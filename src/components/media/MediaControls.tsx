import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronLeft,
  Music,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Volume2,
  Radio,
} from "lucide-react";
import { MediaInfo } from "../../types";
import { cn } from "../../lib/utils";

interface MediaControlsProps {
  onBack: () => void;
}

export const MediaControls: React.FC<MediaControlsProps> = ({ onBack }) => {
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);

  const fetchMedia = useCallback(async () => {
    try {
      const info = await invoke<MediaInfo>("get_media_info");
      setMediaInfo(info);
    } catch (err) {
      console.error("Failed to get media info:", err);
    }
  }, []);

  useEffect(() => {
    fetchMedia();
    const interval = setInterval(fetchMedia, 2000);
    return () => clearInterval(interval);
  }, [fetchMedia]);

  const handlePlayPause = async () => {
    try {
      await invoke("media_play_pause");
      setTimeout(fetchMedia, 300);
    } catch (err) {
      console.error(err);
    }
  };

  const handleNext = async () => {
    try {
      await invoke("media_next");
      setTimeout(fetchMedia, 500);
    } catch (err) {
      console.error(err);
    }
  };

  const handlePrev = async () => {
    try {
      await invoke("media_prev");
      setTimeout(fetchMedia, 500);
    } catch (err) {
      console.error(err);
    }
  };

  const handleVolume = async (delta: number) => {
    try {
      await invoke("adjust_system_volume", { delta });
    } catch (err) {
      console.error(err);
    }
  };

  const isPlaying = mediaInfo?.is_playing ?? false;
  const hasMedia = mediaInfo && (mediaInfo.title || mediaInfo.artist);

  return (
    <div className="w-full flex flex-col h-[290px] bg-evry-bg rounded-b-2xl animate-slideDown overflow-hidden p-3">
      {/* Header */}
      <div className="flex items-center justify-between pb-1.5 border-b border-evry-border">
        <div className="flex items-center space-x-1.5">
          <button
            onClick={onBack}
            className="w-6 h-6 rounded-md bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border flex items-center justify-center text-evry-muted hover:text-evry-text transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-semibold text-evry-text tracking-wide">Now Playing & Media</span>
        </div>
        <div className="flex items-center space-x-1.5 text-[10px] text-evry-muted font-mono">
          <Radio className={cn("w-3 h-3", isPlaying ? "text-emerald-400 animate-pulse" : "text-evry-muted")} />
          <span>{isPlaying ? "PLAYING" : "STANDBY"}</span>
        </div>
      </div>

      {/* Main Player Display */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-1 space-y-2.5">
        {/* Track / Artwork Card */}
        <div className="w-full max-w-[340px] p-4 rounded-2xl bg-evry-surface border border-evry-border flex items-center space-x-3.5 shadow-sm">
          <div
            className={cn(
              "w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 transition-all border",
              isPlaying
                ? "bg-evry-accent/15 border-evry-accent/40 text-evry-accent shadow-glow"
                : "bg-evry-bg border-evry-border text-evry-muted"
            )}
          >
            <Music className={cn("w-6 h-6", isPlaying && "animate-pulse")} />
          </div>

          <div className="flex-1 min-w-0">
            <span className="text-xs font-bold text-evry-text truncate block">
              {hasMedia ? mediaInfo?.title : "No Media Detected"}
            </span>
            <span className="text-[11px] text-evry-muted truncate block mt-0.5">
              {hasMedia ? (mediaInfo?.artist || "Unknown Artist") : "Play audio in Spotify, YouTube, or VLC"}
            </span>
            <div className="flex items-center space-x-1.5 mt-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-evry-accent" />
              <span className="text-[9px] text-evry-muted font-mono uppercase tracking-wider">
                Windows SMTC Session
              </span>
            </div>
          </div>
        </div>

        {/* Playback Transport Buttons */}
        <div className="flex items-center space-x-4">
          <button
            onClick={handlePrev}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-muted hover:text-white transition-all active:scale-95"
            title="Previous Track"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={handlePlayPause}
            className={cn(
              "w-12 h-12 flex items-center justify-center rounded-full transition-all active:scale-95 shadow-md",
              isPlaying
                ? "bg-evry-accent text-white shadow-glow"
                : "bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-text hover:border-evry-accent/50"
            )}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>

          <button
            onClick={handleNext}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-evry-surface hover:bg-evry-surfaceHover border border-evry-border text-evry-muted hover:text-white transition-all active:scale-95"
            title="Next Track"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Volume Stepper & Mute */}
        <div className="w-full max-w-[340px] px-3 py-2 rounded-xl bg-evry-surface/60 border border-evry-border flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2 text-evry-muted">
            <Volume2 className="w-3.5 h-3.5 text-evry-accent" />
            <span className="font-medium text-evry-text">Volume</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <button
              onClick={() => handleVolume(0)}
              className="px-2 py-1 rounded bg-evry-bg hover:bg-evry-surface border border-evry-border text-[10px] text-evry-muted hover:text-white transition-colors"
            >
              Mute
            </button>
            <button
              onClick={() => handleVolume(-2)}
              className="px-2.5 py-1 rounded bg-evry-bg hover:bg-evry-surface border border-evry-border text-[10px] text-evry-muted hover:text-white transition-colors"
            >
              -2%
            </button>
            <button
              onClick={() => handleVolume(2)}
              className="px-2.5 py-1 rounded bg-evry-bg hover:bg-evry-surface border border-evry-border text-[10px] text-evry-accent hover:text-white transition-colors"
            >
              +2%
            </button>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="pt-2 border-t border-evry-border/60 flex items-center justify-between text-[10px] text-evry-muted">
        <span>Hardware Media Transport Keys</span>
        <span className="font-mono text-emerald-400">Spotify • Edge • Chrome • VLC</span>
      </div>
    </div>
  );
};
