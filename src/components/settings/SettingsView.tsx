import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import {
  ArrowLeft,
  Settings as SettingsIcon,
  Keyboard,
  Power,
  Database,
  Shield,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface SettingsViewProps {
  onBack: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onBack }) => {
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [hotkeyStatus, setHotkeyStatus] = useState<string | null>(null);
  const [autoMeetingMode, setAutoMeetingMode] = useState(() => {
    return localStorage.getItem("evry_auto_meeting_mode") === "true";
  });
  const [clipRetentionLimit, setClipRetentionLimit] = useState(() => {
    return Number(localStorage.getItem("evry_clip_retention_limit")) || 250;
  });
  const [clipAutoExpireDays, setClipAutoExpireDays] = useState(() => {
    return Number(localStorage.getItem("evry_clip_auto_expire_days")) || 30;
  });
  const [purgeFeedback, setPurgeFeedback] = useState<string | null>(null);

  // Check autostart & hotkey status on mount
  useEffect(() => {
    isEnabled()
      .then(setAutostartEnabled)
      .catch((err) => console.warn("Autostart check failed:", err));

    invoke<string | null>("get_hotkey_status")
      .then(setHotkeyStatus)
      .catch(console.error);
  }, []);

  const handleToggleAutostart = async () => {
    try {
      if (autostartEnabled) {
        await disable();
        setAutostartEnabled(false);
      } else {
        await enable();
        setAutostartEnabled(true);
      }
    } catch (err) {
      console.error("Failed to toggle autostart:", err);
    }
  };

  const handleToggleMeetingMode = () => {
    const next = !autoMeetingMode;
    setAutoMeetingMode(next);
    localStorage.setItem("evry_auto_meeting_mode", String(next));
  };

  const handleSetRetention = (limit: number) => {
    setClipRetentionLimit(limit);
    localStorage.setItem("evry_clip_retention_limit", String(limit));
  };

  const handleSetExpireDays = (days: number) => {
    setClipAutoExpireDays(days);
    localStorage.setItem("evry_clip_auto_expire_days", String(days));
  };

  const handlePurgeNow = async () => {
    try {
      await invoke("purge_clipboard_and_shelf", {
        maxItems: clipRetentionLimit,
        maxDays: clipAutoExpireDays,
      });
      setPurgeFeedback("Cleaned up unpinned items according to policy!");
      setTimeout(() => setPurgeFeedback(null), 2500);
    } catch (err) {
      setPurgeFeedback(`Purge error: ${err}`);
      setTimeout(() => setPurgeFeedback(null), 3000);
    }
  };

  return (
    <div className="w-full flex flex-col h-[410px] bg-evry-bg rounded-b-2xl animate-slideDown overflow-hidden p-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-evry-border">
        <div className="flex items-center space-x-2">
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-lg bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border flex items-center justify-center text-evry-muted hover:text-evry-text transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center space-x-2">
            <SettingsIcon className="w-4 h-4 text-evry-accent" />
            <span className="text-xs font-semibold text-evry-text tracking-wide">
              EVRY Preferences & Settings
            </span>
          </div>
        </div>
        <span className="text-[10px] font-mono bg-evry-surface border border-evry-border px-2 py-0.5 rounded text-evry-muted">
          v0.1.0 • Desktop
        </span>
      </div>

      {/* Settings Scrollable Content */}
      <div className="flex-1 min-h-0 evry-scroll py-3 space-y-3">
        {/* 1. Global Hotkey Card */}
        <div className="p-3 rounded-xl bg-evry-surface border border-evry-border space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-lg bg-evry-bg border border-evry-border flex items-center justify-center text-evry-accent">
                <Keyboard className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="text-xs font-semibold text-evry-text block">Summoning Hotkey</span>
                <span className="text-[10px] text-evry-muted block">System-wide global trigger</span>
              </div>
            </div>
            <div className="flex items-center space-x-1.5 font-mono text-xs">
              <span className="px-2 py-1 rounded bg-evry-bg border border-evry-border text-white font-bold shadow-sm">
                Alt
              </span>
              <span className="text-evry-muted">+</span>
              <span className="px-2.5 py-1 rounded bg-evry-bg border border-evry-border text-white font-bold shadow-sm">
                Space
              </span>
            </div>
          </div>
          {hotkeyStatus ? (
            <div className="flex items-center space-x-1.5 text-[11px] text-amber-400 bg-amber-500/10 p-2 rounded-lg border border-amber-500/30">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{hotkeyStatus}</span>
            </div>
          ) : (
            <div className="flex items-center space-x-1.5 text-[10px] text-emerald-400/90 pl-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>Registered natively via Windows GlobalHook</span>
            </div>
          )}
        </div>

        {/* 2. Launch at Windows Startup */}
        <div className="p-3 rounded-xl bg-evry-surface border border-evry-border flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-lg bg-evry-bg border border-evry-border flex items-center justify-center text-emerald-400">
              <Power className="w-3.5 h-3.5" />
            </div>
            <div>
              <span className="text-xs font-semibold text-evry-text block">Launch on Windows Startup</span>
              <span className="text-[10px] text-evry-muted block">Runs quietly in the background on boot</span>
            </div>
          </div>
          <button
            onClick={handleToggleAutostart}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
              autostartEnabled
                ? "bg-emerald-500 text-black shadow-sm font-bold"
                : "bg-evry-bg border border-evry-border text-evry-muted hover:text-white"
            )}
          >
            {autostartEnabled ? "Enabled" : "Disabled"}
          </button>
        </div>

        {/* 3. Auto Meeting Mode */}
        <div className="p-3 rounded-xl bg-evry-surface border border-evry-border flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-lg bg-evry-bg border border-evry-border flex items-center justify-center text-purple-400">
              <Shield className="w-3.5 h-3.5" />
            </div>
            <div>
              <span className="text-xs font-semibold text-evry-text block">Auto Meeting Mode</span>
              <span className="text-[10px] text-evry-muted block">
                Suggest Privacy Shield & Prompter during Zoom/Teams calls
              </span>
            </div>
          </div>
          <button
            onClick={handleToggleMeetingMode}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
              autoMeetingMode
                ? "bg-purple-500 text-white shadow-sm font-bold"
                : "bg-evry-bg border border-evry-border text-evry-muted hover:text-white"
            )}
          >
            {autoMeetingMode ? "Active" : "Off"}
          </button>
        </div>

        {/* 4. Storage & Retention Policies */}
        <div className="p-3 rounded-xl bg-evry-surface border border-evry-border space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-lg bg-evry-bg border border-evry-border flex items-center justify-center text-cyan-400">
                <Database className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="text-xs font-semibold text-evry-text block">Storage & Retention Policy</span>
                <span className="text-[10px] text-evry-muted block">Controls SQLite local database growth</span>
              </div>
            </div>
            <button
              onClick={handlePurgeNow}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-evry-bg hover:bg-red-500/10 border border-evry-border hover:border-red-500/40 text-red-400 text-[10px] transition-all font-medium"
              title="Prune unpinned items now"
            >
              <Trash2 className="w-3 h-3" />
              <span>Purge Now</span>
            </button>
          </div>

          {purgeFeedback && (
            <div className="text-[10px] text-emerald-400 bg-emerald-500/10 p-1.5 rounded border border-emerald-500/30">
              {purgeFeedback}
            </div>
          )}

          {/* Retention Options */}
          <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
            <div className="space-y-1">
              <span className="text-[10px] text-evry-muted block">Max History Items</span>
              <div className="flex space-x-1">
                {[50, 100, 250, 500].map((num) => (
                  <button
                    key={num}
                    onClick={() => handleSetRetention(num)}
                    className={cn(
                      "flex-1 py-1 rounded text-[10px] font-mono border transition-all",
                      clipRetentionLimit === num
                        ? "bg-evry-accent text-white border-evry-accent font-bold"
                        : "bg-evry-bg border-evry-border text-evry-muted hover:text-white"
                    )}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-evry-muted block">Auto-Expire After</span>
              <div className="flex space-x-1">
                {[7, 30, 90, 0].map((days) => (
                  <button
                    key={days}
                    onClick={() => handleSetExpireDays(days)}
                    className={cn(
                      "flex-1 py-1 rounded text-[10px] font-mono border transition-all",
                      clipAutoExpireDays === days
                        ? "bg-evry-accent text-white border-evry-accent font-bold"
                        : "bg-evry-bg border-evry-border text-evry-muted hover:text-white"
                    )}
                  >
                    {days === 0 ? "Never" : `${days}d`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="pt-2 border-t border-evry-border flex items-center justify-between text-[10px] text-evry-muted">
        <span className="flex items-center space-x-1">
          <Sparkles className="w-3 h-3 text-evry-accent" />
          <span>Local SQLite database located at %APPDATA%\EVRY\evry.db</span>
        </span>
        <span className="text-emerald-400">100% Offline & Private</span>
      </div>
    </div>
  );
};

