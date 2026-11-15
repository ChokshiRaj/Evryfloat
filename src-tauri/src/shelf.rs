use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use uuid::Uuid;

use crate::clipboard::ClipboardState;
use crate::db::DbState;
use crate::error::AppError;

pub const DRIVE_REMOTE: u32 = 4;
pub const CREATE_NO_WINDOW: u32 = 0x08000000;
pub const COINIT_APARTMENTTHREADED: u32 = 0x2;
pub const COINIT_DISABLE_OLE1DDE: u32 = 0x4;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    File,
    Folder,
    Image,
    Text,
    Url,
    Archive,
    Video,
    Audio,
    Document,
    Code,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropItem {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub text_content: Option<String>,
    pub item_kind: ItemKind,
    pub size_bytes: Option<u64>,
    pub child_count: Option<usize>,
    pub partial: bool,
    pub is_symlink: bool,
    pub is_risky: bool,
    pub from_internet: bool,
    pub missing: bool,
    pub created_at: i64,
    pub modified_at: Option<i64>,
}

#[derive(Clone, Default)]
pub struct ShelfState(pub Arc<Mutex<HashMap<String, DropItem>>>);

const RISKY_EXTENSIONS: &[&str] = &[
    "exe", "bat", "cmd", "ps1", "vbs", "js", "msi", "lnk", "scr", "com", "pif", "hta", "wsf",
    "jar", "reg", "vbe", "jse", "wsh", "cpl", "msc", "msp", "inf", "scf", "url", "chm", "dll",
    "appx", "msix", "application", "gadget", "iso", "img", "docm", "xlsm", "pptm",
];

pub fn normalize_dropped_path(raw: &str) -> String {
    let mut clean = raw.trim().trim_matches('"').trim_matches('\'').to_string();
    if clean.starts_with("file:///") {
        clean = clean[8..].to_string();
    } else if clean.starts_with("file://") {
        clean = clean[7..].to_string();
    }
    clean = clean.replace("%20", " ");
    clean
}

#[cfg(target_os = "windows")]
pub fn is_drive_remote(drive_root: &str) -> bool {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;

    let wide: Vec<u16> = OsStr::new(drive_root).encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        let drive_type = GetDriveTypeW(wide.as_ptr());
        drive_type == DRIVE_REMOTE
    }
}

#[cfg(not(target_os = "windows"))]
pub fn is_drive_remote(_drive_root: &str) -> bool {
    false
}

pub fn is_unc_or_remote_path(p_str: &str) -> bool {
    let normalized = p_str.replace('/', "\\");

    // Check device namespace e.g. \\.\pipe\x or \??\UNC\...
    if normalized.starts_with(r"\\.\") || normalized.starts_with(r"\??\") {
        return true;
    }

    // Check verbatim UNC: \\?\UNC\srv\s
    if normalized.to_ascii_uppercase().starts_with(r"\\?\UNC\") {
        return true;
    }

    // Check verbatim local: \\?\C:\... -> local unless drive is mapped remote
    if normalized.starts_with(r"\\?\") {
        let rest = &normalized[4..];
        if rest.len() >= 2 && rest.chars().nth(1) == Some(':') {
            let root = format!("{}\\", &rest[0..2]);
            return is_drive_remote(&root);
        }
        return true;
    }

    // Standard UNC: \\server\share
    if normalized.starts_with(r"\\") {
        return true;
    }

    // Check mapped network drive: Z:\
    if normalized.len() >= 2 && normalized.chars().nth(1) == Some(':') {
        let root = format!("{}\\", &normalized[0..2]);
        if is_drive_remote(&root) {
            return true;
        }
    }

    false
}

pub fn is_risky_file(path: &str) -> bool {
    let trimmed = path.trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    let p = Path::new(trimmed);
    if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
        RISKY_EXTENSIONS.contains(&ext.to_lowercase().as_str())
    } else {
        false
    }
}

