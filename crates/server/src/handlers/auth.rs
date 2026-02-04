//! Auth handlers

use crate::config::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

#[derive(Debug, Deserialize)]
pub struct SignupRequest {
    pub email: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user_id: String,
    pub username: String,
}

#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub id: String,
    pub email: String,
    pub username: String,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

/// POST /auth/signup
pub async fn signup(
    State(state): State<AppState>,
    Json(req): Json<SignupRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    info!("POST /auth/signup - {}", req.email);
    
    match state.auth.signup(req.email.clone(), req.username.clone(), req.password.clone()).await {
        Ok(user) => {
            // Create session
            match state.auth.login(req.email.clone(), req.password.clone()).await {
                Ok((_, session)) => {
                    info!("User {} registered successfully", req.email);
                    Ok(Json(AuthResponse {
                        token: session.token,
                        user_id: user.id,
                        username: user.username,
                    }))
                }
                Err(e) => {
                    warn!("Login after signup failed: {}", e);
                    Err((StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                        error: "Account created but login failed".to_string(),
                    })))
                }
            }
        }
        Err(e) => {
            warn!("Signup failed for {}: {}", req.email, e);
            Err((StatusCode::BAD_REQUEST, Json(ErrorResponse {
                error: e.to_string(),
            })))
        }
    }
}

/// POST /auth/login
pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    info!("POST /auth/login - {}", req.email);
    
    match state.auth.login(req.email.clone(), req.password.clone()).await {
        Ok((user, session)) => {
            info!("User {} logged in successfully", req.email);
            Ok(Json(AuthResponse {
                token: session.token.clone(),
                user_id: user.id,
                username: user.username,
            }))
        }
        Err(e) => {
            warn!("Login failed for {}: {}", req.email, e);
            Err((StatusCode::UNAUTHORIZED, Json(ErrorResponse {
                error: "Invalid credentials".to_string(),
            })))
        }
    }
}

/// POST /auth/logout
pub async fn logout(
    State(_state): State<AppState>,
) -> StatusCode {
    info!("POST /auth/logout");
    // In a real implementation, we would invalidate the session
    // For now, just return OK
    StatusCode::OK
}

/// GET /auth/me
pub async fn me(
    State(_state): State<AppState>,
) -> Result<Json<UserInfo>, StatusCode> {
    info!("GET /auth/me");
    // In a real implementation, extract token from headers
    // and return user info
    Err(StatusCode::NOT_IMPLEMENTED)
}

/// GET /users
pub async fn list_users(
    State(_state): State<AppState>,
) -> Result<Json<Vec<UserInfo>>, StatusCode> {
    info!("GET /users");
    // Return list of users
    let users = vec![];
    Ok(Json(users))
}
