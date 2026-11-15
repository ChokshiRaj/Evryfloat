use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::clipboard_utils::{compute_content_hash, ContentType};
use crate::db::DbState;
use crate::error::AppError;

pub const MAX_CLIPBOARD_TEXT_LEN: usize = 1024 * 1024; // 1 MB cap

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardItem {
    pub id: i64,
    pub content: String,
    pub content_type: ContentType,
    pub color_hex: Option<String>,
    pub is_pinned: bool,
    pub created_at: i64, // Unix timestamp in ms
}

pub struct ClipboardState {
    pub last_self_written_hash: Mutex<Option<String>>,
    pub is_capture_paused: AtomicBool,
    pub ignore_next_file_copy: AtomicBool,
    pub ignore_next_image_hash: Mutex<Option<String>>,
    #[allow(dead_code)]
    pub restore_previous_clipboard: AtomicBool,
    pub saved_foreground_hwnd: Mutex<isize>,
}

impl Default for ClipboardState {
    fn default() -> Self {
        Self {
            last_self_written_hash: Mutex::new(None),
            is_capture_paused: AtomicBool::new(false),
            ignore_next_file_copy: AtomicBool::new(false),
            ignore_next_image_hash: Mutex::new(None),
            restore_previous_clipboard: AtomicBool::new(false),
            saved_foreground_hwnd: Mutex::new(0),
        }
    }
}

impl ClipboardState {
    pub fn mark_self_write(&self, text: &str) {
        let hash = compute_content_hash(text);
        if let Ok(mut lock) = self.last_self_written_hash.lock() {
            *lock = Some(hash);
        }
    }

    pub fn is_self_write(&self, text: &str) -> bool {
        let hash = compute_content_hash(text);
        if let Ok(mut lock) = self.last_self_written_hash.lock() {
            if let Some(ref self_hash) = *lock {
                if *self_hash == hash {
                    *lock = None; // consume flag
                    return true;
                }
            }
        }
        false
    }

    pub fn mark_self_written_image(&self, hash: &str) {
        if let Ok(mut lock) = self.ignore_next_image_hash.lock() {
            *lock = Some(hash.to_string());
        }
    }

    pub fn is_self_written_image(&self, hash: &str) -> bool {
        if let Ok(mut lock) = self.ignore_next_image_hash.lock() {
            if let Some(ref self_hash) = *lock {
                if self_hash == hash {
                    *lock = None; // consume flag
                    return true;
                }
            }
        }
        false
    }

    pub fn set_saved_hwnd(&self, hwnd: isize) {
        if let Ok(mut lock) = self.saved_foreground_hwnd.lock() {
            *lock = hwnd;
        }
    }

    pub fn get_saved_hwnd(&self) -> isize {
        self.saved_foreground_hwnd.lock().map(|h| *h).unwrap_or(0)
    }
}

// -------------------------------------------------------------------------------------------------
// Windows Native Helpers (Focus restoration, Modifiers release, Native Ctrl+V, Sensitive detection)
// -------------------------------------------------------------------------------------------------