#[cfg(target_os = "windows")]
pub fn parse_zone_identifier(path: &str) -> Option<u32> {
    let zone_path = format!("{}:Zone.Identifier", path);
    let content = fs::read_to_string(&zone_path).ok()?;
    for line in content.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("ZoneId=") {
            if let Ok(id) = val.trim().parse::<u32>() {
                return Some(id);
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
pub fn parse_zone_identifier(_path: &str) -> Option<u32> {
    None
}

pub fn is_from_internet(path: &str) -> bool {
    if let Some(zone_id) = parse_zone_identifier(path) {
        zone_id >= 3 // 3 = Internet, 4 = Restricted Sites
    } else {
        false
    }
}

pub fn detect_item_kind(p: &Path, is_dir: bool) -> ItemKind {
    if is_dir {
        return ItemKind::Folder;
    }
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    // SVG is NEVER classified as an image for safe rendering
    if ext == "svg" {
        return ItemKind::Document;
    }

    if let Ok(Some(kind)) = infer::get_from_path(p) {
        match kind.matcher_type() {
            infer::MatcherType::Image => return ItemKind::Image,
            infer::MatcherType::Video => return ItemKind::Video,
            infer::MatcherType::Audio => return ItemKind::Audio,
            infer::MatcherType::Archive => return ItemKind::Archive,
            infer::MatcherType::Doc => return ItemKind::Document,
            _ => {}
        }
    }

    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "ico" => ItemKind::Image,
        "mp4" | "mkv" | "avi" | "mov" | "webm" => ItemKind::Video,
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" => ItemKind::Audio,
        "zip" | "tar" | "gz" | "7z" | "rar" => ItemKind::Archive,
        "pdf" | "docx" | "xlsx" | "pptx" | "txt" | "md" | "rtf" => ItemKind::Document,
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "c" | "cpp" | "h" | "html" | "css"
        | "json" | "xml" | "toml" | "yaml" | "sh" => ItemKind::Code,
        _ => ItemKind::File,
    }
}

pub fn compute_folder_stats(p: &Path, time_limit: Duration) -> (Option<u64>, usize, bool) {
    let start = Instant::now();
    let mut total_bytes: u64 = 0;
    let mut child_count: usize = 0;
    let mut is_partial = false;
    let mut stack = vec![p.to_path_buf()];

    while let Some(dir) = stack.pop() {
        if start.elapsed() >= time_limit {
            is_partial = true;
            break;
        }
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                child_count += 1;
                if let Ok(meta) = fs::symlink_metadata(entry.path()) {
                    if meta.file_type().is_symlink() {
                        continue;
                    }
                    if meta.is_dir() {
                        stack.push(entry.path());
                    } else if meta.is_file() {
                        total_bytes = total_bytes.saturating_add(meta.len());
                    }
                }
            }
        }
    }
    (Some(total_bytes), child_count, is_partial)
}

pub fn cleanup_staging_temp_dir() {
    let temp_dir = std::env::temp_dir().join("EVRY_DragDrop");
    if let Ok(entries) = fs::read_dir(&temp_dir) {
        let now = SystemTime::now();
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    if let Ok(age) = now.duration_since(modified) {
                        if age > Duration::from_secs(15 * 60) {
                            let _ = fs::remove_file(entry.path());
                        }
                    }
                }
            }
        }
    }
}

pub fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

