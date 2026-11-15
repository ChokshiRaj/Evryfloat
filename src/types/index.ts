export interface AppEntry {
  name: string;
  path: string;
  icon_hint?: string;
}

export interface FileSearchResult {
  name: string;
  path: string;
  is_dir: boolean;
  extension?: string;
}

export interface SystemStats {
  cpu_usage: number;
  memory_used_mb: number;
  memory_total_mb: number;
  memory_usage_percent: number;
  battery_percent: number | null;
  is_charging: boolean | null;
  on_ac: boolean | null; // plugged in, whether or not it is charging
}

export interface Note {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: number;
  title: string;
  due_date: string;
  is_completed: boolean;
  created_at: string;
}

export type ClipboardContentType = 'text' | 'color' | 'url' | 'email' | 'code' | 'image' | 'files';

export interface ClipboardItem {
  id: number;
  content: string;
  content_type: ClipboardContentType;
  color_hex: string | null;
  is_pinned: boolean;
  created_at: number; // Unix timestamp in ms
}

export interface ClipboardImageDetails {
  data_url: string;
  width: number;
  height: number;
  size_bytes: number;
}

export type PomodoroPhase = "work" | "short_break" | "long_break";

export interface PomodoroConfig {
  work_duration: number; // seconds
  short_break: number; // seconds
  long_break: number; // seconds
  long_break_interval: number;
  auto_start_next: boolean;
}

export interface PomodoroState {
  phase: PomodoroPhase;
  remaining_secs: number;
  total_secs: number;
  is_running: boolean;
  sessions_today: number;
  cycle_position: number;
  task: string | null;
  config: PomodoroConfig;
}

export interface PomodoroComplete {
  finished: PomodoroPhase;
  state: PomodoroState;
}

export interface PomodoroStats {
  sessions_today: number;
  interrupted_today: number;
  focus_minutes_today: number;
  streak_days: number;
  by_task: { task: string; sessions: number; minutes: number }[];
}
export interface MediaInfo {
  title: string | null;
  artist: string | null;
  is_playing: boolean;
  can_play_pause: boolean;
}

export interface ActiveAppContext {
  process_name: string;
  window_title: string;
  category: 'code' | 'meeting' | 'design' | 'browser' | 'terminal' | 'general';
  badge_label: string;
  quick_action: string | null;
}

export type ItemKind =
  | 'file'
  | 'folder'
  | 'image'
  | 'text'
  | 'url'
  | 'archive'
  | 'video'
  | 'audio'
  | 'document'
  | 'code';

export interface DropItem {
  id: string;
  name: string;
  path: string | null;
  text_content: string | null;
  item_kind: ItemKind;
  size_bytes: number | null;
  child_count: number | null;
  partial: boolean;
  is_symlink: boolean;
  is_risky: boolean;
  from_internet: boolean;
  missing: boolean;
  created_at: number;
  modified_at: number | null;
  item_type?: 'file' | 'folder' | 'image' | 'text' | 'url';
  size_formatted?: string | null;
}

export interface Snippet {
  id: number;
  prefix: string;
  title: string;
  content: string;
  created_at: number;
}

export interface LanShareInfo {
  ip: string;
  port: number;
  token: string;
  url: string;
  filename: string;
  size_bytes: number;
}

export type ActiveModule =
  | "dashboard"
  | "commands"
  | "actions"
  | "notes"
  | "privacy"
  | "widgets"
  | "clipboard"
  | "pomodoro"
  | "media"
  | "shelf"
  | "settings";

declare global {
  interface Window {
    __isDraggingActive?: boolean;
  }
}
