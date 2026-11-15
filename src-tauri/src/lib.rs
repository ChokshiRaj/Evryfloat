mod apps;
mod clipboard;
mod clipboard_utils;
mod context;
mod db;
mod error;
mod media;
mod pomodoro;
mod shelf;
mod system;
mod window;

use clipboard::ClipboardState;
use db::DbState;
use pomodoro::PomodoroManagerState;
use shelf::ShelfState;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const HOTKEY: &str = "alt+space";
const WATCH_INTERVAL_MS: u64 = 250;
const MAX_READ_RETRIES: u8 = 4;

/// Set when the global hotkey could not be registered, so the UI can show a message.
pub struct HotkeyStatus(pub Mutex<Option<String>>);

#[tauri::command]
fn get_hotkey_status(state: tauri::State<'_, HotkeyStatus>) -> Option<String> {
    state.0.lock().ok().and_then(|g| g.clone())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Changes every time the clipboard content changes. Cheap integer read.
#[cfg(target_os = "windows")]
fn clipboard_sequence() -> u32 {
    unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}

#[cfg(not(target_os = "windows"))]
fn clipboard_sequence() -> u32 {
    use std::sync::atomic::AtomicU32;
    static N: AtomicU32 = AtomicU32::new(0);
    N.fetch_add(1, Ordering::Relaxed)
}

fn store_clip(
    app: &tauri::AppHandle,
    content: &str,
    hash: &str,
    content_type: &clipboard_utils::ContentType,
    color_hex: &Option<String>,
) {
    let db: tauri::State<'_, DbState> = app.state();
    let stored = match db.conn.lock() {
        Ok(conn) => conn
            .execute(
                "INSERT INTO clipboard_history (content, content_hash, content_type, color_hex, is_pinned, created_at) \
                 VALUES (?1, ?2, ?3, ?4, 0, ?5) \
                 ON CONFLICT(content_hash) DO UPDATE SET \
                    created_at = excluded.created_at, \
                    color_hex = excluded.color_hex",
                rusqlite::params![content, hash, content_type.as_str(), color_hex, now_ms()],
            )
            .is_ok(),
        Err(_) => false,
    };
    if stored {
        let _ = app.emit("clipboard-new-item", ());
    }
}

/// Handles one clipboard change.
/// Returns true when it is dealt with (stored or intentionally skipped),
/// false when the clipboard could not be read and should be retried.
fn capture_once(app: &tauri::AppHandle, last_hash: &mut String) -> bool {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let state: tauri::State<'_, ClipboardState> = app.state();

    // Changes made while paused are skipped (the sequence number still advances).
    if state.is_capture_paused.load(Ordering::SeqCst) {
        return true;
    }
    // Password managers and "exclude from history" formats.
    if clipboard::is_sensitive_clipboard_content() {
        return true;
    }

    // Files copied in Explorer or written by the EVRY shelf (CF_HDROP).
    #[cfg(target_os = "windows")]
    {
        if clipboard_win::raw::is_format_avail(clipboard_win::formats::CF_HDROP) {
            // get_clipboard opens the clipboard itself; raw::get_file_list does not.
            let files: Result<Vec<String>, _> =
                clipboard_win::get_clipboard(clipboard_win::formats::FileList);
            return match files {
                Ok(list) if !list.is_empty() => {
                    let joined = list.join("\n");
                    let hash = clipboard_utils::compute_content_hash(&joined);
                    if hash != *last_hash {
                        *last_hash = hash.clone();
                        // Remember our own write by its hash, so later sequence
                        // changes with the same list are skipped too.
                        let self_write = state.ignore_next_file_copy.swap(false, Ordering::SeqCst);
                        if !self_write {
                            store_clip(
                                app,
                                &joined,
                                &hash,
                                &clipboard_utils::ContentType::Files,
                                &None,
                            );
                        }
                    }
                    true
                }
                Ok(_) => true,
                Err(_) => false,
            };
        }
    }

    // Images (Screenshots, Snipping Tool, copied web images)
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::DataExchange::IsClipboardFormatAvailable;
        const CF_BITMAP: u32 = 2;
        const CF_DIB: u32 = 8;
        const CF_DIBV5: u32 = 17;
        let has_image = unsafe {
            IsClipboardFormatAvailable(CF_DIBV5) != 0
                || IsClipboardFormatAvailable(CF_DIB) != 0
                || IsClipboardFormatAvailable(CF_BITMAP) != 0
        };

        if has_image {
            if let Ok(mut clip) = arboard::Clipboard::new() {
                if let Ok(img) = clip.get_image() {
                    let hash = blake3::hash(&img.bytes).to_hex().to_string();
                    if hash != *last_hash {
                        *last_hash = hash.clone();
                        let self_write = state.is_self_written_image(&hash);
                        if !self_write {
                            match clipboard::save_clipboard_image(&img, &hash) {
                                Ok(path_str) => {
                                    store_clip(
                                        app,
                                        &path_str,
                                        &hash,
                                        &clipboard_utils::ContentType::Image,
                                        &None,
                                    );
                                }
                                Err(e) => {
                                    eprintln!("[EVRY] Failed to save clipboard image: {}", e);
                                }
                            }
                        }
                    }
                    return true;
                }
            }
        }
    }

    // Text
    let text = match app.clipboard().read_text() {
        Ok(t) => t,
        Err(_) => return false,
    };
    if text.is_empty() || text.len() > clipboard::MAX_CLIPBOARD_TEXT_LEN {
        return true;
    }
    if state.is_self_write(&text) {
        return true;
    }

    let hash = clipboard_utils::compute_content_hash(&text);
    if hash == *last_hash {
        return true;
    }
    *last_hash = hash.clone();

    let color_hex = clipboard_utils::parse_and_normalize_color(&text);
    let content_type = clipboard_utils::detect_content_type(&text, &color_hex);
    store_clip(app, &text, &hash, &content_type, &color_hex);
    true
}

