use chrono::{Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use tokio::time::{interval, MissedTickBehavior};

const TICK_MS: u64 = 250;
const MAX_LOG: usize = 1000;
const MAX_TASK_CHARS: usize = 80;
const MAX_TOTAL_SECS: u64 = 4 * 3600;

// ───────────────────────── Types ─────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PomodoroConfig {
    pub work_duration: u64,       // seconds
    pub short_break: u64,         // seconds
    pub long_break: u64,          // seconds
    pub long_break_interval: u32, // focus sessions before a long break
    #[serde(default)]
    pub auto_start_next: bool,
}

impl Default for PomodoroConfig {
    fn default() -> Self {
        Self {
            work_duration: 25 * 60,
            short_break: 5 * 60,
            long_break: 15 * 60,
            long_break_interval: 4,
            auto_start_next: false,
        }
    }
}

impl PomodoroConfig {
    fn validate(&self) -> Result<(), String> {
        let in_range = |v: u64, min_m: u64, max_m: u64| (min_m * 60..=max_m * 60).contains(&v);
        if !in_range(self.work_duration, 1, 180) {
            return Err("Focus length must be 1-180 minutes".into());
        }
        if !in_range(self.short_break, 1, 60) {
            return Err("Short break must be 1-60 minutes".into());
        }
        if !in_range(self.long_break, 1, 120) {
            return Err("Long break must be 1-120 minutes".into());
        }
        if !(1..=12).contains(&self.long_break_interval) {
            return Err("Long break interval must be 1-12 sessions".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PomodoroPhase {
    Work,
    ShortBreak,
    LongBreak,
}

/// What the frontend receives. Field names match src/types/index.ts.
#[derive(Debug, Clone, Serialize)]
pub struct PomodoroState {
    pub phase: PomodoroPhase,
    pub remaining_secs: u64,
    pub total_secs: u64,
    pub is_running: bool,
    pub sessions_today: u32,
    pub cycle_position: u32,
    pub task: Option<String>,
    pub config: PomodoroConfig,
}

#[derive(Debug, Clone, Serialize)]
pub struct PomodoroComplete {
    pub finished: PomodoroPhase,
    pub state: PomodoroState,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskStat {
    pub task: String,
    pub sessions: u32,
    pub minutes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PomodoroStats {
    pub sessions_today: u32,
    pub interrupted_today: u32,
    pub focus_minutes_today: u64,
    pub streak_days: u32,
    pub by_task: Vec<TaskStat>,
}

#[derive(Debug, Clone)]
struct SessionRecord {
    #[allow(dead_code)]
    started_ms: u64,
    ended_ms: u64,
    planned_secs: u64,
    task: Option<String>,
    completed: bool,
}

// ───────────────────────── Engine ─────────────────────────

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn local_date(ms: u64) -> Option<NaiveDate> {
    Local.timestamp_millis_opt(ms as i64).single().map(|d| d.date_naive())
}

/// Pure state machine. All time handling is wall-clock deadline based, so it
/// does not drift and it catches up after the PC wakes from sleep.
pub struct Engine {
    config: PomodoroConfig,
    phase: PomodoroPhase,
    total_secs: u64,
    remaining_ms: u64,        // valid while paused
    deadline_ms: Option<u64>, // Some(..) while running
    phase_started_ms: Option<u64>,
    run_id: u64, // bumped on every change that must invalidate a ticker
    work_done: u32,
    task: Option<String>,
    log: Vec<SessionRecord>,
}

impl Engine {
    fn new(config: PomodoroConfig) -> Self {
        let total = config.work_duration;
        Self {
            config,
            phase: PomodoroPhase::Work,
            total_secs: total,
            remaining_ms: total * 1000,
            deadline_ms: None,
            phase_started_ms: None,
            run_id: 0,
            work_done: 0,
            task: None,
            log: Vec::new(),
        }
    }

    fn duration_of(&self, phase: PomodoroPhase) -> u64 {
        match phase {
            PomodoroPhase::Work => self.config.work_duration,
            PomodoroPhase::ShortBreak => self.config.short_break,
            PomodoroPhase::LongBreak => self.config.long_break,
        }
    }

    fn running(&self) -> bool {
        self.deadline_ms.is_some()
    }

    fn remaining_ms_now(&self) -> u64 {
        let max = self.total_secs * 1000;
        match self.deadline_ms {
            Some(d) => d.saturating_sub(now_ms()).min(max), // min() guards clock jumps
            None => self.remaining_ms.min(max),
        }
    }

    fn start(&mut self) -> u64 {
        if self.running() {
            return self.run_id;
        }
        let now = now_ms();
        self.run_id += 1;
        self.deadline_ms = Some(now + self.remaining_ms);
        self.phase_started_ms.get_or_insert(now);
        self.run_id
    }

    fn pause(&mut self) {
        if self.running() {
            let left = self.remaining_ms_now();
            self.remaining_ms = left;
            self.deadline_ms = None;
            self.run_id += 1;
        }
    }

    fn reset(&mut self) {
        self.phase = PomodoroPhase::Work;
        self.total_secs = self.config.work_duration;
        self.remaining_ms = self.total_secs * 1000;
        self.deadline_ms = None;
        self.phase_started_ms = None;
        self.work_done = 0;
        self.run_id += 1;
    }

    /// Ends the current phase and moves to the next one.
    /// `completed == false` means skipped: the focus session is logged as
    /// interrupted (only if it had started) and does not count.
    fn finish_phase(&mut self, completed: bool, start_next: bool) -> PomodoroPhase {
        let now = now_ms();
        let finished = self.phase;

        if finished == PomodoroPhase::Work && (completed || self.phase_started_ms.is_some()) {
            self.log.push(SessionRecord {
                started_ms: self.phase_started_ms.unwrap_or(now),
                ended_ms: now,
                planned_secs: self.total_secs,
                task: self.task.clone(),
                completed,
            });
            if self.log.len() > MAX_LOG {
                let excess = self.log.len() - MAX_LOG;
                self.log.drain(..excess);
            }
            if completed {
                self.work_done += 1;
            }
        }

        let interval = self.config.long_break_interval.max(1);
        let next = match finished {
            PomodoroPhase::Work if completed && self.work_done % interval == 0 => {
                PomodoroPhase::LongBreak
            }
            PomodoroPhase::Work => PomodoroPhase::ShortBreak,
            _ => PomodoroPhase::Work,
        };

        self.phase = next;
        self.total_secs = self.duration_of(next);
        self.remaining_ms = self.total_secs * 1000;
        self.deadline_ms = if start_next { Some(now + self.remaining_ms) } else { None };
        self.phase_started_ms = if start_next { Some(now) } else { None };
        self.run_id += 1;
        finished
    }

    fn extend(&mut self, secs: u64) {
        let secs = secs.clamp(60, 1800);
        if self.total_secs + secs > MAX_TOTAL_SECS {
            return;
        }
        self.total_secs += secs;
        let ms = secs * 1000;
        match self.deadline_ms.as_mut() {
            Some(d) => *d += ms,
            None => self.remaining_ms += ms,
        }
    }

    fn set_task(&mut self, task: Option<String>) {
        self.task = task
            .map(|t| t.trim().chars().take(MAX_TASK_CHARS).collect::<String>())
            .filter(|t| !t.is_empty());
    }

    fn apply_config(&mut self, config: PomodoroConfig) {
        // Only rewrite the current timer if it has not been touched yet.
        let untouched = !self.running()
            && self.phase_started_ms.is_none()
            && self.remaining_ms == self.total_secs * 1000;
        self.config = config;
        if untouched {
            self.total_secs = self.duration_of(self.phase);
            self.remaining_ms = self.total_secs * 1000;
        }
    }

    fn cycle_position(&self) -> u32 {
        let n = self.config.long_break_interval.max(1);
        if self.phase == PomodoroPhase::LongBreak { n } else { self.work_done % n }
    }

    fn sessions_today(&self) -> u32 {
        let today = Local::now().date_naive();
        self.log
            .iter()
            .rev()
            .map_while(|r| local_date(r.ended_ms).filter(|d| *d == today).map(|_| r))
            .filter(|r| r.completed)
            .count() as u32
    }

    fn snapshot(&self) -> PomodoroState {
        PomodoroState {
            phase: self.phase,
            remaining_secs: (self.remaining_ms_now() + 999) / 1000, // ceil: 25:00 until the first second passes
            total_secs: self.total_secs,
            is_running: self.running(),
            sessions_today: self.sessions_today(),
            cycle_position: self.cycle_position(),
            task: self.task.clone(),
            config: self.config.clone(),
        }
    }

    fn stats(&self) -> PomodoroStats {
        let today = Local::now().date_naive();
        let (mut done, mut interrupted, mut minutes) = (0u32, 0u32, 0u64);
        let mut days: HashSet<NaiveDate> = HashSet::new();
        let mut per_task: HashMap<String, (u32, u64)> = HashMap::new();

        for r in &self.log {
            let Some(day) = local_date(r.ended_ms) else { continue };
            if r.completed {
                days.insert(day);
            }
            if day != today {
                continue;
            }
            if r.completed {
                let mins = r.planned_secs / 60;
                done += 1;
                minutes += mins;
                let key = r.task.clone().unwrap_or_else(|| "No task".to_string());
                let entry = per_task.entry(key).or_insert((0, 0));
                entry.0 += 1;
                entry.1 += mins;
            } else {
                interrupted += 1;
            }
        }

        // Streak: consecutive days with a finished session. Today doesn't break it until it ends.
        let mut cursor = today;
        if !days.contains(&cursor) {
            cursor = cursor.pred_opt().unwrap_or(cursor);
        }
        let mut streak = 0;
        while days.contains(&cursor) {
            streak += 1;
            match cursor.pred_opt() {
                Some(p) => cursor = p,
                None => break,
            }
        }

        let mut by_task: Vec<TaskStat> = per_task
            .into_iter()
            .map(|(task, (sessions, minutes))| TaskStat { task, sessions, minutes })
            .collect();
        by_task.sort_by(|a, b| b.minutes.cmp(&a.minutes).then(a.task.cmp(&b.task)));

        PomodoroStats {
            sessions_today: done,
            interrupted_today: interrupted,
            focus_minutes_today: minutes,
            streak_days: streak,
            by_task,
        }
    }
}

// ───────────────────────── Managed state ─────────────────────────

pub struct PomodoroManagerState(pub Arc<Mutex<Engine>>);

impl Default for PomodoroManagerState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Engine::new(PomodoroConfig::default()))))
    }
}

/// A poisoned lock must never freeze the timer; take the data anyway.
fn lock(m: &Mutex<Engine>) -> MutexGuard<'_, Engine> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn emit_tick(app: &AppHandle, snap: &PomodoroState) {
    let _ = app.emit("pomodoro-tick", snap);
}

