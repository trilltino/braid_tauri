// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, error};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use xf_tauri::commands;
use xf_tauri::commands::BraidAppState;
use xf_tauri::chat::ChatManager;

fn init_tracing() -> tracing_appender::non_blocking::WorkerGuard {
    let file_appender = tracing_appender::rolling::never("logs", "braid.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "xf_tauri=debug,braid_rs=debug,info".into());

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
        .init();
    
    guard
}

fn main() {
    // Initialize directory structure
    let storage_dir = braid_common::init_structure()
        .expect("Failed to initialize directory structure");
    
    let _ = braid_common::migrate_legacy_paths();
    
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "xf_tauri=debug,braid_rs=debug,info");
    }

    let _guard = init_tracing();
    info!("Starting Braid Tauri App - PURE BRAID PROTOCOL MODE");

    // Use tauri's async runtime
    tauri::async_runtime::block_on(async move {
        // Initialize PURE BRAID CLIENT
        let chat_server_url = env::var("CHAT_SERVER_URL")
            .unwrap_or_else(|_| "http://localhost:3001".to_string());
        
        let chat_manager = ChatManager::new(chat_server_url)
            .expect("Failed to initialize ChatManager");
        
        info!("[App] BraidClient initialized - Using PURE BRAID PROTOCOL (NO SSE)");

        // Create Braid app state
        let braid_state = BraidAppState {
            client: Arc::new(Mutex::new(chat_manager)),
        };

        // Initialize local sync
        if let Err(e) = xf_tauri::local_sync::init(storage_dir.clone()).await {
            error!("Failed to initialize local sync: {}", e);
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
                    xf_tauri::local_sync::set_app_handle(handle.clone());
                    
                    // Ensure default file exists
                    let braid_org = braid_common::braid_org_dir();
                    tauri::async_runtime::spawn(async move {
                        let welcome_path = braid_org.join("Welcome.md");
                        if !welcome_path.exists() {
                            let _ = std::fs::write(&welcome_path, "# Welcome to Braid\n\nEdit this file locally or in the app!\nClick 'Sync Change' to save.");
                        }
                    });

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
                commands::send_message_braid,
                commands::get_messages_braid,
                commands::start_braid_subscription,
                commands::stop_braid_subscription,
                commands::sync_drafts_braid,
                commands::upload_file_braid,
                
                // MAIL/FEED COMMANDS
                commands::subscribe_braid_mail,
                commands::is_braid_mail_subscribed,
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
