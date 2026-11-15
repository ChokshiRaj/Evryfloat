import React, { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { QRCodeSVG } from "qrcode.react";
import {
  ChevronLeft,
  Inbox,
  File,
  Folder,
  Image as ImageIcon,
  ExternalLink,
  Trash2,
  Copy,
  FolderOpen,
  ClipboardCheck,
  Send,
  Video,
  Music,
  Archive,
  Code2,
  FileText,
  Globe,
  AlertTriangle,
  GripVertical,
  CheckSquare,
  Square,
  FileArchive,
  Type,
  Smartphone,
  Wand2,
  X,
  Share2,
} from "lucide-react";
import { DropItem, ItemKind, LanShareInfo } from "../../types";
import { cn } from "../../lib/utils";

interface DropShelfProps {
  items: DropItem[];
  onRemoveItem: (id: string) => void;
  onClearAll: () => void;
  onBack: () => void;
  onItemsUpdated?: (items: DropItem[]) => void;
}

// 1x1 transparent PNG data URL fallback for drag icon
const DRAG_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAMUlEQVR42u3PMQEAAAzDsPn3bW4Z5AEReEnKq3m/AAAAAAAAAAAAAAAAAAAAAL8G8v8AAZfNqC8AAAAASUVORK5CYII=";

export const DropShelf: React.FC<DropShelfProps> = ({
  items,
  onRemoveItem,
  onClearAll,
  onBack,
  onItemsUpdated,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [lanShareModal, setLanShareModal] = useState<LanShareInfo | null>(null);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameMode, setRenameMode] = useState<"lowercase" | "kebab" | "timestamp" | "replace">("kebab");
  const [renameReplaceParam, setRenameReplaceParam] = useState("");
  const [activeImageConvertItem, setActiveImageConvertItem] = useState<DropItem | null>(null);

  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  };

  const handleOpenItem = (id: string, path: string | null) => {
    invoke("open_shelf_item", { id, path }).catch((err) => {
      console.warn("Open item prevented or declined:", err);
    });
  };

  const handleShowInExplorer = (id: string, path: string | null) => {
    invoke("show_in_folder", { id, path }).catch(console.error);
  };

  const handleCopyPath = (path: string | null) => {
    if (!path) return;
    navigator.clipboard.writeText(path);
    setCopyFeedback("Path copied");
    setTimeout(() => setCopyFeedback(null), 1500);
  };

  const handleCopyFilesToClipboard = async () => {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : items.map((i) => i.id);
    if (ids.length === 0) return;

    try {
      await invoke("copy_items_to_clipboard", { ids });
      setCopyFeedback(`${ids.length} item(s) copied (ready for Ctrl+V)`);
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch (err) {
      console.error("Failed to copy items:", err);
    }
  };

  const handlePasteToActiveApp = async () => {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : items.map((i) => i.id);
    if (ids.length === 0) return;

    try {
      await invoke("paste_items", { ids });
    } catch (err) {
      console.error("Failed to paste items:", err);
    }
  };

  // 1. Batch Compress to .zip
  const handleCompressToZip = async () => {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : items.map((i) => i.id);
    if (ids.length === 0) return;

    try {
      setCopyFeedback("Compressing archive...");
      const newZip = await invoke<DropItem>("compress_shelf_items", { ids });
      setCopyFeedback(`Created '${newZip.name}' in shelf!`);
      if (onItemsUpdated) {
        onItemsUpdated([newZip, ...items]);
      }
      setSelectedIds(new Set());
      setTimeout(() => setCopyFeedback(null), 2500);
    } catch (err) {
      setCopyFeedback(`Zip failed: ${err}`);
      setTimeout(() => setCopyFeedback(null), 3000);
    }
  };

  // 2. Batch Rename
  const handleExecuteBatchRename = async () => {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : items.map((i) => i.id);
    if (ids.length === 0) return;

    try {
      const updated = await invoke<DropItem[]>("batch_rename_shelf_items", {
        ids,
        mode: renameMode,
        param: renameMode === "replace" ? renameReplaceParam : undefined,
      });

      const updatedMap = new Map(updated.map((u) => [u.id, u]));
      const refreshed = items.map((i) => updatedMap.get(i.id) || i);
      if (onItemsUpdated) onItemsUpdated(refreshed);

      setShowRenameModal(false);
      setCopyFeedback(`Renamed ${updated.length} item(s)!`);
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch (err) {
      setCopyFeedback(`Rename failed: ${err}`);
      setTimeout(() => setCopyFeedback(null), 3000);
    }
  };

  // 3. Image Conversion & EXIF Stripping
  const handleConvertImage = async (format: string, stripExif: boolean) => {
    if (!activeImageConvertItem) return;
    try {
      setCopyFeedback(`Converting to ${format.toUpperCase()} (EXIF stripped)...`);
      const converted = await invoke<DropItem>("convert_image", {
        id: activeImageConvertItem.id,
        targetFormat: format,
        stripExif,
      });

      if (onItemsUpdated) {
        onItemsUpdated([converted, ...items]);
      }
      setActiveImageConvertItem(null);
      setCopyFeedback(`Converted '${converted.name}' added to shelf!`);
      setTimeout(() => setCopyFeedback(null), 2500);
    } catch (err) {
      setCopyFeedback(`Conversion failed: ${err}`);
      setTimeout(() => setCopyFeedback(null), 3000);
    }
  };

  // 4. Local LAN QR Share ("Send to Phone")
  const handleStartLanShare = async (id: string) => {
    try {
      const info = await invoke<LanShareInfo>("start_lan_share", { id });
      setLanShareModal(info);
    } catch (err) {
      setCopyFeedback(`LAN Share failed: ${err}`);
      setTimeout(() => setCopyFeedback(null), 3000);
    }
  };

  const handleCloseLanShare = async () => {
    try {
      await invoke("stop_lan_share");
    } catch {}
    setLanShareModal(null);
  };

  // Native OLE drag out into Explorer, VS Code, Discord, Browser, etc.
  const handleMouseDown = (e: React.MouseEvent, item: DropItem) => {
    if (item.missing) return;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = async (e: React.MouseEvent, item: DropItem) => {
    if (!dragStartPos.current) return;
    const dx = Math.abs(e.clientX - dragStartPos.current.x);
    const dy = Math.abs(e.clientY - dragStartPos.current.y);

    if (dx > 5 || dy > 5) {
      dragStartPos.current = null;
      try {
        const idsToDrag = selectedIds.has(item.id)
          ? Array.from(selectedIds)
          : [item.id];

        const preparedPaths: string[] = [];
        for (const id of idsToDrag) {
          try {
            const path = await invoke<string>("prepare_drag_item", { id });
            preparedPaths.push(path);
          } catch (err) {
            console.error("Failed to prepare drag item:", err);
          }
        }

        if (preparedPaths.length > 0) {
          window.__isDraggingActive = true;
          try {
            await startDrag({
              item: preparedPaths,
              icon: DRAG_ICON_DATA_URL,
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

  const formatSize = (item: DropItem) => {
    if (item.size_formatted) return item.size_formatted;
    if (item.size_bytes !== null && item.size_bytes !== undefined) {
      const b = item.size_bytes;
      if (b < 1024) return `${b} B`;
      if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
      return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (item.child_count !== null && item.child_count !== undefined) {
      return `${item.child_count} items`;
    }
    return "Unknown size";
  };

  const renderKindIcon = (kind: ItemKind | string) => {
    switch (kind) {
      case "folder":
        return <Folder className="w-4 h-4 text-amber-400" />;
      case "image":
        return <ImageIcon className="w-4 h-4 text-emerald-400" />;
      case "video":
        return <Video className="w-4 h-4 text-purple-400" />;
      case "audio":
        return <Music className="w-4 h-4 text-pink-400" />;
      case "archive":
        return <Archive className="w-4 h-4 text-yellow-500" />;
      case "code":
        return <Code2 className="w-4 h-4 text-cyan-400" />;
      case "document":
        return <FileText className="w-4 h-4 text-blue-400" />;
      case "url":
        return <Globe className="w-4 h-4 text-indigo-400" />;
      default:
        return <File className="w-4 h-4 text-evry-muted" />;
    }
  };

  return (
    <div className="w-full flex flex-col h-[410px] bg-evry-bg rounded-b-2xl animate-slideDown overflow-hidden p-3.5 relative">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-evry-border">
        <div className="flex items-center space-x-2">
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-lg bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border flex items-center justify-center text-evry-muted hover:text-evry-text transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center space-x-1.5">
            <span className="text-xs font-semibold text-evry-text">Holding Shelf</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-evry-surface border border-evry-border text-evry-accent">
              {items.length}
            </span>
          </div>

          {items.length > 0 && (
            <button
              onClick={handleSelectAll}
              className="text-[10px] text-evry-muted hover:text-white px-1.5 py-0.5 rounded bg-evry-surface border border-evry-border transition-colors ml-1"
            >
              {selectedIds.size === items.length ? "Deselect All" : "Select All"}
            </button>
          )}
        </div>

        {/* Global Shelf Actions */}
        <div className="flex items-center space-x-1">
          {items.length > 0 && (
            <>
              <button
                onClick={handleCopyFilesToClipboard}
                title="Copy to Windows clipboard as files (Ctrl+C)"
                className="px-2 py-1 rounded-lg bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-[11px] text-evry-muted hover:text-white transition-colors flex items-center space-x-1"
              >
                <Copy className="w-3 h-3 text-evry-accent" />
                <span>Copy</span>
              </button>

              <button
                onClick={handlePasteToActiveApp}
                title="Paste files to active window (switches focus + Ctrl+V)"
                className="px-2.5 py-1 rounded-lg bg-evry-accent hover:bg-evry-accentHover text-white text-[11px] font-semibold transition-colors flex items-center space-x-1 shadow-sm active:scale-95"
              >
                <Send className="w-3 h-3" />
                <span>Paste</span>
              </button>

              <button
                onClick={onClearAll}
                className="p-1 rounded-lg bg-evry-surface hover:bg-rose-500/20 text-evry-muted hover:text-rose-400 transition-colors"
                title="Clear entire shelf"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Productivity Quick Action Toolbar (Compress, Rename, LAN Share) */}
      {items.length > 0 && (
        <div className="flex items-center justify-between py-1.5 px-2 bg-evry-surface/70 border border-evry-border rounded-xl mt-2 text-[10px]">
          <span className="text-evry-muted font-medium">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Quick Tools:"}
          </span>
          <div className="flex items-center space-x-1">
            <button
              onClick={handleCompressToZip}
              title="Compress selected into a .zip archive"
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-evry-bg hover:bg-evry-surface border border-evry-border text-yellow-400 hover:text-yellow-300 transition-colors font-medium"
            >
              <FileArchive className="w-3 h-3" />
              <span>Zip</span>
            </button>

            <button
              onClick={() => setShowRenameModal(true)}
              title="Batch rename selected files"
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-evry-bg hover:bg-evry-surface border border-evry-border text-cyan-400 hover:text-cyan-300 transition-colors font-medium"
            >
              <Type className="w-3 h-3" />
              <span>Rename</span>
            </button>

            {items.some((i) => i.item_kind === "image") && (
              <button
                onClick={() => {
                  const firstImg = items.find((i) => i.item_kind === "image");
                  if (firstImg) setActiveImageConvertItem(firstImg);
                }}
                title="Convert and strip EXIF from image"
                className="flex items-center space-x-1 px-2 py-0.5 rounded bg-evry-bg hover:bg-evry-surface border border-evry-border text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
              >
                <Wand2 className="w-3 h-3" />
                <span>Clean Image</span>
              </button>
            )}

            <button
              onClick={() => {
                const first = items[0];
                if (first) handleStartLanShare(first.id);
              }}
              title="Send to phone via temporary local QR code"
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-evry-bg hover:bg-evry-surface border border-evry-border text-purple-400 hover:text-purple-300 transition-colors font-medium"
            >
              <Smartphone className="w-3 h-3" />
              <span>Send to Phone</span>
            </button>
          </div>
        </div>
      )}

      {/* Optional feedback banner */}
      {copyFeedback && (
        <div className="py-1 px-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-[10px] text-emerald-400 flex items-center space-x-1.5 mt-2 animate-fadeIn">
          <ClipboardCheck className="w-3 h-3" />
          <span>{copyFeedback}</span>
        </div>
      )}

      {/* Main Items Area */}
      <div className="flex-1 min-h-0 evry-scroll py-2 space-y-2">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-evry-surface border border-evry-border flex items-center justify-center text-evry-accent">
              <Inbox className="w-6 h-6 animate-bounce" />
            </div>
            <p className="text-xs font-medium text-evry-text">Your Holding Shelf is Empty</p>
            <p className="text-[11px] text-evry-muted max-w-[280px]">
              Drag any file, folder, image, or text from Windows directly onto the top notch pill to hold it here.
            </p>
          </div>
        ) : (
          items.map((item) => {
            const isSelected = selectedIds.has(item.id);
            return (
              <div
                key={item.id}
                onMouseDown={(e) => handleMouseDown(e, item)}
                onMouseMove={(e) => handleMouseMove(e, item)}
                onMouseUp={handleMouseUp}
                className={cn(
                  "p-2.5 rounded-xl border flex items-center justify-between transition-all group shadow-sm select-none",
                  isSelected
                    ? "bg-evry-surface border-evry-accent/60 shadow-glow"
                    : "bg-evry-surface/70 border-evry-border hover:border-evry-accent/40",
                  item.missing && "opacity-50 border-rose-500/30"
                )}
              >
                <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                  <button
                    onClick={(e) => toggleSelect(item.id, e)}
                    className="text-evry-muted hover:text-white flex-shrink-0"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-evry-accent" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>

                  <div className="w-8 h-8 rounded-lg bg-evry-bg border border-evry-border flex items-center justify-center flex-shrink-0">
                    {renderKindIcon(item.item_kind)}
                  </div>

                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs font-medium text-evry-text truncate block">
                        {item.name}
                      </span>

                      {item.is_risky && (
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center space-x-0.5">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          <span>Exec</span>
                        </span>
                      )}

                      {item.from_internet && (
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                          Web
                        </span>
                      )}

                      {item.is_symlink && (
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          Link
                        </span>
                      )}

                      {item.missing && (
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                          Missing
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 text-[10px] text-evry-muted mt-0.5">
                      <span>{formatSize(item)}</span>
                      {item.partial && <span className="text-amber-400 font-mono">(partial)</span>}
                      {item.text_content && (
                        <span className="truncate max-w-[200px] italic opacity-80">
                          "{item.text_content.slice(0, 40)}"
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center space-x-1 pl-2">
                  {item.path && !item.missing && (
                    <>
                      <button
                        onClick={() => handleStartLanShare(item.id)}
                        title="Share to phone via local Wi-Fi QR"
                        className="p-1.5 rounded-lg bg-evry-bg hover:bg-evry-surface border border-evry-border text-purple-400 hover:text-purple-300 transition-colors"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleOpenItem(item.id, item.path)}
                        title="Open item (verifies security)"
                        className="p-1.5 rounded-lg bg-evry-bg hover:bg-evry-surface border border-evry-border text-evry-muted hover:text-white transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleShowInExplorer(item.id, item.path)}
                        title="Locate in File Explorer"
                        className="p-1.5 rounded-lg bg-evry-bg hover:bg-evry-surface border border-evry-border text-evry-muted hover:text-white transition-colors"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleCopyPath(item.path)}
                        title="Copy absolute path"
                        className="p-1.5 rounded-lg bg-evry-bg hover:bg-evry-surface border border-evry-border text-evry-muted hover:text-white transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => onRemoveItem(item.id)}
                    title="Remove from Shelf"
                    className="p-1.5 rounded-lg bg-evry-bg hover:bg-rose-500/20 border border-evry-border text-evry-muted hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="pt-2 border-t border-evry-border/60 flex items-center justify-between text-[10px] text-evry-muted">
        <span className="flex items-center space-x-1">
          <GripVertical className="w-3 h-3 text-evry-accent" />
          <span>Drag rows out to Explorer, VS Code, Discord, or Slack</span>
        </span>
        <span className="font-mono text-emerald-400">Native OLE Active</span>
      </div>

      {/* --- MODAL 1: Batch Rename Modal --- */}
      {showRenameModal && (
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-[340px] bg-evry-bg border border-evry-borderLight rounded-2xl p-4 shadow-2xl space-y-3">
            <div className="flex items-center justify-between pb-1.5 border-b border-evry-border">
              <span className="text-xs font-semibold text-white">Batch Rename Files</span>
              <button
                onClick={() => setShowRenameModal(false)}
                className="text-evry-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <span className="text-[10px] text-evry-muted">Choose renaming pattern:</span>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { mode: "kebab", label: "kebab-case" },
                  { mode: "lowercase", label: "lowercase" },
                  { mode: "timestamp", label: "+ YYYYMMDD_" },
                  { mode: "replace", label: "Find -> Replace" },
                ].map((m) => (
                  <button
                    key={m.mode}
                    onClick={() => setRenameMode(m.mode as typeof renameMode)}
                    className={cn(
                      "py-1.5 px-2 rounded-lg border text-left text-[11px] transition-all",
                      renameMode === m.mode
                        ? "bg-evry-accent text-white border-evry-accent font-semibold"
                        : "bg-evry-surface border-evry-border text-evry-muted hover:text-white"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {renameMode === "replace" && (
                <div className="pt-1">
                  <input
                    type="text"
                    value={renameReplaceParam}
                    onChange={(e) => setRenameReplaceParam(e.target.value)}
                    placeholder="search -> replacement"
                    className="w-full bg-evry-surface border border-evry-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-evry-accent font-mono"
                  />
                  <span className="text-[9px] text-evry-muted block mt-1">
                    Example: old -&gt; new
                  </span>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowRenameModal(false)}
                className="px-3 py-1 rounded-lg text-xs text-evry-muted hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteBatchRename}
                className="px-3 py-1 rounded-lg bg-evry-accent text-white text-xs font-semibold shadow-sm"
              >
                Apply Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 2: Image Conversion & EXIF Strip Modal --- */}
      {activeImageConvertItem && (
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-[320px] bg-evry-bg border border-evry-borderLight rounded-2xl p-4 shadow-2xl space-y-3">
            <div className="flex items-center justify-between pb-1.5 border-b border-evry-border">
              <span className="text-xs font-semibold text-white">Convert & Strip EXIF</span>
              <button
                onClick={() => setActiveImageConvertItem(null)}
                className="text-evry-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-evry-muted leading-relaxed">
              Strip camera metadata, GPS coordinates, and convert '{activeImageConvertItem.name}' cleanly:
            </p>

            <div className="grid grid-cols-3 gap-2 pt-1">
              {["webp", "png", "jpg"].map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => handleConvertImage(fmt, true)}
                  className="py-2 rounded-xl bg-evry-surface hover:bg-evry-accent border border-evry-border hover:border-evry-accent text-white font-mono text-xs font-bold transition-all shadow-sm"
                >
                  .{fmt.toUpperCase()}
                </button>
              ))}
            </div>

            <span className="text-[9px] text-emerald-400 block pt-1 text-center font-mono">
              ✓ Removes GPS & Device EXIF Tags
            </span>
          </div>
        </div>
      )}

      {/* --- MODAL 3: Local LAN QR Share ("Send to Phone") --- */}
      {lanShareModal && (
        <div className="absolute inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-[320px] bg-evry-bg border border-evry-borderLight rounded-2xl p-4 shadow-2xl flex flex-col items-center text-center space-y-3">
            <div className="w-full flex items-center justify-between pb-1 border-b border-evry-border">
              <div className="flex items-center space-x-1.5 text-xs font-semibold text-white">
                <Smartphone className="w-3.5 h-3.5 text-purple-400" />
                <span>Send to Phone (Wi-Fi)</span>
              </div>
              <button onClick={handleCloseLanShare} className="text-evry-muted hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* QR Code Container */}
            <div className="p-3 bg-white rounded-xl shadow-lg mt-1">
              <QRCodeSVG value={lanShareModal.url} size={140} level="M" />
            </div>

            <div className="space-y-1">
              <span className="text-xs font-semibold text-white block truncate max-w-[280px]">
                {lanShareModal.filename}
              </span>
              <span className="text-[10px] text-evry-muted block">
                Scan with your phone's camera on the same Wi-Fi
              </span>
            </div>

            <div className="w-full flex items-center justify-between bg-evry-surface p-2 rounded-lg border border-evry-border text-[10px] font-mono">
              <span className="text-evry-muted truncate max-w-[190px]">{lanShareModal.url}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(lanShareModal.url);
                  setCopyFeedback("Wi-Fi URL copied!");
                  setTimeout(() => setCopyFeedback(null), 1500);
                }}
                className="text-purple-400 hover:text-purple-300 font-bold ml-1"
              >
                Copy
              </button>
            </div>

            <button
              onClick={handleCloseLanShare}
              className="w-full py-1.5 rounded-lg bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-xs text-white font-medium"
            >
              Done & Close Server
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
