//! Authentication Module
//!
//! Handles user signup, login, and session management.
//! All user data stored in SQLite database at braid_sync/users.sqlite

use anyhow::{Context, Result};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock;
use tracing::{info, warn};
use uuid::Uuid;

/// User record stored in database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub username: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub created_at: DateTime<Utc>,
    pub last_login: Option<DateTime<Utc>>,
    pub is_active: bool,
}

/// Public user info (no sensitive data)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: String,
    pub email: String,
    pub username: String,
    pub created_at: DateTime<Utc>,
}

impl From<User> for UserInfo {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            email: user.email,
            username: user.username,
            created_at: user.created_at,
        }
    }
}

/// Session token for authenticated requests
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub token: String,
    pub user_id: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

/// Auth manager handles all authentication
pub struct AuthManager {
    db_path: std::path::PathBuf,
    /// In-memory session cache
    sessions: RwLock<HashMap<String, Session>>,
}

impl AuthManager {
    /// Create new auth manager
    pub async fn new(base_dir: &std::path::Path) -> Result<Self> {
        let db_path = base_dir.join("users.sqlite");
        
        let manager = Self {
            db_path,
            sessions: RwLock::new(HashMap::new()),
        };
        
        // Initialize database
        manager.init_db().await?;
        
        info!("[Auth] Initialized at {:?}", manager.db_path);
        
        Ok(manager)
    }

