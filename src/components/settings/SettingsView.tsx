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
  Eye,
  EyeOff,
  ShieldAlert,
  Sliders,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface SettingsViewProps {
  onBack: () => void;
}

interface ProtectionInfo {
  success: boolean;
  is_fallback: boolean;
  build_number: number;
  mode: string;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onBack }) => {
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [hotkeyStatus, setHotkeyStatus] = useState<string | null>(null);
  const [shieldActive, setShieldActive] = useState(false);
  const [protectionInfo, setProtectionInfo] = useState<ProtectionInfo | null>(null);
  const [opacity, setOpacity] = useState(() => {
    return Number(localStorage.getItem("evry_overlay_opacity")) || 95;
  });
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

  const toggleShield = () => {
    const nextState = !shieldActive;
    invoke<ProtectionInfo>("set_screen_capture_protection", { enable: nextState })
      .then((res) => {
        setShieldActive(nextState && res.success);
        setProtectionInfo(res);
      })
      .catch((err) => {
        console.error("Failed to toggle capture protection:", err);
      });
  };

  const handleOpacityChange = (val: number) => {
    setOpacity(val);
    localStorage.setItem("evry_overlay_opacity", String(val));
  };

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
    <div className="w-full flex flex-col h-[290px] bg-evry-bg rounded-b-2xl animate-slideDown overflow-hidden p-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-1.5 border-b border-evry-border">
        <div className="flex items-center space-x-1.5">
          <button
            onClick={onBack}
            className="w-6 h-6 rounded-md bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border flex items-center justify-center text-evry-muted hover:text-evry-text transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center space-x-1.5">
            <SettingsIcon className="w-3.5 h-3.5 text-evry-accent" />
            <span className="text-xs font-semibold text-evry-text tracking-wide">
              Settings & Preferences
            </span>
          </div>
        </div>
        <span className="text-[10px] font-mono bg-evry-surface border border-evry-border px-1.5 py-0.5 rounded text-evry-muted">
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
                Suggest Prompter & meeting tools during Zoom/Teams calls
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

        {/* 4. Hardware Privacy Shield & Screen Capture Protection */}
        <div className="p-3 rounded-xl bg-evry-surface border border-evry-border space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div
                className={cn(
                  "w-7 h-7 rounded-lg border flex items-center justify-center transition-all",
                  shieldActive
                    ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-400"
                    : "bg-evry-bg border-evry-border text-evry-muted"
                )}
              >
                {shieldActive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </div>
              <div>
                <span className="text-xs font-semibold text-evry-text block">
                  Hardware Screen Capture Shield
                </span>
                <span className="text-[10px] text-evry-muted block">
                  Hides EVRY window from Teams, Zoom, OBS, and screenshots
                </span>
              </div>
            </div>

            <button
              onClick={toggleShield}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95",
                shieldActive
                  ? "bg-emerald-500 text-black shadow-glow font-bold"
                  : "bg-evry-bg hover:bg-evry-surfaceHover border border-evry-border text-evry-text"
              )}
            >
              {shieldActive ? "Shield Active" : "Enable Shield"}
            </button>
          </div>

          {/* Opacity Slider */}
          <div className="pt-1 space-y-1.5 border-t border-evry-border/60">
            <div className="flex items-center justify-between text-[11px] text-evry-muted">
              <span className="flex items-center space-x-1.5">
                <Sliders className="w-3 h-3 text-evry-accent" />
                <span className="text-evry-text">Overlay Opacity</span>
              </span>
              <span className="font-mono text-evry-accent font-semibold">{opacity}%</span>
            </div>
            <input
              type="range"
              min="40"
              max="100"
              value={opacity}
              onChange={(e) => handleOpacityChange(Number(e.target.value))}
              className="w-full h-1.5 bg-evry-bg rounded-lg appearance-none cursor-pointer accent-evry-accent"
            />
          </div>

          {/* Hardware Diagnostic Info */}
          <div className="p-2 rounded-lg bg-evry-bg/60 border border-evry-border/70 flex items-start space-x-2 text-[10px] text-evry-muted">
            <ShieldAlert className="w-3.5 h-3.5 text-evry-accent flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center space-x-1.5">
                <span className="font-medium text-evry-text">Windows Display Affinity</span>
                {protectionInfo?.build_number ? (
                  <span className="font-mono text-[9px] px-1 bg-evry-surface rounded border border-evry-border text-evry-muted">
                    Build {protectionInfo.build_number}
                  </span>
                ) : null}
              </div>
              {protectionInfo?.is_fallback ? (
                <p className="mt-0.5 leading-relaxed text-amber-400 text-[10px]">
                  Build &lt; 19041 fallback: Uses <code className="font-mono text-[9px]">WDA_MONITOR</code> (solid black box during screen share).
                </p>
              ) : (
                <p className="mt-0.5 leading-relaxed text-evry-muted text-[10px]">
                  Uses native <code className="font-mono text-[9px] text-cyan-400">SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)</code>. Completely invisible on captured video streams.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 5. Storage & Retention Policies */}
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

