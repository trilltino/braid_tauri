//! Braid Mail Module - Server Side
//!
//! The server subscribes to external mail feeds and caches them locally.
//! Clients fetch feed data from the server via HTTP API.
//! When user clicks subscribe, messages appear in the UI via Braid protocol.

use crate::config::AppState;
use crate::store::json_store::{JsonChatStore, RoomUpdate, UpdateType};
use anyhow::Result;
use axum::extract::{Path, State};
use axum::response::Json;
use braid_http::{BraidClient, BraidRequest};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

/// Mail feed item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailFeedItem {
    pub id: String,
    pub url: String,
    pub subject: Option<String>,
    pub from: Option<Vec<String>>,
    pub to: Option<Vec<String>>,
    pub date: Option<u64>,
    pub body: Option<String>,
    pub is_network: bool,
}

/// Mail post content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailPost {
    pub url: String,
    pub subject: Option<String>,
    pub from: Option<Vec<String>>,
    pub to: Option<Vec<String>>,
    pub date: Option<u64>,
    pub body: Option<String>,
    pub version: Option<String>,
}

/// Mail subscription state
#[derive(Debug, Clone)]
struct FeedSubscription {
    feed_url: String,
    last_version: Option<String>,
}

/// Mail manager - handles external feed subscriptions
pub struct MailManager {
    store: Arc<JsonChatStore>,
    /// Feed URL -> Subscription state
    subscriptions: Arc<RwLock<HashMap<String, FeedSubscription>>>,
    /// Cached feed items
    feed_items: Arc<RwLock<Vec<MailFeedItem>>>,
    /// Cached posts
    posts: Arc<RwLock<HashMap<String, MailPost>>>,
}

