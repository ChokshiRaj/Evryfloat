use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveAppContext {
    pub process_name: String,
    pub window_title: String,
    pub category: String, // "code" | "meeting" | "design" | "browser" | "terminal" | "general"
    pub badge_label: String,
    pub quick_action: Option<String>,
}

#[tauri::command]
pub fn get_active_app_context() -> ActiveAppContext {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
        };

        unsafe {
            let hwnd: HWND = GetForegroundWindow();
            if hwnd.is_null() {
                return default_context();
            }

            // 1. Get window title
            let mut title_buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 512);
            let window_title = if len > 0 {
                String::from_utf16_lossy(&title_buf[..len as usize])
            } else {
                String::new()
            };

            // 2. Get process name
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);

            let process_name = get_process_name_by_pid(pid);

            // 3. Categorize context
            categorize_context(&process_name, &window_title)
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        default_context()
    }
}

fn default_context() -> ActiveAppContext {
    ActiveAppContext {
        process_name: "Desktop".to_string(),
        window_title: "".to_string(),
        category: "general".to_string(),
        badge_label: "Desktop".to_string(),
        quick_action: None,
    }
}

fn get_process_name_by_pid(pid: u32) -> String {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        use windows_sys::Win32::System::ProcessStatus::GetProcessImageFileNameW;
        use windows_sys::Win32::Foundation::CloseHandle;

        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !handle.is_null() {
                let mut path_buf = [0u16; 512];
                let len = GetProcessImageFileNameW(handle, path_buf.as_mut_ptr(), 512);
                CloseHandle(handle);

                if len > 0 {
                    let full_path = String::from_utf16_lossy(&path_buf[..len as usize]);
                    if let Some(filename) = full_path.split('\\').last() {
                        return filename.to_lowercase().replace(".exe", "");
                    }
                }
            }
        }
    }
    "".to_string()
}

fn categorize_context(process_name: &str, window_title: &str) -> ActiveAppContext {
    let p = process_name.to_lowercase();
    let t = window_title.to_lowercase();

    // 1. Coding / Development
    if p.contains("code") || p.contains("devenv") || p.contains("idea") || p.contains("sublime") || p.contains("cursor") {
        return ActiveAppContext {
            process_name: "VS Code".to_string(),
            window_title: window_title.to_string(),
            category: "code".to_string(),
            badge_label: "Coding Mode".to_string(),
            quick_action: Some("Dev Port Killer (:3000)".to_string()),
        };
    }

    // 2. Terminal / Shell
    if p.contains("windowsterminal") || p.contains("cmd") || p.contains("powershell") || p.contains("alacritty") || p.contains("wezterm") {
        return ActiveAppContext {
            process_name: "Terminal".to_string(),
            window_title: window_title.to_string(),
            category: "terminal".to_string(),
            badge_label: "CLI Session".to_string(),
            quick_action: Some("Run Developer Command".to_string()),
        };
    }

    // 3. Meetings / Video Call
    if p.contains("zoom") || p.contains("teams") || p.contains("slack") || p.contains("discord") || t.contains("meet.google.com") || t.contains("zoom meeting") {
        return ActiveAppContext {
            process_name: "Meeting".to_string(),
            window_title: window_title.to_string(),
            category: "meeting".to_string(),
            badge_label: "Meeting Active".to_string(),
            quick_action: Some("Enable Screen Shield".to_string()),
        };
    }

    // 4. Design & Creative
    if p.contains("figma") || p.contains("photoshop") || p.contains("illustrator") || p.contains("canva") || p.contains("blender") {
        return ActiveAppContext {
            process_name: "Design".to_string(),
            window_title: window_title.to_string(),
            category: "design".to_string(),
            badge_label: "Creative Mode".to_string(),
            quick_action: Some("Inspect Color Palette".to_string()),
        };
    }

    // 5. Browser / Research
    if p.contains("chrome") || p.contains("msedge") || p.contains("firefox") || p.contains("brave") {
        return ActiveAppContext {
            process_name: "Browser".to_string(),
            window_title: window_title.to_string(),
            category: "browser".to_string(),
            badge_label: "Web Research".to_string(),
            quick_action: Some("Quick Notes".to_string()),
        };
    }

    default_context()
}

