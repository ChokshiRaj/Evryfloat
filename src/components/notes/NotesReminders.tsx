import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  ArrowLeft,
  Clock,
  FileText,
  Check,
} from "lucide-react";
import { Note, Reminder } from "../../types";
import { cn } from "../../lib/utils";

interface NotesRemindersProps {
  onBack: () => void;
}

export const NotesReminders: React.FC<NotesRemindersProps> = ({ onBack }) => {
  const [tab, setTab] = useState<"notes" | "reminders">("notes");

  // Notes state
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isSaved, setIsSaved] = useState(true);

  // Reminders state
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [newReminderTitle, setNewReminderTitle] = useState("");
  const [newReminderDue, setNewReminderDue] = useState("");

  const loadNotes = () => {
    invoke<Note[]>("get_notes")
      .then((data) => {
        setNotes(data);
        if (data.length > 0 && activeNoteId === null) {
          setActiveNoteId(data[0].id);
          setTitle(data[0].title);
          setContent(data[0].content);
        }
      })
      .catch(console.error);
  };

  const loadReminders = () => {
    invoke<Reminder[]>("get_reminders")
      .then(setReminders)
      .catch(console.error);
  };

  useEffect(() => {
    loadNotes();
    loadReminders();
  }, []);

  const handleSelectNote = (n: Note) => {
    setActiveNoteId(n.id);
    setTitle(n.title);
    setContent(n.content);
    setIsSaved(true);
  };

  const handleCreateNewNote = () => {
    setActiveNoteId(null);
    setTitle("New Note");
    setContent("");
    setIsSaved(true);
  };

  const handleSaveNote = () => {
    if (!title.trim() && !content.trim()) return;
    invoke<number>("save_note", {
      id: activeNoteId,
      title: title.trim() || "Untitled Note",
      content,
    })
      .then((newId) => {
        setActiveNoteId(newId);
        setIsSaved(true);
        loadNotes();
      })
      .catch(console.error);
  };

  const handleDeleteNote = (id: number) => {
    invoke("delete_note", { id })
      .then(() => {
        if (activeNoteId === id) {
          setActiveNoteId(null);
          setTitle("");
          setContent("");
        }
        loadNotes();
      })
      .catch(console.error);
  };

  const handleAddReminder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReminderTitle.trim()) return;

    invoke("save_reminder", {
      title: newReminderTitle.trim(),
      dueDate: newReminderDue || "Today",
    })
      .then(() => {
        setNewReminderTitle("");
        setNewReminderDue("");
        loadReminders();
      })
      .catch(console.error);
  };

  const handleToggleReminder = (id: number) => {
    invoke("toggle_reminder", { id })
      .then(loadReminders)
      .catch(console.error);
  };

  const handleDeleteReminder = (id: number) => {
    invoke("delete_reminder", { id })
      .then(loadReminders)
      .catch(console.error);
  };

  return (
    <div className="w-full flex flex-col h-[410px] bg-evry-bg rounded-b-2xl animate-slideDown overflow-hidden p-4">
      {/* Header Tabs */}
      <div className="flex items-center justify-between pb-2.5 border-b border-evry-border">
        <div className="flex items-center space-x-2">
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-lg bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border flex items-center justify-center text-evry-muted hover:text-evry-text transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center bg-evry-surface p-0.5 rounded-lg border border-evry-border">
            <button
              onClick={() => setTab("notes")}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                tab === "notes"
                  ? "bg-evry-accent text-white shadow-sm font-semibold"
                  : "text-evry-muted hover:text-evry-text"
              )}
            >
              Notes ({notes.length})
            </button>
            <button
              onClick={() => setTab("reminders")}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                tab === "reminders"
                  ? "bg-evry-accent text-white shadow-sm font-semibold"
                  : "text-evry-muted hover:text-evry-text"
              )}
            >
              Reminders ({reminders.length})
            </button>
          </div>
        </div>

        {tab === "notes" && (
          <button
            onClick={handleCreateNewNote}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-evry-accent text-white text-xs font-semibold hover:bg-evry-accentHover transition-all shadow-sm active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Note</span>
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden pt-2.5 min-h-0">
        {tab === "notes" ? (
          <div className="grid grid-cols-3 gap-3 h-full">
            {/* Notes List Column */}
            <div className="col-span-1 min-h-0 evry-scroll space-y-1.5 pr-1 border-r border-evry-border/60">
              {notes.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-2">
                  <div className="w-9 h-9 rounded-xl bg-evry-surface border border-evry-border flex items-center justify-center text-evry-accent">
                    <FileText className="w-4 h-4" />
                  </div>
                  <p className="text-xs font-medium text-evry-text">No notes yet</p>
                  <p className="text-[10px] text-evry-muted">Click "+ New Note" above</p>
                </div>
              ) : (
                notes.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => handleSelectNote(n)}
                    className={cn(
                      "p-2.5 rounded-xl border text-left cursor-pointer transition-all group relative",
                      activeNoteId === n.id
                        ? "bg-evry-surface border-evry-accent text-evry-text shadow-sm"
                        : "bg-evry-surface/40 border-evry-border text-evry-muted hover:text-evry-text hover:border-evry-accent/30"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs truncate max-w-[105px]">
                        {n.title || "Untitled"}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNote(n.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-evry-muted hover:text-rose-400 p-0.5 rounded transition-all"
                        title="Delete note"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-[10px] text-evry-muted truncate mt-1">
                      {n.content || "Empty content"}
                    </p>
                  </div>
                ))
              )}
            </div>

            {/* Note Editor Column */}
            <div className="col-span-2 flex flex-col h-full bg-evry-surface/50 rounded-xl border border-evry-border p-3 min-h-0">
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setIsSaved(false);
                }}
                onBlur={handleSaveNote}
                placeholder="Note Title..."
                className="bg-transparent border-b border-evry-border pb-2 text-xs font-bold text-evry-text placeholder-evry-muted focus:outline-none focus:border-evry-accent"
              />
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setIsSaved(false);
                }}
                onBlur={handleSaveNote}
                placeholder="Type your note here... (saved locally to SQLite)"
                className="flex-1 bg-transparent resize-none text-xs text-evry-text placeholder-evry-muted focus:outline-none pt-2.5 leading-relaxed evry-scroll"
              />
              <div className="flex justify-between items-center text-[10px] text-evry-muted pt-2 border-t border-evry-border/60">
                <span className="flex items-center space-x-1 text-emerald-400">
                  <Check className="w-3 h-3" />
                  <span>{isSaved ? "Saved to SQLite" : "Unsaved changes"}</span>
                </span>
                <span className="text-[10px] text-evry-muted font-mono">{content.length} chars</span>
              </div>
            </div>
          </div>
        ) : (
          /* Reminders Tab */
          <div className="flex flex-col h-full min-h-0">
            {/* New Reminder Form */}
            <form onSubmit={handleAddReminder} className="flex space-x-2 pb-2.5">
              <input
                type="text"
                value={newReminderTitle}
                onChange={(e) => setNewReminderTitle(e.target.value)}
                placeholder="Add a new reminder..."
                className="flex-1 px-3 py-1.5 rounded-xl bg-evry-surface border border-evry-border text-xs text-evry-text placeholder-evry-muted focus:outline-none focus:border-evry-accent"
              />
              <input
                type="text"
                value={newReminderDue}
                onChange={(e) => setNewReminderDue(e.target.value)}
                placeholder="Due (e.g. 5 PM)"
                className="w-28 px-2.5 py-1.5 rounded-xl bg-evry-surface border border-evry-border text-xs text-evry-text placeholder-evry-muted focus:outline-none focus:border-evry-accent"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-xl bg-evry-accent text-white text-xs font-semibold hover:bg-evry-accentHover transition-colors flex items-center space-x-1 shadow-sm active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </form>

            {/* Reminders List */}
            <div className="flex-1 min-h-0 evry-scroll space-y-2 pr-1">
              {reminders.length === 0 ? (
                <div className="text-center py-12 text-xs text-evry-muted">
                  No reminders set. Add one above!
                </div>
              ) : (
                reminders.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => handleToggleReminder(r.id)}
                    className={cn(
                      "flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer group",
                      r.is_completed
                        ? "bg-evry-surface/30 border-evry-border opacity-60 line-through text-evry-muted"
                        : "bg-evry-surface border-evry-border hover:border-evry-accent/40 text-evry-text"
                    )}
                  >
                    <div className="flex items-center space-x-2.5">
                      {r.is_completed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Circle className="w-4 h-4 text-evry-muted group-hover:text-evry-accent" />
                      )}
                      <span className="text-xs font-medium">{r.title}</span>
                    </div>

                    <div className="flex items-center space-x-3">
                      <span className="text-[10px] text-evry-muted flex items-center space-x-1 font-mono">
                        <Clock className="w-3 h-3" />
                        <span>{r.due_date}</span>
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteReminder(r.id);
                        }}
                        className="text-evry-muted hover:text-rose-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete reminder"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
