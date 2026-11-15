use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaInfo {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub is_playing: bool,
    pub can_play_pause: bool,
}

#[cfg(target_os = "windows")]
pub fn send_native_media_key(vk: u16) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    };

    unsafe {
        let mut inputs: [INPUT; 2] = [std::mem::zeroed(); 2];
        inputs[0].r#type = INPUT_KEYBOARD;
        inputs[0].Anonymous.ki = KEYBDINPUT {
            wVk: vk,
            wScan: 0,
            dwFlags: 0,
            time: 0,
            dwExtraInfo: 0,
        };
        inputs[1].r#type = INPUT_KEYBOARD;
        inputs[1].Anonymous.ki = KEYBDINPUT {
            wVk: vk,
            wScan: 0,
            dwFlags: KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
        };
        SendInput(2, inputs.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn send_native_media_key(_vk: u16) {}

#[cfg(target_os = "windows")]
fn get_media_info_winrt() -> windows::core::Result<MediaInfo> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };

    let async_mgr = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?;
    let mgr = async_mgr.get()?;

    let session = match mgr.GetCurrentSession() {
        Ok(s) => s,
        Err(_) => {
            let sessions = mgr.GetSessions()?;
            if sessions.Size()? > 0 {
                sessions.GetAt(0)?
            } else {
                return Ok(MediaInfo {
                    title: None,
                    artist: None,
                    is_playing: false,
                    can_play_pause: true,
                });
            }
        }
    };

    let is_playing = if let Ok(pb) = session.GetPlaybackInfo() {
        pb.PlaybackStatus()? == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
    } else {
        false
    };

    let (title, artist) = if let Ok(prop_op) = session.TryGetMediaPropertiesAsync() {
        if let Ok(props) = prop_op.get() {
            let t = props.Title().map(|h| h.to_string()).unwrap_or_default();
            let a = props.Artist().map(|h| h.to_string()).unwrap_or_default();
            (
                if t.trim().is_empty() { None } else { Some(t) },
                if a.trim().is_empty() { None } else { Some(a) },
            )
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    Ok(MediaInfo {
        title,
        artist,
        is_playing,
        can_play_pause: true,
    })
}

#[tauri::command]
pub async fn get_media_info() -> MediaInfo {
    tokio::task::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            get_media_info_winrt().unwrap_or(MediaInfo {
                title: None,
                artist: None,
                is_playing: false,
                can_play_pause: true,
            })
        }
        #[cfg(not(target_os = "windows"))]
        {
            MediaInfo {
                title: None,
                artist: None,
                is_playing: false,
                can_play_pause: true,
            }
        }
    })
    .await
    .unwrap_or(MediaInfo {
        title: None,
        artist: None,
        is_playing: false,
        can_play_pause: true,
    })
}

#[tauri::command]
pub fn media_play_pause() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_MEDIA_PLAY_PAUSE;
        send_native_media_key(VK_MEDIA_PLAY_PAUSE);
    }
    Ok(())
}

#[tauri::command]
pub fn media_next() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_MEDIA_NEXT_TRACK;
        send_native_media_key(VK_MEDIA_NEXT_TRACK);
    }
    Ok(())
}

#[tauri::command]
pub fn media_prev() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_MEDIA_PREV_TRACK;
        send_native_media_key(VK_MEDIA_PREV_TRACK);
    }
    Ok(())
}
