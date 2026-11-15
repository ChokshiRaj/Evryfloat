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

const SETTINGS = [
  { uri: "ms-settings:network-wifi", label: "Wi-Fi", sub: "Network", Icon: Wifi, iconCls: "text-emerald-400", hoverCls: "hover:border-emerald-500/40" },
  { uri: "ms-settings:bluetooth", label: "Bluetooth", sub: "Devices", Icon: Bluetooth, iconCls: "text-blue-400", hoverCls: "hover:border-blue-500/40" },
  { uri: "ms-settings:display", label: "Display", sub: "Brightness", Icon: Monitor, iconCls: "text-amber-400", hoverCls: "hover:border-amber-500/40" },
  { uri: "ms-settings:", label: "Settings", sub: "Windows", Icon: Settings, iconCls: "text-evry-muted", hoverCls: "hover:border-evry-accent/40" },
] as const;

const volBtn =
  "px-2.5 py-1 rounded-lg bg-evry-bg hover:bg-evry-surfaceHover border border-evry-border text-[11px] text-evry-muted hover:text-evry-text transition-colors flex items-center space-x-1";

function powerText(s: SystemStats | null): string {
  if (!s) return "--";
  if (s.battery_percent == null) return "AC Powered Desktop";
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
  const batteryColor = stats?.is_charging ? "text-evry-accent animate-pulse" : lowBattery ? "text-red-400" : "text-emerald-400";

  return (
    <div className="w-full flex flex-col h-[410px] bg-evry-bg rounded-b-2xl animate-slideDown overflow-hidden p-4">
      {/* Header */}
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
        <span className="text-[10px] text-evry-muted uppercase tracking-wider font-mono">System</span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col justify-between py-2.5 space-y-2.5">
        {/* Gauges */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-2.5 rounded-xl bg-evry-surface border border-evry-border">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center space-x-1.5">
                <Cpu className="w-3.5 h-3.5 text-evry-accent" />
                <span className="font-medium text-evry-text">CPU Load</span>
              </span>
              <span className="font-mono text-[11px] text-evry-accent font-semibold">
                {stats ? `${stats.cpu_usage.toFixed(1)}%` : "--"}
              </span>
            </div>
            <div className="w-full h-1.5 bg-evry-bg rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-evry-accent transition-all duration-500 rounded-full"
                style={{ width: `${Math.min(stats?.cpu_usage ?? 0, 100)}%` }}
              />
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-evry-surface border border-evry-border">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center space-x-1.5">
                <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-medium text-evry-text">Memory</span>
              </span>
              <span className="font-mono text-[11px] text-emerald-400 font-semibold">
                {stats ? `${stats.memory_usage_percent.toFixed(0)}%` : "--"}
              </span>
            </div>
            <div className="w-full h-1.5 bg-evry-bg rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-emerald-400 transition-all duration-500 rounded-full"
                style={{ width: `${Math.min(stats?.memory_usage_percent ?? 0, 100)}%` }}
              />
            </div>
            <div className="text-[9px] text-evry-muted font-mono mt-1">
              {stats
                ? `${(stats.memory_used_mb / 1024).toFixed(1)} / ${(stats.memory_total_mb / 1024).toFixed(0)} GB`
                : "\u00A0"}
            </div>
          </div>
        </div>

        {/* Settings shortcuts */}
        <div className="grid grid-cols-4 gap-2">
          {SETTINGS.map(({ uri, label, sub, Icon, iconCls, hoverCls }) => (
            <button
              key={uri}
              onClick={() => handleOpenSetting(uri)}
              className={`flex flex-col items-center justify-center p-2 rounded-xl bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border ${hoverCls} transition-all group`}
            >
              <Icon className={`w-4 h-4 ${iconCls} mb-1 group-hover:scale-110 transition-transform`} />
              <span className="text-[11px] font-medium text-evry-text">{label}</span>
              <span className="text-[9px] text-evry-muted">{sub}</span>
            </button>
          ))}
        </div>

        {/* Volume */}
        <div className="p-2.5 rounded-xl bg-evry-surface border border-evry-border flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs text-evry-text">
            <Volume2 className="w-4 h-4 text-evry-accent" />
            <span className="font-medium">Master Volume</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <button onClick={() => handleVolume(0)} className={volBtn} title="Toggle mute">
              <VolumeX className="w-3 h-3" />
              <span>Mute</span>
            </button>
            <button onClick={() => handleVolume(-2)} className={volBtn}>
              <Volume1 className="w-3 h-3" />
              <span>Down</span>
            </button>
            <button onClick={() => handleVolume(2)} className={volBtn.replace("text-evry-muted", "text-evry-accent")}>
              <Volume2 className="w-3 h-3" />
              <span>Up</span>
            </button>
          </div>
        </div>

        {/* Power */}
        <div className="p-2.5 rounded-xl bg-evry-surface border border-evry-border flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <BatteryIcon className={`w-4 h-4 ${batteryColor}`} />
            <span className="text-evry-text font-medium">Power Status</span>
          </div>
          <span className={`font-mono text-[11px] ${lowBattery ? "text-red-400" : "text-evry-muted"}`}>
            {powerText(stats)}
          </span>
        </div>

        {error && <p className="text-[10px] text-red-400 text-center">{error}</p>}
      </div>
    </div>
  );
};