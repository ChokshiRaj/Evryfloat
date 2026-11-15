import React, { useEffect, useState } from "react";
import {
  ChevronLeft,
  Timer,
  RotateCcw,
  Settings,
  Play,
  Pause,
  Coffee,
  CheckCircle2,
  SkipForward,
  Plus,
  Flame,
  X,
} from "lucide-react";
import { PomodoroConfig, PomodoroPhase } from "../../types";
import { usePomodoro } from "../../hooks/usePomodoro";
import { cn } from "../../lib/utils";

interface PomodoroTimerProps {
  onBack: () => void;
}

const PHASE_COLORS: Record<PomodoroPhase, string> = {
  work: "#F47735",
  short_break: "#22c55e",
  long_break: "#3b82f6",
};

const PHASE_LABELS: Record<PomodoroPhase, string> = {
  work: "Focus Session",
  short_break: "Short Break",
  long_break: "Long Break",
};

interface Draft {
  work: string;
  short: string;
  long: string;
  interval: string;
  auto: boolean;
}

const toDraft = (c: PomodoroConfig): Draft => ({
  work: String(Math.round(c.work_duration / 60)),
  short: String(Math.round(c.short_break / 60)),
  long: String(Math.round(c.long_break / 60)),
  interval: String(c.long_break_interval),
  auto: c.auto_start_next,
});

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function chime() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.65);
    setTimeout(() => ctx.close(), 900);
  } catch {
    /* audio unavailable, ignore */
  }
}

const inputCls =
  "w-full bg-evry-bg border border-evry-border rounded-lg px-2 py-1 text-xs text-white text-center font-mono focus:outline-none focus:border-evry-accent";