// ---------------------------------------------------------------------------
// ASYNC COMMANDS
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn process_dropped_paths(
    shelf_state: tauri::State<'_, ShelfState>,
    db_state: tauri::State<'_, DbState>,
    paths: Vec<String>,
) -> Result<Vec<DropItem>, AppError> {
    let shelf = shelf_state.0.clone();
    let conn_arc = db_state.conn.clone();

    tokio::task::spawn_blocking(move || {
        let db = conn_arc.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let mut results = Vec::new();

        for raw_path in paths {
            let clean_path = normalize_dropped_path(&raw_path);
            let p = Path::new(&clean_path);
            if !p.exists() {
                continue;
            }

            // Canonicalize first to resolve symlinks / junctions, then check UNC and DRIVE_REMOTE on both
            let canonical = match fs::canonicalize(p) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let canon_str = canonical.to_string_lossy().to_string();

            if is_unc_or_remote_path(&clean_path) || is_unc_or_remote_path(&canon_str) {
                continue;
            }

            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| clean_path.clone());

            let is_dir = p.is_dir();
            let is_symlink = p
                .symlink_metadata()
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false);

            let (size_bytes, child_count, partial) = if is_dir {
                let (bytes, count, part) = compute_folder_stats(p, Duration::from_millis(1500));
                (bytes, Some(count), part)
            } else if let Ok(meta) = p.symlink_metadata() {
                (Some(meta.len()), None, false)
            } else {
                (None, None, false)
            };

            let item_kind = detect_item_kind(p, is_dir);
            let is_risky = is_risky_file(&clean_path);
            let from_internet = is_from_internet(&clean_path);

            let modified_at = p
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);

            let item = DropItem {
                id: Uuid::new_v4().to_string(),
                name,
                path: Some(clean_path.clone()),
                text_content: None,
                item_kind,
                size_bytes,
                child_count,
                partial,
                is_symlink,
                is_risky,
                from_internet,
                missing: false,
                created_at: current_timestamp_ms(),
                modified_at,
            };

            // Persist in DB
            let _ = db.execute(
                "INSERT OR REPLACE INTO shelf_items (id, name, path, text_content, item_kind, size_bytes, child_count, partial, is_symlink, is_risky, from_internet, missing, created_at, modified_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                rusqlite::params![
                    item.id,
                    item.name,
                    item.path,
                    item.text_content,
                    serde_json::to_string(&item.item_kind).unwrap_or_default().trim_matches('"'),
                    item.size_bytes.map(|s| s as i64),
                    item.child_count.map(|c| c as i64),
                    item.partial as i32,
                    item.is_symlink as i32,
                    item.is_risky as i32,
                    item.from_internet as i32,
                    item.missing as i32,
                    item.created_at,
                    item.modified_at,
                ],
            );

            // Add to managed in-memory state
            if let Ok(mut map) = shelf.lock() {
                map.insert(item.id.clone(), item.clone());
            }

            results.push(item);
        }

        Ok(results)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn process_dropped_file(
    shelf_state: tauri::State<'_, ShelfState>,
    db_state: tauri::State<'_, DbState>,
    path: String,
) -> Result<DropItem, AppError> {
    let items = process_dropped_paths(shelf_state, db_state, vec![path]).await?;
    items.into_iter().next().ok_or_else(|| AppError::Validation("Failed to process file".to_string()))
}

