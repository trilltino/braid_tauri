use std::sync::Arc;

use xf_tauri::backend::db::init_db;
use xf_tauri::backend::messaging::{
    create_conversation_db, send_friend_request_db, send_message_db,
};
use xf_tauri::backend::ServerState;
use xf_tauri::backend::SharedState;
use xf_tauri::chat::ChatManager;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("--- Social Simulation Starting ---");

    // 0. Setup BRAID_ROOT to ensure we use a consistent test DB
    let storage_dir = std::env::current_dir()?.join("test_storage");
    std::env::set_var("BRAID_ROOT", &storage_dir);

    // Initialize directory structure
    braid_common::init_structure()?;
    println!("[0] BRAID_ROOT set to {:?}", storage_dir);

    // 1. Initialize DB
    let pool = init_db().await?;
    let pool_arc = Arc::new(pool);
    println!(
        "[1] Database initialized at {:?}",
        storage_dir.join("data/xfmail.db")
    );

    // 2. Setup Managers
    let chat_manager = Arc::new(ChatManager::new("https://mail.braid.org".to_string())?);
    let (broadcaster, _) = tokio::sync::broadcast::channel(100);

    let server_state = Arc::new(ServerState {
        pool: (*pool_arc).clone(),
        chat_manager,
        broadcaster,
    });
    let shared_state = SharedState(server_state);

    // 3. Create Users with unique timestamps
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();
    let alice_email = format!("alice_{}@example.com", ts);
    let bob_email = format!("bob_{}@example.com", ts);

    println!("[3] Creating Alice ({})...", alice_email);
    let alice_id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO users (id, email, password_hash, username, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)")
        .bind(&alice_id)
        .bind(&alice_email)
        .bind("ph_hash")
        .bind("Alice")
        .execute(&*pool_arc)
        .await?;

    let alice = xf_tauri::auth::AuthResponse {
        token: "f".to_string(),
        username: "Alice".to_string(),
        email: Some(alice_email.clone()),
        id: Some(alice_id),
    };
    println!("[3.1] Alice created.");

    println!("[3.2] Creating Bob ({})...", bob_email);
    let bob_id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO users (id, email, password_hash, username, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)")
        .bind(&bob_id)
        .bind(&bob_email)
        .bind("ph_hash")
        .bind("Bob")
        .execute(&*pool_arc)
        .await?;

    let bob = xf_tauri::auth::AuthResponse {
        token: "f".to_string(),
        username: "Bob".to_string(),
        email: Some(bob_email.clone()),
        id: Some(bob_id),
    };
    println!("[3.3] Bob created.");

    // 4. Friend Request
    send_friend_request_db(
        &pool_arc,
        bob_email.clone(),
        Some("Hi Bob!".to_string()),
        alice_email.clone(),
        "Alice".to_string(),
    )
    .await?;
    println!("[4] Alice sent friend request to Bob.");

    // 5. Bob Accepts (Manual check)
    let (req_id,): (String,) =
        sqlx::query_as("SELECT id FROM friend_requests WHERE from_email = ? AND to_email = ?")
            .bind(&alice_email)
            .bind(&bob_email)
            .fetch_one(&*pool_arc)
            .await?;

    sqlx::query("UPDATE friend_requests SET status = 'accepted', responded_at = CURRENT_TIMESTAMP WHERE id = ?").bind(&req_id).execute(&*pool_arc).await?;
    sqlx::query("INSERT INTO contacts (id, username, email) VALUES (?, ?, ?)")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind("Alice")
        .bind(&alice_email)
        .execute(&*pool_arc)
        .await?;
    sqlx::query("INSERT INTO contacts (id, username, email) VALUES (?, ?, ?)")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind("Bob")
        .bind(&bob_email)
        .execute(&*pool_arc)
        .await?;
    println!("[5] Bob accepted. Contacts established.");

    // 6. Conversation
    let conv = create_conversation_db(
        &pool_arc,
        Some("Direct Simulation".to_string()),
        alice_email.clone(),
        true,
        None,
    )
    .await?;
    println!("[6] Conversation established: {}", conv.id);

    // 7. Messaging
    let msg1 = send_message_db(
        axum::extract::State(shared_state.clone()),
        axum::extract::Json(xf_tauri::backend::messaging::SendMessage {
            conversation_id: conv.id.clone(),
            content: "Hey friend!".to_string(),
            sender: Some(alice_email.clone()),
        }),
    )
    .await
    .map_err(|e| format!("A->B failed: {:?}", e))?;
    println!("  Alice ({}): {}", alice_email, msg1.content);

    let msg2 = send_message_db(
        axum::extract::State(shared_state.clone()),
        axum::extract::Json(xf_tauri::backend::messaging::SendMessage {
            conversation_id: conv.id.clone(),
            content: "Yo Alice!".to_string(),
            sender: Some(bob_email.clone()),
        }),
    )
    .await
    .map_err(|e| format!("B->A failed: {:?}", e))?;
    println!("  Bob ({}): {}", bob_email, msg2.content);

    println!("\n--- FINAL SIMULATION STATE ---");
    let u_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(&*pool_arc)
        .await?;
    let c_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM contacts")
        .fetch_one(&*pool_arc)
        .await?;
    let m_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM messages")
        .fetch_one(&*pool_arc)
        .await?;
    println!("Users in DB: {}", u_count.0);
    println!("Contacts in DB: {}", c_count.0);
    println!("Messages in DB: {}", m_count.0);
    println!("--- SUCCESS ---");

    Ok(())
}
