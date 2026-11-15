import React, { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Search,
  Terminal,
  AppWindow,
  File,
  Folder,
  CornerDownLeft,
  X,
  Calculator,
  Globe,
  BookOpen,
  Clipboard,
  FileEdit,
  Clock,
  Skull,
  Code,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { AppEntry, FileSearchResult, ClipboardItem, Snippet } from "../../types";
import { cn } from "../../lib/utils";

interface CommandSearchProps {
  onClose: () => void;
}

// Offline mini dictionary
const DICTIONARY: Record<string, string> = {
  serendipity: "The occurrence and development of events by chance in a happy or beneficial way.",
  ephemeral: "Lasting for a very short time; transitory.",
  ubiquitous: "Present, appearing, or found everywhere.",
  resilience: "The capacity to recover quickly from difficulties; toughness.",
  pragmatic: "Dealing with things sensibly and realistically based on practical considerations.",
  paradigm: "A typical example or pattern of something; a model.",
  aesthetic: "Concerned with beauty or the appreciation of beauty.",
  anomaly: "Something that deviates from what is standard, normal, or expected.",
  catalyst: "A person or thing that precipitates an event or change.",
  cognitive: "Relating to the mental action or process of acquiring knowledge and understanding.",
  concurrency: "The ability of different parts or units of a program to be executed out-of-order.",
  heuristic: "Enabling someone to discover or learn something for themselves.",
  idempotent: "Denoting an element of a set which is unchanged in value when multiplied or operated on by itself.",
  immutable: "Unchanging over time or unable to be changed.",
  lucid: "Expressed clearly; easy to understand; bright or luminous.",
  nostalgia: "A sentimental longing or wistful affection for the past.",
  optimal: "Best or most favorable; optimum.",
  protocol: "The official procedure or system of rules governing affairs or data transfer.",
  recursion: "The application of a function as a part of its own definition.",
  synergy: "The interaction or cooperation of two or more organizations, substances, or agents to produce a combined effect greater than the sum of their separate effects.",
  zenith: "The time at which something is most powerful or successful.",
};

export const CommandSearch: React.FC<CommandSearchProps> = ({ onClose }) => {
  const [query, setQuery] = useState("");
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [fileResults, setFileResults] = useState<FileSearchResult[]>([]);
  const [clipboardItems, setClipboardItems] = useState<ClipboardItem[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load apps, clipboard, and snippets on mount
  useEffect(() => {
    let isMounted = true;
    invoke<AppEntry[]>("get_installed_apps")
      .then((res) => {
        if (isMounted) {
          setApps(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load apps:", err);
        if (isMounted) setLoading(false);
      });

    invoke<ClipboardItem[]>("get_clipboard_history")
      .then((res) => {
        if (isMounted) setClipboardItems(res);
      })
      .catch(console.error);

    invoke<Snippet[]>("get_snippets")
      .then((res) => {
        if (isMounted) setSnippets(res);
      })
      .catch(console.error);

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search user files dynamically when query is typed (and not a special prefix)
  useEffect(() => {
    const q = query.trim();
    const isSpecialPrefix =
      q.startsWith("clip ") ||
      q === "clip" ||
      q.startsWith("note ") ||
      q.startsWith("remind ") ||
      q.startsWith("kill ") ||
      q.startsWith(";") ||
      q.startsWith("define ") ||
      q.startsWith("g ") ||
      q.startsWith("yt ") ||
      q.startsWith("gh ") ||
      q.startsWith("npm ");

    if (q.length >= 2 && !isSpecialPrefix) {
      invoke<FileSearchResult[]>("search_user_files", { query: q })
        .then(setFileResults)
        .catch(console.error);
    } else {
      setFileResults([]);
    }
  }, [query]);

  // Command Prefix 1: "clip <query>"
  const isClipMode = query.startsWith("clip ") || query.trim() === "clip";
  const clipQuery = isClipMode ? query.slice(4).trim().toLowerCase() : "";
  const filteredClips = useMemo(() => {
    if (!isClipMode) return [];
    if (!clipQuery) return clipboardItems.slice(0, 10);
    return clipboardItems
      .filter((c) => c.content.toLowerCase().includes(clipQuery))
      .slice(0, 10);
  }, [isClipMode, clipQuery, clipboardItems]);

  // Command Prefix 2: "note <text>"
  const isNoteMode = query.startsWith("note ");
  const noteContent = isNoteMode ? query.slice(5).trim() : "";

  // Command Prefix 3: "remind <time> <text>"
  const isRemindMode = query.startsWith("remind ");
  const parsedReminder = useMemo(() => {
    if (!isRemindMode) return null;
    const rest = query.slice(7).trim();
    if (!rest) return null;

    const parts = rest.split(/\s+/);
    const timeToken = parts[0].toLowerCase();
    const taskText = parts.slice(1).join(" ") || "Reminder";

    let due = new Date();
    let displayTime = "";

    if (timeToken.endsWith("m")) {
      const mins = parseInt(timeToken) || 10;
      due = new Date(Date.now() + mins * 60 * 1000);
      displayTime = `in ${mins} minutes (${due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`;
    } else if (timeToken.endsWith("h")) {
      const hours = parseInt(timeToken) || 1;
      due = new Date(Date.now() + hours * 60 * 60 * 1000);
      displayTime = `in ${hours} hour(s) (${due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`;
    } else if (timeToken === "tomorrow") {
      due.setDate(due.getDate() + 1);
      due.setHours(9, 0, 0, 0);
      displayTime = `tomorrow at 9:00 AM`;
    } else {
      // Default to 15m
      due = new Date(Date.now() + 15 * 60 * 1000);
      displayTime = `in 15m (${due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`;
    }

    return {
      dueIso: due.toISOString(),
      displayTime,
      task: taskText,
    };
  }, [isRemindMode, query]);

  // Command Prefix 4: "kill <process>"
  const isKillMode = query.startsWith("kill ");
  const killTarget = isKillMode ? query.slice(5).trim() : "";

  // Snippets detection: Starts with ';' or query matches prefix
  const isSnippetMode = query.startsWith(";");
  const filteredSnippets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    if (q.startsWith(";")) {
      return snippets.filter((s) => s.prefix.toLowerCase().startsWith(q));
    }
    return snippets.filter((s) => s.prefix.toLowerCase().includes(q) || s.title.toLowerCase().includes(q));
  }, [query, snippets]);

  // Helper to expand placeholders in snippets
  const expandSnippet = (content: string): string => {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-CA"); // YYYY-MM-DD
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const latestClip = clipboardItems[0]?.content || "";

    return content
      .replace(/\{date\}/g, dateStr)
      .replace(/\{time\}/g, timeStr)
      .replace(/\{clipboard\}/g, latestClip)
      .replace(/\{cursor\}/g, "");
  };

  // Inline Calculator & Unit Converter Evaluation
  const inlineEvalResult = useMemo(() => {
    const q = query.trim();
    if (!q || isClipMode || isNoteMode || isRemindMode || isKillMode || isSnippetMode) return null;

    const sanitizedMath = q.replace(/\^/g, "**");
    if (/^[\d\s+\-*/().%]+$/.test(sanitizedMath) && /[\d]/.test(sanitizedMath) && /[+\-*/%]/.test(sanitizedMath)) {
      try {
        const result = Function(`"use strict"; return (${sanitizedMath})`)();
        if (typeof result === "number" && !isNaN(result) && isFinite(result)) {
          return {
            type: "math",
            label: "Calculation",
            value: Number.isInteger(result) ? result.toLocaleString() : result.toFixed(4).replace(/\.?0+$/, ""),
            raw: q,
          };
        }
      } catch {}
    }

    // Unit conversions
    const kmMile = q.match(/^([\d.]+)\s*(?:km|kms|kilometer|kilometers)\s+(?:in|to)\s+(?:miles?|mi)$/i);
    if (kmMile) {
      const v = parseFloat(kmMile[1]);
      return { type: "unit", label: "Unit Conversion", value: `${(v * 0.621371).toFixed(2)} miles`, raw: q };
    }
    const cToF = q.match(/^([\d.-]+)\s*(?:c|celsius)\s+(?:in|to)\s+(?:f|fahrenheit)$/i);
    if (cToF) {
      const v = parseFloat(cToF[1]);
      return { type: "unit", label: "Temperature", value: `${((v * 9) / 5 + 32).toFixed(1)} °F`, raw: q };
    }
    const usdInr = q.match(/^([\d.]+)\s*usd\s+(?:in|to)\s+inr$/i);
    if (usdInr) {
      const v = parseFloat(usdInr[1]);
      return { type: "unit", label: "Currency (Approx)", value: `₹${(v * 86.5).toFixed(2)} INR`, raw: q };
    }

    return null;
  }, [query, isClipMode, isNoteMode, isRemindMode, isKillMode, isSnippetMode]);

  // Dictionary check
  const dictionaryResult = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.startsWith("define ")) {
      const word = q.slice(7).trim();
      if (word) {
        const definition = DICTIONARY[word];
        return {
          word,
          definition: definition || `No offline definition found for "${word}". Press Tab to search on Google.`,
          found: !!definition,
        };
      }
    }
    return null;
  }, [query]);

  // Web search shortcuts
  const webSearchTarget = useMemo(() => {
    const q = query.trim();
    if (q.startsWith("g ")) return { service: "Google", url: `https://www.google.com/search?q=${encodeURIComponent(q.slice(2).trim())}` };
    if (q.startsWith("yt ")) return { service: "YouTube", url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q.slice(3).trim())}` };
    if (q.startsWith("gh ")) return { service: "GitHub", url: `https://github.com/search?q=${encodeURIComponent(q.slice(3).trim())}` };
    if (q.startsWith("npm ")) return { service: "npm", url: `https://www.npmjs.com/search?q=${encodeURIComponent(q.slice(4).trim())}` };
    return null;
  }, [query]);

  // Standard Apps filter
  const filteredApps = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || isClipMode || isNoteMode || isRemindMode || isKillMode || isSnippetMode || dictionaryResult || webSearchTarget) {
      return q ? [] : apps.slice(0, 15);
    }
    return apps.filter((app) => app.name.toLowerCase().includes(q)).slice(0, 15);
  }, [apps, query, isClipMode, isNoteMode, isRemindMode, isKillMode, isSnippetMode, dictionaryResult, webSearchTarget]);

  // Combined navigation items
  const combinedItems = useMemo(() => {
    const items: Array<{
      type: "app" | "file" | "clip" | "snippet";
      name: string;
      path: string;
      iconHint?: string;
      isDir?: boolean;
      extra?: unknown;
    }> = [];

    if (isClipMode) {
      filteredClips.forEach((c) =>
        items.push({
          type: "clip",
          name: c.content,
          path: String(c.id),
          extra: c,
        })
      );
      return items;
    }

    if (isSnippetMode || filteredSnippets.length > 0) {
      filteredSnippets.forEach((s) =>
        items.push({
          type: "snippet",
          name: `${s.prefix} — ${s.title}`,
          path: String(s.id),
          extra: s,
        })
      );
      if (isSnippetMode) return items;
    }

    filteredApps.forEach((a) =>
      items.push({
        type: "app",
        name: a.name,
        path: a.path,
        iconHint: a.icon_hint,
      })
    );

    fileResults.forEach((f) =>
      items.push({
        type: "file",
        name: f.name,
        path: f.path,
        isDir: f.is_dir,
      })
    );

    return items;
  }, [isClipMode, filteredClips, isSnippetMode, filteredSnippets, filteredApps, fileResults]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleLaunch = (item: { path: string }) => {
    invoke("launch_app", { path: item.path })
      .then(() => onClose())
      .catch((err) => console.error("Launch error:", err));
  };

  const handleLaunchUrl = (url: string) => {
    invoke("launch_app", { path: url })
      .then(() => onClose())
      .catch((err) => console.error("Launch URL error:", err));
  };

  // Actions for Special Commands
  const handleExecuteNote = async () => {
    if (!noteContent) return;
    try {
      await invoke("save_note", {
        title: noteContent.slice(0, 30),
        content: noteContent,
      });
      setStatusMessage({ text: "Note saved to EVRY Notes!", type: "success" });
      setTimeout(onClose, 800);
    } catch (err) {
      setStatusMessage({ text: `Failed to save note: ${err}`, type: "error" });
    }
  };

  const handleExecuteReminder = async () => {
    if (!parsedReminder || !parsedReminder.task) return;
    try {
      await invoke("save_reminder", {
        title: parsedReminder.task,
        due_date: parsedReminder.dueIso,
      });
      setStatusMessage({ text: `Reminder set: ${parsedReminder.task} (${parsedReminder.displayTime})`, type: "success" });
      setTimeout(onClose, 800);
    } catch (err) {
      setStatusMessage({ text: `Failed to schedule reminder: ${err}`, type: "error" });
    }
  };

  const handleExecuteKill = async () => {
    if (!killTarget) return;
    try {
      await invoke("terminate_process", { query: killTarget });
      setStatusMessage({ text: `Process '${killTarget}' terminated successfully!`, type: "success" });
      setTimeout(onClose, 800);
    } catch (err) {
      setStatusMessage({ text: String(err), type: "error" });
    }
  };

  const handleExecuteClipPaste = async (item: ClipboardItem) => {
    try {
      await invoke("paste_clipboard_item", { id: item.id });
      onClose();
    } catch {
      navigator.clipboard.writeText(item.content);
      onClose();
    }
  };

  const handleExecuteSnippet = async (snippet: Snippet) => {
    const expanded = expandSnippet(snippet.content);
    try {
      await invoke("paste_clipboard_item", { content: expanded });
      onClose();
    } catch {
      navigator.clipboard.writeText(expanded);
      onClose();
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const q = query.trim();
      if (webSearchTarget) {
        handleLaunchUrl(webSearchTarget.url);
      } else if (q) {
        handleLaunchUrl(`https://www.google.com/search?q=${encodeURIComponent(q)}`);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < combinedItems.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : combinedItems.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isNoteMode) {
        handleExecuteNote();
      } else if (isRemindMode) {
        handleExecuteReminder();
      } else if (isKillMode) {
        handleExecuteKill();
      } else if (webSearchTarget) {
        handleLaunchUrl(webSearchTarget.url);
      } else if (inlineEvalResult) {
        navigator.clipboard.writeText(inlineEvalResult.value);
        onClose();
      } else if (combinedItems[selectedIndex]) {
        const item = combinedItems[selectedIndex];
        if (item.type === "clip") {
          handleExecuteClipPaste(item.extra as ClipboardItem);
        } else if (item.type === "snippet") {
          handleExecuteSnippet(item.extra as Snippet);
        } else {
          handleLaunch(item);
        }
      } else if (query.trim()) {
        handleLaunchUrl(`https://www.google.com/search?q=${encodeURIComponent(query.trim())}`);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="w-full flex flex-col h-[410px] bg-evry-bg rounded-b-2xl animate-slideDown overflow-hidden">
      {/* Search Bar Input */}
      <div className="p-3 border-b border-evry-border flex items-center space-x-2.5">
        <Search className="w-4 h-4 text-evry-accent" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type to search apps, files, or prefixes (clip, note, remind, kill, ;shrug)..."
          className="w-full bg-transparent border-none text-sm text-evry-text placeholder-evry-muted focus:outline-none font-sans"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="text-evry-muted hover:text-evry-text p-1 rounded-md"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <div className="flex items-center space-x-1 text-[10px] text-evry-muted font-mono bg-evry-surface px-1.5 py-0.5 rounded border border-evry-border">
          <span>ESC</span>
        </div>
      </div>

      {/* Results List */}
      <div ref={listRef} className="flex-1 min-h-0 evry-scroll px-2 py-2 space-y-1.5">
        {/* Status Toast Banner */}
        {statusMessage && (
          <div
            className={cn(
              "p-3 rounded-xl flex items-center space-x-2 text-xs font-semibold animate-slideDown",
              statusMessage.type === "success"
                ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-300"
                : "bg-red-500/15 border border-red-500/40 text-red-300"
            )}
          >
            {statusMessage.type === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-red-400" />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Note Action Card */}
        {isNoteMode && (
          <div
            onClick={handleExecuteNote}
            className="p-3 rounded-xl bg-evry-surface border border-evry-accent/40 flex items-center justify-between cursor-pointer hover:bg-evry-surfaceHover transition-all shadow-sm"
          >
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-evry-accent/10 border border-evry-accent/30 flex items-center justify-center text-evry-accent">
                <FileEdit className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-evry-accent tracking-wider block">
                  Quick Note • Press Enter to Save
                </span>
                <span className="text-sm font-medium text-white block truncate max-w-[420px]">
                  {noteContent ? `"${noteContent}"` : "Type note text..."}
                </span>
              </div>
            </div>
            <span className="text-[10px] text-evry-accent font-mono bg-evry-bg px-2 py-1 rounded border border-evry-border">
              ↵ Save
            </span>
          </div>
        )}

        {/* Remind Action Card */}
        {isRemindMode && parsedReminder && (
          <div
            onClick={handleExecuteReminder}
            className="p-3 rounded-xl bg-evry-surface border border-amber-500/40 flex items-center justify-between cursor-pointer hover:bg-evry-surfaceHover transition-all shadow-sm"
          >
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-amber-400 tracking-wider block">
                  Schedule Reminder • {parsedReminder.displayTime}
                </span>
                <span className="text-sm font-medium text-white block truncate max-w-[420px]">
                  {parsedReminder.task}
                </span>
              </div>
            </div>
            <span className="text-[10px] text-amber-400 font-mono bg-evry-bg px-2 py-1 rounded border border-evry-border">
              ↵ Schedule
            </span>
          </div>
        )}

        {/* Kill Action Card */}
        {isKillMode && (
          <div
            onClick={handleExecuteKill}
            className="p-3 rounded-xl bg-evry-surface border border-red-500/40 flex items-center justify-between cursor-pointer hover:bg-evry-surfaceHover transition-all shadow-sm"
          >
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
                <Skull className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-red-400 tracking-wider block">
                  Terminate Process • TaskKill
                </span>
                <span className="text-sm font-medium text-white block truncate max-w-[420px]">
                  {killTarget ? `Terminate '${killTarget}'` : "Type process name (e.g. node, chrome)..."}
                </span>
              </div>
            </div>
            <span className="text-[10px] text-red-400 font-mono bg-evry-bg px-2 py-1 rounded border border-evry-border">
              ↵ Kill
            </span>
          </div>
        )}

        {/* Instant Calculator / Conversion Card */}
        {inlineEvalResult && (
          <div
            onClick={() => {
              navigator.clipboard.writeText(inlineEvalResult.value);
              onClose();
            }}
            className="p-3 rounded-xl bg-evry-surface border border-evry-accent/40 flex items-center justify-between cursor-pointer hover:bg-evry-surfaceHover transition-all shadow-sm"
          >
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-evry-accent/10 border border-evry-accent/30 flex items-center justify-center text-evry-accent">
                <Calculator className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-evry-accent tracking-wider block">
                  {inlineEvalResult.label} • Click to Copy
                </span>
                <span className="text-base font-bold text-white tracking-wide">
                  {inlineEvalResult.value}
                </span>
              </div>
            </div>
            <span className="text-[10px] text-evry-muted font-mono bg-evry-bg px-2 py-1 rounded border border-evry-border">
              ↵ Copy
            </span>
          </div>
        )}

        {/* Dictionary Card */}
        {dictionaryResult && (
          <div className="p-3 rounded-xl bg-evry-surface border border-evry-borderLight space-y-1">
            <div className="flex items-center space-x-2 text-xs text-evry-accent font-semibold">
              <BookOpen className="w-3.5 h-3.5" />
              <span className="capitalize">{dictionaryResult.word}</span>
              {dictionaryResult.found && (
                <span className="text-[9px] bg-evry-bg px-1.5 py-0.5 rounded text-emerald-400 font-mono border border-evry-border">
                  Offline Dictionary
                </span>
              )}
            </div>
            <p className="text-xs text-evry-text leading-relaxed pl-5">
              {dictionaryResult.definition}
            </p>
          </div>
        )}

        {/* Direct Web Search Intent */}
        {webSearchTarget && (
          <div
            onClick={() => handleLaunchUrl(webSearchTarget.url)}
            className="p-3 rounded-xl bg-evry-surface border border-blue-500/40 flex items-center justify-between cursor-pointer hover:bg-evry-surfaceHover transition-all"
          >
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <Globe className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold text-evry-text">
                  Search {webSearchTarget.service}
                </span>
                <span className="text-[10px] text-evry-muted block truncate max-w-[400px]">
                  {webSearchTarget.url}
                </span>
              </div>
            </div>
            <span className="text-[10px] text-blue-400 font-mono bg-evry-bg px-2 py-1 rounded border border-evry-border">
              ↵ Open
            </span>
          </div>
        )}

        {/* Items List (Clips, Snippets, Apps, Files) */}
        {loading ? (
          <div className="h-32 flex items-center justify-center text-xs text-evry-muted">
            Indexing installed applications...
          </div>
        ) : combinedItems.length === 0 && !inlineEvalResult && !dictionaryResult && !webSearchTarget && !isNoteMode && !isRemindMode && !isKillMode ? (
          <div className="h-44 flex flex-col items-center justify-center text-center p-4">
            <AppWindow className="w-6 h-6 text-evry-muted mb-2 opacity-50" />
            <p className="text-xs text-evry-text font-medium">No direct matches</p>
            <p className="text-[11px] text-evry-muted mt-1">
              Press <kbd className="px-1 py-0.5 bg-evry-surface rounded border border-evry-border text-evry-accent font-mono text-[10px]">Tab</kbd> or <kbd className="px-1 py-0.5 bg-evry-surface rounded border border-evry-border text-evry-accent font-mono text-[10px]">↵</kbd> to search on Google
            </p>
          </div>
        ) : (
          combinedItems.map((item, index) => {
            const isSelected = index === selectedIndex;
            return (
              <div
                key={item.type + item.path + index}
                onClick={() => {
                  if (item.type === "clip") {
                    handleExecuteClipPaste(item.extra as ClipboardItem);
                  } else if (item.type === "snippet") {
                    handleExecuteSnippet(item.extra as Snippet);
                  } else {
                    handleLaunch(item);
                  }
                }}
                onMouseEnter={() => setSelectedIndex(index)}
                className={cn(
                  "flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all cursor-pointer",
                  isSelected
                    ? "bg-evry-surface text-evry-text border border-evry-borderLight shadow-sm"
                    : "text-evry-muted hover:bg-evry-surface/40 hover:text-evry-text border border-transparent"
                )}
              >
                <div className="flex items-center space-x-3 overflow-hidden">
                  <div
                    className={cn(
                      "w-7 h-7 rounded-lg flex items-center justify-center border flex-shrink-0",
                      isSelected
                        ? "bg-evry-accent/10 border-evry-accent/30 text-evry-accent"
                        : "bg-evry-surface border-evry-border text-evry-muted"
                    )}
                  >
                    {item.type === "clip" ? (
                      <Clipboard className="w-3.5 h-3.5 text-cyan-400" />
                    ) : item.type === "snippet" ? (
                      <Code className="w-3.5 h-3.5 text-purple-400" />
                    ) : item.type === "file" ? (
                      item.isDir ? <Folder className="w-3.5 h-3.5 text-amber-400" /> : <File className="w-3.5 h-3.5" />
                    ) : item.iconHint === "system" ? (
                      <Terminal className="w-3.5 h-3.5" />
                    ) : (
                      <AppWindow className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div className="flex flex-col truncate">
                    <div className="flex items-center space-x-1.5">
                      <span className="font-medium truncate text-evry-text">
                        {item.name}
                      </span>
                      {item.type === "clip" && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-evry-bg text-cyan-400 border border-evry-border font-mono">
                          Clipboard
                        </span>
                      )}
                      {item.type === "snippet" && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-evry-bg text-purple-400 border border-evry-border font-mono">
                          Snippet
                        </span>
                      )}
                      {item.type === "file" && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-evry-bg text-amber-400 border border-evry-border font-mono">
                          {item.isDir ? "Folder" : "File"}
                        </span>
                      )}
                    </div>
                    {item.type === "snippet" ? (
                      <span className="text-[10px] text-evry-muted truncate font-mono opacity-70">
                        {expandSnippet((item.extra as Snippet).content).slice(0, 60)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-evry-muted truncate opacity-70">
                        {item.path}
                      </span>
                    )}
                  </div>
                </div>

                {isSelected && (
                  <div className="flex items-center space-x-1 text-[11px] text-evry-accent font-medium pl-2">
                    <span>{item.type === "clip" || item.type === "snippet" ? "Paste" : "Open"}</span>
                    <CornerDownLeft className="w-3 h-3" />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Navigation Bar */}
      <div className="px-3 py-2 border-t border-evry-border bg-evry-surface/40 flex items-center justify-between text-[11px] text-evry-muted">
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1">
            <kbd className="px-1 py-0.5 bg-evry-surface rounded border border-evry-border font-mono text-[9px]">↑</kbd>
            <kbd className="px-1 py-0.5 bg-evry-surface rounded border border-evry-border font-mono text-[9px]">↓</kbd>
            <span>Navigate</span>
          </span>
          <span className="flex items-center space-x-1">
            <kbd className="px-1.5 py-0.5 bg-evry-surface rounded border border-evry-border font-mono text-[9px]">↵</kbd>
            <span>Execute</span>
          </span>
        </div>
        <div className="flex items-center space-x-2 text-[10px]">
          <span className="font-mono text-cyan-400">clip</span>
          <span className="font-mono text-emerald-400">note</span>
          <span className="font-mono text-amber-400">remind</span>
          <span className="font-mono text-red-400">kill</span>
          <span className="font-mono text-purple-400">;snip</span>
        </div>
      </div>
    </div>
  );
};
