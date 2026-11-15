import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  Calendar,
  ArrowLeft,
  HardDrive,
  Cpu,
} from "lucide-react";
import { SystemStats } from "../../types";

interface FloatingWidgetsProps {
  onBack: () => void;
}

export const FloatingWidgets: React.FC<FloatingWidgetsProps> = ({ onBack }) => {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [currentDate] = useState(new Date());

  useEffect(() => {
    const fetchStats = () => {
      invoke<SystemStats>("get_system_stats")
        .then(setStats)
        .catch(console.error);
    };
    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, []);

  // Calendar matrix calculations
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthName = currentDate.toLocaleString("default", { month: "long" });
  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const currentDay = currentDate.getDate();

  const daysArray = [];
  for (let i = 0; i < firstDayIndex; i++) {
    daysArray.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    daysArray.push(i);
  }

  return (
    <div className="w-full flex flex-col h-[380px] bg-evry-bg rounded-b-2xl animate-slideDown overflow-hidden p-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-evry-border">
        <div className="flex items-center space-x-2">
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-lg bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border flex items-center justify-center text-evry-muted hover:text-evry-text transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-semibold text-evry-text tracking-wide">Desktop Widgets</span>
        </div>
        <span className="text-[10px] text-evry-muted font-mono">Live Telemetry</span>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-2 gap-3 py-3 pr-1 evry-scroll">
        {/* Widget 1: Mini Desktop Calendar */}
        <div className="p-3 bg-evry-surface rounded-xl border border-evry-border flex flex-col justify-between">
          <div className="flex items-center justify-between pb-2 border-b border-evry-border/60">
            <span className="text-xs font-semibold text-evry-text flex items-center space-x-1.5">
              <Calendar className="w-3.5 h-3.5 text-evry-accent" />
              <span>{monthName} {year}</span>
            </span>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] my-2">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <span key={d} className="text-evry-muted font-medium">
                {d}
              </span>
            ))}
            {daysArray.map((day, idx) => (
              <span
                key={idx}
                className={`py-0.5 rounded ${
                  day === currentDay
                    ? "bg-evry-accent text-white font-bold"
                    : day
                    ? "text-evry-text hover:bg-evry-surfaceHover"
                    : "opacity-0"
                }`}
              >
                {day || ""}
              </span>
            ))}
          </div>

          <div className="text-[10px] text-evry-muted text-center pt-1 border-t border-evry-border/40">
            Today: {currentDate.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
          </div>
        </div>

        {/* Widget 2: Live Hardware Monitor */}
        <div className="p-3 bg-evry-surface rounded-xl border border-evry-border flex flex-col justify-between">
          <div className="flex items-center justify-between pb-2 border-b border-evry-border/60">
            <span className="text-xs font-semibold text-evry-text flex items-center space-x-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>Live System Stats</span>
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>

          <div className="space-y-3 my-2">
            {/* CPU */}
            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-evry-muted flex items-center space-x-1">
                  <Cpu className="w-3 h-3 text-evry-accent" />
                  <span>Processor</span>
                </span>
                <span className="font-mono text-evry-text">
                  {stats ? `${stats.cpu_usage.toFixed(1)}%` : "--"}
                </span>
              </div>
              <div className="w-full h-1.5 bg-evry-bg rounded-full overflow-hidden">
                <div
                  className="h-full bg-evry-accent rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(stats?.cpu_usage || 0, 100)}%` }}
                />
              </div>
            </div>

            {/* RAM */}
            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-evry-muted flex items-center space-x-1">
                  <HardDrive className="w-3 h-3 text-emerald-400" />
                  <span>Memory ({stats?.memory_used_mb || 0} MB)</span>
                </span>
                <span className="font-mono text-evry-text">
                  {stats ? `${stats.memory_usage_percent.toFixed(0)}%` : "--"}
                </span>
              </div>
              <div className="w-full h-1.5 bg-evry-bg rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(stats?.memory_usage_percent || 0, 100)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="text-[10px] text-evry-muted text-center pt-1 border-t border-evry-border/40 font-mono">
            Total RAM: {((stats?.memory_total_mb || 0) / 1024).toFixed(1)} GB
          </div>
        </div>
      </div>
    </div>
  );
};
