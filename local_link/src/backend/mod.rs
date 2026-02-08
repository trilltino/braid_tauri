pub mod db;
pub mod messaging;

use crate::chat::ChatManager;
use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing::{error, info};

pub struct ServerState {
    pub pool: sqlx::SqlitePool,
    pub chat_manager: Arc<ChatManager>,
    pub broadcaster: crate::realtime::RealtimeEventBroadcast,
}

#[derive(Clone)]
pub struct SharedState(pub Arc<ServerState>);

pub async fn start_server(
    pool: sqlx::SqlitePool,
    chat_manager: Arc<ChatManager>,
    broadcaster: crate::realtime::RealtimeEventBroadcast,
) {
    let state = SharedState(Arc::new(ServerState {
        pool,
        chat_manager,
        broadcaster,
    }));

    let app = Router::new()
        // Auth
        .route("/api/auth/signup", post(crate::auth::signup))
        .route("/api/auth/login", post(crate::auth::login))
        // Messaging & Contacts
        .route("/api/contacts", get(messaging::list_contacts))
        .route("/api/friends/request", post(messaging::send_friend_request))
        .route(
            "/api/friends/pending",
            get(messaging::list_pending_requests),
        )
        .route(
            "/api/friends/respond",
            post(messaging::respond_friend_request),
        )
        // Direct Messaging
        .route(
            "/api/conversations",
            get(messaging::list_conversations).post(messaging::create_conversation),
        )
        .route(
            "/api/conversations/{id}/messages",
            get(messaging::list_messages),
        )
        .route("/api/messages", post(messaging::send_message_db))
        .route("/api/ai_chat/create", post(messaging::create_ai_chat))
        .route("/api/ai_chat/invite", post(messaging::generate_invite))
        .route("/api/ai_chat/join", post(messaging::join_ai_chat))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));

    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            info!("Backend listening on {}", addr);
            if let Err(e) = axum::serve(listener, app).await {
                error!("Axum server error: {}", e);
            }
        }
        Err(e) => {
            error!(
                "Failed to bind to port 3000 (Backend might already be running): {}",
                e
            );
        }
    }
}
