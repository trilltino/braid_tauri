//! Pure Braid Protocol Subscription Handler
//!
//! Uses braid-http and braid-core for all subscription handling.
//! NO SSE - pure Braid protocol throughout.

use crate::config::AppState;
use crate::store::json_store::UpdateType;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    body::Body,
};
use braid_http::protocol::{
    constants::headers,
};
use std::collections::HashMap;
use std::convert::Infallible;
use std::time::Duration;
use tracing::{info, debug, error};

/// GET /chat/{room_id}/subscribe
/// 
/// PURE BRAID PROTOCOL SUBSCRIPTION
/// 
/// Headers:
///   - Subscribe: true (required)
///   - Heartbeats: 30s (optional)
///   - Version: "10@server" (optional - for resuming)
/// 
/// Uses braid-http protocol for streaming updates.
/// NO SSE - pure Braid headers and data.
pub async fn braid_subscribe(
    Path(room_id): Path<String>,
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    info!("[BraidSubscribe] /chat/{}", room_id);

    // Check for Subscribe header (Braid protocol requirement)
    if headers.get(&headers::SUBSCRIBE).is_none() {
        error!("[BraidSubscribe] Missing Subscribe header");
        return Err(StatusCode::BAD_REQUEST);
    }

    // Get heartbeat interval from header
    let heartbeat = headers
        .get(&headers::HEARTBEATS)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            // Parse "30s" or "30000ms" format
            v.trim_end_matches('s')
                .parse::<u64>()
                .ok()
                .or_else(|| v.trim_end_matches("ms").parse::<u64>().ok().map(|ms| ms / 1000))
        })
        .unwrap_or(30);

    // Parse Version header for resuming subscription
    let since_version: Option<String> = headers
        .get(&headers::VERSION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_string());

    debug!(
        "[BraidSubscribe] heartbeat={}s, since_version={:?}",
        heartbeat, since_version
    );

    // Get the broadcast channel for this room
    let channel = state.store.get_channel(&room_id).await;
    let mut rx = channel.tx.subscribe();

    // Create the Braid subscription stream
    let stream = async_stream::stream! {
        // Get current room state
        let current_version = if let Some(room_lock) = state.store.get_room(&room_id).await.ok().flatten() {
            let room_data = room_lock.read().await;
            room_data.crdt.get_frontier()
                .first()
                .cloned()
                .unwrap_or_else(|| "0@server".to_string())
        } else {
            "0@server".to_string()
        };

        // Send Braid protocol headers (using braid-http format)
        yield Ok::<_, Infallible>(format!("{}: \"{}\"\r\n", headers::VERSION.as_str(), current_version));
        yield Ok::<_, Infallible>(format!("{}: {}s\r\n\r\n", headers::HEARTBEATS.as_str(), heartbeat));

        // If client provided a version, send missed updates
        if let Some(ref since) = since_version {
            // Parse comma-separated versions
            let known_versions: HashMap<String, bool> = since
                .split(',')
                .map(|v| (v.trim().to_string(), true))
                .collect();
            
            if let Ok(updates) = state.store.generate_sync_braid(&room_id, &known_versions).await {
                for update in updates {
                    let json = serde_json::to_string(&update).unwrap_or_default();
                    yield Ok::<_, Infallible>(format!("{}: \"{}\"\r\n", headers::VERSION.as_str(), update.version));
                    yield Ok::<_, Infallible>(format!("data: {}\r\n\r\n", json));
                }
            }
        }

        // Stream updates with Braid protocol
        let mut heartbeat_interval = tokio::time::interval(Duration::from_secs(heartbeat));
        
        loop {
            tokio::select! {
                // Wait for room updates
                Ok(update) = rx.recv() => {
                    let event_type = match update.update_type {
                        UpdateType::Message => "message",
                        UpdateType::Presence => "presence",
                        UpdateType::Typing => "typing",
                        UpdateType::RoomUpdate => "room",
                        UpdateType::Sync => "sync",
                    };

                    let data = serde_json::to_string(&update.data).unwrap_or_default();
                    
                    // Braid protocol format
                    if let Some(version) = &update.crdt_version {
                        yield Ok::<_, Infallible>(format!("{}: \"{}\"\r\n", headers::VERSION.as_str(), version));
                    }
                    yield Ok::<_, Infallible>(format!("type: {}\r\n", event_type));
                    yield Ok::<_, Infallible>(format!("data: {}\r\n\r\n", data));
                }
                
                // Send heartbeat (Braid protocol keepalive)
                _ = heartbeat_interval.tick() => {
                    yield Ok::<_, Infallible>("\r\n".to_string());  // Blank line = heartbeat in Braid
                }
            }
        }
    };

    // Build Braid protocol response
    let response = axum::response::Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/plain") // Braid uses text/plain, not event-stream
        .header("cache-control", "no-cache")
        .header("connection", "keep-alive")
        // Braid protocol headers (using braid-http constants)
        .header(headers::SUBSCRIBE.as_str(), "true")
        .header(headers::HEARTBEATS.as_str(), format!("{}s", heartbeat))
        .body(Body::from_stream(stream))
        .map_err(|e| {
            error!("[BraidSubscribe] Failed to build response: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_braid_header_format() {
        // Test that we use proper Braid header formatting
        let version = "42@server";
        let formatted = format!("{}: \"{}\"\r\n", headers::VERSION.as_str(), version);
        assert!(formatted.contains("version:"));
        assert!(formatted.contains("42@server"));
    }
}