fn spawn_ticker(app: AppHandle, shared: Arc<Mutex<Engine>>, mut run_id: u64) {
    tauri::async_runtime::spawn(async move {
        let mut timer = interval(Duration::from_millis(TICK_MS));
        timer.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut last_secs = u64::MAX;

        loop {
            timer.tick().await;

            let mut finished = None;
            let snap = {
                let mut e = lock(&shared);
                // A newer start/pause/skip/reset invalidated this ticker.
                if e.run_id != run_id || !e.running() {
                    break;
                }
                if e.remaining_ms_now() == 0 {
                    let auto = e.config.auto_start_next;
                    finished = Some(e.finish_phase(true, auto));
                    if e.running() {
                        run_id = e.run_id; // auto-start: keep this loop going
                    }
                }
                e.snapshot()
            };

            if finished.is_some() || snap.remaining_secs != last_secs {
                last_secs = snap.remaining_secs;
                emit_tick(&app, &snap);
            }
            if let Some(phase) = finished {
                let _ = app.emit(
                    "pomodoro-complete",
                    &PomodoroComplete { finished: phase, state: snap.clone() },
                );
                if !snap.is_running {
                    break;
                }
            }
        }
    });
}

// ───────────────────────── Commands ─────────────────────────

#[tauri::command]
pub fn get_pomodoro_state(state: State<'_, PomodoroManagerState>) -> PomodoroState {
    lock(&state.0).snapshot()
}

