import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import {
  Pin,
  Trash2,
  ChevronLeft,
  Clipboard,
  X,
  Code,
  Globe,
  Mail,
  Palette,
  FileText,
  Pause,
  Play,
  CornerDownLeft,
  Image as ImageIcon,
  Copy,
  Check,
  Eye,
  Layers,
  GripVertical,
  PlusCircle,
} from "lucide-react";
import { ClipboardItem, ClipboardContentType, ClipboardImageDetails } from "../../types";
import { cn } from "../../lib/utils";

interface ClipboardManagerProps {
  onBack: () => void;
}

const DRAG_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAMUlEQVR42u3PMQEAAAzDsPn3bW4Z5AEReEnKq3m/AAAAAAAAAAAAAAAAAAAAAL8G8v8AAZfNqC8AAAAASUVORK5CYII=";

function formatRelativeTime(timestampMs: number): string {
  if (!timestampMs) return "Just now";
  const diffSec = Math.floor((Date.now() - timestampMs) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Module-level thumbnail cache to avoid re-fetching across re-renders
const globalImageCache = new Map<string, ClipboardImageDetails>();

export const ClipboardManager: React.FC<ClipboardManagerProps> = ({ onBack }) => {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [filterType, setFilterType] = useState<string>("all");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [previewImage, setPreviewImage] = useState<{
    details: ClipboardImageDetails;
    item: ClipboardItem;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [imageMap, setImageMap] = useState<Record<string, ClipboardImageDetails>>({});
  const [dropFeedback, setDropFeedback] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const history = await invoke<ClipboardItem[]>("get_clipboard_history");
      setItems(history);
      const paused = await invoke<boolean>("get_clipboard_pause_status");
      setIsPaused(paused);

      // Pre-fetch image details for any image items
      const imageItems = history.filter((i) => i.content_type === "image");
      imageItems.forEach(async (item) => {
        if (globalImageCache.has(item.content)) {
          setImageMap((prev) => ({ ...prev, [item.content]: globalImageCache.get(item.content)! }));
        } else {
          try {
            const details = await invoke<ClipboardImageDetails>("get_clipboard_image_details", {
              filePath: item.content,
            });
            globalImageCache.set(item.content, details);
            setImageMap((prev) => ({ ...prev, [item.content]: details }));
          } catch (e) {
            console.warn("Failed to load image details for:", item.content, e);
          }
        }
      });
    } catch (err) {
      console.error("Failed to load clipboard history:", err);
    }
  }, []);

  useEffect(() => {
    loadHistory();

    // Listen for new items added by watcher or drops
    let unlisten: (() => void) | null = null;
    listen("clipboard-new-item", () => {
      loadHistory();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadHistory]);

  // Counts for filter pills
  const counts = {
    all: items.length,
    image: items.filter((i) => i.content_type === "image").length,
    text: items.filter((i) => i.content_type === "text" || i.content_type === "code").length,
    color: items.filter((i) => i.content_type === "color").length,
    url: items.filter((i) => i.content_type === "url" || i.content_type === "email").length,
  };

  const filteredItems = items.filter((item) => {
    // Type filter
    if (filterType === "image" && item.content_type !== "image") return false;
    if (filterType === "text" && item.content_type !== "text" && item.content_type !== "code")
      return false;
    if (filterType === "color" && item.content_type !== "color") return false;
    if (filterType === "url" && item.content_type !== "url" && item.content_type !== "email")
      return false;
    return true;
  });

  const sortedItems = [...filteredItems].sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    return b.created_at - a.created_at;
  });

  const handlePaste = async (item: ClipboardItem) => {
    try {
      await invoke("paste_clipboard_item", { id: item.id });
    } catch (err) {
      console.error("Paste error:", err);
    }
  };

  const handleCopyOnly = async (item: ClipboardItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await invoke("copy_clipboard_item", { id: item.id });
      setCopiedId(item.id);
      setDropFeedback(item.content_type === "image" ? "Copied image to clipboard!" : "Copied to clipboard!");
      setTimeout(() => {
        setCopiedId(null);
        setDropFeedback(null);
      }, 1800);
    } catch (err) {
      console.error("Copy error:", err);
    }
  };

  const handlePin = async (item: ClipboardItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await invoke("pin_clipboard_item", { id: item.id, pinned: !item.is_pinned });
      await loadHistory();
    } catch (err) {
      console.error("Pin error:", err);
    }
  };

  const handleDelete = async (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await invoke("delete_clipboard_item", { id });
      await loadHistory();
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const handleClear = async () => {
    try {
      await invoke("clear_clipboard_history");
      await loadHistory();
    } catch (err) {
      console.error("Clear error:", err);
    }
  };

  const handleTogglePause = async () => {
    try {
      const next = await invoke<boolean>("toggle_clipboard_pause");
      setIsPaused(next);
    } catch (err) {
      console.error("Toggle pause error:", err);
    }
  };

  // -------------------------------------------------------------------------------------------------
  // Drag OUT of Clipboard into other applications (Explorer, Discord, Slack, VS Code, etc.)
  // -------------------------------------------------------------------------------------------------
  const handleMouseDown = (e: React.MouseEvent) => {
    dragStartPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = async (e: React.MouseEvent, item: ClipboardItem) => {
    if (!dragStartPos.current) return;
    const dx = Math.abs(e.clientX - dragStartPos.current.x);
    const dy = Math.abs(e.clientY - dragStartPos.current.y);

    if (dx > 5 || dy > 5) {
      dragStartPos.current = null;
      try {
        const paths = await invoke<string[]>("prepare_clipboard_drag_items", {
          ids: [item.id],
        });

        if (paths.length > 0) {
          window.__isDraggingActive = true;
          try {
            const dragIcon =
              item.content_type === "image" && imageMap[item.content]?.data_url
                ? imageMap[item.content].data_url
                : DRAG_ICON_DATA_URL;

            await startDrag({
              item: paths,
              icon: dragIcon,
            });
          } finally {
            setTimeout(() => {
              window.__isDraggingActive = false;
            }, 300);
          }
        }
      } catch (err) {
        window.__isDraggingActive = false;
        console.log("Drag out finished or cancelled:", err);
      }
    }
  };

  const handleMouseUp = () => {
    dragStartPos.current = null;
  };

  // -------------------------------------------------------------------------------------------------
  // Drop INTO Clipboard (Drop images, files, or text snippets directly here)
  // -------------------------------------------------------------------------------------------------
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const paths: string[] = [];
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        // @ts-expect-error path is present in Tauri File object
        const p = file.path || "";
        if (p) paths.push(p);
      }
    }

    const text = e.dataTransfer.getData("text/plain");

    if (paths.length > 0 || text) {
      try {
        await invoke("drop_into_clipboard", {
          paths: paths.length > 0 ? paths : undefined,
          text: text || undefined,
        });
        await loadHistory();
        setDropFeedback("Added to Clipboard History!");
        setTimeout(() => setDropFeedback(null), 2500);
      } catch (err) {
        console.error("Drop into clipboard failed:", err);
      }
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (previewImage) {
      if (e.key === "Escape") {
        setPreviewImage(null);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev + 1 < sortedItems.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : sortedItems.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (sortedItems[focusedIndex]) {
        handlePaste(sortedItems[focusedIndex]);
      }
    } else if (e.key === "Delete") {
      e.preventDefault();
      if (sortedItems[focusedIndex]) {
        handleDelete(sortedItems[focusedIndex].id);
      }
    }
  };

  const renderTypeIcon = (type: ClipboardContentType) => {
    switch (type) {
      case "image":
        return <ImageIcon className="w-3.5 h-3.5 text-purple-400" />;
      case "color":
        return <Palette className="w-3.5 h-3.5 text-pink-400" />;
      case "url":
        return <Globe className="w-3.5 h-3.5 text-blue-400" />;
      case "email":
        return <Mail className="w-3.5 h-3.5 text-amber-400" />;
      case "code":
        return <Code className="w-3.5 h-3.5 text-emerald-400" />;
      default:
        return <FileText className="w-3.5 h-3.5 text-evry-muted" />;
    }
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      tabIndex={0}
      className={cn(
        "w-full flex flex-col h-[440px] bg-evry-bg rounded-b-2xl animate-slideDown overflow-hidden p-4 relative focus:outline-none transition-colors",
        isDraggingOver && "ring-2 ring-evry-accent ring-inset bg-evry-surface/70"
      )}
    >
      {/* Drop into Clipboard Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 bg-evry-bg/90 backdrop-blur-md z-40 border-2 border-dashed border-evry-accent rounded-b-2xl flex flex-col items-center justify-center p-6 space-y-2 animate-fadeIn pointer-events-none">
          <div className="w-12 h-12 rounded-2xl bg-evry-accent/20 border border-evry-accent/40 flex items-center justify-center text-evry-accent animate-bounce">
            <PlusCircle className="w-6 h-6" />
          </div>
          <p className="text-xs font-semibold text-white">Drop into Clipboard History</p>
          <p className="text-[11px] text-evry-muted text-center max-w-[280px]">
            Release images, files, or text snippets to save them directly to your clipboard.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-evry-border">
        <div className="flex items-center space-x-2">
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-lg bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border flex items-center justify-center text-evry-muted hover:text-evry-text transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center space-x-1.5">
            <Clipboard className="w-4 h-4 text-evry-accent" />
            <span className="text-xs font-semibold text-evry-text tracking-wide">
              Clipboard History ({items.length})
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {dropFeedback && (
            <span className="text-[11px] text-emerald-400 font-medium px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 animate-fadeIn">
              {dropFeedback}
            </span>
          )}

          <button
            onClick={handleTogglePause}
            className={cn(
              "px-2 py-1 rounded-lg border text-[11px] font-medium flex items-center space-x-1 transition-all",
              isPaused
                ? "bg-amber-500/10 border-amber-500/40 text-amber-400"
                : "bg-evry-surface border-evry-border text-evry-muted hover:text-white"
            )}
            title={isPaused ? "Resume Clipboard Capture" : "Pause Clipboard Capture"}
          >
            {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            <span>{isPaused ? "Paused" : "Active"}</span>
          </button>

          {items.some((i) => !i.is_pinned) && (
            <button
              onClick={handleClear}
              className="text-[11px] text-rose-400 hover:text-rose-300 transition-colors flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-rose-500/10"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="py-2.5 flex items-center space-x-1.5 overflow-x-auto no-scrollbar text-[11px]">
        <button
          onClick={() => setFilterType("all")}
          className={cn(
            "px-2 py-0.5 rounded-lg border transition-all flex items-center space-x-1 font-medium",
            filterType === "all"
              ? "bg-evry-accent/20 border-evry-accent/50 text-evry-accent"
              : "bg-evry-surface/60 border-evry-border text-evry-muted hover:text-white"
          )}
        >
          <Layers className="w-3 h-3" />
          <span>All</span>
          <span className="text-[10px] opacity-70">({counts.all})</span>
        </button>

          <button
            onClick={() => setFilterType("image")}
            className={cn(
              "px-2 py-0.5 rounded-lg border transition-all flex items-center space-x-1 font-medium",
              filterType === "image"
                ? "bg-purple-500/20 border-purple-500/50 text-purple-300"
                : "bg-evry-surface/60 border-evry-border text-evry-muted hover:text-white"
            )}
          >
            <ImageIcon className="w-3 h-3 text-purple-400" />
            <span>Images</span>
            <span className="text-[10px] opacity-70">({counts.image})</span>
          </button>

          <button
            onClick={() => setFilterType("text")}
            className={cn(
              "px-2 py-0.5 rounded-lg border transition-all flex items-center space-x-1 font-medium",
              filterType === "text"
                ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                : "bg-evry-surface/60 border-evry-border text-evry-muted hover:text-white"
            )}
          >
            <FileText className="w-3 h-3 text-emerald-400" />
            <span>Text</span>
            <span className="text-[10px] opacity-70">({counts.text})</span>
          </button>

          <button
            onClick={() => setFilterType("color")}
            className={cn(
              "px-2 py-0.5 rounded-lg border transition-all flex items-center space-x-1 font-medium",
              filterType === "color"
                ? "bg-pink-500/20 border-pink-500/50 text-pink-300"
                : "bg-evry-surface/60 border-evry-border text-evry-muted hover:text-white"
            )}
          >
            <Palette className="w-3 h-3 text-pink-400" />
            <span>Colors</span>
            <span className="text-[10px] opacity-70">({counts.color})</span>
          </button>

          <button
            onClick={() => setFilterType("url")}
            className={cn(
              "px-2 py-0.5 rounded-lg border transition-all flex items-center space-x-1 font-medium",
              filterType === "url"
                ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                : "bg-evry-surface/60 border-evry-border text-evry-muted hover:text-white"
            )}
          >
            <Globe className="w-3 h-3 text-blue-400" />
            <span>Links</span>
            <span className="text-[10px] opacity-70">({counts.url})</span>
          </button>
        </div>

      {/* Clips List */}
      <div ref={listRef} className="flex-1 min-h-0 evry-scroll space-y-1.5 py-1">
        {sortedItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-1.5 text-evry-muted">
            <Clipboard className="w-6 h-6 opacity-40 mb-1" />
            <p className="text-xs text-evry-text font-medium">No clipboard items found</p>
            <p className="text-[11px]">
              Drag and drop files, screenshots, or text here, or copy anything in Windows.
            </p>
          </div>
        ) : (
          sortedItems.map((item, index) => {
            const isFocused = index === focusedIndex;
            const isImage = item.content_type === "image";
            const imgDetails = isImage ? imageMap[item.content] : null;

            return (
              <div
                key={item.id}
                onClick={() => handleCopyOnly(item)}
                onDoubleClick={() => handlePaste(item)}
                onMouseDown={handleMouseDown}
                onMouseMove={(e) => handleMouseMove(e, item)}
                onMouseUp={handleMouseUp}
                onMouseEnter={() => setFocusedIndex(index)}
                className={cn(
                  "p-2.5 rounded-xl border flex items-center justify-between transition-all cursor-pointer group relative select-none",
                  isFocused
                    ? "bg-evry-surface border-evry-borderLight shadow-sm"
                    : "bg-evry-surface/40 border-evry-border hover:bg-evry-surface hover:border-evry-borderLight",
                  item.is_pinned && "border-l-2 border-l-evry-accent"
                )}
              >
                {/* Drag Grip Handle */}
                <div
                  className="pr-1 text-evry-muted/40 group-hover:text-evry-muted transition-colors cursor-grab active:cursor-grabbing flex-shrink-0"
                  title="Drag out to Discord, Slack, Explorer, VS Code, or Desktop"
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </div>

                <div className="flex items-center space-x-3 min-w-0 flex-1">
                  {/* Thumbnail / Swatch / Type Icon */}
                  {isImage ? (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        if (imgDetails) setPreviewImage({ details: imgDetails, item });
                      }}
                      className="w-12 h-12 rounded-lg bg-evry-bg border border-white/10 overflow-hidden flex-shrink-0 relative group/img cursor-zoom-in"
                      title="Click to preview full image"
                    >
                      {imgDetails ? (
                        <>
                          <img
                            src={imgDetails.data_url}
                            alt="Clipboard Screenshot"
                            className="w-full h-full object-cover pointer-events-none"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 flex items-center justify-center transition-opacity">
                            <Eye className="w-3.5 h-3.5 text-white" />
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center animate-pulse bg-white/5">
                          <ImageIcon className="w-4 h-4 text-purple-400" />
                        </div>
                      )}
                    </div>
                  ) : item.color_hex ? (
                    <div
                      className="w-7 h-7 rounded-lg border border-white/20 flex-shrink-0 shadow-sm"
                      style={{ backgroundColor: item.color_hex }}
                      title={`Color: ${item.color_hex}`}
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-lg bg-evry-bg border border-evry-border flex items-center justify-center flex-shrink-0">
                      {renderTypeIcon(item.content_type)}
                    </div>
                  )}

                  {/* Content Info */}
                  <div className="min-w-0 flex-1">
                    {isImage ? (
                      <div className="space-y-0.5">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs text-evry-text font-medium">Screenshot / Image</span>
                          {imgDetails && (
                            <span className="text-[10px] font-mono text-purple-300 bg-purple-500/10 px-1 rounded border border-purple-500/20">
                              {imgDetails.width}×{imgDetails.height}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 text-[10px] text-evry-muted">
                          {imgDetails && <span>{formatFileSize(imgDetails.size_bytes)}</span>}
                          <span>•</span>
                          <span>PNG on disk</span>
                          <span>•</span>
                          <span>{formatRelativeTime(item.created_at)}</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="text-xs text-evry-text font-medium truncate block">
                          {item.content.length > 90 ? item.content.slice(0, 90) + "..." : item.content}
                        </span>
                        <div className="flex items-center space-x-2 text-[10px] text-evry-muted mt-0.5">
                          <span className="capitalize">{item.content_type}</span>
                          {item.color_hex && (
                            <span className="font-mono text-pink-300">{item.color_hex}</span>
                          )}
                          <span>•</span>
                          <span>{formatRelativeTime(item.created_at)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center space-x-1.5 pl-2">
                  {isFocused && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePaste(item);
                      }}
                      title="Paste directly into previous window (Enter)"
                      className="flex items-center space-x-1 text-[10px] text-evry-accent hover:text-white bg-evry-accent/15 hover:bg-evry-accent px-2 py-1 rounded-lg border border-evry-accent/30 font-medium transition-all"
                    >
                      <span>Paste</span>
                      <CornerDownLeft className="w-3 h-3" />
                    </button>
                  )}

                  {/* Copy Button */}
                  <button
                    onClick={(e) => handleCopyOnly(item, e)}
                    title={isImage ? "Copy image to clipboard" : "Copy to clipboard"}
                    className={cn(
                      "p-1.5 rounded-lg border transition-all",
                      copiedId === item.id
                        ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                        : "bg-evry-bg border-evry-border text-evry-muted hover:text-white"
                    )}
                  >
                    {copiedId === item.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </button>

                  {/* Pin Button */}
                  <button
                    onClick={(e) => handlePin(item, e)}
                    title={item.is_pinned ? "Unpin clip" : "Pin clip"}
                    className={cn(
                      "p-1.5 rounded-lg border transition-colors",
                      item.is_pinned
                        ? "bg-evry-accent/20 border-evry-accent/40 text-evry-accent"
                        : "bg-evry-bg border-evry-border text-evry-muted hover:text-white"
                    )}
                  >
                    <Pin className="w-3 h-3" />
                  </button>

                  {/* Delete Button */}
                  <button
                    onClick={(e) => handleDelete(item.id, e)}
                    title="Delete clip"
                    className="p-1.5 rounded-lg bg-evry-bg hover:bg-rose-500/20 border border-evry-border text-evry-muted hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Nav Bar */}
      <div className="pt-2 border-t border-evry-border/60 flex items-center justify-between text-[10px] text-evry-muted">
        <div className="flex items-center space-x-3">
          <span>
            <kbd className="px-1 py-0.5 bg-evry-surface rounded border border-evry-border font-mono text-[9px]">
              Click
            </kbd>{" "}
            Copy
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-evry-surface rounded border border-evry-border font-mono text-[9px]">
              ↵
            </kbd>{" "}
            Paste
          </span>
          <span className="text-purple-300">
            <span className="font-semibold">Drag out</span> to any app
          </span>
        </div>
        <span className="font-mono text-purple-400">Native Windows OLE Drag & Drop</span>
      </div>

      {/* Full Image Preview Modal */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex flex-col items-center justify-center p-4 animate-fadeIn"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-[540px] max-h-[90%] bg-evry-surface border border-evry-borderLight rounded-2xl p-4 shadow-2xl flex flex-col space-y-3 animate-scaleUp"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-2 border-b border-evry-border">
              <div className="flex items-center space-x-2">
                <ImageIcon className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-semibold text-white">Image Preview</span>
                <span className="text-[10px] font-mono text-evry-muted">
                  ({previewImage.details.width} × {previewImage.details.height} px,{" "}
                  {formatFileSize(previewImage.details.size_bytes)})
                </span>
              </div>
              <button
                onClick={() => setPreviewImage(null)}
                className="w-6 h-6 rounded-lg bg-evry-bg hover:bg-white/10 flex items-center justify-center text-evry-muted hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Modal Image Display */}
            <div className="flex-1 min-h-0 max-h-[250px] overflow-auto flex items-center justify-center bg-black/40 rounded-xl p-2 border border-evry-border">
              <img
                src={previewImage.details.data_url}
                alt="Clipboard Preview"
                className="max-w-full max-h-full object-contain rounded-lg pointer-events-none"
              />
            </div>

            {/* Modal Footer Actions */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-evry-muted">
                {formatRelativeTime(previewImage.item.created_at)}
              </span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleCopyOnly(previewImage.item)}
                  className="px-3 py-1.5 rounded-xl bg-evry-bg hover:bg-evry-surfaceHover border border-evry-border text-xs text-white flex items-center space-x-1.5 transition-colors font-medium"
                >
                  <Copy className="w-3 h-3 text-evry-muted" />
                  <span>Copy Image</span>
                </button>
                <button
                  onClick={() => {
                    handlePaste(previewImage.item);
                    setPreviewImage(null);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-evry-accent hover:bg-evry-accent/90 text-white text-xs flex items-center space-x-1.5 transition-colors font-medium shadow-sm"
                >
                  <CornerDownLeft className="w-3 h-3" />
                  <span>Paste into App</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
