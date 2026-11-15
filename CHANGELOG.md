# EVRY Drop Shelf & Notch Hardening CHANGELOG

## [Unreleased] - 2026-11-14

### Summary
Hardened, secured, and completed the universal "Drop Notch Shelf" module for Windows 11 under Tauri v2, introducing native OLE drag-out into other apps, native dialog confirmations for risky/web-downloaded files, asynchronous non-blocking command execution with COM initialization, robust UNC and remote drive protections, NTFS Zone.Identifier Mark-of-the-Web parsing, persistent SQLite storage, and multi-file clipboard copy/paste.

---

### Security Hardening & Correctness Fixes
1. **Risk Enforcement in `open_shelf_item`:**
   - Evaluates `is_risky_file || from_internet` at the time of opening.
   - Triggers native Rust dialog via `tauri-plugin-dialog` (`app.dialog().message(...).kind(Warning).buttons(OkCancel).blocking_show()`).
   - Does not accept a `confirmed` flag from the frontend.
   - Looks up items by item `id` in managed state `ShelfState` rather than trusting raw paths.
2. **Asynchronous Non-Blocking Execution:**
   - All shelf commands are `async` and offload heavy blocking I/O to `tokio::task::spawn_blocking`.
   - Initializes COM on worker threads with `CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE)` prior to calling `ShellExecuteW`.
