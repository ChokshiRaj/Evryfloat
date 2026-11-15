# EVRY — Modern Desktop Command Center for Windows

<div align="center">

![EVRY Status](https://img.shields.io/badge/Status-Power%20Suite%20Ready-F47735?style=for-the-badge)
![Tauri 2](https://img.shields.io/badge/Tauri-v2.0-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Backend-Rust-black?style=for-the-badge&logo=rust)
![React 19](https://img.shields.io/badge/Frontend-React%2019%20%2B%20TS-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D6?style=for-the-badge&logo=windows)

**A lightweight, intelligent desktop companion designed to make everyday Windows computing faster, cleaner, and privacy-first.**

</div>

---

## 📖 Overview

**EVRY** is an intelligent, floating desktop command center designed as a sleek, top-docked hardware notch and dynamic island on Windows 11. Built with **Tauri 2**, **Rust**, and **React 19**, EVRY prioritizes **speed**, **zero resource bloat**, **local-first privacy**, and **deep native Windows integration**.

All core functions—including clipboard history, drop shelf, SQLite markdown notes, task reminders, hardware telemetry, offline dictionary, and unit calculations—operate 100% locally on your machine with zero cloud dependencies or telemetry. Dynamic features (such as live currency exchange rates and smart web prefixes) are opt-in and utilize cached offline fallbacks when offline.

Unlike traditional Electron applications, EVRY does not bundle Chromium. It relies on the lightweight Windows WebView2 runtime, resulting in minimal RAM usage, instant startup, and snappy performance.

---

## ✨ Features

### 1. 🎛️ Top-Docked Hardware Notch & Dynamic Island
* **Seamless Bezel Docking:** Frameless, transparent, always-on-top pill docked flush against the top monitor bezel (`rounded-t-none border-t-0 rounded-b-2xl`).
* **Dynamic Island Live Activities in the Collapsed Pill:**
  * **Now Playing Media:** Shows 3-bar animated sound wave visualizer, scrolling/compact track title and artist, and an inline play/pause toggle directly inside the pill.
  * **Pomodoro Countdown:** Displays a live SVG countdown ring with remaining time (`24:18 Focus`) and phase-colored glow (amber focus, emerald break).
  * **Drop Shelf Glow:** Lights up with an amber pulsating border and bounce indicator when dragging files over the notch.
  * **Copied Color Swatch Pulse:** Copying a hex or RGB color code pulses the collapsed pill with a live swatch and color preview for 3.5 seconds.
  * **Low Battery Warning:** Soft amber pulsating warning pill whenever the laptop battery drops to $\le 20\%$ without AC power.
  * **Auto Meeting Mode Chip:** When Zoom, Microsoft Teams, or Google Meet is active, the pill surfaces an instant Meeting Mode chip to engage Privacy Shield & Teleprompter with 1 click.
* **Context-Aware Dynamic App Detection:** Automatically identifies active foreground applications (VS Code, Chrome, Zoom, Figma, Windows Terminal) and surfaces dynamic context badges and quick actions.
* **DPI-Aware Native Sizing:** Windows logical pixel sizing guarantees zero clipping on 100%, 125%, 150%, and 200% display scaling.

### 2. 📥 Universal "Drop Notch" Shelf & Quick Tools
* **Native OS Drag-and-Drop In & Out:** Drag files in from Windows Explorer, or drag rows out directly to Discord, Slack, VS Code, or web browsers using native Windows OLE via `tauri-plugin-drag`.
* **Shelf Productivity Action Bar:**
  * **Batch Zip Archive:** Select files in the shelf and click "Zip" to generate an archive in the background.
  * **Batch Rename:** Inline rename utility supporting `kebab-case`, `lowercase`, timestamp prefixes (`YYYYMMDD_`), and search-and-replace (`old -> new`).
  * **Image Convert & EXIF Stripper:** Quick-convert between PNG, JPG, and WebP, re-encoding pure pixel data to strip GPS and camera metadata tags.
  * **Send to Phone (Local LAN QR Share):** Spin up an ephemeral, tokenized Tokio HTTP server on local Wi-Fi with an instant SVG QR code for mobile file downloads.
* **Multi-Select & Batch Drag:** Select multiple items with checkboxes; dragging one row moves all selected items.
* **Clipboard File Copy & Direct Paste:** Copy shelf files as `CF_HDROP` or paste directly to the previous window via simulated Ctrl+V.
* **Security & Sandboxing:** Native warning dialogs, UNC and remote drive blocking, and NTFS Zone.Identifier parsing.

### 3. ⚡ Command Center & Intelligence
* **Unified Command Prefixes:**
  * `clip <query>`: Jump directly into clipboard search and press `Enter` to paste into your active app.
  * `note <text>`: Quickly write and store a scratchpad note without opening the notes drawer.
  * `remind <time> <text>`: Natural language reminder scheduling (e.g. `remind 20m Stand up and hydrate`, `remind tomorrow Standup`).
  * `kill <process>`: Search and terminate unresponsive processes (e.g. `kill node`, `kill chrome`) via background Win32 taskkill.
* **Snippets with Dynamic Placeholders:**
  * Type `;shrug`, `;date`, `;time`, `;meeting`, or `;email` to expand templates dynamically replacing `{date}`, `{time}`, and `{clipboard}` tags.
* **Global Shortcut (`Alt + Space`):** Summon EVRY from anywhere on Windows.
* **🧮 Inline Calculator & Unit Converter:** Real-time math evaluation and unit conversions.
* **📖 Offline Dictionary & Quick Define:** `define <word>` offline definitions.
* **🌍 Smart Web Prefixes:** `g <query>`, `yt <query>`, `gh <query>`, `npm <query>`.

### 4. 🎛️ Dedicated Settings & System Tray
* **Background System Tray Icon:** Right-click menu with *Show/Hide EVRY*, *Pause Clipboard Capture*, *Mute Audio*, *Settings*, and *Quit*.
* **Startup on Boot:** One-click launch at Windows startup powered by `tauri-plugin-autostart`.
* **Configurable Retention Policy:** Configure max history limits (50–500 items) and auto-expiration (7–90 days) with on-demand database purging.

### 4. 📋 Smart Clipboard Manager (with Native Image History)
* **Native Image Clipboard Capture:** Captures screenshots (PrintScreen, Win+Shift+S, Snipping Tool) and copied web/app images directly into clipboard history.
* **Disk-Backed Storage (Zero DB Bloat):** Saves optimized PNG files directly to `%APPDATA%\EVRY\clip_images\{hash}.png` with raw BLAKE3 pixel deduplication—zero raw base64 or bloated blobs stored inside SQLite!
* **Responsive Visual Thumbnails & Full Preview:** Displays rich image thumbnails in `ClipboardManager`, dimensions (e.g. `1920×1080`), file sizes, and includes a full-resolution preview modal with Esc to dismiss.
* **Native 1-Click Image Pasting:** Press Enter or click Paste on any image clip to encode real bitmap data back to the Windows clipboard, restore focus to the previous application (Discord, Slack, Photoshop, Paint, Word, or browsers), and execute native Ctrl+V.
* **Category Filter Pills:** Switch instantly between *All*, *Images*, *Text*, *Colors*, and *Links* with live item counters.
* **Background Clipboard Watcher:** Captures copies in real time with self-write suppression (`last_self_written_hash`, `ignore_next_image_hash`) to avoid feedback loops.
* **BLAKE3 Deduplication:** Re-copied text or images bump timestamps instead of creating duplicate database entries or disk files.
* **Hex Color Detection & Swatches:** Automatically identifies hex color codes (e.g. `#F47735`, `#22c55e`), displaying an interactive visual swatch and monospace code preview.
* **Native Focus Restoration & Paste:** Hides EVRY, restores focus to the previously active window (`SetForegroundWindow` with HWND polling), releases held modifiers (Shift/Alt/Win), and simulates Ctrl+V via Win32 `SendInput`.
* **Persistent Pinning & Search:** Pin important text or image clips permanently; search across full history.
* **Automated Image Garbage Collection:** Deleting clips or purging expired items automatically removes unreferenced PNG files from disk to prevent storage leaks.

### 5. ⏱️ Focus & Pomodoro Timer
* **Floating Progress Ring:** Visual SVG countdown ring showing elapsed and remaining session time.
* **Live Dynamic Island Ring:** Miniature progress ring and live countdown embedded directly into the collapsed notch pill.
* **Phased Focus System:** Automatically cycles between **Focus (25m)**, **Short Break (5m)**, and **Long Break (15m)**.
* **Daily Session Counter:** Tracks total completed focus sessions for the day.

### 6. 🎧 Media & Audio Session Controller
* **Windows Media Session Integration:** Queries System Media Transport Controls (SMTC) to retrieve live track metadata (Song Title, Artist, Playing Status) from Spotify, YouTube, VLC, and browsers.
* **Pill-Level Controls:** Mini visualizer and quick Play/Pause button embedded directly in the collapsed notch.
* **Hardware Media Keys:** Native Play/Pause, Next Track, and Previous Track controls.
* **Master Volume Slider:** Quick volume adjustments with mute toggle.

### 7. 🛠️ Quick Actions & System Telemetry
* **Hardware Telemetry:** Real-time CPU load and RAM utilization powered by `sysinfo`.
* **Battery & Power Monitor:** Live battery percentage and AC charging state detection.
* **Direct Settings Shortcuts:** One-click shortcuts to Wi-Fi, Bluetooth, Display, and Windows Settings via native protocol handlers (`ms-settings:`).

### 8. 📝 Offline Notes & Reminders
* **Embedded SQLite Database:** 100% offline local storage at `%APPDATA%\EVRY\evry.db` using bundled `rusqlite`.
* **Markdown Notes Editor:** Two-pane editor with live note switching, character count, and automatic SQLite persistence.
* **Task Reminders:** Add reminders with custom due times, toggle completion status with strike-through styling, and manage to-do items.

### 9. 🛡️ Privacy Shield & Teleprompter
* **Hardware Screen-Capture Exclusion:** Utilizes Windows DWM API `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`. When active, EVRY is completely blacked out in Teams, Zoom, OBS, and screenshot tools.
* **Meeting Teleprompter:** Floating prompter with font size controls (`A-` / `A` / `A+`), word/character counters, quick copy, and opacity slider for presentations and interviews.

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Desktop Framework** | [Tauri 2](https://v2.tauri.app/) |
| **Native Drag & Drop** | `tauri-plugin-drag` (native Windows OLE drag out) |
| **Native Dialogs** | `tauri-plugin-dialog` |
| **Windows Clipboard** | `clipboard-win` (`CF_HDROP` + `Preferred DropEffect`) |
| **Backend / System** | Rust (`rusqlite`, `sysinfo`, `tokio`, `windows-sys`, `infer`, `blake3`, `uuid`) |
| **Frontend Framework** | React 19 + TypeScript |
| **Styling** | Tailwind CSS v3 + PostCSS |
| **Build Tool** | Vite |
| **Local Database** | SQLite (bundled offline via `rusqlite`) |
| **Platform** | Windows 10 / Windows 11 |

---

## 📁 Project Architecture

```text
EVRY/
├── src-tauri/                     # Native Rust Backend
│   ├── src/
│   │   ├── apps.rs                # Windows app discovery, execution & file search
│   │   ├── clipboard.rs           # Clipboard state machine, HWND focus restore & Ctrl+V
│   │   ├── clipboard_utils.rs     # Color parsing, BLAKE3 dedupe, content type heuristic
│   │   ├── context.rs             # Active foreground window detection & app classification
│   │   ├── db.rs                  # SQLite connection, schema & CRUD (Notes, Reminders, Clipboard, Shelf)
│   │   ├── error.rs               # Structured AppError with ShellExecute code mapping
│   │   ├── media.rs               # Windows Media Session (SMTC) controls & now playing
│   │   ├── pomodoro.rs            # Async Pomodoro state machine & timer events
│   │   ├── shelf.rs               # Hardened Drop Shelf (OLE drag, UNC protection, ZoneId, copy/paste)
│   │   ├── system.rs              # CPU, RAM, battery, volume & Windows settings
│   │   ├── window.rs              # Flush bezel positioning, logical resizing & capture shield
│   │   ├── lib.rs                 # Tauri app builder, plugins, managed states & command router
│   │   └── main.rs                # Windows subsystem entry point
│   ├── capabilities/
│   │   └── default.json           # Tauri v2 security ACL (drag, dialog, window permissions)
│   ├── Cargo.toml                 # Rust dependencies & build settings
│   └── tauri.conf.json            # Window configurations (frameless, transparent, always-on-top)
├── src/                           # React Frontend
│   ├── components/
│   │   ├── actions/               # QuickActions: volume, hardware gauges, Windows settings
│   │   ├── clipboard/             # ClipboardManager: SQLite history, pins, color swatches, paste
│   │   ├── commands/              # CommandSearch: app/file search, calculator, dictionary, web prefixes
│   │   ├── media/                 # MediaControls: now playing display, controls, volume
│   │   ├── notch/                 # Notch: main floating pill, header, dynamic island & drawer
│   │   ├── notes/                 # NotesReminders: SQLite notes editor & task reminders
│   │   ├── pomodoro/              # PomodoroTimer: SVG progress ring, phase switcher, settings
│   │   ├── privacy/               # PrivacyOverlay: capture shield & teleprompter
│   │   ├── shelf/                 # DropShelf: universal holding shelf, OLE drag out, multi-select
│   │   └── widgets/               # FloatingWidgets: live calendar & system telemetry
│   ├── hooks/
│   │   └── useClock.ts            # High-efficiency 1s interval clock & date
│   ├── types/
│   │   └── index.ts               # Shared TypeScript data models
│   ├── index.css                  # Tailwind styles & custom .evry-scroll scrollbars
│   ├── App.tsx                    # Root UI layout
│   └── main.tsx                   # React DOM mount point
├── CHANGELOG.md                   # Detailed hardening log & manual test verification scenarios
├── package.json                   # NPM dependencies & scripts
├── tailwind.config.js             # EVRY design system color definitions
└── vite.config.ts                 # Vite bundler configuration
```

---

## 🚀 Getting Started

### Development

```powershell
# Run EVRY in development mode (starts Vite + runs Rust binary)
npm run tauri dev
```

### Production Build

```powershell
# Compile the production Windows application executable / installer
npm run tauri build
```

---

## ⌨️ Default Keybindings & Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt + Space` | Toggle EVRY Command Center from anywhere on Windows |
| `Escape` | Collapse EVRY notch / Close active search |
| `Tab` | Push current query directly to Google Search |
| `↑` / `↓` | Navigate search results in Command Center or Clipboard history |
| `Enter` | Launch application, open file, copy calculator result, or paste clipboard item |
| `g <query>` | Direct Google Search shortcut in Command Center |
| `yt <query>` | Direct YouTube Search shortcut |
| `gh <query>` | Direct GitHub Repository Search shortcut |
| `npm <query>` | Direct npm package Search shortcut |
| `define <word>` | Instant offline dictionary lookup |

---

## 🔒 Privacy & Offline Guarantee

* **100% Offline-First:** EVRY does not transmit user data, notes, clipboard history, or keystrokes to any cloud servers.
* **Local SQLite Storage:** All preferences, notes, reminders, shelf items, and clipboard history are saved locally in SQLite (`%APPDATA%\EVRY\evry.db`).
* **Hardware Screen Protection:** Optional screen-capture exclusion (`SetWindowDisplayAffinity`) keeps sensitive notes and prompter text private during video conferences and screen recordings.
* **UIPI Notice:** Due to Windows User Interface Privilege Isolation (UIPI), dragging items from a standard user application into an Administrator-elevated window is restricted by the Windows OS.
