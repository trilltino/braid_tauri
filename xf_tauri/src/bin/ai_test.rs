use std::sync::Arc;
use tokio::time::{sleep, Duration};
use xf_tauri::chat::ChatManager;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 1. Setup Environment
    let storage_dir = std::env::current_dir()?.join("ai_test_root");
    if storage_dir.exists() {
        let _ = std::fs::remove_dir_all(&storage_dir);
    }
    std::env::set_var("BRAID_ROOT", &storage_dir);

    // Initialize directory structure
    braid_common::init_structure()?;
    std::env::set_var("DEEPSEEK_API_KEY", "sk-4bc3b7bf8fe44ed7bb8592a032e5abed");

    println!("--- AI SHORT TEST STARTING ---");

    // 2. Init DB
    let pool = xf_tauri::backend::db::init_db().await?;
    let pool = Arc::new(pool);
    let _ = xf_tauri::backend::db::seed_data(&pool).await;

    // 3. Init Chat Manager
    let chat_manager = Arc::new(ChatManager::new("https://mail.braid.org".to_string())?);

    // 4. AI is handled server-side - no local AI assistant needed
    sleep(Duration::from_secs(2)).await;

    // 5. Create AI Chat Room "scientific_demo"
    let room_id = "scientific_demo";
    sqlx::query("INSERT OR REPLACE INTO conversations (id, name, created_by, is_direct_message, resource_url) VALUES (?, ?, ?, ?, ?)")
        .bind(room_id)
        .bind("Scientific Branching Hub")
        .bind("Alice")
        .bind(false)
        .bind("xf://mail.braid.org/chats/demo")
        .execute(&*pool)
        .await?;

    // Add multi-user participants
    println!("Seeding participants: Alice, Bob, Charlie...");

    // 6. Project to file
    chat_manager.sync_to_file(room_id).await?;

    // 7. Insert message from Alice asking a question
    println!("Alice: '@BraidBot! explain the Braid protocol in 2 sentences'...");
    sqlx::query("INSERT INTO messages (id, conversation_id, sender, content, branch, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(room_id)
        .bind("Alice")
        .bind("@BraidBot! Please explain the Braid protocol in exactly 2 sentences.")
        .bind("main")
        .execute(&*pool)
        .await?;

    chat_manager.sync_to_file(room_id).await?;

    // 8. Wait for AI response
    println!("Waiting for Qwen3:4b response (120s timeout)...");
    let file_path = storage_dir.join("ai_chats").join(format!("{}.md", room_id));

    for i in 0..120 {
        if file_path.exists() {
            let content = tokio::fs::read_to_string(&file_path).await?;
            if content.contains("**@BraidBot**") {
                println!("SUCCESS: AI Response detected!");
                println!("\n--- AI RESPONSE ---\n{}\n--------------------", content);
                return Ok(());
            }
        }
        sleep(Duration::from_secs(1)).await;
        if i % 10 == 0 {
            println!("Still waiting... {}s", i);
        }
    }

    anyhow::bail!("Timeout waiting for AI response.");
}
