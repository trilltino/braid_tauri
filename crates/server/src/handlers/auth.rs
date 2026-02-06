//! Auth handlers

use crate::config::AppState;
use axum::{
    extract::{State, Path},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

#[derive(Debug, Deserialize)]
pub struct SignupRequest {
    pub email: String,
    pub username: String,
    pub password: String,
    pub avatar_blob_hash: Option<String>,
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
    pub avatar_blob_hash: Option<String>,
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
    
    match state.auth.signup(req.email.clone(), req.username.clone(), req.password.clone(), req.avatar_blob_hash).await {
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
        State(state): State<AppState>,
    ) -> Result<Json<Vec<UserInfo>>, StatusCode> {
        info!("GET /users");
        match state.auth.list_users().await {
            Ok(users) => {
                let info = users.into_iter().map(|u| UserInfo {
                    id: u.id,
                    email: u.email,
                    username: u.username,
                    avatar_blob_hash: u.avatar_blob_hash,
                }).collect();
                Ok(Json(info))
            },
            Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
        }
    }
    
    #[derive(Debug, Deserialize)]
    pub struct UpdateProfileRequest {
        pub username: Option<String>,
        pub email: Option<String>,
        pub password: Option<String>,
        pub avatar_blob_hash: Option<String>,
    }
    
    /// PUT /auth/profile
    pub async fn update_profile(
        State(state): State<AppState>,
        // In a real app, extract user_id from token
        Path(user_id): Path<String>,
        Json(req): Json<UpdateProfileRequest>,
    ) -> Result<Json<UserInfo>, (StatusCode, Json<ErrorResponse>)> {
        info!("PUT /auth/profile - {}", user_id);
        
        match state.auth.update_user(
            &user_id, 
            req.username, 
            req.email, 
            req.password, 
            req.avatar_blob_hash
        ).await {
            Ok(user) => Ok(Json(UserInfo {
                id: user.id,
                email: user.email,
                username: user.username,
                avatar_blob_hash: user.avatar_blob_hash,
            })),
            Err(e) => Err((StatusCode::BAD_REQUEST, Json(ErrorResponse {
                error: e.to_string(),
            }))),
        }
    }
