// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error, info};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use local_link::chat::ChatManager;
use local_link::commands;
use local_link::commands::LocalLinkAppState;

fn init_tracing() -> tracing_appender::non_blocking::WorkerGuard {
    let file_appender = tracing_appender::rolling::never("logs", "locallink.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "local_link=debug,braid_rs=debug,info".into());

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
        .init();

    guard
}

fn main() {
    // 1. Try to load persistent root preference
    // 1. Initialize directory structure
    // This now automatically loads the persistent root from config if it exists
    let storage_dir =
        braid_common::init_structure().expect("Failed to initialize directory structure");

    let _ = braid_common::migrate_legacy_paths();

    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "local_link=debug,braid_rs=debug,info");
    }

    let _guard = init_tracing();
    info!("Starting LocalLink App - PURE BRAID PROTOCOL MODE");

    // Use tauri's async runtime
    tauri::async_runtime::block_on(async move {
        // Initialize PURE BRAID CLIENT
        let chat_server_url =
            env::var("CHAT_SERVER_URL").unwrap_or_else(|_| "http://localhost:3001".to_string());

        let chat_manager =
            ChatManager::new(chat_server_url).expect("Failed to initialize ChatManager");

        // info!("[App] LocalLinkClient initialized - Using PURE BRAID PROTOCOL (NO SSE)");

        // Create LocalLink app state
        let braid_state = LocalLinkAppState {
            client: Arc::new(Mutex::new(chat_manager)),
        };

        // Initialize local sync
        if let Err(e) = local_link::local_sync::init(storage_dir.clone()).await {
            error!("Failed to initialize local sync: {}", e);
        }

        // EMBEDDED BRAIDFS DAEMON
        // we set the BRAID_ROOT to the user's storage directory so the daemon uses the correct path
        env::set_var("BRAID_ROOT", storage_dir.to_string_lossy().to_string());

        // Spawn the daemon in the background
        // Only run if not skipped via env var (e.g. for specialized testing)
        if env::var("XF_SKIP_DAEMON").is_err() {
            info!("Spawning Embedded BraidFS Daemon on port 45678...");
            tauri::async_runtime::spawn(async move {
                if let Err(e) = braid_core::fs::run_daemon(45678).await {
                    error!("Embedded Daemon Failed: {}", e);
                    // If address in use, it means another daemon is likely running.
                    // We log it but don't crash the app, assuming the user might intend this.
                }
            });
        }

        let builder = tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_fs::init())
            .plugin(tauri_plugin_http::init())
            .plugin(tauri_plugin_dialog::init())
            .manage(braid_state)
            .setup({
                move |app| {
                    let handle = app.handle().clone();

                    // Set app handle for local sync
                    local_link::local_sync::set_app_handle(handle.clone());

                    // Ensure Braid.org wiki is synced on startup - REMOVED per user request
                    // tauri::async_runtime::spawn(async move {
                    //     if let Err(e) = commands::download_default_wiki().await {
                    //         tracing::warn!("[Startup] Failed to sync Braid Wiki: {}", e);
                    //     }
                    // });

                    Ok(())
                }
            })
            .invoke_handler(tauri::generate_handler![
                // Legacy commands
                commands::greet,
                commands::signup,
                commands::login,
                // PURE BRAID COMMANDS (NO SSE!)
                commands::signup_braid,
                commands::login_braid,
                commands::send_friend_request_braid,
                commands::get_pending_requests_braid,
                commands::respond_to_request_braid,
                commands::get_contacts_braid,
                commands::get_conversations_braid,
                commands::create_conversation_braid,
                commands::create_ai_chat_braid,
                commands::send_message_braid,
                commands::get_messages_braid,
                commands::start_braid_subscription,
                commands::stop_braid_subscription,
                commands::sync_drafts_braid,
                commands::get_sync_status_braid,
                commands::upload_file_braid,
                commands::send_message_with_file_braid,
                // MAIL/FEED COMMANDS
                commands::subscribe_braid_mail,
                commands::is_braid_mail_subscribed,
                commands::set_mail_auth,
                commands::get_mail_feed,
                commands::get_mail_feed_braid,
                commands::send_mail,
                // EXPLORER / SYNC EDITOR COMMANDS
                commands::get_braid_explorer_tree,
                commands::read_explorer_file,
                commands::write_explorer_file,
                commands::read_sync_editor_file,
                commands::set_sync_editor_cookie,
                commands::add_braid_sync_subscription,
                commands::get_sync_editor_page,
                commands::setup_user_storage,
                commands::get_default_storage_base,
                commands::download_default_wiki,
                commands::is_storage_setup,
                commands::get_braid_root,
                commands::get_server_config,
                commands::create_local_page,
            ]);

        let app = builder
            .build(tauri::generate_context!())
            .expect("error while building tauri application");

        app.run(|_app_handle, event| match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                info!("BraidFS: Shutdown requested. Cleaning up...");
            }
            _ => {}
        });
    });
}