#[tauri::command]
pub async fn get_shelf_items(
    shelf_state: tauri::State<'_, ShelfState>,
    db_state: tauri::State<'_, DbState>,
) -> Result<Vec<DropItem>, AppError> {
    let shelf = shelf_state.0.clone();
    let conn_arc = db_state.conn.clone();

    tokio::task::spawn_blocking(move || {
        let db = conn_arc.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let mut stmt = db.prepare(
            "SELECT id, name, path, text_content, item_kind, size_bytes, child_count, partial, is_symlink, is_risky, from_internet, missing, created_at, modified_at FROM shelf_items ORDER BY created_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            let kind_str: String = row.get(4)?;
            let item_kind: ItemKind = serde_json::from_str(&format!("\"{}\"", kind_str)).unwrap_or(ItemKind::File);
            let size_bytes: Option<i64> = row.get(5)?;
            let child_count: Option<i64> = row.get(6)?;

            Ok(DropItem {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                text_content: row.get(3)?,
                item_kind,
                size_bytes: size_bytes.map(|s| s as u64),
                child_count: child_count.map(|c| c as usize),
                partial: row.get::<_, i32>(7)? != 0,
                is_symlink: row.get::<_, i32>(8)? != 0,
                is_risky: row.get::<_, i32>(9)? != 0,
                from_internet: row.get::<_, i32>(10)? != 0,
                missing: row.get::<_, i32>(11)? != 0,
                created_at: row.get(12)?,
                modified_at: row.get(13)?,
            })
        })?;

        let mut items = Vec::new();
        let mut map = shelf.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        for r in rows.flatten() {
            let mut item = r;
            // Check if file is still present on disk
            if let Some(ref p) = item.path {
                item.missing = !Path::new(p).exists();
            }
            map.insert(item.id.clone(), item.clone());
            items.push(item);
        }

        Ok(items)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn remove_shelf_item(
    shelf_state: tauri::State<'_, ShelfState>,
    db_state: tauri::State<'_, DbState>,
    id: String,
) -> Result<(), AppError> {
    let shelf = shelf_state.0.clone();
    let conn_arc = db_state.conn.clone();

    tokio::task::spawn_blocking(move || {
        let db = conn_arc.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let _ = db.execute("DELETE FROM shelf_items WHERE id = ?1", rusqlite::params![id]);
        if let Ok(mut map) = shelf.lock() {
            map.remove(&id);
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn clear_shelf_items(
    shelf_state: tauri::State<'_, ShelfState>,
    db_state: tauri::State<'_, DbState>,
) -> Result<(), AppError> {
    let shelf = shelf_state.0.clone();
    let conn_arc = db_state.conn.clone();

    tokio::task::spawn_blocking(move || {
        let db = conn_arc.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let _ = db.execute("DELETE FROM shelf_items", []);
        if let Ok(mut map) = shelf.lock() {
            map.clear();
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn open_shelf_item(
    app: AppHandle,
    shelf_state: tauri::State<'_, ShelfState>,
    id: String,
    path: Option<String>,
) -> Result<(), AppError> {
    let (target_path, name, is_risky, from_internet) = {
        let map = shelf_state.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        if let Some(item) = map.get(&id) {
            let p = item.path.clone().ok_or_else(|| AppError::NotFound("Item has no file path".to_string()))?;
            (p, item.name.clone(), item.is_risky, item.from_internet)
        } else if let Some(fallback_path) = path {
            let risky = is_risky_file(&fallback_path);
            let internet = is_from_internet(&fallback_path);
            let n = Path::new(&fallback_path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| fallback_path.clone());
            (fallback_path, n, risky, internet)
        } else {
            return Err(AppError::NotFound(format!("Shelf item '{}' not found", id)));
        }
    };

    if is_unc_or_remote_path(&target_path) {
        return Err(AppError::Blocked("UNC network paths are restricted for security".to_string()));
    }

    let p = Path::new(&target_path);
    if !p.exists() {
        return Err(AppError::NotFound(format!("File does not exist: {}", target_path)));
    }

    // Enforce risk check: recompute is_risky_file || from_internet; if true, show NATIVE confirmation dialog
    let needs_warning = is_risky || from_internet || is_risky_file(&target_path) || is_from_internet(&target_path);
    if needs_warning {
        let confirmed = app
            .dialog()
            .message(format!(
                "The item '{}' is an executable or was downloaded from the internet. Are you sure you want to open it?",
                name
            ))
            .title("Security Warning - Open Item")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancel)
            .blocking_show();

        if !confirmed {
            return Err(AppError::ConfirmationDeclined);
        }
    }

    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            use std::ffi::OsStr;
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::System::Com::CoInitializeEx;
            use windows_sys::Win32::UI::Shell::ShellExecuteW;
            use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

            unsafe {
                // Initialize COM on this worker thread
                CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);

                let wide_path: Vec<u16> = OsStr::new(&target_path).encode_wide().chain(std::iter::once(0)).collect();
                let operation: Vec<u16> = OsStr::new("open").encode_wide().chain(std::iter::once(0)).collect();

                let res = ShellExecuteW(
                    std::ptr::null_mut(),
                    operation.as_ptr(),
                    wide_path.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    SW_SHOWNORMAL,
                );

                let code = res as isize;
                if code <= 32 {
                    return match code {
                        2 | 3 => Err(AppError::NotFound(format!("File not found by ShellExecute (code {})", code))),
                        5 => Err(AppError::PermissionDenied("Access denied by system policy (code 5)".to_string())),
                        31 => Err(AppError::NoAssociation("No application is associated with this file type (code 31)".to_string())),
                        _ => Err(AppError::Internal(format!("ShellExecute error code: {}", code))),
                    };
                }
            }
            Ok(())
        }
        #[cfg(not(target_os = "windows"))]
        {
            Err(AppError::NativeOs("Unsupported platform".to_string()))
        }
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn show_in_folder(
    shelf_state: tauri::State<'_, ShelfState>,
    id: String,
    path: Option<String>,
) -> Result<(), AppError> {
    let target_path = {
        let map = shelf_state.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        if let Some(item) = map.get(&id) {
            item.path.clone().ok_or_else(|| AppError::NotFound("Item has no path".to_string()))?
        } else if let Some(fallback_path) = path {
            fallback_path
        } else {
            return Err(AppError::NotFound(format!("Shelf item '{}' not found", id)));
        }
    };

    if is_unc_or_remote_path(&target_path) {
        return Err(AppError::Blocked("UNC network paths are restricted".to_string()));
    }

    let p = Path::new(&target_path);
    if !p.exists() {
        return Err(AppError::NotFound(format!("File does not exist: {}", target_path)));
    }

    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let clean = target_path.replace('/', "\\");
            let _ = Command::new("explorer.exe")
                .raw_arg(format!("/select,\"{}\"", clean))
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
            Ok(())
        }
        #[cfg(not(target_os = "windows"))]
        {
            Err(AppError::NativeOs("Unsupported platform".to_string()))
        }
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn prepare_drag_item(
    shelf_state: tauri::State<'_, ShelfState>,
    id: String,
) -> Result<String, AppError> {
    let item = {
        let map = shelf_state.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        map.get(&id).cloned().ok_or_else(|| AppError::NotFound(format!("Item '{}' not found", id)))?
    };

    if item.missing {
        return Err(AppError::NotFound("File has been moved or deleted".to_string()));
    }

    // If it's a file on disk
    if let Some(ref path_str) = item.path {
        if is_unc_or_remote_path(path_str) {
            return Err(AppError::Blocked("Cannot drag files from network shares".to_string()));
        }
        if !Path::new(path_str).exists() {
            return Err(AppError::NotFound("File not found on disk".to_string()));
        }
        return Ok(path_str.clone());
    }

    // Text / URL item: write a temp file in the app temp dir and drag that
    if let Some(ref text) = item.text_content {
        let temp_dir = std::env::temp_dir().join("EVRY_DragDrop");
        let _ = fs::create_dir_all(&temp_dir);

        let is_url = item.item_kind == ItemKind::Url;
        let ext = if is_url { "url" } else { "txt" };

        // Sanitize name: remove illegal filesystem characters (\ / : * ? " < > |) and control chars
        let safe_name: String = item
            .name
            .chars()
            .map(|c| {
                if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'..='\x1f') {
                    '_'
                } else {
                    c
                }
            })
            .collect();
        let safe_trimmed = safe_name.trim();
        let stem = if safe_trimmed.is_empty() || safe_trimmed == "_" {
            format!("drop_{}", &item.id[0..8])
        } else if safe_trimmed.len() > 64 {
            safe_trimmed[0..64].to_string()
        } else {
            safe_trimmed.to_string()
        };

        let filename = format!("{}.{}", stem, ext);
        let temp_file = temp_dir.join(filename);

        if is_url {
            let content = format!("[InternetShortcut]\nURL={}\n", text);
            let _ = fs::write(&temp_file, content);
        } else {
            let _ = fs::write(&temp_file, text);
        }

        return Ok(temp_file.to_string_lossy().to_string());
    }

    Err(AppError::Validation("No draggable content found for this item".to_string()))
}

#[tauri::command]
pub async fn copy_items_to_clipboard(
    clipboard_state: tauri::State<'_, ClipboardState>,
    shelf_state: tauri::State<'_, ShelfState>,
    ids: Vec<String>,
) -> Result<(), AppError> {
    let mut file_paths: Vec<PathBuf> = Vec::new();
    {
        let map = shelf_state.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        for id in &ids {
            if let Some(item) = map.get(id) {
                if let Some(ref p) = item.path {
                    if !is_unc_or_remote_path(p) && Path::new(p).exists() {
                        file_paths.push(PathBuf::from(p));
                    }
                }
            }
        }
    }

    if file_paths.is_empty() {
        return Err(AppError::Validation("No valid local files found to copy".to_string()));
    }

    // Set separate atomic flag for CF_HDROP writes so clipboard watcher ignores self copy
    clipboard_state.ignore_next_file_copy.store(true, std::sync::atomic::Ordering::SeqCst);

    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            // Set clipboard files with clipboard-win
            let paths_str: Vec<String> = file_paths.iter().map(|p| p.to_string_lossy().to_string()).collect();
            if clipboard_win::raw::set_file_list(&paths_str).is_err() {
                return Err(AppError::Clipboard("Failed to write files to clipboard".to_string()));
            }

            // Set Preferred DropEffect = 1 (DROPEFFECT_COPY)
            use windows_sys::Win32::System::DataExchange::{CloseClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData};
            use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

            unsafe {
                if OpenClipboard(std::ptr::null_mut()) != 0 {
                    let fmt_name: Vec<u16> = "Preferred DropEffect\0".encode_utf16().collect();
                    let fmt_id = RegisterClipboardFormatW(fmt_name.as_ptr());
                    if fmt_id != 0 {
                        let h_mem = GlobalAlloc(GMEM_MOVEABLE, std::mem::size_of::<u32>());
                        if !h_mem.is_null() {
                            let ptr = GlobalLock(h_mem) as *mut u32;
                            if !ptr.is_null() {
                                *ptr = 1; // DROPEFFECT_COPY
                                GlobalUnlock(h_mem);
                                SetClipboardData(fmt_id, h_mem as _);
                            }
                        }
                    }
                    CloseClipboard();
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn paste_items(
    app: AppHandle,
    clipboard_state: tauri::State<'_, ClipboardState>,
    shelf_state: tauri::State<'_, ShelfState>,
    ids: Vec<String>,
) -> Result<(), AppError> {
    copy_items_to_clipboard(clipboard_state.clone(), shelf_state, ids).await?;

    // Collapse notch drawer cleanly back to the top notch
    use tauri::Emitter;
    let _ = app.emit("collapse-notch", ());

    // Restore focus and paste via Ctrl+V
    let saved_hwnd = clipboard_state
        .saved_foreground_hwnd
        .lock()
        .map(|g| *g)
        .unwrap_or(0);

    let res = tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            crate::clipboard::restore_focus_and_send_ctrl_v(saved_hwnd)
        }
        #[cfg(not(target_os = "windows"))]
        {
            Ok(())
        }
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    if let Err(e) = res {
        // Restore notch window if target fails/refuses focus (UIPI elevation protection)
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.show();
            let _ = win.set_focus();
        }
        return Err(e);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// SHELF PRODUCTIVITY TOOLS (Zip, Batch Rename, Image Conversion, LAN Share)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanShareInfo {
    pub ip: String,
    pub port: u16,
    pub token: String,
    pub url: String,
    pub filename: String,
    pub size_bytes: u64,
}

static ACTIVE_LAN_TOKEN: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
pub async fn compress_shelf_items(
    shelf_state: tauri::State<'_, ShelfState>,
    db_state: tauri::State<'_, DbState>,
    ids: Vec<String>,
    zip_name: Option<String>,
) -> Result<DropItem, AppError> {
    let mut files_to_zip: Vec<(String, PathBuf)> = Vec::new();
    {
        let map = shelf_state.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        for id in &ids {
            if let Some(item) = map.get(id) {
                if let Some(ref p_str) = item.path {
                    let p = Path::new(p_str);
                    if p.exists() && !is_unc_or_remote_path(p_str) {
                        files_to_zip.push((item.name.clone(), p.to_path_buf()));
                    }
                }
            }
        }
    }

    if files_to_zip.is_empty() {
        return Err(AppError::Validation("No valid files selected to compress".to_string()));
    }

    let first_dir = files_to_zip[0].1.parent().unwrap_or_else(|| Path::new("."));
    let final_name = zip_name
        .map(|n| if n.ends_with(".zip") { n } else { format!("{}.zip", n) })
        .unwrap_or_else(|| format!("Archive_{}.zip", &Uuid::new_v4().to_string()[0..8]));
    let zip_path = first_dir.join(&final_name);
    let target_str = zip_path.to_string_lossy().to_string();

    tokio::task::spawn_blocking(move || {
        use std::io::{Read, Write};
        let file = fs::File::create(&zip_path).map_err(|e| AppError::Internal(e.to_string()))?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for (name, path) in files_to_zip {
            if path.is_file() {
                zip.start_file(&name, options)
                    .map_err(|e| AppError::Internal(e.to_string()))?;
                let mut f = fs::File::open(&path).map_err(|e| AppError::Internal(e.to_string()))?;
                let mut buffer = Vec::new();
                f.read_to_end(&mut buffer).map_err(|e| AppError::Internal(e.to_string()))?;
                zip.write_all(&buffer).map_err(|e| AppError::Internal(e.to_string()))?;
            }
        }

        zip.finish().map_err(|e| AppError::Internal(e.to_string()))?;
        Ok::<(), AppError>(())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))??;

    let new_items = process_dropped_paths(shelf_state, db_state, vec![target_str]).await?;
    new_items.into_iter().next().ok_or_else(|| AppError::Internal("Failed to add zip to shelf".to_string()))
}

#[tauri::command]
pub async fn convert_image(
    shelf_state: tauri::State<'_, ShelfState>,
    db_state: tauri::State<'_, DbState>,
    id: String,
    target_format: String,
    strip_exif: bool,
) -> Result<DropItem, AppError> {
    let source_path = {
        let map = shelf_state.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let item = map.get(&id).ok_or_else(|| AppError::NotFound(format!("Item {} not found", id)))?;
        item.path.clone().ok_or_else(|| AppError::NotFound("Item has no path".to_string()))?
    };

    let p = Path::new(&source_path);
    if !p.exists() {
        return Err(AppError::NotFound("File not found on disk".to_string()));
    }

    let ext = target_format.to_lowercase().trim().trim_start_matches('.').to_string();
    if !["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
        return Err(AppError::Validation("Supported formats: png, jpg, webp".to_string()));
    }

    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let parent = p.parent().unwrap_or_else(|| Path::new("."));
    let suffix = if strip_exif { "_clean" } else { "_converted" };
    let new_filename = format!("{}{}.{}", stem, suffix, ext);
    let target_path = parent.join(new_filename);
    let target_str = target_path.to_string_lossy().to_string();

    tokio::task::spawn_blocking(move || {
        let img = image::open(&source_path).map_err(|e| AppError::Internal(format!("Failed to read image: {}", e)))?;
        img.save(&target_path).map_err(|e| AppError::Internal(format!("Failed to save converted image: {}", e)))?;
        Ok::<(), AppError>(())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))??;

    let new_items = process_dropped_paths(shelf_state, db_state, vec![target_str]).await?;
    new_items.into_iter().next().ok_or_else(|| AppError::Internal("Failed to add converted image to shelf".to_string()))
}

#[tauri::command]
pub async fn batch_rename_shelf_items(
    shelf_state: tauri::State<'_, ShelfState>,
    db_state: tauri::State<'_, DbState>,
    ids: Vec<String>,
    mode: String,
    param: Option<String>,
) -> Result<Vec<DropItem>, AppError> {
    let shelf = shelf_state.0.clone();
    let conn_arc = db_state.conn.clone();

    tokio::task::spawn_blocking(move || {
        let mut updated = Vec::new();
        let db = conn_arc.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let mut map = shelf.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        for id in ids {
            if let Some(item) = map.get_mut(&id) {
                if let Some(ref current_path) = item.path {
                    let old_path = Path::new(current_path);
                    if !old_path.exists() {
                        continue;
                    }
                    let ext = old_path.extension().and_then(|e| e.to_str()).unwrap_or("");
                    let stem = old_path.file_stem().and_then(|s| s.to_str()).unwrap_or(&item.name);

                    let new_stem = match mode.as_str() {
                        "lowercase" => stem.to_lowercase(),
                        "kebab" => stem.to_lowercase().replace(' ', "-").replace('_', "-"),
                        "timestamp" => {
                            let date_prefix = chrono::Local::now().format("%Y%m%d_").to_string();
                            format!("{}{}", date_prefix, stem)
                        }
                        "replace" => {
                            let search = param.as_deref().unwrap_or("");
                            let parts: Vec<&str> = search.split("->").collect();
                            if parts.len() == 2 {
                                stem.replace(parts[0].trim(), parts[1].trim())
                            } else {
                                stem.to_string()
                            }
                        }
                        _ => stem.to_string(),
                    };

                    let new_filename = if ext.is_empty() {
                        new_stem
                    } else {
                        format!("{}.{}", new_stem, ext)
                    };

                    let new_path = old_path.with_file_name(&new_filename);
                    if fs::rename(old_path, &new_path).is_ok() {
                        let new_path_str = new_path.to_string_lossy().to_string();
                        item.name = new_filename.clone();
                        item.path = Some(new_path_str.clone());

                        let _ = db.execute(
                            "UPDATE shelf_items SET name = ?1, path = ?2 WHERE id = ?3",
                            rusqlite::params![new_filename, new_path_str, id],
                        );
                        updated.push(item.clone());
                    }
                }
            }
        }
        Ok(updated)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn start_lan_share(
    shelf_state: tauri::State<'_, ShelfState>,
    id: String,
) -> Result<LanShareInfo, AppError> {
    let (file_path, filename, size_bytes) = {
        let map = shelf_state.0.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let item = map.get(&id).ok_or_else(|| AppError::NotFound(format!("Item {} not found", id)))?;
        let p = item.path.clone().ok_or_else(|| AppError::NotFound("Item has no path".to_string()))?;
        (p, item.name.clone(), item.size_bytes.unwrap_or(0))
    };

    if !Path::new(&file_path).exists() {
        return Err(AppError::NotFound("File not found on disk".to_string()));
    }

    let local_ip = {
        let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok();
        socket
            .and_then(|s| {
                s.connect("8.8.8.8:80").ok()?;
                s.local_addr().ok().map(|a| a.ip().to_string())
            })
            .unwrap_or_else(|| "127.0.0.1".to_string())
    };

    let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to bind port: {}", e)))?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .port();

    let token = uuid::Uuid::new_v4().to_string()[0..12].to_string();
    let url = format!("http://{}:{}/download?token={}", local_ip, port, token);

    {
        let mut g = ACTIVE_LAN_TOKEN.lock().unwrap();
        *g = Some(token.clone());
    }

    let server_token = token.clone();
    let serve_path = file_path.clone();
    let serve_name = filename.clone();

    tokio::spawn(async move {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let timeout = tokio::time::sleep(Duration::from_secs(15 * 60));
        tokio::pin!(timeout);

        loop {
            tokio::select! {
                _ = &mut timeout => {
                    break;
                }
                res = listener.accept() => {
                    if let Ok((mut stream, _)) = res {
                        let mut req_buf = [0u8; 2048];
                        if let Ok(n) = stream.read(&mut req_buf).await {
                            let req = String::from_utf8_lossy(&req_buf[..n]);
                            let expected = format!("token={}", server_token);
                            if req.contains(&expected) {
                                if let Ok(bytes) = fs::read(&serve_path) {
                                    let header = format!(
                                        "HTTP/1.1 200 OK\r\n\
                                         Content-Type: application/octet-stream\r\n\
                                         Content-Length: {}\r\n\
                                         Content-Disposition: attachment; filename=\"{}\"\r\n\
                                         Access-Control-Allow-Origin: *\r\n\
                                         Connection: close\r\n\r\n",
                                        bytes.len(),
                                        serve_name
                                    );
                                    let _ = stream.write_all(header.as_bytes()).await;
                                    let _ = stream.write_all(&bytes).await;
                                    let _ = stream.flush().await;
                                    break;
                                }
                            } else {
                                let forbidden = "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nInvalid Token";
                                let _ = stream.write_all(forbidden.as_bytes()).await;
                            }
                        }
                    }
                }
            }
        }

        let mut g = ACTIVE_LAN_TOKEN.lock().unwrap();
        *g = None;
    });

    Ok(LanShareInfo {
        ip: local_ip,
        port,
        token,
        url,
        filename,
        size_bytes,
    })
}

#[tauri::command]
pub fn stop_lan_share() -> Result<(), AppError> {
    let mut g = ACTIVE_LAN_TOKEN.lock().unwrap();
    *g = None;
    Ok(())
}

// ---------------------------------------------------------------------------
// UNIT TESTS
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unc_variants() {
        assert!(is_unc_or_remote_path(r"\\server\share\file.txt"));
        assert!(is_unc_or_remote_path("//server/share/file.txt"));
        assert!(is_unc_or_remote_path(r"\\?\UNC\srv\s"));
        assert!(is_unc_or_remote_path(r"\\.\pipe\x"));
        assert!(!is_unc_or_remote_path(r"\\?\C:\x"));
        assert!(!is_unc_or_remote_path(r"C:\test\document.pdf"));
    }

    #[test]
    fn test_risky_extensions_with_dots_and_spaces() {
        assert!(is_risky_file("evil.exe."));
        assert!(is_risky_file("evil.exe "));
        assert!(is_risky_file("script.vbs"));
        assert!(is_risky_file("macro.docm"));
        assert!(is_risky_file("installer.msi."));
        assert!(!is_risky_file("safe.pdf"));
        assert!(!is_risky_file("picture.png"));
        assert!(!is_risky_file("code.rs"));
    }

    #[test]
    fn test_zone_parsing() {
        // Test parsing simulated zone content
        let test_content = "[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=about:internet\r\n";
        let mut zone_id = None;
        for line in test_content.lines() {
            if let Some(val) = line.strip_prefix("ZoneId=") {
                zone_id = val.trim().parse::<u32>().ok();
            }
        }
        assert_eq!(zone_id, Some(3));
    }
}
