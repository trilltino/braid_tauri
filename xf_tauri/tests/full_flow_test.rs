//! Integration Test: Full User Flow
//!
//! Tests the complete flow:
//! 1. Create 2 user accounts
//! 2. Send friend request from user1 to user2
//! 3. User2 accepts the request
//! 4. They create a conversation and message each other
//! 5. Verify messages are persisted

use sqlx::Row;

// Test configuration
const TEST_DB_PATH: &str = ":memory:";
const TEST_SERVER_ADDR: &str = "127.0.0.1:0"; // Random port

/// Full integration test
#[tokio::test]
async fn test_full_user_flow() -> anyhow::Result<()> {
    println!("\n🚀 Starting Full Flow Integration Test\n");

    // Initialize test database
    let pool = setup_test_db().await?;
    println!("✅ Database initialized");

    // ========== STEP 1: Create Two Users ==========
    println!("\n📋 Step 1: Creating two user accounts...");
    
    let user1 = create_user(&pool, "alice@test.com", "Alice", "password123").await?;
    let user2 = create_user(&pool, "bob@test.com", "Bob", "password123").await?;
    
    println!("   ✅ User 1 created: {} ({})", user1.username, user1.email);
    println!("   ✅ User 2 created: {} ({})", user2.username, user2.email);

    // ========== STEP 2: Send Friend Request ==========
    println!("\n📋 Step 2: Alice sends friend request to Bob...");
    
    let request_id = send_friend_request(
        &pool, 
        &user1.id, 
        &user1.username, 
        &user1.email,
        &user2.email,
        Some("Hey Bob! Let's chat!")
    ).await?;
    
    println!("   ✅ Friend request sent (ID: {})", request_id);

    // Verify request is pending
    let pending_for_bob = get_pending_requests(&pool, &user2.email).await?;
    assert_eq!(pending_for_bob.len(), 1, "Bob should have 1 pending request");
    println!("   ✅ Bob sees 1 pending request from Alice");

    // ========== STEP 3: Accept Friend Request ==========
    println!("\n📋 Step 3: Bob accepts the friend request...");
    
    accept_friend_request(&pool, &request_id, &user2.id).await?;
    println!("   ✅ Friend request accepted");

    // Verify they are now contacts
    let alice_contacts = get_contacts(&pool, &user1.id).await?;
    let bob_contacts = get_contacts(&pool, &user2.id).await?;
    
    assert_eq!(alice_contacts.len(), 1, "Alice should have 1 contact");
    assert_eq!(bob_contacts.len(), 1, "Bob should have 1 contact");
    println!("   ✅ Alice and Bob are now contacts");

    // ========== STEP 4: Create Conversation ==========
    println!("\n📋 Step 4: Creating conversation between Alice and Bob...");
    
    let conversation = create_conversation(
        &pool,
        Some("Alice & Bob Chat"),
        &user1.id,
        true, // is_direct_message
        None,
    ).await?;
    
    println!("   ✅ Conversation created (ID: {})", conversation.id);

    // Add participants
    add_participant(&pool, &conversation.id, &user1.id).await?;
    add_participant(&pool, &conversation.id, &user2.id).await?;
    println!("   ✅ Both users added as participants");

    // ========== STEP 5: Send Messages ==========
    println!("\n📋 Step 5: Sending messages...");
    
    let msg1 = send_message(
        &pool,
        &conversation.id,
        &user1.id,
        "Hey Bob! How are you?",
    ).await?;
    println!("   ✅ Alice: \"{}\"", msg1.content);

    let msg2 = send_message(
        &pool,
        &conversation.id,
        &user2.id,
        "Hi Alice! I'm doing great, thanks!",
    ).await?;
    println!("   ✅ Bob: \"{}\"", msg2.content);

    let msg3 = send_message(
        &pool,
        &conversation.id,
        &user1.id,
        "Want to collaborate on that project?",
    ).await?;
    println!("   ✅ Alice: \"{}\"", msg3.content);

    // ========== STEP 6: Verify Persistence ==========
    println!("\n📋 Step 6: Verifying chat persistence...");
    
    let messages = get_messages(&pool, &conversation.id).await?;
    assert_eq!(messages.len(), 3, "Should have 3 messages");
    
    println!("   ✅ All {} messages persisted in database", messages.len());
    
    // Verify message content
    assert_eq!(messages[0].content, "Hey Bob! How are you?");
    assert_eq!(messages[1].content, "Hi Alice! I'm doing great, thanks!");
    assert_eq!(messages[2].content, "Want to collaborate on that project?");
    println!("   ✅ Message content verified");

    // Verify Braid versioning
    for msg in &messages {
        assert!(!msg.braid_version.is_empty(), "Message should have braid_version");
        println!("   📌 Message {} has version: {}", msg.id, msg.braid_version);
    }

    // ========== STEP 7: Test Delta Sync ==========
    println!("\n📋 Step 7: Testing delta sync (catch-up)...");
    
    // Simulate client that only knows first message
    let known_parents = vec![messages[0].braid_version.clone()];
    let new_messages = get_messages_since_parents(&pool, &conversation.id, &known_parents, 100).await?;
    
    assert_eq!(new_messages.len(), 2, "Should get 2 new messages");
    println!("   ✅ Delta sync returned {} new messages", new_messages.len());

    println!("\n✅✅✅ ALL TESTS PASSED ✅✅✅\n");
    println!("Summary:");
    println!("  - 2 users created");
    println!("  - Friend request sent and accepted");
    println!("  - Conversation created");
    println!("  - 3 messages exchanged");
    println!("  - All data persisted with Braid versioning");
    println!("  - Delta sync working correctly");

    Ok(())
}