fn start_clipboard_watcher(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_hash = String::new();
        let mut last_seq: u32 = 0;
        let mut retries: u8 = 0;

        loop {
            tokio::time::sleep(Duration::from_millis(WATCH_INTERVAL_MS)).await;

            let seq = clipboard_sequence();
            if seq == last_seq {
                continue;
            }

            if capture_once(&app, &mut last_hash) {
                last_seq = seq;
                retries = 0;
            } else {
                // Another app may be holding the clipboard. Retry a few times, then give up.
                retries += 1;
                if retries >= MAX_READ_RETRIES {
                    last_seq = seq;
                    retries = 0;
                }
            }
        }
    });
}

fn register_hotkey(app: &tauri::App) {
    let handle = app.handle().clone();

    let result = HOTKEY
        .parse::<Shortcut>()
        .map_err(|e| e.to_string())
        .and_then(|sc| {
            app.global_shortcut()
                .on_shortcut(sc, move |_app, _sc, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let Some(win) = handle.get_webview_window("main") else { return };

                    // Only remember the paste target when EVRY is not already focused,
                    // otherwise we would overwrite it with EVRY's own window.
                    if !win.is_focused().unwrap_or(false) {
                        let clip_state: tauri::State<'_, ClipboardState> = handle.state();
                        clipboard::record_current_foreground_window(&clip_state);
                    }

                    if !win.is_visible().unwrap_or(true) {
                        let _ = win.show();
                    }
                    let _ = win.set_focus();
                    let _ = win.emit("toggle-command-center", ());
                })
                .map_err(|e| e.to_string())
        });

    if let Err(e) = result {
        eprintln!("EVRY: could not register {HOTKEY}: {e}");
        let status: tauri::State<'_, HotkeyStatus> = app.state();
        if let Ok(mut g) = status.0.lock() {
            *g = Some(format!("Hotkey {HOTKEY} is already in use by another app"));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_state = DbState::new().expect("Failed to initialize SQLite database");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(db_state)
        .manage(PomodoroManagerState::default())
        .manage(ClipboardState::default())
        .manage(ShelfState::default())
        .manage(HotkeyStatus(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_hotkey_status,
            // Window
            window::center_notch_top,
            window::set_notch_height,
            window::toggle_notch_visibility,
            window::set_screen_capture_protection,
            // Apps & files
            apps::get_installed_apps,
            apps::launch_app,
            apps::search_user_files,
            // System
            system::get_system_stats,
            system::open_windows_setting,
            system::adjust_system_volume,
            system::terminate_process,
            // Notes & reminders
            db::get_notes,
            db::save_note,
            db::delete_note,
            db::get_reminders,
            db::save_reminder,
            db::toggle_reminder,
            db::delete_reminder,
            // Snippets
            db::get_snippets,
            db::save_snippet,
            db::delete_snippet,
            db::purge_clipboard_and_shelf,
            // Clipboard
            clipboard::paste_clipboard_item,
            clipboard::copy_clipboard_item,
            clipboard::get_clipboard_image_details,
            clipboard::drop_into_clipboard,
            clipboard::prepare_clipboard_drag_items,
            clipboard::toggle_clipboard_pause,
            clipboard::get_clipboard_pause_status,
            clipboard::record_foreground_target,
            db::get_clipboard_history,
            db::add_clipboard_entry,
            db::pin_clipboard_item,
            db::delete_clipboard_item,
            db::clear_clipboard_history,
            // Pomodoro
            pomodoro::get_pomodoro_state,
            pomodoro::get_pomodoro_stats,
            pomodoro::start_pomodoro,
            pomodoro::pause_pomodoro,
            pomodoro::reset_pomodoro,
            pomodoro::skip_pomodoro,
            pomodoro::extend_pomodoro,
            pomodoro::set_pomodoro_task,
            pomodoro::set_pomodoro_config,
            // Media
            media::get_media_info,
            media::media_play_pause,
            media::media_next,
            media::media_prev,
            // Context
            context::get_active_app_context,
            // Shelf
            shelf::process_dropped_paths,
            shelf::process_dropped_file,
            shelf::get_shelf_items,
            shelf::remove_shelf_item,
            shelf::clear_shelf_items,
            shelf::open_shelf_item,
            shelf::show_in_folder,
            shelf::prepare_drag_item,
            shelf::copy_items_to_clipboard,
            shelf::paste_items,
            shelf::compress_shelf_items,
            shelf::convert_image,
            shelf::batch_rename_shelf_items,
            shelf::start_lan_share,
            shelf::stop_lan_share,
        ])
        .setup(|app| {
            shelf::cleanup_staging_temp_dir();

            // Dock the notch at the top centre of the current monitor.
            if let Some(main_win) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = main_win.current_monitor() {
                    let m_size = monitor.size();
                    let m_pos = monitor.position();
                    let w_size = main_win
                        .outer_size()
                        .unwrap_or(tauri::PhysicalSize::new(640, 44));
                    let x = m_pos.x + ((m_size.width as i32 - w_size.width as i32) / 2);
                    let _ = main_win.set_position(tauri::PhysicalPosition::new(x, m_pos.y));
                }
            }

            // System Tray Icon & Menu
            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

            let toggle_i = MenuItemBuilder::with_id("toggle", "Show / Hide EVRY").build(app)?;
            let pause_i = MenuItemBuilder::with_id("pause_clip", "Pause Clipboard Capture").build(app)?;
            let mute_i = MenuItemBuilder::with_id("mute", "Mute Audio").build(app)?;
            let settings_i = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Quit EVRY").build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .items(&[&toggle_i, &pause_i, &mute_i, &settings_i])
                .separator()
                .item(&quit_i)
                .build()?;

            let mut builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "toggle" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let is_vis = win.is_visible().unwrap_or(true);
                                if is_vis {
                                    let _ = win.hide();
                                } else {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                            }
                        }
                        "pause_clip" => {
                            let clip_state: tauri::State<'_, ClipboardState> = app.state();
                            let cur = clip_state.is_capture_paused.load(Ordering::SeqCst);
                            clip_state.is_capture_paused.store(!cur, Ordering::SeqCst);
                        }
                        "mute" => {
                            let _ = system::adjust_system_volume(0);
                        }
                        "settings" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                                let _ = win.emit("open-module", "settings");
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let is_vis = win.is_visible().unwrap_or(true);
                            if is_vis {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }

            let _ = builder.build(app);

            register_hotkey(app);
            start_clipboard_watcher(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building EVRY");

    app.run(|_handle, event| {
        if let RunEvent::Exit = event {
            shelf::cleanup_staging_temp_dir();
        }
    });
}