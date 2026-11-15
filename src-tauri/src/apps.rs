use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppEntry {
    pub name: String,
    pub path: String,
    pub icon_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSearchResult {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub extension: Option<String>,
}

#[tauri::command]
pub fn get_installed_apps() -> Vec<AppEntry> {
    let mut apps: Vec<AppEntry> = Vec::new();
    let mut seen_names: HashSet<String> = HashSet::new();

    let mut search_dirs: Vec<PathBuf> = Vec::new();

    // 1. Common Start Menu (All Users)
    if let Ok(program_data) = std::env::var("ProgramData") {
        search_dirs.push(
            Path::new(&program_data)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }

    // 2. User Start Menu
    if let Ok(app_data) = std::env::var("APPDATA") {
        search_dirs.push(
            Path::new(&app_data)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }

    for dir in search_dirs {
        if !dir.exists() {
            continue;
        }

        for entry in WalkDir::new(dir)
            .follow_links(false)
            .max_depth(4)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if ext.eq_ignore_ascii_case("lnk") {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        let lower_stem = stem.to_lowercase();
                        if lower_stem.contains("uninstall")
                            || lower_stem.contains("help")
                            || lower_stem.contains("documentation")
                            || lower_stem.contains("readme")
                        {
                            continue;
                        }

                        if !seen_names.contains(&lower_stem) {
                            seen_names.insert(lower_stem);
                            apps.push(AppEntry {
                                name: stem.to_string(),
                                path: path.to_string_lossy().to_string(),
                                icon_hint: Some("app".to_string()),
                            });
                        }
                    }
                }
            }
        }
    }

    // Standard Windows utilities
    let standard_tools = vec![
        ("Command Prompt", "cmd.exe"),
        ("PowerShell", "powershell.exe"),
        ("File Explorer", "explorer.exe"),
        ("Notepad", "notepad.exe"),
        ("Calculator", "calc.exe"),
        ("Task Manager", "taskmgr.exe"),
        ("Settings", "ms-settings:"),
    ];

    for (name, target) in standard_tools {
        let lower = name.to_lowercase();
        if !seen_names.contains(&lower) {
            seen_names.insert(lower);
            apps.push(AppEntry {
                name: name.to_string(),
                path: target.to_string(),
                icon_hint: Some("system".to_string()),
            });
        }
    }

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

#[tauri::command]
pub fn launch_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let status = Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Failed to launch target '{}': {}", path, e))?;

        drop(status);
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Unsupported operating system for app launch".to_string())
    }
}

#[tauri::command]
pub fn search_user_files(query: String) -> Vec<FileSearchResult> {
    let mut results: Vec<FileSearchResult> = Vec::new();
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return results;
    }

    let mut user_dirs: Vec<PathBuf> = Vec::new();
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        let p = Path::new(&userprofile);
        user_dirs.push(p.join("Desktop"));
        user_dirs.push(p.join("Documents"));
        user_dirs.push(p.join("Downloads"));
    }

    for dir in user_dirs {
        if !dir.exists() {
            continue;
        }

        for entry in WalkDir::new(dir)
            .follow_links(false)
            .max_depth(3)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name.to_lowercase().contains(&q) {
                let is_dir = entry.file_type().is_dir();
                let extension = entry
                    .path()
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|s| s.to_string());

                results.push(FileSearchResult {
                    name: file_name,
                    path: entry.path().to_string_lossy().to_string(),
                    is_dir,
                    extension,
                });

                if results.len() >= 25 {
                    return results;
                }
            }
        }
    }

    results
}
