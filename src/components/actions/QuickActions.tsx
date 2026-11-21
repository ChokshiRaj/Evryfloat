import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Volume2,
  VolumeX,
  Volume1,
  Wifi,
  Bluetooth,
  Battery,
  BatteryCharging,
  BatteryWarning,
  Cpu,
  HardDrive,
  Settings,
  Monitor,
  ArrowLeft,
} from "lucide-react";
import { SystemStats } from "../../types";

interface QuickActionsProps {
  onBack: () => void;
}

const volBtn =
  "px-2.5 py-1.5 rounded-lg bg-evry-bg hover:bg-evry-surfaceHover border border-evry-border text-[11px] text-evry-muted hover:text-evry-text transition-colors flex items-center space-x-1";

function powerText(s: SystemStats | null): string {
  if (!s) return "--";
  if (s.battery_percent == null) return "AC Powered";
  const state = s.is_charging ? "Charging" : s.on_ac ? "Plugged in" : "On battery";
  return `${s.battery_percent}% • ${state}`;
}

export const QuickActions: React.FC<QuickActionsProps> = ({ onBack }) => {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errTimer = useRef<number | undefined>(undefined);

  const showError = useCallback((e: unknown) => {
    console.error(e);
    setError(String(e));
    window.clearTimeout(errTimer.current);
    errTimer.current = window.setTimeout(() => setError(null), 3000);
  }, []);

  // Poll while the window is visible; skip a tick if the previous call is still running.
  useEffect(() => {
    let alive = true;
    let busy = false;

    const fetchStats = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const s = await invoke<SystemStats>("get_system_stats");
        if (alive) setStats(s);
      } catch (e) {
        console.error(e);
      } finally {
        busy = false;
      }
    };

    fetchStats();
    const id = window.setInterval(fetchStats, 3000);
    const onVisible = () => !document.hidden && fetchStats();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(errTimer.current);
    };
  }, []);

  const handleOpenSetting = (uri: string) => invoke("open_windows_setting", { uri }).catch(showError);
  const handleVolume = (delta: number) => invoke("adjust_system_volume", { delta }).catch(showError);

  const lowBattery =
    stats?.battery_percent != null && stats.battery_percent <= 20 && stats.on_ac === false;
  const BatteryIcon = stats?.is_charging ? BatteryCharging : lowBattery ? BatteryWarning : Battery;
  const batteryColor = stats?.is_charging
    ? "text-evry-accent animate-pulse"
    : lowBattery
    ? "text-red-400"
    : "text-emerald-400";

  return (
    <div className="w-full flex flex-col h-[410px] bg-evry-bg rounded-b-2xl animate-slideDown overflow-hidden p-4">
      {/* Header with Power Status beside SYSTEM */}
      <div className="flex items-center justify-between pb-2.5 border-b border-evry-border">
        <div className="flex items-center space-x-2">
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-lg bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border flex items-center justify-center text-evry-muted hover:text-evry-text transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-semibold text-evry-text tracking-wide">Quick Controls & System</span>
        </div>

        {/* Power Status displayed beside SYSTEM */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-lg bg-evry-surface border border-evry-border text-[11px] font-mono">
            <BatteryIcon className={`w-3.5 h-3.5 ${batteryColor}`} />
            <span className={lowBattery ? "text-red-400 font-semibold" : "text-evry-text"}>
              {powerText(stats)}
            </span>
          </div>
          <span className="text-[10px] text-evry-muted uppercase tracking-wider font-mono">System</span>
        </div>
      </div>

      {/* 
        3-Row Wireframe Grid Layout:
        Row 1: [ Wide Box: CPU Load ] [ Small Box: Wi-Fi ] [ Small Box: Bluetooth ]
        Row 2: [ Wide Box: Memory ]   [ Small Box: Display ] [ Small Box: Settings ]
        Row 3: [ Full-Width Box: Master Volume ]
      */}
      <div className="flex-1 min-h-0 grid grid-cols-4 grid-rows-[1fr_1fr_auto] gap-2.5 py-2.5">
        {/* Row 1 Left: CPU Load (Col Span 2) */}
        <div className="col-span-2 p-3 rounded-xl bg-evry-surface border border-evry-border flex flex-col justify-between h-full">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center space-x-1.5">
              <Cpu className="w-4 h-4 text-evry-accent" />
              <span className="font-semibold text-evry-text">CPU Load</span>
            </span>
            <span className="font-mono text-xs text-evry-accent font-semibold">
              {stats ? `${stats.cpu_usage.toFixed(1)}%` : "--"}
            </span>
          </div>
          <div className="py-2">
            <div className="w-full h-2 bg-evry-bg rounded-full overflow-hidden">
              <div
                className="h-full bg-evry-accent transition-all duration-500 rounded-full"
                style={{ width: `${Math.min(stats?.cpu_usage ?? 0, 100)}%` }}
              />
            </div>
          </div>
          <div className="text-[10px] text-evry-muted font-mono flex items-center justify-between">
            <span>Utilization</span>
            <span>
              {stats ? (stats.cpu_usage > 75 ? "High Load" : stats.cpu_usage > 30 ? "Active" : "Normal") : "--"}
            </span>
          </div>
        </div>

        {/* Row 1 Middle: Wi-Fi (Col Span 1) */}
        <button
          onClick={() => handleOpenSetting("ms-settings:network-wifi")}
          className="col-span-1 flex flex-col items-center justify-center p-2 rounded-xl bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border hover:border-emerald-500/40 transition-all group h-full"
        >
          <Wifi className="w-5 h-5 text-emerald-400 mb-1 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-semibold text-evry-text">Wi-Fi</span>
          <span className="text-[9px] text-evry-muted">Network</span>
        </button>

        {/* Row 1 Right: Bluetooth (Col Span 1) */}
        <button
          onClick={() => handleOpenSetting("ms-settings:bluetooth")}
          className="col-span-1 flex flex-col items-center justify-center p-2 rounded-xl bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border hover:border-blue-500/40 transition-all group h-full"
        >
          <Bluetooth className="w-5 h-5 text-blue-400 mb-1 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-semibold text-evry-text">Bluetooth</span>
          <span className="text-[9px] text-evry-muted">Devices</span>
        </button>

        {/* Row 2 Left: Memory (Col Span 2) */}
        <div className="col-span-2 p-3 rounded-xl bg-evry-surface border border-evry-border flex flex-col justify-between h-full">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center space-x-1.5">
              <HardDrive className="w-4 h-4 text-emerald-400" />
              <span className="font-semibold text-evry-text">Memory</span>
            </span>
            <span className="font-mono text-xs text-emerald-400 font-semibold">
              {stats ? `${stats.memory_usage_percent.toFixed(0)}%` : "--"}
            </span>
          </div>
          <div className="py-2">
            <div className="w-full h-2 bg-evry-bg rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-all duration-500 rounded-full"
                style={{ width: `${Math.min(stats?.memory_usage_percent ?? 0, 100)}%` }}
              />
            </div>
          </div>
          <div className="text-[10px] text-evry-muted font-mono flex items-center justify-between">
            <span>Used / Total</span>
            <span>
              {stats
                ? `${(stats.memory_used_mb / 1024).toFixed(1)} / ${(stats.memory_total_mb / 1024).toFixed(0)} GB`
                : "--"}
            </span>
          </div>
        </div>

        {/* Row 2 Middle: Display (Col Span 1) */}
        <button
          onClick={() => handleOpenSetting("ms-settings:display")}
          className="col-span-1 flex flex-col items-center justify-center p-2 rounded-xl bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border hover:border-amber-500/40 transition-all group h-full"
        >
          <Monitor className="w-5 h-5 text-amber-400 mb-1 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-semibold text-evry-text">Display</span>
          <span className="text-[9px] text-evry-muted">Brightness</span>
        </button>

        {/* Row 2 Right: Settings (Col Span 1) */}
        <button
          onClick={() => handleOpenSetting("ms-settings:")}
          className="col-span-1 flex flex-col items-center justify-center p-2 rounded-xl bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border hover:border-evry-accent/40 transition-all group h-full"
        >
          <Settings className="w-5 h-5 text-evry-muted mb-1 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-semibold text-evry-text">Settings</span>
          <span className="text-[9px] text-evry-muted">Windows</span>
        </button>

        {/* Row 3: Master Volume (Col Span 4 - Full Width) */}
        <div className="col-span-4 p-3 rounded-xl bg-evry-surface border border-evry-border flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs text-evry-text">
            <div className="w-7 h-7 rounded-lg bg-evry-bg border border-evry-border flex items-center justify-center text-evry-accent">
              <Volume2 className="w-3.5 h-3.5" />
            </div>
            <span className="font-semibold">Master Volume</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <button onClick={() => handleVolume(0)} className={volBtn} title="Toggle mute">
              <VolumeX className="w-3.5 h-3.5" />
              <span>Mute</span>
            </button>
            <button onClick={() => handleVolume(-2)} className={volBtn} title="Decrease volume">
              <Volume1 className="w-3.5 h-3.5" />
              <span>Down</span>
            </button>
            <button
              onClick={() => handleVolume(2)}
              className={volBtn.replace("text-evry-muted", "text-evry-accent font-medium")}
              title="Increase volume"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Up</span>
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-[10px] text-red-400 text-center mt-1">{error}</p>}
    </div>
  );
};