export const PomodoroTimer: React.FC<PomodoroTimerProps> = ({ onBack }) => {
  const { state, stats, lastComplete, dismissComplete, start, pause, reset, skip, extend, setTask, setConfig } =
    usePomodoro();

  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState("");

  // Keep the task box in sync with the backend.
  useEffect(() => {
    setTaskDraft(state?.task ?? "");
  }, [state?.task]);

  // Chime when a phase finishes.
  useEffect(() => {
    if (lastComplete) chime();
  }, [lastComplete]);

  if (!state) {
    return (
      <div className="w-full h-[410px] bg-evry-bg rounded-b-2xl flex items-center justify-center text-xs text-evry-muted">
        Loading timer…
      </div>
    );
  }

  const openSettings = () => {
    setDraft(toDraft(state.config));
    setError(null);
    setShowSettings(true);
  };

  const handleStartPause = () => (state.is_running ? pause() : start()).catch(console.error);

  const handleSaveConfig = async () => {
    if (!draft) return;
    const n = (v: string) => Math.round(Number(v));
    const cfg: PomodoroConfig = {
      work_duration: n(draft.work) * 60,
      short_break: n(draft.short) * 60,
      long_break: n(draft.long) * 60,
      long_break_interval: n(draft.interval),
      auto_start_next: draft.auto,
    };
    const values = [n(draft.work), n(draft.short), n(draft.long), n(draft.interval)];
    if (values.some((v) => !Number.isFinite(v) || v < 1)) {
      setError("Enter whole numbers of 1 or more.");
      return;
    }
    try {
      await setConfig(cfg);
      setShowSettings(false);
    } catch (err) {
      setError(String(err)); // validation message from Rust
    }
  };

  const commitTask = () => {
    const next = taskDraft.trim() || null;
    if (next !== state.task) setTask(next).catch(console.error);
  };

  // Ring
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const progress =
    state.total_secs > 0 ? Math.min(1, Math.max(0, state.remaining_secs / state.total_secs)) : 1;
  const strokeDashoffset = circumference * (1 - progress);
  const color = PHASE_COLORS[state.phase];
  const label = PHASE_LABELS[state.phase];

  const sessionsToday = stats?.sessions_today ?? state.sessions_today;

  return (
    <div className="w-full flex flex-col h-[410px] bg-evry-bg rounded-b-2xl animate-slideDown overflow-hidden p-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-evry-border">
        <div className="flex items-center space-x-2">
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-lg bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border flex items-center justify-center text-evry-muted hover:text-evry-text transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-evry-text tracking-wide">Focus & Pomodoro</span>
        </div>

        <button
          onClick={() => (showSettings ? setShowSettings(false) : openSettings())}
          className={cn(
            "p-1.5 rounded-lg border border-evry-border transition-colors text-evry-muted hover:text-white",
            showSettings ? "bg-evry-accent/15 border-evry-accent/40 text-evry-accent" : "bg-evry-surface"
          )}
          title="Configure Timer"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Completion banner */}
      {lastComplete && (
        <div
          className="mt-2 flex items-center justify-between rounded-xl border px-3 py-1.5 text-[11px] animate-slideDown"
          style={{
            color: PHASE_COLORS[lastComplete.state.phase],
            borderColor: `${PHASE_COLORS[lastComplete.state.phase]}40`,
            backgroundColor: `${PHASE_COLORS[lastComplete.state.phase]}15`,
          }}
        >
          <span>
            {lastComplete.finished === "work" ? "Focus session complete" : "Break over"} · up next:{" "}
            {PHASE_LABELS[lastComplete.state.phase]}
          </span>
          <button onClick={dismissComplete} className="opacity-70 hover:opacity-100" title="Dismiss">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Main body */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-2 space-y-3">
        {showSettings && draft ? (
          <div className="w-full max-w-[320px] p-4 rounded-2xl bg-evry-surface border border-evry-border space-y-3 animate-slideDown">
            <span className="text-xs font-semibold text-evry-text block">Timer Intervals</span>
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  ["Focus (m)", "work", 180],
                  ["Short (m)", "short", 60],
                  ["Long (m)", "long", 120],
                  ["Every N", "interval", 12],
                ] as const
              ).map(([text, key, max]) => (
                <label key={key} className="flex flex-col space-y-1">
                  <span className="text-[10px] text-evry-muted">{text}</span>
                  <input
                    type="number"
                    min={1}
                    max={max}
                    value={draft[key]}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    className={inputCls}
                  />
                </label>
              ))}
            </div>

            <label className="flex items-center space-x-2 text-[11px] text-evry-muted cursor-pointer">
              <input
                type="checkbox"
                checked={draft.auto}
                onChange={(e) => setDraft({ ...draft, auto: e.target.checked })}
                className="accent-[#F47735]"
              />
              <span>Auto-start the next phase</span>
            </label>

            {error && <p className="text-[10px] text-red-400">{error}</p>}

            <button
              onClick={handleSaveConfig}
              className="w-full py-1.5 rounded-xl bg-evry-accent text-white text-xs font-semibold hover:bg-evry-accentHover transition-colors"
            >
              Apply
            </button>
          </div>
        ) : (
          <>
            {/* Phase tag */}
            <div
              className="text-[11px] font-semibold tracking-wider uppercase px-3 py-1 rounded-full border flex items-center space-x-1.5"
              style={{ color, borderColor: `${color}40`, backgroundColor: `${color}15` }}
            >
              {state.phase === "work" ? <Timer className="w-3 h-3" /> : <Coffee className="w-3 h-3" />}
              <span>{label}</span>
            </div>

            {/* Task */}
            <input
              value={taskDraft}
              onChange={(e) => setTaskDraft(e.target.value)}
              onBlur={commitTask}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur() as void)}
              placeholder="What are you focusing on?"
              maxLength={80}
              className="w-full max-w-[240px] bg-transparent border-b border-evry-border text-center text-xs text-white placeholder:text-evry-muted focus:outline-none focus:border-evry-accent pb-1"
            />

            {/* Ring */}
            <div className="relative w-[124px] h-[124px]">
              <svg width="124" height="124" className="-rotate-90">
                <circle cx="62" cy="62" r={radius} fill="none" stroke="#222222" strokeWidth="7" />
                <circle
                  cx="62"
                  cy="62"
                  r={radius}
                  fill="none"
                  stroke={color}
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  style={{ transition: "stroke-dashoffset 0.6s ease" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold font-mono text-white tracking-tight">
                  {formatTime(state.remaining_secs)}
                </span>
                <span className="text-[10px] text-evry-muted font-mono mt-0.5">
                  {state.is_running ? "RUNNING" : "PAUSED"}
                </span>
              </div>
            </div>

            {/* Cycle dots */}
            <div className="flex items-center space-x-1.5" title="Sessions until long break">
              {Array.from({ length: state.config.long_break_interval }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    i < state.cycle_position ? "bg-evry-accent" : "bg-evry-border"
                  )}
                />
              ))}
            </div>

            {/* Controls */}
            <div className="flex items-center space-x-3">
              <button
                onClick={() => reset().catch(console.error)}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-muted hover:text-white transition-all active:scale-95"
                title="Reset timer and cycle"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={handleStartPause}
                className={cn(
                  "w-12 h-12 flex items-center justify-center rounded-full transition-all active:scale-95 shadow-md",
                  state.is_running
                    ? "bg-evry-accent text-white shadow-glow"
                    : "bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-white hover:border-evry-accent/40"
                )}
                title={state.is_running ? "Pause" : "Start"}
              >
                {state.is_running ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                )}
              </button>

              <button
                onClick={() => skip().catch(console.error)}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-muted hover:text-white transition-all active:scale-95"
                title="Skip to next phase"
              >
                <SkipForward className="w-4 h-4" />
              </button>

              <button
                onClick={() => extend(5 * 60).catch(console.error)}
                className="h-9 px-2 flex items-center justify-center rounded-full bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-muted hover:text-white transition-all active:scale-95 text-[10px] font-mono"
                title="Add 5 minutes"
              >
                <Plus className="w-3 h-3" />5
              </button>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="pt-2 border-t border-evry-border/60 flex items-center justify-between text-[10px] text-evry-muted">
        <span className="flex items-center space-x-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span>
            {sessionsToday} session{sessionsToday !== 1 ? "s" : ""} today
            {stats ? ` · ${stats.focus_minutes_today}m focused` : ""}
          </span>
        </span>
        {stats && stats.streak_days > 0 && (
          <span className="flex items-center space-x-1 font-mono text-evry-accent">
            <Flame className="w-3 h-3" />
            <span>{stats.streak_days}d streak</span>
          </span>
        )}
      </div>
    </div>
  );
};