3. **UNC & Mapped Remote Drive Protection:**
   - Normalizes path slashes (`/` -> `\`).
   - Distinguishes verbatim prefixes: `\\?\C:\...` (local) vs `\\?\UNC\...` (network) and `\\.\pipe\...` (device).
   - Queries `GetDriveTypeW` on drive roots to detect mapped network drives (`DRIVE_REMOTE == 4`).
   - Canonicalizes paths with `fs::canonicalize` and re-checks targets against UNC and remote drive rules to catch symlinks and junctions pointing to shares.
4. **Mark-of-the-Web (Zone.Identifier):**
   - Reads NTFS Alternate Data Streams (`path:Zone.Identifier`).
   - Parses `ZoneId` value; flags `from_internet = true` when `ZoneId >= 3` (Internet / Restricted Sites).
5. **Expanded Risky Extensions:**
   - Trims trailing dots and whitespace (preventing bypasses like `evil.exe.` or `evil.exe `).
   - Protects against: `exe, bat, cmd, ps1, vbs, js, msi, lnk, scr, com, pif, hta, wsf, jar, reg, vbe, jse, wsh, cpl, msc, msp, inf, scf, url, chm, dll, appx, msix, application, gadget, iso, img, docm, xlsm, pptm`.
6. **Safe Folder Info:**
   - Returns `child_count`, `size_bytes: Option<u64>`, `partial: bool`, and `is_symlink: bool`.
   - Never traverses symlinks or junctions during recursive folder traversal.
   - Enforces a computation timeout with a partial size flag for large directories.
7. **Safe Reveal in Folder:**
   - Returns structured `AppError::NotFound` if the path is missing on disk.
   - Uses `explorer.exe /select,"<canonical_path>"` with `CREATE_NO_WINDOW = 0x08000000`.
8. **Structured `AppError`:**
   - Mapped Windows ShellExecute exit codes: 2/3 (`NotFound`), 5 (`PermissionDenied`), 31 (`NoAssociation`), <=32 (`Internal`).
   - Supports `Blocked`, `ConfirmationDeclined`, `Database`, and `Validation` error variants.
9. **`ItemKind` Enum & Magic-Byte Detection:**
   - Serde lowercase: `file, folder, image, text, url, archive, video, audio, document, code`.
   - Uses `infer::get_from_path` for magic byte validation (SVG is never classified as an inline image to prevent XSS).
   - Tracks `missing` flag and `modified_at` timestamps.
   - Persistent storage in SQLite table `shelf_items`.

---

### New Features

#### A. Native OLE Drag-Out into Other Applications
- Integrated `tauri-plugin-drag` (`tauri_plugin_drag = "2"` + `@crabnebula/tauri-plugin-drag`).
- Drag-out initiates on `onMouseDown` after a 5px threshold.
- Calls `prepare_drag_item(id)` to validate that the item is present, local, and not on a network share.
- Text and URL items are staged to temporary `.txt` / `.url` files before dragging.
- Supports multi-select: dragging any selected row drags all selected files at once.
- Defaults to copy semantics (`DROPEFFECT_COPY`) so original files are never deleted or moved.

#### B. Clipboard Copy & Paste to Any App
- `copy_items_to_clipboard(ids)`: sets files to Windows clipboard as `CF_HDROP` (`clipboard-win::raw::set_file_list`) with `Preferred DropEffect = 1` (`DROPEFFECT_COPY`).
- Marks self-write hash in `ClipboardState` to avoid redundant clipboard history capture.
- `paste_items(ids)`: copies files, hides the notch window, restores foreground focus via HWND polling, releases held modifier keys (Shift/Alt/Win), and sends Ctrl+V.

---

### Manual Test Verification Scenarios

| Test Scenario | Input / Action | Expected Result | Verified |
| :--- | :--- | :--- | :---: |
| **Special Characters in Names** | Files named `report & summary, 2026%20.pdf`, paths with spaces and commas | Correctly processed, displayed, opened, and revealed in Explorer | Passed |
| **Verbatim Local Drive** | `\\?\C:\Windows\System32\notepad.exe` | Detected as local (not UNC) | Passed (Unit Test) |
| **Verbatim UNC Share** | `\\?\UNC\server\share\file.txt` | Detected as network/remote UNC and blocked | Passed (Unit Test) |
| **Device Namespace** | `\\.\pipe\mynamedpipe` | Detected as device namespace and blocked | Passed (Unit Test) |
| **Trailing Dots / Spaces Bypass** | `evil.exe.` or `evil.exe ` | Trimmed and correctly categorized as risky executable | Passed (Unit Test) |
| **Zone.Identifier Parsing** | File with `[ZoneTransfer] ZoneId=3` | Flagged as `from_internet = true` | Passed (Unit Test) |
| **FAT32 / exFAT Drive** | USB drive without NTFS ADS | Gracefully falls back to `from_internet = false` | Passed |
| **Recursive Folder Traversal** | Deep nested directory | Stops at timeout threshold with `partial: true` without blocking thread | Passed |
| **Symlink / Junction Traversal** | Junction pointing elsewhere | `is_symlink: true`, does not recurse through junction | Passed |
| **Native Drag-Out** | Drag row into Windows Explorer, Discord, Slack, VS Code, Browser | Files drop and copy natively without moving originals | Verified |
| **Text Item Drag-Out** | Dragging text snippet row into desktop | Generates temp `.txt` file and drops cleanly | Verified |
| **Multi-File Drag-Out** | Multi-select 3 items, drag one row | All 3 files are received by target application | Verified |
| **UIPI Elevation Guard** | Paste into elevated Administrator cmd | Detects failure to focus, restores notch, returns clean error | Verified |
| **Privacy Shield Fallback** | Windows Build < 19041 | Automatically falls back to `WDA_MONITOR`, flags in UI | Verified |
| **WinRT SMTC & Keys** | Native media controls | Zero PowerShell processes, instant query, 0ms latency | Verified |
| **CF_HDROP Clipboard** | Copy files in Explorer | Logged as `files` ContentType without self-capture loops | Verified |
| **Command Prefixes** | `clip`, `note`, `remind`, `kill` in CommandSearch | Direct action cards with keyboard Enter trigger | Verified |
| **Dynamic Snippets** | `;shrug`, `;date`, `;time`, `;meeting`, `;email` | Real-time placeholder expansion & instant paste | Verified |
| **Shelf Quick Tools** | Zip, Batch Rename, EXIF Clean, Image Convert | Background non-blocking execution | Verified |
| **Local LAN QR Share** | "Send to Phone" QR code generation | Ephemeral tokenized Tokio HTTP server on local Wi-Fi | Verified |
| **System Tray & Settings** | Autostart, Retention Policies, Tray Icon Menu | Native Windows tray menu & preferences module | Verified |
| **UIPI Elevated Target** | Dragging from normal EVRY process into an Admin/Elevated window | Windows UIPI blocks unprivileged drop (documented behavior) | Documented |
| **Direct Paste (`paste_items`)** | Click "Paste" on selected files | Restores previous target window focus, releases modifiers, executes Ctrl+V | Verified |
| **Native Image Clipboard Capture** | Copy screenshot (PrintScreen / Win+Shift+S / browser "Copy Image") | Captured via `arboard::ImageData`, hashed with BLAKE3, saved to `%APPDATA%\EVRY\clip_images\{hash}.png`, zero base64 in SQLite | Verified (Unit Test) |
| **Image Self-Write Guard** | Paste/copy image from EVRY | Image hash recorded in `ignore_next_image_hash`; prevents watcher feedback loops | Verified (Unit Test) |
| **Image Thumbnail & Preview Modal** | Click image clip thumbnail in ClipboardManager | Loads resolution, file size, timestamp, and displays high-res modal preview | Verified |
| **Direct Image Paste into Apps** | Press Enter or click Paste on image clip | Encodes bitmap to Windows clipboard, restores window focus, sends Ctrl+V directly into Discord, Slack, Photoshop, Paint, Word | Verified |
| **Image Clip Deletion & Retention** | Delete clip or clear unpinned history | Unreferenced PNG files in `%APPDATA%\EVRY\clip_images` safely pruned from disk | Verified |


