use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{ConnectOptions, Row, SqlitePool};
use tracing::{info, log::LevelFilter};

pub async fn init_db() -> Result<SqlitePool, sqlx::Error> {
    // Use centralized directory structure
    let data_dir = braid_common::local_dir();

    let db_path = data_dir.join("xfmail.db");

    let connection_options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .log_slow_statements(LevelFilter::Off, std::time::Duration::from_secs(1))
        .log_statements(LevelFilter::Debug);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connection_options)
        .await?;

    // Create users table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            username TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(&pool)
    .await?;

    // Create conversations table (enhanced)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT,
            description TEXT,
            is_direct_message BOOLEAN DEFAULT FALSE,
            created_by TEXT,
            resource_url TEXT, -- Braid Resource URL for this chat
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(&pool)
    .await?;

    // Migration for resource_url
    let rows_conv = sqlx::query("PRAGMA table_info(conversations)")
        .fetch_all(&pool)
        .await?;
    let has_url = rows_conv
        .iter()
        .any(|r| r.get::<String, _>("name") == "resource_url");
    if !has_url {
        sqlx::query("ALTER TABLE conversations ADD COLUMN resource_url TEXT")
            .execute(&pool)
            .await?;
    }

    // Create messages table (Enhanced Braid versioned)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY NOT NULL,
            conversation_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            subject TEXT,
            content TEXT NOT NULL,
            message_type TEXT NOT NULL DEFAULT 'text',
            is_read BOOLEAN NOT NULL DEFAULT FALSE,
            is_delivered BOOLEAN NOT NULL DEFAULT TRUE,
            crdt_timestamp BIGINT NOT NULL DEFAULT 0,
            braid_version TEXT,
            braid_parents TEXT,
            branch TEXT DEFAULT 'main',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )",
    )
    .execute(&pool)
    .await?;

    // Create friend_requests table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS friend_requests (
            id TEXT PRIMARY KEY NOT NULL,
            from_username TEXT NOT NULL,
            from_email TEXT NOT NULL,
            to_email TEXT NOT NULL,
            message TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            responded_at DATETIME
        )",
    )
    .execute(&pool)
    .await?;

    // Create contacts table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY NOT NULL,
            username TEXT,
            email TEXT UNIQUE,
            avatar_url TEXT,
            last_seen DATETIME,
            is_online BOOLEAN DEFAULT FALSE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(&pool)
    .await?;

    // Create conversation_tips table (Frontier tracking)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS conversation_tips (
            conversation_id TEXT NOT NULL,
            version TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (conversation_id, version),
            FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )",
    )
    .execute(&pool)
    .await?;

    // Create wiki_pages table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS wiki_pages (
            url TEXT PRIMARY KEY NOT NULL,
            content TEXT NOT NULL,
            version TEXT,
            last_modified DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(&pool)
    .await?;

    // Column Migration for messages.subject
    let rows = sqlx::query("PRAGMA table_info(messages)")
        .fetch_all(&pool)
        .await?;
    let has_subject = rows.iter().any(|r| r.get::<String, _>("name") == "subject");
    if !has_subject {
        sqlx::query("ALTER TABLE messages ADD COLUMN subject TEXT")
            .execute(&pool)
            .await?;
    }

    let has_branch = rows.iter().any(|r| r.get::<String, _>("name") == "branch");
    if !has_branch {
        sqlx::query("ALTER TABLE messages ADD COLUMN branch TEXT DEFAULT 'main'")
            .execute(&pool)
            .await?;
    }

    let has_created_at = rows
        .iter()
        .any(|r| r.get::<String, _>("name") == "created_at");
    let has_timestamp = rows
        .iter()
        .any(|r| r.get::<String, _>("name") == "timestamp");
    if !has_created_at && has_timestamp {
        // Rename timestamp to created_at (SQLite 3.25.0+)
        sqlx::query("ALTER TABLE messages RENAME COLUMN timestamp TO created_at")
            .execute(&pool)
            .await?;
    }

    Ok(pool)
}

pub async fn seed_data(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // Purge dummy data as requested by user to start with a clean slate
    // sqlx::query("DELETE FROM messages").execute(pool).await?;
    // sqlx::query("DELETE FROM conversations")
    //     .execute(pool)
    //     .await?;
    // sqlx::query("DELETE FROM contacts").execute(pool).await?;

    info!("Seed data check completed. (Automatic purge disabled for persistence)");
    Ok(())
}