impl MailManager {
    pub fn new(store: Arc<JsonChatStore>) -> Self {
        Self {
            store,
            subscriptions: Arc::new(RwLock::new(HashMap::new())),
            feed_items: Arc::new(RwLock::new(Vec::new())),
            posts: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Subscribe to an external mail feed
    pub async fn subscribe_feed(&self, feed_url: &str) -> Result<()> {
        info!("[MailManager] Subscribing to feed: {}", feed_url);

        let mut subs = self.subscriptions.write().await;
        if subs.contains_key(feed_url) {
            info!("[MailManager] Already subscribed to {}", feed_url);
            return Ok(());
        }

        subs.insert(
            feed_url.to_string(),
            FeedSubscription {
                feed_url: feed_url.to_string(),
                last_version: None,
            },
        );
        drop(subs);

        // Start background task to sync feed
        let feed_url = feed_url.to_string();
        let subscriptions = self.subscriptions.clone();
        let feed_items = self.feed_items.clone();
        let posts = self.posts.clone();

        tokio::spawn(async move {
            if let Err(e) = Self::feed_sync_task(feed_url, subscriptions, feed_items, posts).await {
                error!("[MailManager] Feed sync task failed: {}", e);
            }
        });

        info!("[MailManager] Subscription started");
        Ok(())
    }

    /// Background task to sync feed
    async fn feed_sync_task(
        feed_url: String,
        subscriptions: Arc<RwLock<HashMap<String, FeedSubscription>>>,
        feed_items: Arc<RwLock<Vec<MailFeedItem>>>,
        posts: Arc<RwLock<HashMap<String, MailPost>>>,
    ) -> Result<()> {
        let client = BraidClient::new()?;

        loop {
            // Check if still subscribed
            let sub = {
                let subs = subscriptions.read().await;
                match subs.get(&feed_url) {
                    Some(s) => FeedSubscription {
                        feed_url: s.feed_url.clone(),
                        last_version: s.last_version.clone(),
                    },
                    None => {
                        info!("[MailManager] Subscription ended for {}", feed_url);
                        break;
                    }
                }
            };

            // Fetch feed
            match Self::fetch_feed(&client, &feed_url, sub.last_version.clone()).await {
                Ok((items, new_version)) => {
                    let mut feed_guard = feed_items.write().await;
                    for item in items {
                        // Check if already exists
                        if !feed_guard.iter().any(|i| i.id == item.id) {
                            feed_guard.push(item);
                        }
                    }
                    // Sort by date descending
                    feed_guard.sort_by(|a, b| b.date.cmp(&a.date));
                    drop(feed_guard);

                    // Update last version
                    if let Some(ver) = new_version {
                        let mut subs = subscriptions.write().await;
                        if let Some(s) = subs.get_mut(&feed_url) {
                            s.last_version = Some(ver);
                        }
                    }
                }
                Err(e) => {
                    warn!("[MailManager] Failed to fetch feed: {}", e);
                }
            }

            // Sleep before next sync
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
        }

        Ok(())
    }

    /// Fetch feed from external source
    async fn fetch_feed(
        client: &BraidClient,
        feed_url: &str,
        since_version: Option<String>,
    ) -> Result<(Vec<MailFeedItem>, Option<String>)> {
        let mut req = BraidRequest::new();
        req = req.subscribe();

        if let Some(ver) = since_version {
            req.parents = Some(vec![braid_http::types::Version::new(&ver)]);
        }

        let mut subscription = client.subscribe(feed_url, req).await?;

        let mut items = Vec::new();
        let mut last_version = None;

        // Process first batch of updates
        while let Some(update_result) = subscription.next().await {
            match update_result {
                Ok(update) => {
                    // Get version from extra_headers if available
                    last_version = update.extra_headers.get("version").map(|v| v.to_string());

                    if let Some(body) = &update.body {
                        let body_str = String::from_utf8_lossy(body);
                        let parsed_items = Self::parse_feed_items(&body_str);
                        items.extend(parsed_items);
                    }

                    // Only process first update for now
                    break;
                }
                Err(e) => {
                    warn!("[MailManager] Subscription error: {}", e);
                    break;
                }
            }
        }

        Ok((items, last_version))
    }

    /// Parse feed items from JSON
    fn parse_feed_items(body: &str) -> Vec<MailFeedItem> {
        // Try array of links: ["/post/1", "/post/2"]
        if let Ok(links) = serde_json::from_str::<Vec<String>>(body) {
            return links
                .into_iter()
                .map(|link| MailFeedItem {
                    id: link.clone(),
                    url: link,
                    subject: None,
                    from: None,
                    to: None,
                    date: None,
                    body: None,
                    is_network: true,
                })
                .collect();
        }

        // Try array of objects
        if let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(body) {
            return items
                .into_iter()
                .filter_map(|v| {
                    let link = v
                        .get("link")
                        .and_then(|l| l.as_str())
                        .or_else(|| v.as_str())?;
                    Some(MailFeedItem {
                        id: link.to_string(),
                        url: link.to_string(),
                        subject: v
                            .get("subject")
                            .and_then(|s| s.as_str())
                            .map(|s| s.to_string()),
                        from: v
                            .get("from")
                            .and_then(|f| serde_json::from_value(f.clone()).ok()),
                        to: v
                            .get("to")
                            .and_then(|t| serde_json::from_value(t.clone()).ok()),
                        date: v.get("date").and_then(|d| d.as_u64()),
                        body: v
                            .get("body")
                            .and_then(|b| b.as_str())
                            .map(|s| s.to_string()),
                        is_network: true,
                    })
                })
                .collect();
        }

        warn!("[MailManager] Failed to parse feed body");
        Vec::new()
    }

    /// Fetch a specific post
    pub async fn fetch_post(&self, url: &str) -> Result<MailPost> {
        // Check cache first
        {
            let posts = self.posts.read().await;
            if let Some(post) = posts.get(url) {
                return Ok(post.clone());
            }
        }

        // Fetch from network
        let client = BraidClient::new()?;
        let req = BraidRequest::new();
        let resp = client.fetch(url, req).await?;
        let body = String::from_utf8_lossy(&resp.body);

        let json: serde_json::Value = serde_json::from_str(&body)?;
        let post = MailPost {
            url: url.to_string(),
            date: json.get("date").and_then(|v| v.as_u64()).map(|v| v * 1000),
            from: json
                .get("from")
                .and_then(|v| serde_json::from_value(v.clone()).ok()),
            to: json
                .get("to")
                .and_then(|v| serde_json::from_value(v.clone()).ok()),
            subject: json
                .get("subject")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            body: json
                .get("body")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            version: resp.headers.get("version").map(|s| s.to_string()),
        };

        // Cache it
        self.posts
            .write()
            .await
            .insert(url.to_string(), post.clone());

        Ok(post)
    }

    /// Get all feed items
    pub async fn get_feed_items(&self) -> Vec<MailFeedItem> {
        self.feed_items.read().await.clone()
    }

    /// Get cached posts
    pub async fn get_posts(&self) -> Vec<MailPost> {
        self.posts.read().await.values().cloned().collect()
    }

    /// Check if subscribed to any feed
    pub async fn is_subscribed(&self) -> bool {
        !self.subscriptions.read().await.is_empty()
    }

    /// Send a mail post
    pub async fn send_mail(&self, post: MailPost) -> Result<String> {
        let client = BraidClient::new()?;

        let body_json = serde_json::json!({
            "subject": post.subject,
            "body": post.body,
            "from": post.from,
            "to": post.to,
            "date": post.date.map(|d| d / 1000),
        });

        let url = if post.url.is_empty() {
            format!("https://mail.braid.org/post/{}", uuid::Uuid::new_v4())
        } else {
            post.url.clone()
        };

        let req = BraidRequest::new();
        client.put(&url, &body_json.to_string(), req).await?;

        // Cache the sent post
        self.posts.write().await.insert(url.clone(), post);

        Ok(url)
    }
}

/// API: Subscribe to mail feed
pub async fn subscribe_mail(
    State(state): State<AppState>,
    Json(req): Json<SubscribeMailRequest>,
) -> Result<Json<SubscribeMailResponse>, axum::http::StatusCode> {
    let feed_url = req
        .feed_url
        .unwrap_or_else(|| "https://mail.braid.org/feed".to_string());

    match state.mail_manager.subscribe_feed(&feed_url).await {
        Ok(_) => Ok(Json(SubscribeMailResponse {
            success: true,
            message: "Subscribed to mail feed".to_string(),
        })),
        Err(e) => {
            error!("[MailAPI] Subscribe failed: {}", e);
            Err(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// API: Get mail feed
pub async fn get_mail_feed(
    State(state): State<AppState>,
) -> Result<Json<Vec<MailFeedItem>>, axum::http::StatusCode> {
    let items = state.mail_manager.get_feed_items().await;
    Ok(Json(items))
}

/// API: Get a specific mail post
pub async fn get_mail_post(
    Path(url): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<MailPost>, axum::http::StatusCode> {
    // Note: URL is passed as path parameter, may need decoding on client side
    match state.mail_manager.fetch_post(&url).await {
        Ok(post) => Ok(Json(post)),
        Err(e) => {
            error!("[MailAPI] Fetch post failed: {}", e);
            Err(axum::http::StatusCode::NOT_FOUND)
        }
    }
}

/// API: Check subscription status
pub async fn is_subscribed(
    State(state): State<AppState>,
) -> Result<Json<bool>, axum::http::StatusCode> {
    Ok(Json(state.mail_manager.is_subscribed().await))
}

/// API: Send mail
pub async fn send_mail(
    State(state): State<AppState>,
    Json(req): Json<SendMailRequest>,
) -> Result<Json<SendMailResponse>, axum::http::StatusCode> {
    let post = MailPost {
        url: String::new(),
        subject: req.subject,
        from: Some(vec![req.from]),
        to: Some(req.to),
        date: Some(chrono::Utc::now().timestamp_millis() as u64),
        body: req.body,
        version: None,
    };

    match state.mail_manager.send_mail(post).await {
        Ok(url) => Ok(Json(SendMailResponse { success: true, url })),
        Err(e) => {
            error!("[MailAPI] Send mail failed: {}", e);
            Err(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Request/Response types

#[derive(Debug, Serialize, Deserialize)]
pub struct SubscribeMailRequest {
    pub feed_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SubscribeMailResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendMailRequest {
    pub subject: Option<String>,
    pub from: String,
    pub to: Vec<String>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendMailResponse {
    pub success: bool,
    pub url: String,
}