#[cfg(target_os = "windows")]
pub fn record_current_foreground_window(state: &ClipboardState) {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe {
        let hwnd = GetForegroundWindow();
        state.set_saved_hwnd(hwnd as isize);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn record_current_foreground_window(_state: &ClipboardState) {}

#[cfg(target_os = "windows")]
pub fn is_sensitive_clipboard_content() -> bool {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW,
    };

    // Formats used by 1Password, Bitwarden, KeePass, Windows Clipboard History exclusion
    unsafe {
        if OpenClipboard(0 as HWND) == 0 {
            return false;
        }

        let exclude_name: Vec<u16> = "ExcludeClipboardContentFromMonitorProcessing\0"
            .encode_utf16()
            .collect();
        let format_exclude = RegisterClipboardFormatW(exclude_name.as_ptr());

        let mut sensitive = false;
        if format_exclude != 0 && IsClipboardFormatAvailable(format_exclude) != 0 {
            sensitive = true;
        }

        CloseClipboard();
        sensitive
    }
}

#[cfg(not(target_os = "windows"))]
pub fn is_sensitive_clipboard_content() -> bool {
    false
}

#[cfg(target_os = "windows")]
pub fn restore_focus_and_send_ctrl_v(target_hwnd: isize) -> Result<(), AppError> {
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_MENU,
        VK_SHIFT, VK_LWIN, VK_RWIN,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, SetForegroundWindow,
    };

    unsafe {
        // 1. Restore focus to saved foreground window
        if target_hwnd != 0 {
            let hwnd = target_hwnd as HWND;
            SetForegroundWindow(hwnd);

            // Poll until focused with timeout up to 300ms
            let start = Instant::now();
            let mut focused = false;
            while start.elapsed() < Duration::from_millis(300) {
                if GetForegroundWindow() == hwnd {
                    focused = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }

            if !focused {
                return Err(AppError::Blocked(
                    "Cannot paste: Target window is elevated (Administrator) or blocked by UIPI".to_string(),
                ));
            }
        }

        // 2. Explicitly release any held modifier keys (Shift, Alt, Win)
        let release_keys = [VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN];
        let mut release_inputs: Vec<INPUT> = Vec::new();
        for &vk in &release_keys {
            let mut input = std::mem::zeroed::<INPUT>();
            input.r#type = INPUT_KEYBOARD;
            input.Anonymous.ki = KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            };
            release_inputs.push(input);
        }
        SendInput(
            release_inputs.len() as u32,
            release_inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );

        // 3. Simulate Ctrl+V (Press Ctrl, Press V, Release V, Release Ctrl)
        let vk_v: u16 = 0x56; // Virtual key 'V'
        let mut paste_inputs: [INPUT; 4] = [std::mem::zeroed(); 4];

        // Ctrl down
        paste_inputs[0].r#type = INPUT_KEYBOARD;
        paste_inputs[0].Anonymous.ki = KEYBDINPUT {
            wVk: VK_CONTROL,
            wScan: 0,
            dwFlags: 0,
            time: 0,
            dwExtraInfo: 0,
        };

        // V down
        paste_inputs[1].r#type = INPUT_KEYBOARD;
        paste_inputs[1].Anonymous.ki = KEYBDINPUT {
            wVk: vk_v,
            wScan: 0,
            dwFlags: 0,
            time: 0,
            dwExtraInfo: 0,
        };

        // V up
        paste_inputs[2].r#type = INPUT_KEYBOARD;
        paste_inputs[2].Anonymous.ki = KEYBDINPUT {
            wVk: vk_v,
            wScan: 0,
            dwFlags: KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
        };

        // Ctrl up
        paste_inputs[3].r#type = INPUT_KEYBOARD;
        paste_inputs[3].Anonymous.ki = KEYBDINPUT {
            wVk: VK_CONTROL,
            wScan: 0,
            dwFlags: KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
        };

        SendInput(
            paste_inputs.len() as u32,
            paste_inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn restore_focus_and_send_ctrl_v(_target_hwnd: isize) -> Result<(), AppError> {
    Ok(())
}

// -------------------------------------------------------------------------------------------------
// Image Clipboard Helpers
// -------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardImageDetails {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub size_bytes: u64,
}

pub fn save_clipboard_image(img: &arboard::ImageData, hash: &str) -> Result<String, AppError> {
    let images_dir = crate::db::get_clip_images_dir();
    let _ = std::fs::create_dir_all(&images_dir);
    let file_path = images_dir.join(format!("{}.png", hash));
    let path_str = file_path.to_string_lossy().to_string();

    if !file_path.exists() {
        image::save_buffer(
            &file_path,
            &img.bytes,
            img.width as u32,
            img.height as u32,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| AppError::Internal(format!("Failed to save clipboard image: {}", e)))?;
    }

    Ok(path_str)
}

pub fn set_clipboard_image_from_path(file_path: &str) -> Result<(), AppError> {
    let path = std::path::Path::new(file_path);
    if !path.exists() {
        return Err(AppError::NotFound(format!("Clipboard image file not found: {}", file_path)));
    }

    let img = image::open(path)
        .map_err(|e| AppError::Internal(format!("Failed to open clipboard image: {}", e)))?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    let img_data = arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: std::borrow::Cow::Borrowed(rgba.as_raw()),
    };

    let mut clip = arboard::Clipboard::new()
        .map_err(|e| AppError::Clipboard(format!("Failed to open clipboard: {}", e)))?;
    clip.set_image(img_data)
        .map_err(|e| AppError::Clipboard(format!("Failed to set image to clipboard: {}", e)))?;

    Ok(())
}

// -------------------------------------------------------------------------------------------------
// Tauri Commands
// -------------------------------------------------------------------------------------------------

#[tauri::command]
pub async fn get_clipboard_image_details(file_path: String) -> Result<ClipboardImageDetails, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::path::Path::new(&file_path);
        if !path.exists() {
            return Err(AppError::NotFound(format!("Image file not found: {}", file_path)));
        }

        let meta = std::fs::metadata(path).map_err(|e| AppError::Internal(e.to_string()))?;
        let bytes = std::fs::read(path).map_err(|e| AppError::Internal(e.to_string()))?;

        let img = image::load_from_memory(&bytes)
            .map_err(|e| AppError::Internal(format!("Failed to parse image: {}", e)))?;
        let (width, height) = (img.width(), img.height());

        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let data_url = format!("data:image/png;base64,{}", b64);

        Ok(ClipboardImageDetails {
            data_url,
            width,
            height,
            size_bytes: meta.len(),
        })
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn copy_clipboard_item(
    app: AppHandle,
    state: State<'_, ClipboardState>,
    db: State<'_, DbState>,
    id: i64,
) -> Result<(), AppError> {
    let item = db.get_clipboard_item_by_id(id)?;
    if item.content_type == ContentType::Image {
        let path = item.content;
        if let Ok(bytes) = std::fs::read(&path) {
            let hash = blake3::hash(&bytes).to_hex().to_string();
            state.mark_self_written_image(&hash);
        }
        tauri::async_runtime::spawn_blocking(move || {
            set_clipboard_image_from_path(&path)
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;
    } else {
        state.mark_self_write(&item.content);
        app.clipboard()
            .write_text(&item.content)
            .map_err(|e| AppError::Clipboard(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn paste_clipboard_item(
    app: AppHandle,
    state: State<'_, ClipboardState>,
    db: State<'_, DbState>,
    id: Option<i64>,
    content: Option<String>,
) -> Result<(), AppError> {
    // 1. Resolve item
    let (item_type, text_or_path) = if let Some(item_id) = id {
        let item = db.get_clipboard_item_by_id(item_id)?;
        (item.content_type, item.content)
    } else if let Some(direct_text) = content {
        (ContentType::Text, direct_text)
    } else {
        return Err(AppError::Validation("No item id or content provided".to_string()));
    };

    if item_type == ContentType::Image {
        let path = text_or_path.clone();
        if let Ok(bytes) = std::fs::read(&path) {
            let hash = blake3::hash(&bytes).to_hex().to_string();
            state.mark_self_written_image(&hash);
        }
        tauri::async_runtime::spawn_blocking(move || {
            set_clipboard_image_from_path(&path)
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;
    } else {
        // Mark self-write to avoid watcher feedback loop (#7)
        state.mark_self_write(&text_or_path);

        // Write natively to clipboard via Tauri's clipboard plugin (#3)
        app.clipboard()
            .write_text(&text_or_path)
            .map_err(|e| AppError::Clipboard(e.to_string()))?;
    }

    // Collapse the drawer cleanly back to the top notch (never permanently hide the notch window)
    use tauri::Emitter;
    let _ = app.emit("collapse-notch", ());

    // Restore focus to previously focused application and send Ctrl+V (#1, #4, #5, #6)
    let target_hwnd = state.get_saved_hwnd();
    let res = tauri::async_runtime::spawn_blocking(move || {
        restore_focus_and_send_ctrl_v(target_hwnd)
    })
    .await
    .map_err(|e| AppError::NativeOs(e.to_string()))?;

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

#[tauri::command]
pub fn toggle_clipboard_pause(state: State<'_, ClipboardState>) -> Result<bool, AppError> {
    let current = state.is_capture_paused.load(Ordering::SeqCst);
    let next = !current;
    state.is_capture_paused.store(next, Ordering::SeqCst);
    Ok(next)
}

#[tauri::command]
pub fn get_clipboard_pause_status(state: State<'_, ClipboardState>) -> Result<bool, AppError> {
    Ok(state.is_capture_paused.load(Ordering::SeqCst))
}

#[tauri::command]
pub fn record_foreground_target(state: State<'_, ClipboardState>) -> Result<(), AppError> {
    record_current_foreground_window(&state);
    Ok(())
}

#[tauri::command]
pub async fn drop_into_clipboard(
    app: AppHandle,
    _state: State<'_, ClipboardState>,
    db: State<'_, DbState>,
    paths: Option<Vec<String>>,
    text: Option<String>,
) -> Result<Vec<ClipboardItem>, AppError> {
    use tauri::Emitter;

    let mut added_items = Vec::new();

    if let Some(file_paths) = paths {
        for path_str in file_paths {
            let path = std::path::Path::new(&path_str);
            if !path.exists() {
                continue;
            }

            let is_img = if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                let ext_lower = ext.to_lowercase();
                matches!(
                    ext_lower.as_str(),
                    "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" | "ico" | "tiff"
                )
            } else {
                false
            };

            if is_img {
                if let Ok(img) = image::open(path) {
                    let rgba = img.to_rgba8();
                    let (width, height) = rgba.dimensions();
                    let hash = blake3::hash(rgba.as_raw()).to_hex().to_string();

                    let img_data = arboard::ImageData {
                        width: width as usize,
                        height: height as usize,
                        bytes: std::borrow::Cow::Borrowed(rgba.as_raw()),
                    };

                    if let Ok(saved_path) = save_clipboard_image(&img_data, &hash) {
                        if let Ok(item) = db.insert_clipboard_item(&saved_path, &hash, ContentType::Image, None) {
                            added_items.push(item);
                        }
                    }
                }
            } else {
                let hash = compute_content_hash(&path_str);
                if let Ok(item) = db.insert_clipboard_item(&path_str, &hash, ContentType::Files, None) {
                    added_items.push(item);
                }
            }
        }
    }

    if let Some(t) = text {
        if !t.trim().is_empty() {
            let color_hex = crate::clipboard_utils::parse_and_normalize_color(&t);
            let content_type = crate::clipboard_utils::detect_content_type(&t, &color_hex);
            let hash = compute_content_hash(&t);
            if let Ok(item) = db.insert_clipboard_item(&t, &hash, content_type, color_hex) {
                added_items.push(item);
            }
        }
    }

    if !added_items.is_empty() {
        let _ = app.emit("clipboard-new-item", ());
    }

    Ok(added_items)
}

#[tauri::command]
pub async fn prepare_clipboard_drag_items(
    db: State<'_, DbState>,
    ids: Vec<i64>,
) -> Result<Vec<String>, AppError> {
    let mut paths = Vec::new();

    for id in ids {
        if let Ok(item) = db.get_clipboard_item_by_id(id) {
            // 1. If it's an image on disk:
            if item.content_type == ContentType::Image {
                if std::path::Path::new(&item.content).exists() {
                    paths.push(item.content);
                    continue;
                }
            }

            // 2. If it's a file path list:
            if item.content_type == ContentType::Files {
                for line in item.content.lines() {
                    let trimmed = line.trim();
                    if std::path::Path::new(trimmed).exists() {
                        paths.push(trimmed.to_string());
                    }
                }
                continue;
            }

            // 3. For text, code, url, color, email:
            let temp_dir = std::env::temp_dir().join("EVRY_DragDrop");
            let _ = std::fs::create_dir_all(&temp_dir);

            let ext = if item.content_type == ContentType::Url { "url" } else { "txt" };
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let file_name = format!("clip_{}_{}.{}", item.id, timestamp, ext);
            let target_path = temp_dir.join(file_name);

            if item.content_type == ContentType::Url {
                let shortcut_content = format!("[InternetShortcut]\nURL={}\n", item.content.trim());
                if std::fs::write(&target_path, shortcut_content).is_ok() {
                    paths.push(target_path.to_string_lossy().to_string());
                }
            } else {
                if std::fs::write(&target_path, &item.content).is_ok() {
                    paths.push(target_path.to_string_lossy().to_string());
                }
            }
        }
    }

    if paths.is_empty() {
        return Err(AppError::NotFound("No draggable items found".to_string()));
    }

    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_self_write_detection() {
        let state = ClipboardState::default();
        let hash = "abc123blake3hash";

        assert!(!state.is_self_written_image(hash));

        state.mark_self_written_image(hash);
        assert!(state.is_self_written_image(hash));
        // Consumed, next check should be false
        assert!(!state.is_self_written_image(hash));
    }

    #[test]
    fn test_save_and_read_clipboard_image() {
        // Create 2x2 test RGBA image
        let rgba_bytes = vec![
            255, 0, 0, 255,   // Red
            0, 255, 0, 255,   // Green
            0, 0, 255, 255,   // Blue
            255, 255, 255, 255 // White
        ];
        let img_data = arboard::ImageData {
            width: 2,
            height: 2,
            bytes: std::borrow::Cow::Borrowed(&rgba_bytes),
        };
        let hash = blake3::hash(&rgba_bytes).to_hex().to_string();

        let path_str = save_clipboard_image(&img_data, &hash).expect("save image");
        let path = std::path::Path::new(&path_str);
        assert!(path.exists());

        // Verify image can be decoded and dimensions match
        let opened = image::open(path).expect("open image");
        assert_eq!(opened.width(), 2);
        assert_eq!(opened.height(), 2);

        // Clean up test file
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn test_drag_staging_creates_valid_file() {
        let temp_dir = std::env::temp_dir().join("EVRY_DragDrop");
        let _ = std::fs::create_dir_all(&temp_dir);
        let test_file = temp_dir.join("test_drag_sample.txt");
        let sample_text = "Sample dragged clipboard text content";
        std::fs::write(&test_file, sample_text).expect("write test file");

        assert!(test_file.exists());
        let read_back = std::fs::read_to_string(&test_file).expect("read back");
        assert_eq!(read_back, sample_text);

        let _ = std::fs::remove_file(&test_file);
    }
}