#[tauri::command]
pub fn get_pomodoro_stats(state: State<'_, PomodoroManagerState>) -> PomodoroStats {
    lock(&state.0).stats()
}

#[tauri::command]
pub fn start_pomodoro(state: State<'_, PomodoroManagerState>, app: AppHandle) -> PomodoroState {
    let (snap, spawn_id) = {
        let mut e = lock(&state.0);
        let was_running = e.running();
        let id = e.start();
        (e.snapshot(), if was_running { None } else { Some(id) })
    };
    if let Some(id) = spawn_id {
        spawn_ticker(app.clone(), state.0.clone(), id);
    }
    emit_tick(&app, &snap);
    snap
}

#[tauri::command]
pub fn pause_pomodoro(state: State<'_, PomodoroManagerState>, app: AppHandle) -> PomodoroState {
    let snap = {
        let mut e = lock(&state.0);
        e.pause();
        e.snapshot()
    };
    emit_tick(&app, &snap);
    snap
}

#[tauri::command]
pub fn reset_pomodoro(state: State<'_, PomodoroManagerState>, app: AppHandle) -> PomodoroState {
    let snap = {
        let mut e = lock(&state.0);
        e.reset();
        e.snapshot()
    };
    emit_tick(&app, &snap);
    snap
}

#[tauri::command]
pub fn skip_pomodoro(state: State<'_, PomodoroManagerState>, app: AppHandle) -> PomodoroState {
    let (snap, spawn_id) = {
        let mut e = lock(&state.0);
        let was_running = e.running();
        e.finish_phase(false, was_running);
        let id = if e.running() { Some(e.run_id) } else { None };
        (e.snapshot(), id)
    };
    if let Some(id) = spawn_id {
        spawn_ticker(app.clone(), state.0.clone(), id);
    }
    emit_tick(&app, &snap);
    snap
}

