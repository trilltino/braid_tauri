use crate::backend::SharedState;
use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::IntoResponse,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{Duration, Utc};
use jsonwebtoken::{encode, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
}

#[derive(Debug, Deserialize)]
pub struct AuthPayload {
    pub email: String,
    pub password: String,
    pub username: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub username: String,
    pub email: Option<String>,
    pub id: Option<String>,
}

const JWT_SECRET: &[u8] = b"your_ultra_secure_secret"; // In a real app, use environment variables

// --- Axum Handlers ---

pub async fn signup(
    State(state): State<SharedState>,
    Json(payload): Json<AuthPayload>,
) -> impl IntoResponse {
    let pool = &state.0.pool;
    let username = payload.username.unwrap_or_else(|| {
        payload
            .email
            .split('@')
            .next()
            .unwrap_or("User")
            .to_string()
    });

    match signup_db(pool, payload.email, payload.password, username).await {
        Ok(res) => (StatusCode::CREATED, Json(res)).into_response(),
        Err(_) => (StatusCode::CONFLICT, "User already exists").into_response(),
    }
}

pub async fn login(
    State(state): State<SharedState>,
    Json(payload): Json<AuthPayload>,
) -> impl IntoResponse {
    let pool = &state.0.pool;
    match login_db(pool, payload.email, payload.password).await {
        Ok(res) => (StatusCode::OK, Json(res)).into_response(),
        Err(_) => (StatusCode::UNAUTHORIZED, "Invalid credentials").into_response(),
    }
}

// --- Shared Logic ---

pub async fn signup_db(
    pool: &sqlx::SqlitePool,
    email: String,
    password: String,
    username: String,
) -> anyhow::Result<AuthResponse> {
    let id = Uuid::new_v4().to_string();
    let password_hash = hash(password, DEFAULT_COST)?;

    sqlx::query("INSERT INTO users (id, email, password_hash, username, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)")
        .bind(&id)
        .bind(&email)
        .bind(&password_hash)
        .bind(&username)
        .execute(pool)
        .await?;

    // Create token
    let token = create_token(&id).map_err(|e| anyhow::anyhow!("Token error: {}", e))?;

    Ok(AuthResponse {
        token,
        username,
        email: Some(email),
        id: Some(id),
    })
}

pub async fn login_db(
    pool: &sqlx::SqlitePool,
    email: String,
    password: String,
) -> anyhow::Result<AuthResponse> {
    let row = sqlx::query("SELECT id, username, email, password_hash FROM users WHERE email = ?")
        .bind(&email)
        .fetch_optional(pool)
        .await?;

    if let Some(row) = row {
        let db_hash: String = row.get("password_hash");
        let id: String = row.get("id");
        let username: String = row.get("username");
        let email: String = row.get("email");

        if verify(&password, &db_hash)? {
            let token = create_token(&id).map_err(|e| anyhow::anyhow!("Token error: {}", e))?;
            Ok(AuthResponse {
                token,
                username,
                email: Some(email),
                id: Some(id),
            })
        } else {
            Err(anyhow::anyhow!("Invalid password"))
        }
    } else {
        Err(anyhow::anyhow!("User not found"))
    }
}

fn create_token(user_id: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let expiration = Utc::now()
        .checked_add_signed(Duration::days(30))
        .expect("valid timestamp")
        .timestamp();

    let claims = Claims {
        sub: user_id.to_owned(),
        exp: expiration as usize,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(JWT_SECRET),
    )
}
