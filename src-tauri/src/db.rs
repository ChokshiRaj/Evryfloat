use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::clipboard::ClipboardItem;
use crate::clipboard_utils::{compute_content_hash, ContentType};
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reminder {
    pub id: i64,
    pub title: String,
    pub due_date: String,
    pub is_completed: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: i64,
    pub prefix: String,
    pub title: String,
    pub content: String,
    pub created_at: i64,
}

#[derive(Clone)]
pub struct DbState {
    pub conn: Arc<Mutex<Connection>>,
}

fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn get_clip_images_dir() -> PathBuf {
    match std::env::var("APPDATA") {
        Ok(app_data) => PathBuf::from(app_data).join("EVRY").join("clip_images"),
        Err(_) => PathBuf::from(".").join("clip_images"),
    }
}

impl DbState {
    pub fn new() -> Result<Self> {
        let db_dir = match std::env::var("APPDATA") {
            Ok(app_data) => PathBuf::from(app_data).join("EVRY"),
            Err(_) => PathBuf::from("."),
        };

        let _ = fs::create_dir_all(&db_dir);
        let _ = fs::create_dir_all(get_clip_images_dir());
        let db_path = db_dir.join("evry.db");

        let conn = Connection::open(db_path)?;

        // Initialize schema
        conn.execute(
            "CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                due_date TEXT NOT NULL,
                is_completed INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Shelf items persistence table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS shelf_items (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT,
                text_content TEXT,
                item_kind TEXT NOT NULL,
                size_bytes INTEGER,
                child_count INTEGER,
                partial INTEGER DEFAULT 0,
                is_symlink INTEGER DEFAULT 0,
                is_risky INTEGER DEFAULT 0,
                from_internet INTEGER DEFAULT 0,
                missing INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                modified_at INTEGER
            )",
            [],
        )?;

        // Snippets table with dynamic placeholders
        conn.execute(
            "CREATE TABLE IF NOT EXISTS snippets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prefix TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )?;

        // Pre-seed default templates if empty
        let snippet_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM snippets", [], |row| row.get(0))
            .unwrap_or(0);
        if snippet_count == 0 {
            let defaults = [
                (";shrug", "Shrug Emoji", r"¯\_(ツ)_/¯"),
                (";date", "Current Date", "{date}"),
                (";time", "Current Time", "{time}"),
                (";meeting", "Meeting Notes", "## Meeting Notes — {date}\n**Time:** {time}\n**Attendees:** \n**Agenda:** \n- \n\n**Action Items:**\n- [ ] "),
                (";email", "Email Signoff", "Best regards,\n"),
                (";table", "Markdown Table", "| Item | Description | Status |\n| :--- | :--- | :---: |\n| Task 1 | Details | Done |"),
                (";clip", "Paste Clipboard Content", "{clipboard}"),
            ];
            let now = current_timestamp_ms();
            for (pfx, ttl, cnt) in defaults {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO snippets (prefix, title, content, created_at) VALUES (?1, ?2, ?3, ?4)",
                    params![pfx, ttl, cnt, now],
                );
            }
        }

        // Upgrade/Create clipboard_history table with content_hash and unix ms created_at (#10, #12)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS clipboard_history_v2 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                content_hash TEXT NOT NULL UNIQUE,
                content_type TEXT NOT NULL DEFAULT 'text',
                color_hex TEXT,
                is_pinned INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL
            )",
            [],
        )?;

        // Migration from old table if exists
        let table_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='clipboard_history'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if table_exists {
            let mut stmt = conn.prepare("SELECT content, content_type, color_hex, is_pinned FROM clipboard_history")?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i32>(3)?,
                ))
            })?;

            let now = current_timestamp_ms();
            for r in rows.flatten() {
                let hash = compute_content_hash(&r.0);
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO clipboard_history_v2 (content, content_hash, content_type, color_hex, is_pinned, created_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![r.0, hash, r.1, r.2, r.3, now],
                );
            }
            let _ = conn.execute("DROP TABLE clipboard_history", []);
        }

        // Rename v2 to clipboard_history
        let _ = conn.execute("ALTER TABLE clipboard_history_v2 RENAME TO clipboard_history", []);

        // Ensure index exists
        let _ = conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_clipboard_hash ON clipboard_history(content_hash)",
            [],
        );

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn get_clipboard_item_by_id(&self, id: i64) -> Result<ClipboardItem, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, content, content_type, color_hex, is_pinned, created_at FROM clipboard_history WHERE id = ?1",
        )?;

        stmt.query_row(params![id], |row| {
            let type_str: String = row.get(2)?;
            let pinned: i32 = row.get(4)?;
            Ok(ClipboardItem {
                id: row.get(0)?,
                content: row.get(1)?,
                content_type: ContentType::from_str_opt(&type_str),
                color_hex: row.get(3)?,
                is_pinned: pinned != 0,
                created_at: row.get(5)?,
            })
        })
        .map_err(|_| AppError::NotFound(format!("Clipboard item with id {} not found", id)))
    }

    pub fn insert_clipboard_item(
        &self,
        content: &str,
        hash: &str,
        content_type: ContentType,
        color_hex: Option<String>,
    ) -> Result<ClipboardItem, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let now = current_timestamp_ms();

        conn.execute(
            "INSERT INTO clipboard_history (content, content_hash, content_type, color_hex, is_pinned, created_at) \
             VALUES (?1, ?2, ?3, ?4, 0, ?5) \
             ON CONFLICT(content_hash) DO UPDATE SET \
                created_at = excluded.created_at, \
                color_hex = excluded.color_hex",
            params![content, hash, content_type.as_str(), color_hex, now],
        )?;

        let id: i64 = conn.query_row(
            "SELECT id FROM clipboard_history WHERE content_hash = ?1",
            params![hash],
            |row| row.get(0),
        )?;

        Ok(ClipboardItem {
            id,
            content: content.to_string(),
            content_type,
            color_hex,
            is_pinned: false,
            created_at: now,
        })
    }
}

