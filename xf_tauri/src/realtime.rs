use crate::models::RealtimeEvent;
use tokio::sync::broadcast;

/// Real-time update event broadcast (following xfmail guidance)
pub type RealtimeEventBroadcast = broadcast::Sender<RealtimeEvent>;

/// Helper to broadcast an event
pub async fn broadcast_event(
    broadcast_tx: &RealtimeEventBroadcast,
    event: RealtimeEvent,
) -> usize {
    match broadcast_tx.send(event) {
        Ok(subscriber_count) => {
            tracing::info!("[Realtime] Event broadcast to {} subscribers", subscriber_count);
            subscriber_count
        }
        Err(e) => {
            tracing::debug!("[Realtime] No subscribers to receive event: {:?}", e);
            0
        }
    }
}
