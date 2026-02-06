//! Braid Tauri Chat Server Library
//!
//! Pure Braid protocol implementation using existing braid crates.

pub mod ai;
pub mod auth;
pub mod config;
pub mod crdt;
pub mod daemon;
pub mod friends;
pub mod handlers;
pub mod mail;
pub mod models;
pub mod protocol;
pub mod store;
pub mod wiki;

use axum::{routing::get, Router};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn, Level};
use tracing_subscriber::FmtSubscriber;

use ai::{AiChatManager, AiConfig};
use auth::AuthManager;
use config::{AppState, ChatServerConfig};
use daemon::DaemonIntegration;
use friends::FriendManager;
use handlers::{
    // Pure Braid subscription
    braid_subscribe,
    clear_drafts,
    get_blob,
    // Chat - pure Braid protocol
    get_chat_room,
    get_drafts,
    // Presence
    get_presence,
    // Room management
    get_room_status,
    get_typing,
    list_friends,
    list_pending_requests,
    list_users,
    login,
    logout,
    me,
    put_message,
    respond_friend_request,
    save_draft,
    // Friends
    send_friend_request,
    // Typing
    send_typing,
    // Auth
    signup,
    update_presence,
    update_profile,
    // Blob
    upload_blob,
    list_rooms,
};
use mail::{get_mail_feed, get_mail_post, is_subscribed, send_mail, set_mail_auth, subscribe_mail, MailManager};
use store::JsonChatStore;
use wiki::WikiManager;

pub async fn run() -> anyhow::Result<()> {
    // Initialize tracing
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    if tracing::subscriber::set_global_default(subscriber).is_err() {
        // Already set, ignore
    }

    info!("=== Braid Server ===");
    info!("Protocol: Pure Braid (braid-core + braid-http)");
    info!("Features: Auth | CRDT Storage | Blob | Daemon | AI Chat");

    // Get BRAID_ROOT from environment or default
    let braid_root = std::env::var("BRAID_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("braid_sync"));

    // Initialize configuration
    let config = ChatServerConfig::with_base_dir(&braid_root);
    config.ensure_dirs().await?;

    info!("Storage directory: {:?}", config.storage_dir);
    info!("Users database: {:?}", braid_root.join("users.sqlite"));

    // Initialize Auth Manager
    let auth_manager = Arc::new(AuthManager::new(&braid_root).await?);
    info!("Auth Manager initialized");

    // Initialize Friend Manager
    let friend_manager = Arc::new(FriendManager::new(&braid_root).await?);
    info!("Friend Manager initialized");

    // Initialize JSON-based chat store with CRDT (from braid-core)
    let store = Arc::new(JsonChatStore::new(config.clone()).await?);
    info!("JSON ChatStore with CRDT initialized");

    // Initialize AI Chat Manager
    let ai_manager = if std::env::var("DISABLE_AI").is_err() {
        let ai_config = AiConfig::default();
        let ai = Arc::new(AiChatManager::new(ai_config, store.clone(), &config.storage_dir).await?);

        if let Err(e) = ai.start_watching().await {
            warn!("Failed to start AI file watcher: {}", e);
        }

        info!("[@BraidBot] AI Chat Manager initialized");
        Some(ai)
    } else {
        info!("[@BraidBot] AI Chat Manager disabled");
        None
    };

    // Initialize Daemon Integration (braidfs-daemon)
    let daemon = if config.enable_daemon {
        match DaemonIntegration::new(config.clone(), store.clone()).await {
            Ok((daemon_integration, file_events_rx)) => {
                let daemon = Arc::new(daemon_integration);
                let daemon_clone = daemon.clone();
                tokio::spawn(async move {
                    daemon::file_watcher_task(file_events_rx, daemon_clone).await;
                });
                info!(
                    "Daemon Integration (braidfs-daemon) initialized on port {}",
                    config.daemon_port
                );
                Some(daemon)
            }
            Err(e) => {
                warn!("Failed to initialize daemon integration: {}", e);
                None
            }
        }
    } else {
        info!("Daemon Integration disabled");
        None
    };

    // Initialize Mail Manager
    let mail_manager = Arc::new(MailManager::new(store.clone()));
    info!("Mail Manager initialized");

    // Initialize Wiki Manager
    let wiki_manager = Arc::new(WikiManager::new(
        config.daemon_port,
        braid_common::braid_org_dir(),
    ));
    if let Err(e) = wiki_manager.start_discovery().await {
        warn!("Failed to start Wiki discovery: {}", e);
    }
    info!("Wiki Manager initialized & discovery started");

    // Create app state
    let app_state = AppState {
        store: store.clone(),
        auth: auth_manager.clone(),
        friends: friend_manager.clone(),
        ai_manager: ai_manager.clone(),
        daemon: daemon.clone(),
        mail_manager: mail_manager.clone(),
        wiki_manager: wiki_manager.clone(),
    };

    // Build router with pure Braid protocol
    let app = Router::new()
        // Auth endpoints
        .route("/auth/signup", axum::routing::post(signup))
        .route("/auth/login", axum::routing::post(login))
        .route("/auth/logout", axum::routing::post(logout))
        .route("/auth/me", axum::routing::get(me))
        .route("/auth/profile/{user_id}", axum::routing::put(update_profile))
        .route("/users", get(list_users))
        // Core Braid protocol endpoints (NO SSE)
        .route("/chat/rooms", get(list_rooms))
        .route("/chat/{room_id}", get(get_chat_room).put(put_message))
        // Pure Braid subscription - NO SSE, uses braid-http protocol
        .route("/chat/{room_id}/subscribe", get(braid_subscribe))
        // Blob endpoints (braid-blob)
        .route("/blobs", axum::routing::post(upload_blob))
        .route("/blobs/{hash}", get(get_blob))
        // Room status and offline support
        .route("/chat/{room_id}/status", get(get_room_status))
        .route(
            "/chat/{room_id}/drafts",
            get(get_drafts).post(save_draft).delete(clear_drafts),
        )
        // Friends system
        .route("/friends", get(list_friends))
        .route(
            "/friends/requests",
            get(list_pending_requests).post(send_friend_request),
        )
        .route(
            "/friends/requests/{request_id}",
            axum::routing::put(respond_friend_request),
        )
        // Chat-specific extensions
        .route(
            "/chat/{room_id}/presence",
            get(get_presence).put(update_presence),
        )
        .route("/chat/{room_id}/typing", get(get_typing).put(send_typing))
        // Mail/Feed endpoints
        .route("/mail/subscribe", axum::routing::post(subscribe_mail))
        .route("/mail/feed", get(get_mail_feed))
        .route("/mail/subscribed", get(is_subscribed))
        .route("/mail/post/{url}", get(get_mail_post))
        .route("/mail/send", axum::routing::post(send_mail))
        .route("/mail/auth", axum::routing::post(set_mail_auth))
        // Health check
        .route("/health", get(health_check))
        .with_state(app_state)
        .layer(tower_http::cors::CorsLayer::permissive())
        .layer(tower_http::trace::TraceLayer::new_for_http());

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], 3001));
    info!("");
    info!("╔════════════════════════════════════════════════════════════╗");
    info!("║  Braid Chat Server Running                                 ║");
    info!("║  Address: http://localhost:3001                            ║");
    info!("╚════════════════════════════════════════════════════════════╝");
    info!("");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check() -> &'static str {
    "OK - Braid Chat Server (Pure Braid Protocol)"
}