#[tauri::command]
pub fn extend_pomodoro(
    state: State<'_, PomodoroManagerState>,
    app: AppHandle,
    secs: u64,
) -> PomodoroState {
    let snap = {
        let mut e = lock(&state.0);
        e.extend(secs);
        e.snapshot()
    };
    emit_tick(&app, &snap);
    snap
}

#[tauri::command]
pub fn set_pomodoro_task(
    state: State<'_, PomodoroManagerState>,
    app: AppHandle,
    task: Option<String>,
) -> PomodoroState {
    let snap = {
        let mut e = lock(&state.0);
        e.set_task(task);
        e.snapshot()
    };
    emit_tick(&app, &snap);
    snap
}

#[tauri::command]
pub fn set_pomodoro_config(
    state: State<'_, PomodoroManagerState>,
    app: AppHandle,
    config: PomodoroConfig,
) -> Result<PomodoroState, String> {
    config.validate()?;
    let snap = {
        let mut e = lock(&state.0);
        e.apply_config(config);
        e.snapshot()
    };
    emit_tick(&app, &snap);
    Ok(snap)
}

// ───────────────────────── Tests ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_break_after_interval() {
        let mut e = Engine::new(PomodoroConfig::default());
        for i in 1..=4 {
            e.finish_phase(true, false);
            let expected = if i == 4 { PomodoroPhase::LongBreak } else { PomodoroPhase::ShortBreak };
            assert_eq!(e.phase, expected);
            e.finish_phase(true, false);
            assert_eq!(e.phase, PomodoroPhase::Work);
        }
    }

    #[test]
    fn skipping_unstarted_work_is_not_logged_or_counted() {
        let mut e = Engine::new(PomodoroConfig::default());
        e.finish_phase(false, false);
        assert!(e.log.is_empty());
        assert_eq!(e.work_done, 0);
        assert_eq!(e.phase, PomodoroPhase::ShortBreak);
    }

    #[test]
    fn rejects_invalid_config() {
        let mut c = PomodoroConfig::default();
        c.long_break_interval = 0;
        assert!(c.validate().is_err());
        let mut c = PomodoroConfig::default();
        c.work_duration = 0;
        assert!(c.validate().is_err());
        assert!(PomodoroConfig::default().validate().is_ok());
    }

    #[test]
    fn extend_is_clamped_and_capped() {
        let mut e = Engine::new(PomodoroConfig::default());
        e.extend(10); // clamps up to 60s
        assert_eq!(e.total_secs, 25 * 60 + 60);
        e.extend(999_999); // clamps to 30 min
        assert_eq!(e.total_secs, 25 * 60 + 60 + 1800);
    }

    #[test]
    fn config_applies_to_untouched_timer_only() {
        let mut e = Engine::new(PomodoroConfig::default());
        let mut c = PomodoroConfig::default();
        c.work_duration = 30 * 60;
        e.apply_config(c.clone());
        assert_eq!(e.snapshot().remaining_secs, 30 * 60);

        e.start();
        c.work_duration = 40 * 60;
        e.apply_config(c);
        assert_eq!(e.total_secs, 30 * 60); // running timer keeps its length
    }

    #[test]
    fn pause_invalidates_ticker() {
        let mut e = Engine::new(PomodoroConfig::default());
        let first = e.start();
        e.pause();
        let second = e.start();
        assert_ne!(first, second);
    }
}