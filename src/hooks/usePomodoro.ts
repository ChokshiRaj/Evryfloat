import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  PomodoroComplete,
  PomodoroConfig,
  PomodoroState,
  PomodoroStats,
} from "../types";

export function usePomodoro() {
  const [state, setState] = useState<PomodoroState | null>(null);
  const [stats, setStats] = useState<PomodoroStats | null>(null);
  const [lastComplete, setLastComplete] = useState<PomodoroComplete | null>(null);

  const refreshStats = useCallback(() => {
    invoke<PomodoroStats>("get_pomodoro_stats").then(setStats).catch(console.error);
  }, []);

  useEffect(() => {
    let alive = true;
    const unlisteners: Array<() => void> = [];
    const keep = (p: Promise<() => void>) =>
      p.then((u) => (alive ? unlisteners.push(u) : u()));

    invoke<PomodoroState>("get_pomodoro_state")
      .then((s) => alive && setState(s))
      .catch(console.error);
    refreshStats();

    keep(listen<PomodoroState>("pomodoro-tick", (e) => setState(e.payload)));
    keep(
      listen<PomodoroComplete>("pomodoro-complete", (e) => {
        setLastComplete(e.payload);
        refreshStats();
      })
    );

    return () => {
      alive = false;
      unlisteners.forEach((u) => u());
    };
  }, [refreshStats]);

  // Every command returns the new state, so no extra get_pomodoro_state round trip.
  const run = useCallback(async (cmd: string, args?: Record<string, unknown>) => {
    const next = await invoke<PomodoroState>(cmd, args);
    setState(next);
    return next;
  }, []);

  return {
    state,
    stats,
    lastComplete,
    dismissComplete: () => setLastComplete(null),
    start: () => run("start_pomodoro"),
    pause: () => run("pause_pomodoro"),
    reset: () => run("reset_pomodoro"),
    skip: () => run("skip_pomodoro"),
    extend: (secs: number) => run("extend_pomodoro", { secs }),
    setTask: (task: string | null) => run("set_pomodoro_task", { task }),
    setConfig: (config: PomodoroConfig) => run("set_pomodoro_config", { config }),
  };
}