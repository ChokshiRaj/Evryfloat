import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  Search,
  Sliders,
  FileText,
  ChevronDown,
  Sparkles,
  Command,
  GripHorizontal,
  ClipboardList,
  Timer,
  Music,
  Inbox,
  Code2,
  Video,
  Palette,
  Terminal,
  Globe,
  Zap,
  Pause,
  Settings as SettingsIcon,
  BatteryWarning,
} from "lucide-react";
import { useClock } from "../../hooks/useClock";
import { CommandSearch } from "../commands/CommandSearch";
import { QuickActions } from "../actions/QuickActions";
import { NotesReminders } from "../notes/NotesReminders";
import { Teleprompter } from "../teleprompter/Teleprompter";
import { ClipboardManager } from "../clipboard/ClipboardManager";
import { PomodoroTimer } from "../pomodoro/PomodoroTimer";
import { MediaControls } from "../media/MediaControls";
import { DropShelf } from "../shelf/DropShelf";
import { SettingsView } from "../settings/SettingsView";
import { ActiveModule, ActiveAppContext, DropItem, MediaInfo, PomodoroState, SystemStats, ClipboardItem } from "../../types";
import { cn } from "../../lib/utils";

export const Notch: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeModule, setActiveModule] = useState<ActiveModule>("dashboard");
  const activeModuleRef = useRef(activeModule);
  useEffect(() => {
    activeModuleRef.current = activeModule;
  }, [activeModule]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [shelfItems, setShelfItems] = useState<DropItem[]>([]);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [pomodoro, setPomodoro] = useState<PomodoroState | null>(null);
  const [copiedColorPill, setCopiedColorPill] = useState<string | null>(null);
  const [batteryStats, setBatteryStats] = useState<{ percent: number | null; isCharging: boolean | null }>({
    percent: null,
    isCharging: null,
  });

  const [context, setContext] = useState<ActiveAppContext>({
    process_name: "Desktop",
    window_title: "",
    category: "general",
    badge_label: "Desktop",
    quick_action: null,
  });
  const { formattedTime, formattedDate } = useClock();

  // Adjust native window height when expanding/collapsing or switching modules
  useEffect(() => {
    let targetHeight = 44;
    if (isExpanded) {
      targetHeight = 350;
    }
    invoke("set_notch_height", { logicalHeight: targetHeight }).catch(console.error);
  }, [isExpanded, activeModule]);

  // Center on mount flush to top bezel and ensure visible
  useEffect(() => {
    getCurrentWindow().show().catch(console.error);
    invoke("center_notch_top").catch(console.error);
  }, []);

  // Poll Active Windows App Context every 2.5s
  useEffect(() => {
    const fetchContext = () => {
      invoke<ActiveAppContext>("get_active_app_context")
        .then((ctx) => {
          if (ctx && ctx.process_name !== "tauri-app" && ctx.process_name !== "evry") {
            setContext(ctx);
          }
        })
        .catch(console.error);
    };

    fetchContext();
    const interval = setInterval(fetchContext, 2500);
    return () => clearInterval(interval);
  }, []);

  // Poll Media Info for Dynamic Island pill activity
  const fetchMedia = useCallback(() => {
    invoke<MediaInfo>("get_media_info")
      .then((info) => setMediaInfo(info))
      .catch(() => { });
  }, []);

  useEffect(() => {
    fetchMedia();
    const interval = setInterval(fetchMedia, 2000);
    return () => clearInterval(interval);
  }, [fetchMedia]);

  // Listen for Pomodoro ticks for Dynamic Island live countdown
  useEffect(() => {
    invoke<PomodoroState>("get_pomodoro_state")
      .then((s) => setPomodoro(s))
      .catch(() => { });

    const unlistenPromise = listen<PomodoroState>("pomodoro-tick", (event) => {
      setPomodoro(event.payload);
    });

    return () => {
      unlistenPromise.then((u) => u());
    };
  }, []);

  // Listen for global shortcut Alt+Space from Rust backend
  useEffect(() => {
    const unlistenPromise = listen("toggle-command-center", () => {
      setIsExpanded((prev) => {
        if (!prev) {
          setActiveModule("commands");
          return true;
        } else if (activeModule !== "commands") {
          setActiveModule("commands");
          return true;
        } else {
          return false;
        }
      });
    });

    const unlistenOpen = listen<string>("open-module", (e) => {
      if (e.payload === "settings") {
        setActiveModule("settings");
        setIsExpanded(true);
      }
    });

    const unlistenCollapse = listen("collapse-notch", () => {
      setIsExpanded(false);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
      unlistenOpen.then((u) => u());
      unlistenCollapse.then((u) => u());
    };
  }, [activeModule]);

  // Battery monitoring for Low Battery alert
  useEffect(() => {
    const pollBattery = () => {
      invoke<SystemStats>("get_system_stats")
        .then((stats) => {
          setBatteryStats({
            percent: stats.battery_percent,
            isCharging: stats.is_charging,
          });
        })
        .catch(() => {});
    };
    pollBattery();
    const interval = setInterval(pollBattery, 10000);
    return () => clearInterval(interval);
  }, []);

  // Listen for clipboard updates for live Copied Color Swatch pulse
  useEffect(() => {
    const unlisten = listen("clipboard-new-item", () => {
      invoke<ClipboardItem[]>("get_clipboard_history")
        .then((items) => {
          const latest = items[0];
          if (latest && latest.color_hex) {
            setCopiedColorPill(latest.color_hex);
            setTimeout(() => setCopiedColorPill(null), 3500);
          }
        })
        .catch(() => {});
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  // Load persistent Shelf Items from SQLite on mount
  useEffect(() => {
    invoke<DropItem[]>("get_shelf_items")
      .then((items) => setShelfItems(items))
      .catch(console.error);
  }, []);

  // Listen for native OS File Drag & Drop from Windows Explorer
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const registerDragDrop = async () => {
      try {
        const appWindow = getCurrentWindow();
        unlisten = await appWindow.onDragDropEvent(async (event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setIsDraggingOver(true);
          } else if (event.payload.type === "leave") {
            setIsDraggingOver(false);
          } else if (event.payload.type === "drop") {
            setIsDraggingOver(false);
            const paths = event.payload.paths;
            if (paths && paths.length > 0) {
              if (activeModuleRef.current === "clipboard") {
                try {
                  await invoke("drop_into_clipboard", { paths });
                } catch (err) {
                  console.error("Failed to drop into clipboard:", err);
                }
              } else {
                try {
                  const newItems = await invoke<DropItem[]>("process_dropped_paths", { paths });
                  if (newItems.length > 0) {
                    setShelfItems((prev) => [...newItems, ...prev]);
                    setActiveModule("shelf");
                    setIsExpanded(true);
                  }
                } catch (err) {
                  console.error("Failed to process dropped paths:", err);
                }
              }
            }
          }
        });
      } catch (err) {
        console.error("Failed to listen for native drag and drop:", err);
      }
    };

    registerDragDrop();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleStartDrag = () => {
    getCurrentWindow().startDragging().catch(console.error);
  };

  const handleOpenModule = (mod: ActiveModule) => {
    setActiveModule(mod);
    setIsExpanded(true);
  };

  const handleBackToDashboard = () => {
    setActiveModule("dashboard");
  };

  const handleTogglePlayPause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("media_play_pause");
      setTimeout(fetchMedia, 300);
    } catch (err) {
      console.error(err);
    }
  };

  // Drag and Drop handlers for the Drop Notch Shelf
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = () => {
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);

    // 1. Files dropped via HTML5
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const paths: string[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        // @ts-expect-error path is present in Tauri File object
        const filePath = file.path || "";
        if (filePath) {
          paths.push(filePath);
        }
      }
      if (paths.length > 0) {
        try {
          const newItems = await invoke<DropItem[]>("process_dropped_paths", { paths });
          if (newItems.length > 0) {
            setShelfItems((prev) => [...newItems, ...prev]);
            handleOpenModule("shelf");
          }
        } catch (err) {
          console.error("Failed to process dropped files:", err);
        }
      }
      return;
    }

    // 2. Text / URL dropped
    const text = e.dataTransfer.getData("text");
    if (text) {
      const isUrl = /^https?:\/\//i.test(text.trim());
      const newItem: DropItem = {
        id: `text_${Date.now()}`,
        name: isUrl ? text.trim() : text.slice(0, 30) + (text.length > 30 ? "..." : ""),
        path: isUrl ? text.trim() : null,
        text_content: text,
        item_kind: isUrl ? "url" : "text",
        size_bytes: text.length,
        child_count: null,
        partial: false,
        is_symlink: false,
        is_risky: false,
        from_internet: false,
        missing: false,
        created_at: Date.now(),
        modified_at: null,
        item_type: isUrl ? "url" : "text",
        size_formatted: `${text.length} chars`,
      };
      setShelfItems((prev) => [newItem, ...prev]);
      handleOpenModule("shelf");
    }
  };

  const handleRemoveShelfItem = (id: string) => {
    invoke("remove_shelf_item", { id }).catch(console.error);
    setShelfItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearShelf = () => {
    invoke("clear_shelf_items").catch(console.error);
    setShelfItems([]);
  };

  // Render Category Icon for Context Badge
  const renderContextIcon = () => {
    switch (context.category) {
      case "code":
        return <Code2 className="w-3 h-3 text-cyan-400" />;
      case "meeting":
        return <Video className="w-3 h-3 text-rose-400 animate-pulse" />;
      case "design":
        return <Palette className="w-3 h-3 text-purple-400" />;
      case "terminal":
        return <Terminal className="w-3 h-3 text-emerald-400" />;
      case "browser":
        return <Globe className="w-3 h-3 text-blue-400" />;
      default:
        return <span className="w-2 h-2 rounded-full bg-evry-accent animate-pulse" />;
    }
  };

  // Format pomodoro seconds
  const formatPomoTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="w-full flex flex-col items-center select-none"
    >
      {/* --- Main Hardware Notch Pill (Docks flush to top monitor bezel) --- */}
      <div
        className={cn(
          "w-[600px] h-[42px] bg-evry-bg/95 backdrop-blur-xl border border-t-0 border-white/10 rounded-b-2xl flex items-center justify-between px-3.5 shadow-2xl transition-all duration-200",
          isExpanded ? "rounded-b-none border-b-0 bg-evry-bg" : "hover:border-white/20",
          isDraggingOver && "border-evry-accent bg-evry-accent/15 shadow-glow"
        )}
      >
        {/* Left: Brand Identity & Drag Handle */}
        <div className="flex items-center space-x-2">
          {/* Logo badge with Dynamic Island context toggle */}
          <div
            onClick={() => {
              setActiveModule("dashboard");
              setIsExpanded(!isExpanded);
            }}
            className={cn(
              "flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full border cursor-pointer transition-all",
              context.category === "meeting"
                ? "bg-rose-500/10 border-rose-500/40 text-rose-300"
                : context.category === "code"
                  ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-300"
                  : "bg-evry-surface border-evry-border text-evry-text hover:border-evry-accent/40"
            )}
            title={`Active Context: ${context.badge_label}`}
          >
            {renderContextIcon()}
            <span className="text-[11px] font-bold tracking-wider">
              {context.category !== "general" ? context.badge_label : "EVRY"}
            </span>
          </div>

          {/* Native Drag zone */}
          <div
            onMouseDown={handleStartDrag}
            title="Drag to position"
            className="flex items-center cursor-grab active:cursor-grabbing text-evry-muted hover:text-evry-text px-1 py-1 rounded transition-colors"
          >
            <GripHorizontal className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Center: Dynamic Island Live Activities (Drop, Pomodoro, Media, or Clock) */}
        <div
          onMouseDown={handleStartDrag}
          className="flex-1 flex items-center justify-center space-x-2 cursor-grab active:cursor-grabbing px-2"
        >
          {isDraggingOver ? (
            /* Dragging State */
            <div className="flex items-center space-x-1.5 text-evry-accent font-semibold text-xs animate-bounce">
              <Inbox className="w-3.5 h-3.5" />
              <span>Drop file or text into Notch Shelf</span>
            </div>
          ) : copiedColorPill ? (
            /* Live Copied Color Swatch Pill */
            <div
              onClick={(e) => {
                e.stopPropagation();
                handleOpenModule("clipboard");
              }}
              className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-evry-surface border border-evry-border text-white cursor-pointer transition-all animate-bounce"
              title="Color Copied — Click to View Clipboard"
            >
              <div
                style={{ backgroundColor: copiedColorPill }}
                className="w-3 h-3 rounded-full border border-white/50 shadow-sm"
              />
              <span className="text-xs font-mono font-bold">{copiedColorPill}</span>
              <span className="text-[10px] text-evry-muted">Copied</span>
            </div>
          ) : batteryStats.percent !== null && batteryStats.percent <= 20 && !batteryStats.isCharging ? (
            /* Low Battery Warning Pill */
            <div
              onClick={(e) => {
                e.stopPropagation();
                handleOpenModule("actions");
              }}
              className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 cursor-pointer animate-pulse"
              title="Battery is low — click for system controls"
            >
              <BatteryWarning className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-mono font-bold">{batteryStats.percent}%</span>
              <span className="text-[10px] uppercase font-semibold text-amber-400/80">Low Battery</span>
            </div>
          ) : context.category === "meeting" ? (
            /* Auto Meeting Mode Indicator */
            <div
              onClick={(e) => {
                e.stopPropagation();
                handleOpenModule("teleprompter");
              }}
              className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/40 text-purple-300 hover:border-purple-400 cursor-pointer transition-all"
              title="Meeting Active — Click for Teleprompter"
            >
              <Video className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
              <span className="text-xs font-medium font-semibold">{context.badge_label}</span>
              <span className="text-[10px] text-purple-400/80 uppercase font-bold">Teleprompter</span>
            </div>
          ) : pomodoro && pomodoro.is_running ? (
            /* Pomodoro Live Activity in Pill */
            <div
              onClick={(e) => {
                e.stopPropagation();
                handleOpenModule("pomodoro");
              }}
              className="flex items-center space-x-2 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:border-emerald-400 cursor-pointer transition-all"
              title="Focus Timer Running — Click to View"
            >
              <Timer className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span className="text-xs font-mono font-bold">{formatPomoTime(pomodoro.remaining_secs)}</span>
              <span className="text-[10px] uppercase font-semibold text-emerald-400/80">
                {pomodoro.phase === "work" ? "Focus" : "Break"}
              </span>
            </div>
          ) : mediaInfo && mediaInfo.is_playing ? (
            /* Now Playing Media Activity in Pill */
            <div
              onClick={(e) => {
                e.stopPropagation();
                handleOpenModule("media");
              }}
              className="flex items-center space-x-2 px-2.5 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/40 text-purple-200 hover:border-purple-400 cursor-pointer transition-all max-w-[240px]"
              title={`Now Playing: ${mediaInfo.title || "Track"} — Click for controls`}
            >
              {/* Mini Audio Visualizer (3 pulsating bars) */}
              <div className="flex items-end space-x-0.5 h-3 flex-shrink-0">
                <span className="w-0.5 h-2.5 bg-purple-400 animate-pulse" />
                <span className="w-0.5 h-3 bg-purple-300 animate-pulse delay-75" />
                <span className="w-0.5 h-1.5 bg-purple-400 animate-pulse delay-150" />
              </div>

              <span className="text-[11px] font-medium truncate max-w-[120px]">
                {mediaInfo.title || "Playing"}
              </span>

              {/* Quick Play/Pause inside pill */}
              <button
                onClick={handleTogglePlayPause}
                className="w-4 h-4 rounded-full bg-purple-400/20 hover:bg-purple-400/40 flex items-center justify-center text-white flex-shrink-0 transition-colors"
                title="Pause audio"
              >
                <Pause className="w-2.5 h-2.5 fill-current" />
              </button>
            </div>
          ) : (
            /* Default Clock & Context */
            <>
              <span className="text-xs font-semibold text-evry-text tracking-wide">{formattedTime}</span>
              <span className="text-evry-border text-xs">•</span>
              <span className="text-xs text-evry-muted font-medium">{formattedDate}</span>
              {context.quick_action && (
                <>
                  <span className="text-evry-border text-xs hidden sm:inline">•</span>
                  <span className="text-[10px] text-cyan-400 font-mono hidden sm:inline truncate max-w-[130px]">
                    {context.quick_action}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        {/* Right: Quick glance Shelf button, Widgets & Expand toggle */}
        <div className="flex items-center space-x-1.5">
          {/* Drop Shelf Pill Button */}
          <button
            onClick={() => {
              if (isExpanded && activeModule === "shelf") {
                setIsExpanded(false);
              } else {
                handleOpenModule("shelf");
              }
            }}
            title="Drop Notch Shelf"
            className={cn(
              "h-7 px-2 rounded-full border text-xs flex items-center space-x-1 transition-all",
              shelfItems.length > 0
                ? "bg-evry-accent/20 border-evry-accent text-evry-accent font-semibold shadow-glow"
                : "bg-evry-surface border-evry-border text-evry-muted hover:text-white"
            )}
          >
            <Inbox className="w-3 h-3" />
            <span className="text-[10px]">{shelfItems.length}</span>
          </button>

          {/* Settings Button */}
          <button
            onClick={() => {
              if (isExpanded && activeModule === "settings") {
                setIsExpanded(false);
              } else {
                handleOpenModule("settings");
              }
            }}
            title="Settings & Preferences"
            className={cn(
              "w-7 h-7 flex items-center justify-center rounded-full bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-muted hover:text-evry-text transition-all",
              isExpanded && activeModule === "settings" && "border-evry-accent/40 text-evry-accent"
            )}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
          </button>

          {/* Expand/Collapse trigger */}
          <button
            onClick={() => {
              if (isExpanded) {
                setIsExpanded(false);
              } else {
                setActiveModule("dashboard");
                setIsExpanded(true);
              }
            }}
            title={isExpanded ? "Collapse notch" : "Expand notch"}
            className={cn(
              "w-7 h-7 flex items-center justify-center rounded-full bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-muted hover:text-evry-text transition-all",
              isExpanded && "rotate-180 bg-evry-accent/15 border-evry-accent/40 text-evry-accent"
            )}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* --- Unified Expanded Drawer Routing --- */}
      {isExpanded && (
        <div className="w-[600px] bg-evry-bg/95 backdrop-blur-xl border border-t-0 border-white/10 rounded-b-2xl shadow-2xl overflow-hidden">
          {activeModule === "commands" && (
            <CommandSearch onClose={() => setIsExpanded(false)} />
          )}

          {activeModule === "actions" && (
            <QuickActions onBack={handleBackToDashboard} />
          )}

          {activeModule === "notes" && (
            <NotesReminders onBack={handleBackToDashboard} />
          )}

          {activeModule === "teleprompter" && (
            <Teleprompter onBack={handleBackToDashboard} />
          )}

          {activeModule === "clipboard" && (
            <ClipboardManager onBack={handleBackToDashboard} />
          )}

          {activeModule === "pomodoro" && (
            <PomodoroTimer onBack={handleBackToDashboard} />
          )}

          {activeModule === "media" && (
            <MediaControls onBack={handleBackToDashboard} />
          )}

          {activeModule === "shelf" && (
            <DropShelf
              items={shelfItems}
              onRemoveItem={handleRemoveShelfItem}
              onClearAll={handleClearShelf}
              onBack={handleBackToDashboard}
              onItemsUpdated={(updated) => setShelfItems(updated)}
            />
          )}

          {activeModule === "settings" && (
            <SettingsView onBack={handleBackToDashboard} />
          )}

          {activeModule === "dashboard" && (
            <div className="h-[290px] p-3.5 flex flex-col justify-between animate-slideDown">
              {/* Quick Launch / Command Search Preview Bar */}
              <div
                onClick={() => handleOpenModule("commands")}
                className="w-full bg-evry-surface border border-evry-border hover:border-evry-accent/40 rounded-xl px-3 py-2 flex items-center justify-between transition-colors cursor-pointer group"
              >
                <div className="flex items-center space-x-2 text-evry-muted">
                  <Search className="w-3.5 h-3.5 group-hover:text-evry-accent transition-colors" />
                  <span className="text-xs font-medium group-hover:text-evry-text">
                    Search apps, files, math, dictionary, web...
                  </span>
                </div>
                <div className="flex items-center space-x-1 text-[9px] text-evry-muted font-mono bg-evry-bg px-2 py-0.5 rounded border border-evry-border group-hover:border-evry-accent/40">
                  <Command className="w-3 h-3" />
                  <span>ALT + SPACE</span>
                </div>
              </div>

              {/* Feature Modules Quick Access Grid — 8 tiles */}
              <div className="grid grid-cols-4 gap-2 my-1.5">
                <button
                  onClick={() => handleOpenModule("commands")}
                  className="flex flex-col items-center justify-center p-2 rounded-xl bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border hover:border-evry-accent/40 transition-all group"
                >
                  <div className="w-7 h-7 rounded-lg bg-evry-bg flex items-center justify-center text-evry-accent mb-1 border border-evry-border group-hover:border-evry-accent/30 group-hover:scale-105 transition-all">
                    <Command className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[11px] font-medium text-evry-text">Commands</span>
                  <span className="text-[9px] text-evry-muted">Alt + Space</span>
                </button>

                <button
                  onClick={() => handleOpenModule("shelf")}
                  className="flex flex-col items-center justify-center p-2 rounded-xl bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border hover:border-evry-accent/40 transition-all group"
                >
                  <div className="w-7 h-7 rounded-lg bg-evry-bg flex items-center justify-center text-amber-400 mb-1 border border-evry-border group-hover:border-amber-400/30 group-hover:scale-105 transition-all">
                    <Inbox className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[11px] font-medium text-evry-text">Drop Shelf</span>
                  <span className="text-[9px] text-evry-muted">{shelfItems.length} items</span>
                </button>

                <button
                  onClick={() => handleOpenModule("clipboard")}
                  className="flex flex-col items-center justify-center p-2 rounded-xl bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border hover:border-evry-accent/40 transition-all group"
                >
                  <div className="w-7 h-7 rounded-lg bg-evry-bg flex items-center justify-center text-orange-400 mb-1 border border-evry-border group-hover:border-orange-400/30 group-hover:scale-105 transition-all">
                    <ClipboardList className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[11px] font-medium text-evry-text">Clipboard</span>
                  <span className="text-[9px] text-evry-muted">History</span>
                </button>

                <button
                  onClick={() => handleOpenModule("pomodoro")}
                  className="flex flex-col items-center justify-center p-2 rounded-xl bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border hover:border-evry-accent/40 transition-all group"
                >
                  <div className="w-7 h-7 rounded-lg bg-evry-bg flex items-center justify-center text-emerald-400 mb-1 border border-evry-border group-hover:border-emerald-400/30 group-hover:scale-105 transition-all">
                    <Timer className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[11px] font-medium text-evry-text">Pomodoro</span>
                  <span className="text-[9px] text-evry-muted">Focus Mode</span>
                </button>

                <button
                  onClick={() => handleOpenModule("media")}
                  className="flex flex-col items-center justify-center p-2 rounded-xl bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border hover:border-evry-accent/40 transition-all group"
                >
                  <div className="w-7 h-7 rounded-lg bg-evry-bg flex items-center justify-center text-purple-400 mb-1 border border-evry-border group-hover:border-purple-400/30 group-hover:scale-105 transition-all">
                    <Music className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[11px] font-medium text-evry-text">Media</span>
                  <span className="text-[9px] text-evry-muted">Now Playing</span>
                </button>

                <button
                  onClick={() => handleOpenModule("actions")}
                  className="flex flex-col items-center justify-center p-2 rounded-xl bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border hover:border-evry-accent/40 transition-all group"
                >
                  <div className="w-7 h-7 rounded-lg bg-evry-bg flex items-center justify-center text-blue-400 mb-1 border border-evry-border group-hover:border-blue-400/30 group-hover:scale-105 transition-all">
                    <Sliders className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[11px] font-medium text-evry-text">Actions</span>
                  <span className="text-[9px] text-evry-muted">Controls</span>
                </button>

                <button
                  onClick={() => handleOpenModule("notes")}
                  className="flex flex-col items-center justify-center p-2 rounded-xl bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border hover:border-evry-accent/40 transition-all group"
                >
                  <div className="w-7 h-7 rounded-lg bg-evry-bg flex items-center justify-center text-cyan-400 mb-1 border border-evry-border group-hover:border-cyan-400/30 group-hover:scale-105 transition-all">
                    <FileText className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[11px] font-medium text-evry-text">Notes</span>
                  <span className="text-[9px] text-evry-muted">SQLite Local</span>
                </button>

                <button
                  onClick={() => handleOpenModule("teleprompter")}
                  className="flex flex-col items-center justify-center p-2 rounded-xl bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border hover:border-evry-accent/40 transition-all group"
                >
                  <div className="w-7 h-7 rounded-lg bg-evry-bg flex items-center justify-center text-rose-400 mb-1 border border-evry-border group-hover:border-rose-400/30 group-hover:scale-105 transition-all">
                    <Video className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[11px] font-medium text-evry-text">Prompter</span>
                  <span className="text-[9px] text-evry-muted">Distraction-Free</span>
                </button>
              </div>

              {/* Quick Status Footer */}
              <div className="flex items-center justify-between pt-1.5 border-t border-evry-border/60 text-xs text-evry-muted">
                <div className="flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-evry-accent" />
                  <span className="text-[10px]">
                    Context: <strong className="text-white font-medium">{context.badge_label}</strong>
                  </span>
                </div>
                <div className="flex items-center space-x-1.5 text-[10px] text-emerald-400 font-mono">
                  <Zap className="w-3 h-3" />
                  <span>Drop Shelf Active</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