// --- Tauri Commands for Notes ---

#[tauri::command]
pub fn get_notes(state: tauri::State<'_, DbState>) -> Result<Vec<Note>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, content, created_at, updated_at FROM notes ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let note_iter = stmt
        .query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut notes = Vec::new();
    for note in note_iter.flatten() {
        notes.push(note);
    }
    Ok(notes)
}

#[tauri::command]
pub fn save_note(
    state: tauri::State<'_, DbState>,
    id: Option<i64>,
    title: String,
    content: String,
) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    if let Some(existing_id) = id {
        conn.execute(
            "UPDATE notes SET title = ?1, content = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
            params![title, content, existing_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(existing_id)
    } else {
        conn.execute(
            "INSERT INTO notes (title, content) VALUES (?1, ?2)",
            params![title, content],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }
}

#[tauri::command]
pub fn delete_note(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Tauri Commands for Reminders ---

#[tauri::command]
pub fn get_reminders(state: tauri::State<'_, DbState>) -> Result<Vec<Reminder>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, due_date, is_completed, created_at FROM reminders ORDER BY is_completed ASC, due_date ASC")
        .map_err(|e| e.to_string())?;

    let reminder_iter = stmt
        .query_map([], |row| {
            let is_comp: i32 = row.get(3)?;
            Ok(Reminder {
                id: row.get(0)?,
                title: row.get(1)?,
                due_date: row.get(2)?,
                is_completed: is_comp != 0,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut reminders = Vec::new();
    for item in reminder_iter.flatten() {
        reminders.push(item);
    }
    Ok(reminders)
}

#[tauri::command]
pub fn save_reminder(
    state: tauri::State<'_, DbState>,
    title: String,
    due_date: String,
) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO reminders (title, due_date) VALUES (?1, ?2)",
        params![title, due_date],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn toggle_reminder(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE reminders SET is_completed = CASE WHEN is_completed = 1 THEN 0 ELSE 1 END WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_reminder(state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM reminders WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Tauri Commands for Upgraded Clipboard History ---

#[tauri::command]
pub fn get_clipboard_history(state: tauri::State<'_, DbState>) -> Result<Vec<ClipboardItem>, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, content, content_type, color_hex, is_pinned, created_at \
         FROM clipboard_history \
         ORDER BY is_pinned DESC, created_at DESC \
         LIMIT 200",
    )?;

    let iter = stmt.query_map([], |row| {
        let type_str: String = row.get(2)?;
        let pinned: i32 = row.get(4)?;
        Ok(ClipboardItem {
            id: row.get(0)?,
            content: row.get(1)?,
            content_type: ContentType::from_str_opt(&type_str),
            color_hex: row.get(3)?,
            is_pinned: pinned != 0,
            created_at: row.get(5)?,
        })
    })?;

    let mut items = Vec::new();
    for item in iter.flatten() {
        items.push(item);
    }
    Ok(items)
}

#[tauri::command]
pub fn add_clipboard_entry(
    state: tauri::State<'_, DbState>,
    content: String,
) -> Result<(), AppError> {
    if content.trim().is_empty() {
        return Ok(());
    }

    let color_hex = crate::clipboard_utils::parse_and_normalize_color(&content);
    let content_type = crate::clipboard_utils::detect_content_type(&content, &color_hex);
    let hash = compute_content_hash(&content);
    let now = current_timestamp_ms();

    let conn = state.conn.lock().map_err(|e| AppError::Database(e.to_string()))?;

    // Deduplication & timestamp bump (#12)
    conn.execute(
        "INSERT INTO clipboard_history (content, content_hash, content_type, color_hex, is_pinned, created_at) \
         VALUES (?1, ?2, ?3, ?4, 0, ?5) \
         ON CONFLICT(content_hash) DO UPDATE SET \
            created_at = excluded.created_at, \
            color_hex = excluded.color_hex",
        params![content, hash, content_type.as_str(), color_hex, now],
    )?;

    Ok(())
}

#[tauri::command]
pub fn pin_clipboard_item(
    state: tauri::State<'_, DbState>,
    id: i64,
    pinned: bool,
) -> Result<(), AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Database(e.to_string()))?;
    conn.execute(
        "UPDATE clipboard_history SET is_pinned = ?1 WHERE id = ?2",
        params![pinned as i32, id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn delete_clipboard_item(
    state: tauri::State<'_, DbState>,
    id: i64,
) -> Result<(), AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Database(e.to_string()))?;
    
    let item_info: Option<(String, String)> = conn
        .query_row(
            "SELECT content, content_type FROM clipboard_history WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    conn.execute(
        "DELETE FROM clipboard_history WHERE id = ?1",
        params![id],
    )?;

    if let Some((content, content_type)) = item_info {
        if content_type == "image" {
            let still_used: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM clipboard_history WHERE content = ?1",
                    params![content],
                    |row| row.get::<_, i64>(0),
                )
                .map(|c| c > 0)
                .unwrap_or(false);
            if !still_used {
                let _ = std::fs::remove_file(content);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn clear_clipboard_history(state: tauri::State<'_, DbState>) -> Result<(), AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let mut stmt = conn.prepare(
        "SELECT content FROM clipboard_history WHERE is_pinned = 0 AND content_type = 'image'",
    )?;
    let image_paths: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .flatten()
        .collect();

    conn.execute(
        "DELETE FROM clipboard_history WHERE is_pinned = 0",
        [],
    )?;

    for path in image_paths {
        let still_used: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM clipboard_history WHERE content = ?1",
                params![path],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);
        if !still_used {
            let _ = std::fs::remove_file(path);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_snippets(db_state: tauri::State<'_, DbState>) -> Result<Vec<Snippet>, String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, prefix, title, content, created_at FROM snippets ORDER BY prefix ASC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Snippet {
                id: row.get(0)?,
                prefix: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows.flatten() {
        list.push(r);
    }
    Ok(list)
}

#[tauri::command]
pub fn save_snippet(
    db_state: tauri::State<'_, DbState>,
    prefix: String,
    title: String,
    content: String,
) -> Result<Snippet, String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    let now = current_timestamp_ms();
    conn.execute(
        "INSERT INTO snippets (prefix, title, content, created_at) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(prefix) DO UPDATE SET title = excluded.title, content = excluded.content",
        params![prefix, title, content, now],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    Ok(Snippet {
        id,
        prefix,
        title,
        content,
        created_at: now,
    })
}

#[tauri::command]
pub fn delete_snippet(db_state: tauri::State<'_, DbState>, id: i64) -> Result<(), String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM snippets WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn purge_clipboard_and_shelf(
    db_state: tauri::State<'_, DbState>,
    max_items: i64,
    max_days: i64,
) -> Result<(), String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;

    if max_days > 0 {
        let cutoff_ms = current_timestamp_ms() - (max_days * 24 * 60 * 60 * 1000);
        let _ = conn.execute(
            "DELETE FROM clipboard_history WHERE is_pinned = 0 AND created_at < ?1",
            params![cutoff_ms],
        );
    }

    if max_items > 0 {
        let _ = conn.execute(
            "DELETE FROM clipboard_history WHERE is_pinned = 0 AND id NOT IN (
                SELECT id FROM clipboard_history ORDER BY created_at DESC LIMIT ?1
            )",
            params![max_items],
        );
    }

    // Clean up any files in clip_images that are no longer referenced in clipboard_history
    if let Ok(entries) = std::fs::read_dir(get_clip_images_dir()) {
        for entry in entries.flatten() {
            let path = entry.path();
            let path_str = path.to_string_lossy().to_string();
            let is_referenced: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM clipboard_history WHERE content = ?1",
                    params![path_str],
                    |row| row.get::<_, i64>(0),
                )
                .map(|c| c > 0)
                .unwrap_or(false);
            if !is_referenced {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    Ok(())
}