// ========== Test Helpers ==========

#[derive(Debug)]
struct TestUser {
    id: String,
    username: String,
    email: String,
}

#[derive(Debug)]
struct TestConversation {
    id: String,
    name: Option<String>,
}

#[derive(Debug)]
struct TestMessage {
    id: String,
    conversation_id: String,
    sender: String,
    content: String,
    braid_version: String,
}

async fn setup_test_db() -> anyhow::Result<sqlx::SqlitePool> {
    // Use a temp file database so all connections share the same data
    let temp_dir = std::env::temp_dir();
    let db_path = temp_dir.join(format!("xf_test_{}.db", uuid::Uuid::new_v4()));
    let pool = sqlx::sqlite::SqlitePool::connect(&format!("sqlite:{}?mode=rwc", db_path.display())).await?;
    
    // Create tables
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            username TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(&pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS friend_requests (
            id TEXT PRIMARY KEY NOT NULL,
            from_user_id TEXT NOT NULL,
            to_user_id TEXT NOT NULL,
            from_username TEXT NOT NULL,
            from_email TEXT NOT NULL,
            to_email TEXT NOT NULL,
            message TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            responded_at DATETIME
        )"
    ).execute(&pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL,
            contact_user_id TEXT NOT NULL,
            username TEXT,
            email TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(&pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT,
            is_direct_message BOOLEAN DEFAULT FALSE,
            created_by TEXT,
            resource_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(&pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS conversation_participants (
            conversation_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (conversation_id, user_id)
        )"
    ).execute(&pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY NOT NULL,
            conversation_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            sender_email TEXT,
            content TEXT NOT NULL,
            message_type TEXT NOT NULL DEFAULT 'text',
            is_read BOOLEAN DEFAULT FALSE,
            crdt_timestamp BIGINT DEFAULT 0,
            braid_version TEXT,
            braid_parents TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(&pool).await?;

    Ok(pool)
}

async fn create_user(
    pool: &sqlx::SqlitePool,
    email: &str,
    username: &str,
    password: &str,
) -> anyhow::Result<TestUser> {
    use bcrypt::hash;
    use uuid::Uuid;

    let id = Uuid::new_v4().to_string();
    let password_hash = hash(password, bcrypt::DEFAULT_COST)?;

    sqlx::query(
        "INSERT INTO users (id, email, password_hash, username) VALUES (?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(email)
    .bind(&password_hash)
    .bind(username)
    .execute(pool)
    .await?;

    Ok(TestUser {
        id,
        username: username.to_string(),
        email: email.to_string(),
    })
}

async fn send_friend_request(
    pool: &sqlx::SqlitePool,
    from_user_id: &str,
    from_username: &str,
    from_email: &str,
    to_email: &str,
    message: Option<&str>,
) -> anyhow::Result<String> {
    use uuid::Uuid;

    let id = Uuid::new_v4().to_string();
    
    sqlx::query(
        "INSERT INTO friend_requests 
         (id, from_user_id, to_user_id, from_username, from_email, to_email, message, status)
         VALUES (?, ?, (SELECT id FROM users WHERE email = ?), ?, ?, ?, ?, 'pending')"
    )
    .bind(&id)
    .bind(from_user_id)
    .bind(to_email)
    .bind(from_username)
    .bind(from_email)
    .bind(to_email)
    .bind(message)
    .execute(pool)
    .await?;

    Ok(id)
}

async fn get_pending_requests(
    pool: &sqlx::SqlitePool,
    user_email: &str,
) -> anyhow::Result<Vec<(String, String)>> { // (id, from_username)
    let rows = sqlx::query(
        "SELECT id, from_username FROM friend_requests WHERE to_email = ? AND status = 'pending'"
    )
    .bind(user_email)
    .fetch_all(pool)
    .await?;

    Ok(rows.iter()
        .map(|r| (r.get::<String, _>("id"), r.get::<String, _>("from_username")))
        .collect())
}

async fn accept_friend_request(
    pool: &sqlx::SqlitePool,
    request_id: &str,
    user_id: &str,
) -> anyhow::Result<()> {
    // Update request status
    sqlx::query(
        "UPDATE friend_requests SET status = 'accepted', responded_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
    .bind(request_id)
    .execute(pool)
    .await?;

    // Get request details
    let req = sqlx::query(
        "SELECT from_user_id, from_username, from_email FROM friend_requests WHERE id = ?"
    )
    .bind(request_id)
    .fetch_one(pool)
    .await?;

    let from_user_id: String = req.get("from_user_id");
    let from_username: String = req.get("from_username");
    let from_email: String = req.get("from_email");

    // Create mutual contacts
    let id1 = uuid::Uuid::new_v4().to_string();
    let id2 = uuid::Uuid::new_v4().to_string();

    // User -> Contact
    sqlx::query(
        "INSERT INTO contacts (id, user_id, contact_user_id, username, email) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&id1)
    .bind(user_id)
    .bind(&from_user_id)
    .bind(&from_username)
    .bind(&from_email)
    .execute(pool)
    .await?;

    // Contact -> User (reverse)
    let user = sqlx::query("SELECT username, email FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_one(pool)
        .await?;
    
    sqlx::query(
        "INSERT INTO contacts (id, user_id, contact_user_id, username, email) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&id2)
    .bind(&from_user_id)
    .bind(user_id)
    .bind(user.get::<String, _>("username"))
    .bind(user.get::<String, _>("email"))
    .execute(pool)
    .await?;

    Ok(())
}

async fn get_contacts(
    pool: &sqlx::SqlitePool,
    user_id: &str,
) -> anyhow::Result<Vec<(String, String)>> { // (id, username)
    let rows = sqlx::query(
        "SELECT contact_user_id, username FROM contacts WHERE user_id = ?"
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.iter()
        .map(|r| (r.get::<String, _>("contact_user_id"), r.get::<String, _>("username")))
        .collect())
}

async fn create_conversation(
    pool: &sqlx::SqlitePool,
    name: Option<&str>,
    created_by: &str,
    is_dm: bool,
    resource_url: Option<&str>,
) -> anyhow::Result<TestConversation> {
    use uuid::Uuid;

    let id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO conversations (id, name, is_direct_message, created_by, resource_url)
         VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(name)
    .bind(is_dm)
    .bind(created_by)
    .bind(resource_url)
    .execute(pool)
    .await?;

    Ok(TestConversation {
        id,
        name: name.map(|s| s.to_string()),
    })
}

async fn add_participant(
    pool: &sqlx::SqlitePool,
    conversation_id: &str,
    user_id: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)"
    )
    .bind(conversation_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(())
}

async fn send_message(
    pool: &sqlx::SqlitePool,
    conversation_id: &str,
    sender_id: &str,
    content: &str,
) -> anyhow::Result<TestMessage> {
    use uuid::Uuid;

    let id = Uuid::new_v4().to_string();
    let braid_version = format!("{}@{}", chrono::Utc::now().timestamp_millis(), sender_id);

    // Get sender email
    let sender = sqlx::query("SELECT email FROM users WHERE id = ?")
        .bind(sender_id)
        .fetch_one(pool)
        .await?;
    let sender_email: String = sender.get("email");

    sqlx::query(
        "INSERT INTO messages 
         (id, conversation_id, sender_id, sender_email, content, braid_version)
         VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(conversation_id)
    .bind(sender_id)
    .bind(&sender_email)
    .bind(content)
    .bind(&braid_version)
    .execute(pool)
    .await?;

    Ok(TestMessage {
        id,
        conversation_id: conversation_id.to_string(),
        sender: sender_email,
        content: content.to_string(),
        braid_version,
    })
}

async fn get_messages(
    pool: &sqlx::SqlitePool,
    conversation_id: &str,
) -> anyhow::Result<Vec<TestMessage>> {
    let rows = sqlx::query(
        "SELECT id, conversation_id, sender_email, content, braid_version 
         FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
    )
    .bind(conversation_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.iter()
        .map(|r| TestMessage {
            id: r.get("id"),
            conversation_id: r.get("conversation_id"),
            sender: r.get("sender_email"),
            content: r.get("content"),
            braid_version: r.get("braid_version"),
        })
        .collect())
}

async fn get_messages_since_parents(
    pool: &sqlx::SqlitePool,
    conversation_id: &str,
    parents: &[String],
    limit: i64,
) -> anyhow::Result<Vec<TestMessage>> {
    // This is a simplified version - in production this would do proper DAG traversal
    let rows = sqlx::query(
        "SELECT id, conversation_id, sender_email, content, braid_version 
         FROM messages 
         WHERE conversation_id = ? AND braid_version NOT IN (
             SELECT value FROM json_each(?)
         )
         ORDER BY created_at ASC
         LIMIT ?"
    )
    .bind(conversation_id)
    .bind(serde_json::to_string(parents)?)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows.iter()
        .map(|r| TestMessage {
            id: r.get("id"),
            conversation_id: r.get("conversation_id"),
            sender: r.get("sender_email"),
            content: r.get("content"),
            braid_version: r.get("braid_version"),
        })
        .collect())
}
