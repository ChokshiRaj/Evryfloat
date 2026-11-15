import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Eye,
  EyeOff,
  ShieldAlert,
  ArrowLeft,
  Sliders,
  Copy,
  Trash2,
  Check,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface PrivacyOverlayProps {
  onBack: () => void;
}

interface ProtectionInfo {
  success: boolean;
  is_fallback: boolean;
  build_number: number;
  mode: string;
}

export const PrivacyOverlay: React.FC<PrivacyOverlayProps> = ({ onBack }) => {
  const [shieldActive, setShieldActive] = useState(false);
  const [protectionInfo, setProtectionInfo] = useState<ProtectionInfo | null>(null);
  const [opacity, setOpacity] = useState(85);
  const [mode, setMode] = useState<"screen-shield" | "teleprompter">("screen-shield");
  const [fontSize, setFontSize] = useState<"sm" | "base" | "lg">("base");
  const [copied, setCopied] = useState(false);
  const [teleprompterText, setTeleprompterText] = useState(
    "EVRY Teleprompter Overlay: Paste presentation notes or talking points here. This floating interface stays always on top during meetings and screen shares."
  );

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

  const handleCopy = () => {
    navigator.clipboard.writeText(teleprompterText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const wordCount = teleprompterText.trim() ? teleprompterText.trim().split(/\s+/).length : 0;

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
          <span className="text-xs font-semibold text-evry-text tracking-wide">Privacy Shield & Teleprompter</span>
        </div>

        <div className="flex items-center space-x-1 bg-evry-surface p-0.5 rounded-lg border border-evry-border">
          <button
            onClick={() => setMode("screen-shield")}
            className={cn(
              "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
              mode === "screen-shield"
                ? "bg-evry-accent text-white shadow-sm font-semibold"
                : "text-evry-muted hover:text-evry-text"
            )}
          >
            Shield
          </button>
          <button
            onClick={() => setMode("teleprompter")}
            className={cn(
              "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
              mode === "teleprompter"
                ? "bg-evry-accent text-white shadow-sm font-semibold"
                : "text-evry-muted hover:text-evry-text"
            )}
          >
            Teleprompter
          </button>
        </div>
      </div>

      {mode === "screen-shield" ? (
        <div className="flex-1 min-h-0 flex flex-col justify-between py-2.5 space-y-2.5">
          {/* Main Shield Toggle Card */}
          <div className="p-3 rounded-xl bg-evry-surface border border-evry-border flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div
                className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center border transition-all",
                  shieldActive
                    ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-400 shadow-glow"
                    : "bg-evry-bg border-evry-border text-evry-muted"
                )}
              >
                {shieldActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </div>
              <div>
                <span className="text-xs font-semibold text-evry-text block">
                  Windows Screen Capture Exclusion
                </span>
                <span className="text-[11px] text-evry-muted block mt-0.5">
                  Hides EVRY window from Teams, Zoom, OBS, and screenshots
                </span>
              </div>
            </div>

            <button
              onClick={toggleShield}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95",
                shieldActive
                  ? "bg-emerald-500 text-black shadow-glow"
                  : "bg-evry-bg hover:bg-evry-surfaceHover border border-evry-border text-evry-text hover:border-evry-accent/40"
              )}
            >
              {shieldActive ? "Shield Active" : "Enable Shield"}
            </button>
          </div>

          {/* Transparency Slider */}
          <div className="p-3 rounded-xl bg-evry-surface border border-evry-border space-y-2">
            <div className="flex items-center justify-between text-xs text-evry-muted">
              <span className="flex items-center space-x-1.5">
                <Sliders className="w-3.5 h-3.5 text-evry-accent" />
                <span className="font-medium text-evry-text">Overlay Opacity</span>
              </span>
              <span className="font-mono text-evry-accent font-semibold">{opacity}%</span>
            </div>
            <input
              type="range"
              min="40"
              max="100"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-full h-1.5 bg-evry-bg rounded-lg appearance-none cursor-pointer accent-evry-accent"
            />
          </div>

          {/* Privacy Note / API Information */}
          <div className="p-3 rounded-xl bg-evry-surface/50 border border-evry-border flex items-start space-x-2.5 text-[11px] text-evry-muted">
            <ShieldAlert className="w-4 h-4 text-evry-accent flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <p className="font-medium text-evry-text">Hardware Windows API Protection</p>
                {protectionInfo?.build_number ? (
                  <span className="font-mono text-[9px] px-1.5 py-0.2 bg-evry-bg rounded border border-evry-border text-evry-muted">
                    Build {protectionInfo.build_number}
                  </span>
                ) : null}
              </div>
              {protectionInfo?.is_fallback ? (
                <p className="mt-0.5 text-[10px] leading-relaxed text-amber-400">
                  ⚠️ Windows Build &lt; 19041 detected: Using <code className="font-mono text-[10px] bg-evry-bg px-1 py-0.5 rounded border border-evry-border">WDA_MONITOR</code> fallback.
                  Window renders as a solid black box on screen shares. Upgrade to Windows 10 2004+ (Build 19041+) for complete invisible exclusion.
                </p>
              ) : (
                <p className="mt-0.5 text-[10px] leading-relaxed text-evry-muted">
                  Powered by native Windows <code className="font-mono text-[10px] text-cyan-400 bg-evry-bg px-1 py-0.5 rounded border border-evry-border">SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)</code>.
                  When active, screen recorders receive an invisible or blacked-out window box instead of your private notes.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Teleprompter Mode */
        <div className="flex-1 flex flex-col pt-2.5 min-h-0 space-y-2">
          {/* Prompter Controls Bar */}
          <div className="flex items-center justify-between text-xs text-evry-muted px-0.5">
            <div className="flex items-center space-x-2">
              <span className="font-medium text-evry-text text-[11px]">Meeting / Presentation Prompter</span>
              <span className="text-[9px] font-mono bg-evry-surface border border-evry-border px-1.5 py-0.5 rounded text-emerald-400">
                Always on Top
              </span>
            </div>

            <div className="flex items-center space-x-1.5">
              {/* Font Size Toggle */}
              <div className="flex items-center space-x-0.5 bg-evry-surface border border-evry-border rounded p-0.5 text-[10px]">
                <button
                  onClick={() => setFontSize("sm")}
                  className={cn("px-1.5 py-0.5 rounded", fontSize === "sm" ? "bg-evry-accent text-white" : "text-evry-muted hover:text-white")}
                  title="Small text"
                >
                  A-
                </button>
                <button
                  onClick={() => setFontSize("base")}
                  className={cn("px-1.5 py-0.5 rounded", fontSize === "base" ? "bg-evry-accent text-white" : "text-evry-muted hover:text-white")}
                  title="Normal text"
                >
                  A
                </button>
                <button
                  onClick={() => setFontSize("lg")}
                  className={cn("px-1.5 py-0.5 rounded", fontSize === "lg" ? "bg-evry-accent text-white" : "text-evry-muted hover:text-white")}
                  title="Large text"
                >
                  A+
                </button>
              </div>

              {/* Copy */}
              <button
                onClick={handleCopy}
                className="p-1 rounded bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-muted hover:text-white transition-colors"
                title="Copy all text"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>

              {/* Clear */}
              <button
                onClick={() => setTeleprompterText("")}
                className="p-1 rounded bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-muted hover:text-rose-400 transition-colors"
                title="Clear text"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Prompter Textarea */}
          <textarea
            value={teleprompterText}
            onChange={(e) => setTeleprompterText(e.target.value)}
            placeholder="Paste your talking points, presentation notes, or interview cheat sheet here..."
            className={cn(
              "flex-1 w-full bg-evry-surface/70 border border-evry-border rounded-xl p-3 text-evry-text placeholder-evry-muted resize-none focus:outline-none focus:border-evry-accent leading-relaxed evry-scroll",
              fontSize === "sm" && "text-xs",
              fontSize === "base" && "text-sm",
              fontSize === "lg" && "text-base font-medium"
            )}
          />

          {/* Prompter Footer */}
          <div className="flex items-center justify-between text-[10px] text-evry-muted px-1">
            <span>{wordCount} words • {teleprompterText.length} characters</span>
            <span className="text-evry-accent">Look into webcam while reading</span>
          </div>
        </div>
      )}
    </div>
  );
};