    /// Initialize SQLite database
    async fn init_db(&self) -> Result<()> {
        use sqlx::sqlite::SqlitePoolOptions;
        
        let db_url = format!("sqlite:{}", self.db_path.display());
        let pool = SqlitePoolOptions::new()
            .connect(&db_url)
            .await?;

        // Create users table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                username TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_login TEXT,
                is_active INTEGER DEFAULT 1
            )
            "#,
        )
        .execute(&pool)
        .await?;

        // Create sessions table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
            "#,
        )
        .execute(&pool)
        .await?;

        pool.close().await;
        Ok(())
    }

    /// Get database connection
    async fn get_pool(&self) -> Result<sqlx::SqlitePool> {
        use sqlx::sqlite::SqlitePoolOptions;
        
        let db_url = format!("sqlite:{}", self.db_path.display());
        Ok(SqlitePoolOptions::new().connect(&db_url).await?)
    }

    /// Register a new user
    pub async fn signup(&self, email: String, username: String, password: String) -> Result<User> {
        let pool = self.get_pool().await?;

        // Check if email already exists
        let existing: Option<(String,)> = sqlx::query_as("SELECT id FROM users WHERE email = ?")
            .bind(&email)
            .fetch_optional(&pool)
            .await?;

        if existing.is_some() {
            return Err(anyhow::anyhow!("Email already registered"));
        }

        // Hash password
        let password_hash = hash(&password, DEFAULT_COST)
            .context("Failed to hash password")?;

        // Create user
        let user = User {
            id: Uuid::new_v4().to_string(),
            email: email.clone(),
            username: username.clone(),
            password_hash,
            created_at: Utc::now(),
            last_login: None,
            is_active: true,
        };

        // Insert into database
        sqlx::query(
            "INSERT INTO users (id, email, username, password_hash, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(&user.id)
        .bind(&user.email)
        .bind(&user.username)
        .bind(&user.password_hash)
        .bind(user.created_at.to_rfc3339())
        .bind(user.is_active)
        .execute(&pool)
        .await?;

        pool.close().await;

        info!("[Auth] User registered: {} ({})", username, email);

        Ok(user)
    }

    /// Login user and create session
    pub async fn login(&self, email: String, password: String) -> Result<(User, Session)> {
        let pool = self.get_pool().await?;

        // Find user by email
        let row: Option<(String, String, String, String, String)> = sqlx::query_as(
            "SELECT id, email, username, password_hash, created_at FROM users WHERE email = ? AND is_active = 1"
        )
        .bind(&email)
        .fetch_optional(&pool)
        .await?;

        let (user_id, email, username, password_hash, created_at) = row
            .ok_or_else(|| anyhow::anyhow!("Invalid email or password"))?;

        // Verify password
        let valid = verify(&password, &password_hash)
            .context("Failed to verify password")?;

        if !valid {
            warn!("[Auth] Failed login attempt for {}", email);
            return Err(anyhow::anyhow!("Invalid email or password"));
        }

        // Update last login
        sqlx::query("UPDATE users SET last_login = ? WHERE id = ?")
            .bind(Utc::now().to_rfc3339())
            .bind(&user_id)
            .execute(&pool)
            .await?;

        // Create session
        let session = self.create_session(&pool, &user_id).await?;

        let user = User {
            id: user_id,
            email,
            username,
            password_hash: String::new(), // Don't return hash
            created_at: created_at.parse().unwrap_or_else(|_| Utc::now()),
            last_login: Some(Utc::now()),
            is_active: true,
        };

        pool.close().await;

        info!("[Auth] User logged in: {}", user.username);

        Ok((user, session))
    }

    /// Create new session
    async fn create_session(&self, pool: &sqlx::SqlitePool, user_id: &str) -> Result<Session> {
        let session = Session {
            token: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            created_at: Utc::now(),
            expires_at: Utc::now() + chrono::Duration::days(30),
        };

        sqlx::query(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
        )
        .bind(&session.token)
        .bind(&session.user_id)
        .bind(session.created_at.to_rfc3339())
        .bind(session.expires_at.to_rfc3339())
        .execute(pool)
        .await?;

        // Cache session
        self.sessions.write().await.insert(session.token.clone(), session.clone());

        Ok(session)
    }

    /// Validate session token
    pub async fn validate_session(&self, token: &str) -> Result<UserInfo> {
        // Check cache first
        {
            let sessions = self.sessions.read().await;
            if let Some(session) = sessions.get(token) {
                if session.expires_at > Utc::now() {
                    // Get user info
                    let pool = self.get_pool().await?;
                    let row: Option<(String, String, String, String)> = sqlx::query_as(
                        "SELECT id, email, username, created_at FROM users WHERE id = ?"
                    )
                    .bind(&session.user_id)
                    .fetch_optional(&pool)
                    .await?;
                    pool.close().await;

                    if let Some((id, email, username, created_at)) = row {
                        return Ok(UserInfo {
                            id,
                            email,
                            username,
                            created_at: created_at.parse().unwrap_or_else(|_| Utc::now()),
                        });
                    }
                }
            }
        }

        // Check database
        let pool = self.get_pool().await?;

        let row: Option<(String, String, String, String, String)> = sqlx::query_as(
            r#"
            SELECT u.id, u.email, u.username, u.created_at, s.expires_at 
            FROM users u 
            JOIN sessions s ON u.id = s.user_id 
            WHERE s.token = ?
            "#
        )
        .bind(token)
        .fetch_optional(&pool)
        .await?;

        pool.close().await;

        if let Some((id, email, username, created_at, expires_at)) = row {
            let expires: DateTime<Utc> = expires_at.parse().map_err(|_| anyhow::anyhow!("Invalid date"))?;
            if expires > Utc::now() {
                return Ok(UserInfo {
                    id,
                    email,
                    username,
                    created_at: created_at.parse().unwrap_or_else(|_| Utc::now()),
                });
            }
        }

        Err(anyhow::anyhow!("Invalid or expired session"))
    }

    /// Logout user (invalidate session)
    pub async fn logout(&self, token: &str) -> Result<()> {
        // Remove from cache
        self.sessions.write().await.remove(token);

        // Remove from database
        let pool = self.get_pool().await?;
        sqlx::query("DELETE FROM sessions WHERE token = ?")
            .bind(token)
            .execute(&pool)
            .await?;
        pool.close().await;

        info!("[Auth] Session invalidated");

        Ok(())
    }

    /// Get user by ID
    pub async fn get_user(&self, user_id: &str) -> Result<UserInfo> {
        let pool = self.get_pool().await?;

        let row: Option<(String, String, String, String)> = sqlx::query_as(
            "SELECT id, email, username, created_at FROM users WHERE id = ?"
        )
        .bind(user_id)
        .fetch_optional(&pool)
        .await?;

        pool.close().await;

        if let Some((id, email, username, created_at)) = row {
            Ok(UserInfo {
                id,
                email,
                username,
                created_at: created_at.parse().unwrap_or_else(|_| Utc::now()),
            })
        } else {
            Err(anyhow::anyhow!("User not found"))
        }
    }

    /// List all users (for contact discovery)
    pub async fn list_users(&self) -> Result<Vec<UserInfo>> {
        let pool = self.get_pool().await?;

        let rows: Vec<(String, String, String, String)> = sqlx::query_as(
            "SELECT id, email, username, created_at FROM users WHERE is_active = 1"
        )
        .fetch_all(&pool)
        .await?;

        pool.close().await;

        Ok(rows
            .into_iter()
            .map(|(id, email, username, created_at)| UserInfo {
                id,
                email,
                username,
                created_at: created_at.parse().unwrap_or_else(|_| Utc::now()),
            })
            .collect())
    }
}
