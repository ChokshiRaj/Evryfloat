import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  Save,
  Check,
  Copy,
  Trash2,
  BookOpen,
  ChevronDown,
} from "lucide-react";
import { Note } from "../../types";
import { cn } from "../../lib/utils";

interface TeleprompterProps {
  onBack: () => void;
}

type Speed = 0.5 | 1 | 1.5 | 2;
type FontSize = "sm" | "base" | "lg" | "xl";

const SPEED_RATES: Record<Speed, number> = {
  0.5: 18, // px per second
  1: 34,
  1.5: 52,
  2: 74,
};

const DEFAULT_SCRIPT =
  "Welcome to EVRY Teleprompter.\n\nPositioned directly below your webcam to maintain natural eye contact during video meetings, interviews, and presentations.\n\nPress [Space] to start smooth auto-scroll. When scrolling, all controls disappear to give you an entirely distraction-free reading experience.\n\nYou can load notes directly from your EVRY SQLite notes database or save your script back into Notes at any time.";

export const Teleprompter: React.FC<TeleprompterProps> = ({ onBack }) => {
  const [text, setText] = useState(() => {
    return localStorage.getItem("evry_teleprompter_text") || DEFAULT_SCRIPT;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [fontSize, setFontSize] = useState<FontSize>("lg");
  const [copied, setCopied] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);

  // Notes drawer/popover state
  const [showNotesDrawer, setShowNotesDrawer] = useState(false);
  const [notesList, setNotesList] = useState<Note[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);

  // Refs for smooth requestAnimationFrame scrolling
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  // Save text to localStorage
  useEffect(() => {
    localStorage.setItem("evry_teleprompter_text", text);
  }, [text]);

  // Load notes from SQLite
  const handleOpenNotesDrawer = async () => {
    setShowNotesDrawer((prev) => !prev);
    if (!showNotesDrawer) {
      setIsLoadingNotes(true);
      try {
        const notes = await invoke<Note[]>("get_notes");
        setNotesList(notes);
      } catch (err) {
        console.error("Failed to load notes for teleprompter:", err);
      } finally {
        setIsLoadingNotes(false);
      }
    }
  };

  const handleSelectNote = (note: Note) => {
    setText(`${note.title}\n\n${note.content}`);
    setShowNotesDrawer(false);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  };

  // Save current script to Notes SQLite database
  const handleSaveToNotes = async () => {
    try {
      const lines = text.trim().split("\n").filter((l) => l.trim().length > 0);
      const title = lines.length > 0 ? lines[0].slice(0, 40) : "Teleprompter Script";
      const content = text;

      await invoke("save_note", {
        id: null,
        title,
        content,
      });

      setSavedFeedback("Saved to Notes!");
      setTimeout(() => setSavedFeedback(null), 2000);
    } catch (err) {
      console.error("Failed to save note:", err);
      setSavedFeedback("Error saving");
      setTimeout(() => setSavedFeedback(null), 2500);
    }
  };

  // Smooth Auto-scroll loop via requestAnimationFrame
  const scrollStep = useCallback(
    (timestamp: number) => {
      if (!lastTimeRef.current) {
        lastTimeRef.current = timestamp;
      }
      const deltaTime = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      if (scrollContainerRef.current && isPlaying) {
        const pixelsToScroll = SPEED_RATES[speed] * deltaTime;
        const container = scrollContainerRef.current;
        const maxScroll = container.scrollHeight - container.clientHeight;

        if (container.scrollTop >= maxScroll - 1) {
          setIsPlaying(false);
          lastTimeRef.current = null;
          return;
        }

        container.scrollTop += pixelsToScroll;
        animationFrameRef.current = requestAnimationFrame(scrollStep);
      }
    },
    [isPlaying, speed]
  );

  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = null;
      animationFrameRef.current = requestAnimationFrame(scrollStep);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      lastTimeRef.current = null;
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, scrollStep]);

  // Spacebar and Escape keyboard handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept spacebar if user is actively editing text in the textarea
      const isEditing = document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "INPUT";

      if (e.code === "Space" && !isEditing) {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.code === "Escape") {
        if (isPlaying) {
          e.preventDefault();
          setIsPlaying(false);
        } else if (showNotesDrawer) {
          setShowNotesDrawer(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, showNotesDrawer]);

  const handleRewind = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const estimatedMins = Math.max(1, Math.round(words / 130));

  return (
    <div className="relative w-full flex flex-col h-[410px] bg-evry-bg rounded-b-2xl animate-slideDown overflow-hidden select-none">
      {/* 
        Distraction-Free Top Bar:
        Fades out smoothly when scrolling (isPlaying = true) so NOTHING comes in the user's eyes.
        Moving the mouse or pausing gently restores visibility.
      */}
      <div
        className={cn(
          "w-full px-4 pt-3 pb-2 border-b border-evry-border flex items-center justify-between transition-all duration-300 z-20 bg-evry-bg/95 backdrop-blur-md",
          isPlaying ? "opacity-0 hover:opacity-100 focus-within:opacity-100" : "opacity-100"
        )}
      >
        <div className="flex items-center space-x-2">
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-lg bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border flex items-center justify-center text-evry-muted hover:text-evry-text transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-evry-text tracking-wide">Teleprompter</span>
            <span className="text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded">
              Webcam Aligned
            </span>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center space-x-1.5">
          {/* Notes Integration: Load & Save */}
          <div className="relative">
            <button
              onClick={handleOpenNotesDrawer}
              className={cn(
                "flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors",
                showNotesDrawer
                  ? "bg-evry-accent text-white border-evry-accent"
                  : "bg-evry-surface hover:bg-evry-surfaceHover border-evry-border text-evry-muted hover:text-evry-text"
              )}
              title="Load from SQLite Notes"
            >
              <BookOpen className="w-3 h-3" />
              <span>Notes</span>
              <ChevronDown className="w-2.5 h-2.5 opacity-70" />
            </button>

            {/* Notes Popover */}
            {showNotesDrawer && (
              <div className="absolute right-0 top-full mt-1.5 w-64 max-h-56 bg-evry-surface/95 backdrop-blur-lg border border-evry-border rounded-xl shadow-2xl p-2 z-30 flex flex-col space-y-1.5">
                <div className="flex items-center justify-between px-1 pb-1 border-b border-evry-border/70 text-[10px] text-evry-muted">
                  <span className="font-semibold text-evry-text">Load Existing Note</span>
                  <span>{notesList.length} notes</span>
                </div>

                <div className="flex-1 overflow-y-auto evry-scroll space-y-1 max-h-40">
                  {isLoadingNotes ? (
                    <div className="text-[10px] text-evry-muted text-center py-4">Loading notes...</div>
                  ) : notesList.length === 0 ? (
                    <div className="text-[10px] text-evry-muted text-center py-4">No saved notes found</div>
                  ) : (
                    notesList.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => handleSelectNote(n)}
                        className="w-full text-left p-1.5 rounded-lg hover:bg-evry-surfaceHover border border-transparent hover:border-evry-border transition-all group"
                      >
                        <div className="text-[11px] font-medium text-evry-text group-hover:text-evry-accent truncate">
                          {n.title || "Untitled Note"}
                        </div>
                        <div className="text-[9px] text-evry-muted truncate mt-0.5">
                          {n.content.slice(0, 60)}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Save to Notes Button */}
          <button
            onClick={handleSaveToNotes}
            className="flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-medium bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-muted hover:text-evry-text transition-colors"
            title="Save current script to Notes"
          >
            <Save className="w-3 h-3 text-cyan-400" />
            <span>Save</span>
          </button>

          {/* Font Size Selector */}
          <div className="flex items-center space-x-0.5 bg-evry-surface border border-evry-border rounded-md p-0.5 text-[10px]">
            <button
              onClick={() => setFontSize("sm")}
              className={cn("px-1.5 py-0.5 rounded", fontSize === "sm" ? "bg-evry-accent text-white font-bold" : "text-evry-muted hover:text-white")}
              title="Small text (14px)"
            >
              A-
            </button>
            <button
              onClick={() => setFontSize("base")}
              className={cn("px-1.5 py-0.5 rounded", fontSize === "base" ? "bg-evry-accent text-white font-bold" : "text-evry-muted hover:text-white")}
              title="Regular text (16px)"
            >
              A
            </button>
            <button
              onClick={() => setFontSize("lg")}
              className={cn("px-1.5 py-0.5 rounded", fontSize === "lg" ? "bg-evry-accent text-white font-bold" : "text-evry-muted hover:text-white")}
              title="Large text (20px)"
            >
              A+
            </button>
            <button
              onClick={() => setFontSize("xl")}
              className={cn("px-1.5 py-0.5 rounded", fontSize === "xl" ? "bg-evry-accent text-white font-bold" : "text-evry-muted hover:text-white")}
              title="Extra Large text (24px)"
            >
              A++
            </button>
          </div>

          {/* Copy Script */}
          <button
            onClick={handleCopy}
            className="p-1 rounded-md bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-muted hover:text-white transition-colors"
            title="Copy script"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>

          {/* Clear Script */}
          <button
            onClick={() => setText("")}
            className="p-1 rounded-md bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-muted hover:text-rose-400 transition-colors"
            title="Clear script"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 
        Subtle Eye-Level Reading Guide:
        Positioned near the top (28% from top) right below the camera bezel.
        Gives the reader an anchor without any harsh or distracting visuals.
      */}
      <div className="pointer-events-none absolute left-0 right-0 top-[28%] z-10 flex items-center justify-between px-3 opacity-30">
        <div className="w-2 h-0.5 bg-evry-accent rounded-full" />
        <div className="flex-1 border-t border-dashed border-evry-accent/30 mx-2" />
        <div className="w-2 h-0.5 bg-evry-accent rounded-full" />
      </div>

      {/* Main Reading & Editing Canvas */}
      <div
        ref={scrollContainerRef}
        className={cn(
          "flex-1 overflow-y-auto px-8 py-10 evry-scroll transition-colors select-text",
          isPlaying ? "cursor-none" : "cursor-default"
        )}
      >
        {isPlaying ? (
          /* Presentation / Reading Mode (No borders, high contrast, clean reading experience) */
          <div
            onClick={() => setIsPlaying(false)}
            className={cn(
              "whitespace-pre-wrap leading-relaxed tracking-wide text-evry-text transition-all font-sans",
              fontSize === "sm" && "text-sm leading-7",
              fontSize === "base" && "text-base leading-8",
              fontSize === "lg" && "text-xl leading-9 font-medium",
              fontSize === "xl" && "text-2xl leading-10 font-medium"
            )}
            style={{ textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}
          >
            {text || (
              <span className="text-evry-muted italic">
                Script is empty. Click to stop and type or paste your talking points.
              </span>
            )}
            {/* Generous bottom padding so text can scroll all the way past the eye line */}
            <div className="h-64" />
          </div>
        ) : (
          /* Edit Mode (Textarea for typing or pasting) */
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type or paste your talking points, meeting agenda, or presentation script here..."
            className={cn(
              "w-full h-full bg-transparent text-evry-text placeholder-evry-muted/60 resize-none focus:outline-none leading-relaxed transition-all",
              fontSize === "sm" && "text-sm leading-7",
              fontSize === "base" && "text-base leading-8",
              fontSize === "lg" && "text-xl leading-9 font-medium",
              fontSize === "xl" && "text-2xl leading-10 font-medium"
            )}
          />
        )}
      </div>

      {/* Floating Save Notification Toast */}
      {savedFeedback && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded-full bg-emerald-500/90 text-black text-[11px] font-semibold shadow-lg backdrop-blur flex items-center space-x-1">
          <Check className="w-3.5 h-3.5" />
          <span>{savedFeedback}</span>
        </div>
      )}

      {/* 
        Bottom Floating Control Strip:
        When scrolling (isPlaying = true), it fades out to 0 opacity so the user's eyes have ZERO distraction.
        Hovering or pressing Space immediately reveals controls.
      */}
      <div
        className={cn(
          "w-full px-4 py-2 border-t border-evry-border flex items-center justify-between transition-all duration-300 z-20 bg-evry-bg/95 backdrop-blur-md",
          isPlaying ? "opacity-0 hover:opacity-100" : "opacity-100"
        )}
      >
        {/* Play/Pause & Rewind Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsPlaying((p) => !p)}
            className={cn(
              "flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition-all active:scale-95",
              isPlaying
                ? "bg-amber-500 hover:bg-amber-400 text-black"
                : "bg-evry-accent hover:bg-evry-accentHover text-white shadow-glow"
            )}
            title="Press [Space] to toggle"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isPlaying ? "Pause" : "Start Prompter"}</span>
            <span className="text-[9px] opacity-70 font-mono ml-0.5">[Space]</span>
          </button>

          <button
            onClick={handleRewind}
            className="p-1.5 rounded-lg bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-muted hover:text-white transition-colors"
            title="Rewind to top"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Speed Pills */}
          <div className="flex items-center space-x-1 bg-evry-surface border border-evry-border rounded-lg p-0.5 text-[10px]">
            {([0.5, 1, 1.5, 2] as Speed[]).map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={cn(
                  "px-2 py-0.5 rounded font-mono font-medium transition-all",
                  speed === s
                    ? "bg-evry-accent text-white font-bold"
                    : "text-evry-muted hover:text-white"
                )}
                title={`Speed ${s}x`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Word Count & Speech Time Stats */}
        <div className="flex items-center space-x-2 text-[10px] text-evry-muted font-medium">
          <span>{words} words</span>
          <span>•</span>
          <span>~{estimatedMins} min speech</span>
        </div>
      </div>
    </div>
  );
};
