'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  MessageSquare,
  Send,
  ArrowRight,
  Check,
} from 'lucide-react';
import Hls from 'hls.js';
import DanmakuLayer, { DanmakuComment } from './DanmakuLayer';
import { animateControlsVisibility } from '../lib/animations';
import { API_BASE } from '@/lib/config';

export interface VideoSource {
  quality: string;
  url: string;
}

interface VideoPlayerProps {
  sources: VideoSource[];
  title: string;
  comments: DanmakuComment[];
  onNextChapter?: () => void;
  onProgress?: (time: number, duration: number) => void;
  onSendComment?: (text: string, time: number) => void;
  pluginId?: string;
  mediaId?: string;
  chapterId?: string;
}

export default function VideoPlayer({
  sources = [],
  title,
  comments: initialComments,
  onNextChapter,
  onProgress,
  onSendComment,
  pluginId,
  mediaId,
  chapterId,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  // Active Quality Source
  const [activeSource, setActiveSource] = useState<VideoSource | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Quality & Speed Dropdown Toggles
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [danmakuEnabled, setDanmakuEnabled] = useState(true);

  // Danmaku state
  const [comments, setComments] = useState<DanmakuComment[]>(initialComments);
  const [newComment, setNewComment] = useState('');

  // Seamless quality switching memory
  const seekOnLoadRef = useRef<number | null>(null);
  const playOnLoadRef = useRef<boolean>(false);

  // Hide controls timer
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync sources prop
  useEffect(() => {
    if (sources.length > 0) {
      setActiveSource(sources[0]);
    }
  }, [sources]);

  // Sync initial comments when they change
  useEffect(() => {
    setComments(initialComments);
  }, [initialComments]);

  // Hls.js integration for M3U8 streaming with 2K/4K buffer optimizations
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeSource?.url) return;

    let hls: Hls | null = null;
    const src = activeSource.url;

    // Reset playback states only if we are NOT performing a seamless quality switch
    if (seekOnLoadRef.current === null) {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }

    // Check if the stream is HLS (m3u8)
    const isHls = src.endsWith('.m3u8') || src.includes('.m3u8');

    const setupRestoredState = () => {
      // Restore timestamp if quality changed
      if (seekOnLoadRef.current !== null) {
        video.currentTime = seekOnLoadRef.current;
        seekOnLoadRef.current = null;
      }
      // Restore playback state
      if (playOnLoadRef.current) {
        video.play().catch(() => {});
        setIsPlaying(true);
        playOnLoadRef.current = false;
      }
      // Re-apply playback speed
      video.playbackRate = playbackSpeed;
    };

    if (isHls) {
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true, // Move stream demuxing to Web Workers (prevents UI blocking on 2K/4K)
          maxMaxBufferLength: 30, // Prefetch up to 30 seconds of video
          maxBufferSize: 60 * 1024 * 1024, // 60MB max buffer allocation (perfect for high bitrate 4K)
          lowLatencyMode: false,
          capLevelToPlayerSize: true, // Optimize resolution dynamically based on viewport
        });
        hls.loadSource(src);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setupRestoredState();
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls?.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls?.recoverMediaError();
                break;
              default:
                break;
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        video.src = src;
        video.load();

        const onLoaded = () => {
          setupRestoredState();
          video.removeEventListener('loadedmetadata', onLoaded);
        };
        video.addEventListener('loadedmetadata', onLoaded);
      }
    } else {
      // Standard video file (MP4, WebM, etc.)
      video.src = src;
      video.load();

      const onLoaded = () => {
        setupRestoredState();
        video.removeEventListener('loadedmetadata', onLoaded);
      };
      video.addEventListener('loadedmetadata', onLoaded);
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [activeSource, playbackSpeed]);

  // Handle play/pause toggle
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  // Switch Quality source seamlessly (preserving current time)
  const handleQualityChange = (source: VideoSource) => {
    if (!videoRef.current) return;
    seekOnLoadRef.current = videoRef.current.currentTime;
    playOnLoadRef.current = isPlaying;
    setActiveSource(source);
    setShowQualityMenu(false);
  };

  // Switch Playback Speed
  const handleSpeedChange = (speed: number) => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = speed;
    setPlaybackSpeed(speed);
    setShowSpeedMenu(false);
  };

  // Handle time update
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    setCurrentTime(videoRef.current.currentTime);
    if (onProgress && videoRef.current.duration > 0) {
      onProgress(videoRef.current.currentTime, videoRef.current.duration);
    }
  };

  // Handle loaded metadata
  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration);
  };

  // Handle seek
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const time = parseFloat(e.target.value);
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  // Handle volume change
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const vol = parseFloat(e.target.value);
    videoRef.current.volume = vol;
    setVolume(vol);
    setIsMuted(vol === 0);
  };

  // Toggle mute
  const toggleMute = () => {
    if (!videoRef.current) return;
    const muted = !isMuted;
    videoRef.current.muted = muted;
    setIsMuted(muted);
    if (!muted && volume === 0) {
      videoRef.current.volume = 0.5;
      setVolume(0.5);
    }
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Track fullscreen changes via ESC or native buttons
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Format time (00:00)
  const formatTime = (time: number) => {
    if (isNaN(time)) return '00:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Shoot customized user Danmaku
  const handleSendDanmaku = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !videoRef.current) return;

    const userComment: DanmakuComment = {
      id: `user-danmaku-${Date.now()}`,
      text: newComment.trim(),
      time: videoRef.current.currentTime + 0.1, // Fire almost instantly
      color: '#FFFF33', // Yellow color to differentiate user comment
    };

    setComments((prev) => [...prev, userComment].sort((a, b) => a.time - b.time));
    setNewComment('');
    onSendComment?.(userComment.text, userComment.time);
  };

  // Fetch hotspots to plot high-energy segments above seekbar
  const [hotspots, setHotspots] = useState<{ position: number; intensity: number; time: number }[]>([]);

  useEffect(() => {
    if (!pluginId || !mediaId || !chapterId) return;

    const fetchHotspots = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/danmaku/hotspots/${pluginId}/${mediaId}/${chapterId}`);
        const data = await res.json();
        if (data && data.hotspots) {
          setHotspots(data.hotspots);
        }
      } catch (err) {
        console.warn('[VideoPlayer] Failed to load hotspots:', err);
      }
    };
    fetchHotspots();
  }, [pluginId, mediaId, chapterId]);

  const generatePath = () => {
    if (hotspots.length === 0) return '';
    const sorted = [...hotspots].sort((a, b) => a.position - b.position);
    let path = `M 0 100`;
    if (sorted[0].position > 0) {
      path += ` L 0 100`;
    }
    sorted.forEach((h) => {
      const x = h.position * 100;
      const y = 100 - h.intensity * 85;
      path += ` L ${x} ${y}`;
    });
    path += ` L 100 100 Z`;
    return path;
  };

  // Hover animations for controls using GSAP
  const showControls = () => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);

    animateControlsVisibility(controlsRef.current, true);

    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        animateControlsVisibility(controlsRef.current, false);
      }, 3000);
    }
  };

  useEffect(() => {
    showControls();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying]);

  return (
    <div
      ref={containerRef}
      onMouseMove={showControls}
      onMouseLeave={() => {
        if (isPlaying) {
          animateControlsVisibility(controlsRef.current, false);
        }
      }}
      className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black border border-border shadow-2xl group flex items-center justify-center select-none"
    >
      {/* HTML5 Video element */}
      <video
        ref={videoRef}
        onClick={togglePlay}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        className="w-full h-full object-contain cursor-pointer"
        playsInline
      />

      {/* Sandboxed Danmaku Layer Overlay */}
      <DanmakuLayer
        comments={comments}
        currentTime={currentTime}
        isPlaying={isPlaying}
        danmakuEnabled={danmakuEnabled}
      />

      {/* Control Overlay Panels */}
      <div
        ref={controlsRef}
        className="absolute inset-x-0 bottom-0 z-30 flex flex-col justify-end px-6 pb-6 pt-16 bg-gradient-to-t from-black/95 via-black/50 to-transparent pointer-events-auto opacity-0 translate-y-[10px]"
      >
        {/* Progress Bar */}
        <div className="relative group/progress mb-4 w-full">
          {hotspots.length > 0 && (
            <div className="absolute left-0 right-0 bottom-full h-7 pointer-events-none overflow-hidden opacity-35 group-hover/progress:opacity-85 transition-opacity duration-300">
              <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="hotspot-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path d={generatePath()} fill="url(#hotspot-grad)" />
              </svg>
            </div>
          )}
          <input
            type="range"
            min="0"
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 bg-surface rounded-full appearance-none cursor-pointer group-hover/progress:h-2 transition-all outline-none accent-primary bg-gradient-to-r from-primary to-secondary z-10 relative"
            style={{
              background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-secondary) ${
                (currentTime / (duration || 1)) * 100
              }%, var(--color-surface) ${(currentTime / (duration || 1)) * 100}%)`,
            }}
          />
        </div>

        {/* Buttons Row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer active:scale-95"
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-white" />}
            </button>

            {/* Time display */}
            <span className="text-xs font-semibold text-slate-300">
              {formatTime(currentTime)} <span className="text-slate-600">/</span>{' '}
              {formatTime(duration)}
            </span>

            {/* Volume controls */}
            <div className="flex items-center space-x-2">
              <button
                onClick={toggleMute}
                className="p-2 text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-20 h-1 bg-surface rounded-full appearance-none accent-primary outline-none"
              />
            </div>
          </div>

          {/* Right Buttons: Title, Quality Selector, Speed Selector, Danmaku toggle, Fullscreen */}
          <div className="flex items-center space-x-3 justify-end relative">
            <span className="text-xs text-slate-400 font-medium max-w-32 truncate hidden lg:inline mr-2">
              {title}
            </span>

            {onNextChapter && (
              <button
                onClick={onNextChapter}
                className="flex items-center space-x-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-surface border border-border text-textPrimary hover:text-white hover:border-surfaceLight transition cursor-pointer"
              >
                <span>下一话</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            )}

            {/* Resolution/Quality Switching Menu */}
            {sources.length > 1 && (
              <div className="relative">
                <button
                  onClick={() => {
                    setShowQualityMenu(!showQualityMenu);
                    setShowSpeedMenu(false);
                  }}
                  className="px-3 py-2 text-xs font-bold bg-white/5 border border-white/5 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition cursor-pointer"
                >
                  {activeSource?.quality || '清晰度'}
                </button>
                {showQualityMenu && (
                  <div className="absolute bottom-11 right-0 w-36 bg-background/90 border border-border rounded-xl py-1.5 shadow-xl flex flex-col z-50 backdrop-blur-md">
                    {sources.map((s) => (
                      <button
                        key={s.quality}
                        onClick={() => handleQualityChange(s)}
                        className="flex items-center justify-between text-left px-3 py-2 text-xs text-textPrimary hover:text-white hover:bg-white/10 transition cursor-pointer"
                      >
                        <span>{s.quality}</span>
                        {activeSource?.quality === s.quality && (
                          <Check className="h-3 w-3 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSpeedMenu(!showSpeedMenu);
                  setShowQualityMenu(false);
                }}
                className="px-3 py-2 text-xs font-bold bg-white/5 border border-white/5 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition cursor-pointer"
              >
                {playbackSpeed === 1 ? '倍速' : `${playbackSpeed}x`}
              </button>
              {showSpeedMenu && (
                <div className="absolute bottom-11 right-0 w-28 bg-background/90 border border-border rounded-xl py-1.5 shadow-xl flex flex-col z-50 backdrop-blur-md">
                  {[0.5, 1.0, 1.25, 1.5, 2.0, 3.0].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => handleSpeedChange(speed)}
                      className="flex items-center justify-between text-left px-3 py-2 text-xs text-textPrimary hover:text-white hover:bg-white/10 transition cursor-pointer"
                    >
                      <span>{speed === 1.0 ? '正常 (1.0x)' : `${speed}x`}</span>
                      {playbackSpeed === speed && <Check className="h-3 w-3 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Danmaku toggle */}
            <button
              onClick={() => setDanmakuEnabled(!danmakuEnabled)}
              className={`p-2 rounded-xl transition cursor-pointer ${
                danmakuEnabled
                  ? 'bg-primary/20 border border-primary/30 text-primary'
                  : 'bg-white/5 border border-white/5 text-textSecondary hover:text-textPrimary'
              }`}
              title={danmakuEnabled ? '关闭弹幕' : '开启弹幕'}
            >
              <MessageSquare className="h-5 w-5" />
            </button>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-slate-200 transition cursor-pointer active:scale-95"
            >
              {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Live Danmaku input field inside control bar */}
        <form
          onSubmit={handleSendDanmaku}
          className="mt-4 flex items-center bg-background/80 border border-border/80 rounded-xl p-1.5 backdrop-blur-md"
        >
          <input
            type="text"
            placeholder="发个弹幕见证神作吧..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="flex-grow bg-transparent border-0 outline-none text-xs text-textPrimary px-3 placeholder-textSecondary focus:ring-0 focus:outline-none"
          />
          <button
            type="submit"
            className="p-2 rounded-lg bg-primary hover:bg-primary/80 text-white transition active:scale-95 cursor-pointer"
          >
            <Send className="h-3 w-3" />
          </button>
        </form>
      </div>
    </div>
  );
}
