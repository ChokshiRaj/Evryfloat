use serde::Serialize;
use std::sync::OnceLock;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

// Keep in sync with the window width in tauri.conf.json.
const NOTCH_WIDTH: f64 = 640.0;
const MIN_HEIGHT: f64 = 32.0;
const MAX_HEIGHT: f64 = 900.0;

#[derive(Debug, Clone, Serialize)]
pub struct ProtectionResult {
    pub success: bool,
    pub is_fallback: bool,
    pub build_number: u32,
    pub mode: String,
}

#[cfg(target_os = "windows")]
fn read_windows_build_number() -> u32 {
    #[repr(C)]
    #[allow(non_snake_case)]
    struct OSVERSIONINFOEXW {
        dwOSVersionInfoSize: u32,
        dwMajorVersion: u32,
        dwMinorVersion: u32,
        dwBuildNumber: u32,
        dwPlatformId: u32,
        szCSDVersion: [u16; 128],
        wServicePackMajor: u16,
        wServicePackMinor: u16,
        wSuiteMask: u16,
        wProductType: u8,
        wReserved: u8,
    }
    type RtlGetVersionFn = unsafe extern "system" fn(*mut OSVERSIONINFOEXW) -> i32;

    unsafe {
        use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleA, GetProcAddress};
        // RtlGetVersion is not affected by manifest version clamping.
        let ntdll = GetModuleHandleA(b"ntdll.dll\0".as_ptr());
        if ntdll.is_null() {
            return 0;
        }
        let Some(func) = GetProcAddress(ntdll, b"RtlGetVersion\0".as_ptr()) else {
            return 0;
        };
        let rtl_get_version: RtlGetVersionFn = std::mem::transmute(func);
        let mut info: OSVERSIONINFOEXW = std::mem::zeroed();
        info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOEXW>() as u32;
        if rtl_get_version(&mut info) == 0 {
            info.dwBuildNumber
        } else {
            0
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn read_windows_build_number() -> u32 {
    0
}

pub fn get_windows_build_number() -> u32 {
    static BUILD: OnceLock<u32> = OnceLock::new();
    *BUILD.get_or_init(read_windows_build_number)
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())
}

/// Centres the window flush to the top of its monitor.
/// `logical_width`: use the width the window is about to have (after a resize);
/// None uses the current outer size.
fn center_at_top(window: &WebviewWindow, logical_width: Option<f64>) -> Result<(), String> {
    let monitor = match window.current_monitor().map_err(|e| e.to_string())? {
        Some(m) => m,
        None => match window.primary_monitor().map_err(|e| e.to_string())? {
            Some(m) => m,
            None => return Ok(()),
        },
    };

    let width_px = match logical_width {
        Some(w) => (w * monitor.scale_factor()).round() as i32,
        None => window.outer_size().map_err(|e| e.to_string())?.width as i32,
    };
    let pos = monitor.position();
    let x = pos.x + (monitor.size().width as i32 - width_px) / 2;

    window
        .set_position(PhysicalPosition::new(x, pos.y)) // flush to the top bezel
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn center_notch_top(app: AppHandle) -> Result<(), String> {
    center_at_top(&main_window(&app)?, None)
}

#[tauri::command]
pub fn set_notch_height(app: AppHandle, logical_height: f64) -> Result<(), String> {
    if !logical_height.is_finite() {
        return Err("Invalid height".into());
    }
    let height = logical_height.clamp(MIN_HEIGHT, MAX_HEIGHT);
    let window = main_window(&app)?;

    // Logical sizing keeps the UI unclipped at 125%, 150% and 200% scaling.
    window
        .set_size(LogicalSize::new(NOTCH_WIDTH, height))
        .map_err(|e| format!("Failed to set size: {e}"))?;
    // The monitor's scale factor may differ from before, so re-centre.
    center_at_top(&window, Some(NOTCH_WIDTH))
}

#[tauri::command]
pub fn toggle_notch_visibility(app: AppHandle) -> Result<bool, String> {
    let window = main_window(&app)?;
    let visible = window.is_visible().map_err(|e| e.to_string())?;
    if visible {
        window.hide().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        Ok(true)
    }
}

/// Excludes the notch from screen capture (Teams, Zoom, OBS, screenshots).
/// Windows 10 2004 (build 19041) and later hide the window completely.
/// Older builds fall back to WDA_MONITOR, which shows a black box instead.
#[tauri::command]
pub fn set_screen_capture_protection(app: AppHandle, enable: bool) -> Result<ProtectionResult, String> {
    let build = get_windows_build_number();

    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_MONITOR, WDA_NONE,
        };

        let (affinity, is_fallback, mode) = if !enable {
            (WDA_NONE, false, "none")
        } else if build >= 19041 {
            (WDA_EXCLUDEFROMCAPTURE, false, "exclude")
        } else {
            (WDA_MONITOR, true, "monitor")
        };

        let window = main_window(&app)?;
        let hwnd = window.hwnd().map_err(|e| format!("Could not get window handle: {e}"))?;
        let ok = unsafe { SetWindowDisplayAffinity(hwnd.0 as _, affinity) } != 0;

        Ok(ProtectionResult {
            success: ok,
            is_fallback,
            build_number: build,
            mode: if ok { mode } else { "none" }.to_string(),
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, enable);
        Ok(ProtectionResult { success: false, is_fallback: false, build_number: build, mode: "none".into() })
    }
}