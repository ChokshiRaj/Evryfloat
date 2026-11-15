use serde::Serialize;
use std::sync::{Mutex, MutexGuard, OnceLock};
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

const MB: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct SystemStats {
    pub cpu_usage: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub memory_usage_percent: f32,
    pub battery_percent: Option<u8>,
    pub is_charging: Option<bool>,
    pub on_ac: Option<bool>,
}

// One long-lived System: CPU load needs two refreshes to be meaningful.
// One long-lived System: CPU load needs two refreshes to be meaningful.
// Option because creating a System can fail in sysinfo 0.40.
static SYS: OnceLock<Option<Mutex<System>>> = OnceLock::new();

fn sys() -> Option<MutexGuard<'static, System>> {
    SYS.get_or_init(|| {
        System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::nothing().with_usage())
                .with_memory(MemoryRefreshKind::everything()),
        )
        .ok()
        .map(Mutex::new)
    })
    .as_ref()
    .map(|m| m.lock().unwrap_or_else(|p| p.into_inner()))
}

#[tauri::command]
pub fn get_system_stats() -> SystemStats {
    let (cpu, used_mb, total_mb) = match sys() {
        Some(mut s) => {
            // `let _ =` works whether these return () or a Result in your version.
            let _ = s.refresh_cpu_usage();
            let _ = s.refresh_memory();
            (s.global_cpu_usage(), s.used_memory() / MB, s.total_memory() / MB)
        }
        None => (0.0, 0, 0),
    };
    let mem_percent = if total_mb > 0 {
        used_mb as f32 / total_mb as f32 * 100.0
    } else {
        0.0
    };
    let power = read_power();

    SystemStats {
        cpu_usage: cpu.clamp(0.0, 100.0),
        memory_used_mb: used_mb,
        memory_total_mb: total_mb,
        memory_usage_percent: mem_percent,
        battery_percent: power.percent,
        is_charging: power.charging,
        on_ac: power.on_ac,
    }
}

// ───────────────────────── Battery ─────────────────────────

#[derive(Debug, PartialEq, Eq)]
struct PowerInfo {
    percent: Option<u8>,
    charging: Option<bool>,
    on_ac: Option<bool>,
}

/// Pure so it can be unit tested.
/// battery_flag bits: 1 high, 2 low, 4 critical, 8 charging, 128 no battery, 255 unknown.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn interpret_power(ac_line: u8, battery_flag: u8, life_percent: u8) -> PowerInfo {
    let on_ac = match ac_line {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    };
    if battery_flag == 255 || battery_flag & 128 != 0 {
        return PowerInfo { percent: None, charging: None, on_ac };
    }
    PowerInfo {
        percent: (life_percent <= 100).then_some(life_percent),
        charging: Some(battery_flag & 8 != 0),
        on_ac,
    }
}

#[cfg(target_os = "windows")]
fn read_power() -> PowerInfo {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut st: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
    if unsafe { GetSystemPowerStatus(&mut st) } == 0 {
        return PowerInfo { percent: None, charging: None, on_ac: None };
    }
    interpret_power(st.ACLineStatus, st.BatteryFlag, st.BatteryLifePercent)
}

#[cfg(not(target_os = "windows"))]
fn read_power() -> PowerInfo {
    PowerInfo { percent: None, charging: None, on_ac: None }
}

// ───────────────────────── Windows settings ─────────────────────────

/// Only plain `ms-settings:` pages. Never a file path, exe or other URL scheme.
fn is_allowed_setting(uri: &str) -> bool {
    let u = uri.trim().to_ascii_lowercase();
    u.starts_with("ms-settings:")
        && u.len() <= 80
        && u.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '-' | '_' | '.'))
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn shell_error(code: isize) -> String {
    match code {
        0 | 8 => "Out of memory".into(),
        2 | 3 => "Setting page not found".into(),
        5 => "Access denied".into(),
        31 => "No app is associated with this setting".into(),
        c => format!("Could not open setting (code {c})"),
    }
}

#[tauri::command]
pub fn open_windows_setting(uri: String) -> Result<(), String> {
    if !is_allowed_setting(&uri) {
        return Err("Only Windows Settings pages can be opened".into());
    }

    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let wide = |s: &str| -> Vec<u16> {
            OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
        };
        let op = wide("open");
        let target = wide(uri.trim());

        let res = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if (res as isize) <= 32 {
            return Err(shell_error(res as isize));
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Unsupported platform".to_string())
    }
}

// ───────────────────────── Volume ─────────────────────────

#[cfg(target_os = "windows")]
fn press_media_key(vk: u16, times: u32) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput,
    };

    let key = |up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let mut inputs = Vec::with_capacity(times as usize * 2);
    for _ in 0..times {
        inputs.push(key(false));
        inputs.push(key(true));
    }
    let sent = unsafe {
        SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32)
    };
    if sent as usize != inputs.len() {
        return Err("Windows blocked the volume key press".into());
    }
    Ok(())
}

/// delta == 0 toggles mute, > 0 volume up, < 0 volume down. Each key press is 2%.
#[tauri::command]
pub fn adjust_system_volume(delta: i32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            VK_VOLUME_DOWN, VK_VOLUME_MUTE, VK_VOLUME_UP,
        };
        if delta == 0 {
            return press_media_key(VK_VOLUME_MUTE, 1);
        }
        let steps = delta.unsigned_abs().div_ceil(2).clamp(1, 25);
        press_media_key(if delta > 0 { VK_VOLUME_UP } else { VK_VOLUME_DOWN }, steps)
    }
    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;
        let _ = delta;
        Err("Unsupported platform".to_string())
    }
}

/// Terminate an unresponsive process by name (e.g. "node", "chrome", "notepad")
#[tauri::command]
pub fn terminate_process(query: String) -> Result<usize, String> {
    let clean = query.trim().to_lowercase();
    if clean.is_empty() {
        return Err("No process name provided".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let target = if clean.ends_with(".exe") {
            clean.clone()
        } else {
            format!("{}.exe", clean)
        };

        let output = Command::new("taskkill")
            .args(["/F", "/IM", &target])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                return Ok(1);
            }
        }
    }

    Err(format!("Could not terminate process matching '{}'. It may not be running or requires higher privileges.", query))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_without_battery() {
        let p = interpret_power(1, 128, 255);
        assert_eq!(p, PowerInfo { percent: None, charging: None, on_ac: Some(true) });
    }

    #[test]
    fn laptop_charging() {
        let p = interpret_power(1, 9, 80);
        assert_eq!(p, PowerInfo { percent: Some(80), charging: Some(true), on_ac: Some(true) });
    }

    #[test]
    fn plugged_in_and_full_is_not_charging() {
        let p = interpret_power(1, 1, 100);
        assert_eq!(p.charging, Some(false));
        assert_eq!(p.on_ac, Some(true));
    }

    #[test]
    fn on_battery() {
        let p = interpret_power(0, 1, 55);
        assert_eq!(p, PowerInfo { percent: Some(55), charging: Some(false), on_ac: Some(false) });
    }

    #[test]
    fn setting_allowlist() {
        assert!(is_allowed_setting("ms-settings:network-wifi"));
        assert!(is_allowed_setting("MS-SETTINGS:bluetooth"));
        assert!(is_allowed_setting("ms-settings:"));
        assert!(!is_allowed_setting(r"C:\Windows\System32\calc.exe"));
        assert!(!is_allowed_setting("https://example.com"));
        assert!(!is_allowed_setting("ms-settings:x & calc"));
        assert!(!is_allowed_setting("cmd.exe"));
    }
}