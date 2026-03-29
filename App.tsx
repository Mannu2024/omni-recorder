
import React, { useState, useRef, useEffect } from 'react';
import { RecordingStatus, RecordingResult, VideoQuality } from './types';
import { PlayIcon, StopIcon, PauseIcon, MicIcon, MonitorIcon, DownloadIcon, TrashIcon } from './components/Icons';
import Visualizer from './components/Visualizer';

type CaptureSurface = 'monitor' | 'window' | 'browser';

interface AppError {
  message: string;
  action?: string;
}

const App: React.FC = () => {
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [duration, setDuration] = useState(0);
  const [includeMic, setIncludeMic] = useState(false);
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [captureSurface, setCaptureSurface] = useState<CaptureSurface>('monitor');
  const [quality, setQuality] = useState<VideoQuality>('720p');
  const [customFileName, setCustomFileName] = useState('');
  const [results, setResults] = useState<RecordingResult[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [forceMobileMode, setForceMobileMode] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const combinedStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const isMobile = isMobileDevice || forceMobileMode;

  useEffect(() => {
    const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
    setIsMobileDevice(mobileRegex.test(navigator.userAgent));
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const stopTracks = () => {
    if (combinedStreamRef.current) {
      combinedStreamRef.current.getTracks().forEach(track => track.stop());
      combinedStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setDuration(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const getQualitySettings = (q: VideoQuality) => {
    switch (q) {
      case '1080p': return { width: 1920, height: 1080, bitrate: 6000000 };
      case '720p': return { width: 1280, height: 720, bitrate: 3500000 };
      case '480p': return { width: 854, height: 480, bitrate: 1500000 };
      default: return { width: 1280, height: 720, bitrate: 3500000 };
    }
  };

  const handleCaptureError = (err: any) => {
    console.error('Capture Error:', err);
    let errorDetail: AppError = { message: `Unexpected error: ${err.message || 'Unknown failure'}` };

    switch (err.name) {
      case 'NotAllowedError':
        errorDetail = {
          message: 'Permission Denied.',
          action: 'Click the lock icon (site settings) in your browser address bar and ensure "Screen Sharing", "Microphone", and "Camera" are allowed. If on macOS, check System Settings > Privacy & Security > Screen Recording.'
        };
        break;
      case 'NotFoundError':
        errorDetail = {
          message: 'Capture source not found.',
          action: 'Ensure you have at least one window, tab, or monitor active to record. If on mobile, try refreshing the page.'
        };
        break;
      case 'NotReadableError':
        errorDetail = {
          message: 'Hardware Error.',
          action: 'The browser cannot read the capture source. Another application might be using your screen or microphone exclusively. Close other recording software and try again.'
        };
        break;
      case 'SecurityError':
        errorDetail = {
          message: 'Security Policy Violation.',
          action: 'The browser security policy blocked the recording. This often happens in private/incognito windows or when the site is running in an iframe.'
        };
        break;
      case 'OverconstrainedError':
        errorDetail = {
          message: 'Constraints not met.',
          action: 'The requested quality (resolution/framerate) is not supported by your hardware. Try selecting a lower quality (e.g., 480p).'
        };
        break;
      case 'AbortError':
        errorDetail = {
          message: 'Recording aborted.',
          action: 'The recording was stopped by the system or browser. Please refresh and try again.'
        };
        break;
    }

    setError(errorDetail);
    setStatus('idle');
  };

  const startRecording = async () => {
    setError(null);
    chunksRef.current = [];
    const settings = getQualitySettings(quality);

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError({
        message: 'Browser not supported.',
        action: 'Your browser does not support the Screen Recording API. Please use the latest version of Chrome, Edge, or Firefox. iOS Safari does not support this feature.'
      });
      return;
    }

    try {
      stopTracks();

      const displayConstraints: any = {
        video: {
          displaySurface: captureSurface,
          width: { ideal: settings.width },
          height: { ideal: settings.height },
          frameRate: { ideal: isMobile ? 24 : 30 }
        },
        audio: includeSystemAudio ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          systemAudio: captureSurface === 'monitor' ? 'include' : 'exclude',
          selfBrowserSurface: captureSurface === 'browser' ? 'include' : 'exclude',
        } : false
      };

      const screenStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);

      let finalStream = screenStream;

      if (includeMic || (includeSystemAudio && screenStream.getAudioTracks().length > 0)) {
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const destination = audioContext.createMediaStreamDestination();
        let sourcesAdded = false;

        if (includeSystemAudio && screenStream.getAudioTracks().length > 0) {
          const systemSource = audioContext.createMediaStreamSource(new MediaStream([screenStream.getAudioTracks()[0]]));
          systemSource.connect(destination);
          sourcesAdded = true;
        }

        if (includeMic) {
          try {
            const micStream = await navigator.mediaDevices.getUserMedia({ 
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              } 
            });
            const micSource = audioContext.createMediaStreamSource(micStream);
            micSource.connect(destination);
            sourcesAdded = true;
          } catch (micErr: any) {
            console.warn("Microphone access denied.");
            setError({
              message: 'Mic ignored.',
              action: 'Microphone permission was denied. Recording will proceed with screen audio only.'
            });
          }
        }

        if (sourcesAdded) {
          finalStream = new MediaStream([
            ...screenStream.getVideoTracks(),
            ...destination.stream.getAudioTracks()
          ]);
        }
      }

      combinedStreamRef.current = finalStream;

      finalStream.getVideoTracks()[0].onended = () => {
        if (mediaRecorderRef.current?.state !== 'inactive') stopRecording();
      };

      const options = { 
        mimeType: 'video/webm;codecs=vp8,opus',
        videoBitsPerSecond: settings.bitrate
      };

      const mediaRecorder = new MediaRecorder(finalStream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const fileName = `${customFileName || 'Session'}_${Date.now()}.webm`;
        
        setResults(prev => [{ blob, url, name: fileName, timestamp: Date.now() }, ...prev]);
        stopTracks();
        setStatus('idle');
        setDuration(0);
      };

      mediaRecorder.start(1000);
      setStatus('recording');
      startTimer();

    } catch (err: any) {
      handleCaptureError(err);
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      setStatus('paused');
      stopTimer();
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      setStatus('recording');
      startTimer();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    stopTimer();
    stopTracks();
    setStatus('stopped');
  };

  const downloadRecording = (result: RecordingResult) => {
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const clearAllRecordings = () => {
    results.forEach(res => URL.revokeObjectURL(res.url));
    setResults([]);
    setShowClearConfirm(false);
  };

  const removeResult = (timestamp: number) => {
    setResults(prev => {
      const target = prev.find(r => r.timestamp === timestamp);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter(r => r.timestamp !== timestamp);
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-[#050505]">
      
      {/* Clear All Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-[2.5rem] p-8 shadow-2xl scale-in-center">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="p-4 bg-red-600/20 rounded-full text-red-500">
                <TrashIcon className="w-10 h-10" />
              </div>
              <h3 className="text-lg font-black text-white uppercase tracking-tighter italic">Delete All Recordings?</h3>
              <p className="text-xs text-zinc-500 font-medium leading-relaxed uppercase tracking-wider">
                This action cannot be undone. All captured sessions currently in your vault will be permanently removed.
              </p>
              <div className="grid grid-cols-2 gap-3 w-full mt-4">
                <button 
                  onClick={() => setShowClearConfirm(false)}
                  className="py-3 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl font-black text-[10px] uppercase tracking-widest transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={clearAllRecordings}
                  className="py-3 px-4 bg-red-600 hover:bg-red-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-colors shadow-lg shadow-red-600/20"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Main Header Bar */}
      <header className="sticky top-0 z-40 w-full flex flex-col items-center bg-[#050505]/90 backdrop-blur-xl border-b border-zinc-800/50 shadow-lg">
        <div className={`w-full max-w-5xl flex flex-col md:flex-row items-center justify-between gap-4 p-4 md:px-8 transition-all duration-300`}>
          <div className="flex items-center gap-4">
            <div className="p-2 bg-blue-600 rounded-xl shadow-lg shadow-blue-600/20 hidden sm:block">
              <MonitorIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-white italic tracking-tighter uppercase">OmniCapture</h1>
                {isMobileDevice && <span className="text-[7px] bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full font-black uppercase">Mobile</span>}
              </div>
              <p className="text-[9px] text-blue-500 font-bold uppercase tracking-[0.2em] hidden sm:block">Record Everything Everywhere</p>
            </div>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto justify-between sm:justify-end">
            {/* Status & Timer: PERSISTENTLY VISIBLE HERE */}
            {(status === 'recording' || status === 'paused') ? (
              <div className="flex items-center gap-3 px-4 py-1.5 bg-red-600/10 border border-red-600/30 rounded-full animate-in fade-in zoom-in duration-300">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full bg-red-600 ${status === 'recording' ? 'animate-pulse' : 'opacity-50'}`} />
                  <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">{status}</span>
                </div>
                <div className="w-px h-4 bg-red-600/30 mx-1" />
                <span className="text-lg font-black text-red-500 tabular-nums tracking-tighter">{formatTime(duration)}</span>
              </div>
            ) : (
              <div className="px-4 py-1.5 bg-zinc-900/50 border border-zinc-800 rounded-full">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Ready to record</span>
              </div>
            )}

            <button 
              onClick={() => setForceMobileMode(!forceMobileMode)}
              className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all ${
                forceMobileMode ? 'bg-blue-600 border-blue-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {forceMobileMode ? 'Phone Mode' : 'Web View'}
            </button>
          </div>
        </div>
      </header>

      <main className={`w-full max-w-5xl flex flex-col gap-8 transition-all duration-300 ${isMobile ? 'p-4' : 'p-8'}`}>
        
        {/* Settings & Setup */}
        <div className={`${!isMobile ? 'lg:col-span-8' : ''} space-y-6`}>
          
          {/* Actionable Error Display */}
          {error && (
            <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-3xl animate-in slide-in-from-top duration-300">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-red-500 rounded-full text-white shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-black text-red-500 uppercase tracking-widest">{error.message}</h3>
                  {error.action && (
                    <p className="text-xs text-red-400/80 font-medium leading-relaxed italic">
                      Tip: {error.action}
                    </p>
                  )}
                  <button 
                    onClick={() => setError(null)}
                    className="mt-2 text-[10px] font-black text-red-500/50 hover:text-red-500 uppercase underline transition-colors"
                  >
                    Dismiss Warning
                  </button>
                </div>
              </div>
            </div>
          )}

          {isMobile && status === 'idle' && !error && (
            <div className="p-6 bg-gradient-to-br from-blue-600/20 to-zinc-900 border border-blue-500/30 rounded-3xl">
              <h3 className="text-xs font-black text-blue-400 uppercase tracking-widest mb-3">Android Screen Capture Guide</h3>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-black shrink-0">1</div>
                  <p className="text-xs text-zinc-300">Tap the large <strong>RECORD</strong> button below.</p>
                </div>
                <div className="flex gap-4">
                  <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-black shrink-0">2</div>
                  <p className="text-xs text-zinc-300">Chrome will ask to share screen. Select <strong>Entire Screen</strong> then tap <strong>Start Now</strong>.</p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-zinc-900/40 border border-zinc-800 rounded-[2.5rem] p-6 md:p-10 backdrop-blur-3xl shadow-2xl">
            <div className="space-y-8">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">Recording Name</label>
                <input 
                  type="text"
                  placeholder="e.g. Work_Presentation"
                  value={customFileName}
                  onChange={(e) => setCustomFileName(e.target.value)}
                  disabled={status !== 'idle' && status !== 'stopped'}
                  className="w-full px-6 py-4 bg-zinc-800/40 border border-zinc-700 text-white font-bold rounded-2xl focus:outline-none focus:border-blue-500 transition-all placeholder:text-zinc-700"
                />
              </div>

              {/* Surface Selection */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">Recording Source</label>
                <div className="grid grid-cols-3 gap-3">
                  {(['monitor', 'window', 'browser'] as CaptureSurface[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setCaptureSurface(s)}
                      disabled={status !== 'idle'}
                      className={`flex flex-col items-center gap-2 py-4 rounded-2xl border transition-all ${
                        captureSurface === s ? 'bg-blue-600/10 border-blue-500 text-blue-400' : 'bg-zinc-800/40 border-zinc-700 text-zinc-500 hover:border-zinc-600'
                      }`}
                    >
                      <span className="font-black text-[10px] uppercase tracking-widest">
                        {s === 'monitor' ? 'Full Screen' : s === 'window' ? 'Window' : 'Browser Tab'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <button 
                  onClick={() => setIncludeMic(!includeMic)}
                  className={`flex items-center justify-between px-6 py-5 rounded-2xl border transition-all ${
                    includeMic ? 'bg-blue-600/10 border-blue-500 text-blue-400' : 'bg-zinc-800/40 border-zinc-700 text-zinc-500 hover:border-zinc-600'
                  }`}
                  disabled={status !== 'idle'}
                >
                  <div className="flex items-center gap-3">
                    <MicIcon className="w-6 h-6" />
                    <span className="font-bold text-sm">MICROPHONE</span>
                  </div>
                  <span className="text-[10px] font-black">{includeMic ? 'ACTIVE' : 'OFF'}</span>
                </button>

                <button 
                  onClick={() => setIncludeSystemAudio(!includeSystemAudio)}
                  className={`flex items-center justify-between px-6 py-5 rounded-2xl border transition-all ${
                    includeSystemAudio ? 'bg-green-600/10 border-green-500 text-green-400' : 'bg-zinc-800/40 border-zinc-700 text-zinc-500 hover:border-zinc-600'
                  }`}
                  disabled={status !== 'idle'}
                >
                  <div className="flex items-center gap-3">
                    <MonitorIcon className="w-6 h-6" />
                    <span className="font-bold text-sm">
                      {captureSurface === 'browser' ? 'TAB AUDIO' : 'SYSTEM AUDIO'}
                    </span>
                  </div>
                  <span className="text-[10px] font-black">{includeSystemAudio ? 'ACTIVE' : 'OFF'}</span>
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-1">Output Resolution</label>
                <div className="grid grid-cols-3 gap-3">
                  {(['1080p', '720p', '480p'] as VideoQuality[]).map((q) => (
                    <button
                      key={q}
                      onClick={() => setQuality(q)}
                      disabled={status !== 'idle'}
                      className={`py-3 rounded-xl font-black text-[10px] uppercase border transition-all ${
                        quality === q ? 'bg-blue-600 border-blue-400 text-white' : 'bg-zinc-800/40 border-zinc-700 text-zinc-500 hover:border-zinc-600'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {(status === 'recording' || status === 'paused') && (
                <div className="space-y-3">
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Audio Monitoring</p>
                  <Visualizer stream={combinedStreamRef.current} isActive={status === 'recording'} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Center */}
        <div className={`${!isMobile ? 'lg:col-span-4' : ''} flex flex-col`}>
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-[2.5rem] p-8 flex-1 flex flex-col items-center justify-center backdrop-blur-3xl min-h-[350px]">
            {status === 'idle' || status === 'stopped' ? (
              <button 
                onClick={startRecording}
                className="group relative w-48 h-48 md:w-56 md:h-56 flex items-center justify-center transition-transform active:scale-95"
              >
                <div className="absolute inset-0 bg-blue-600 rounded-full blur-[60px] opacity-20 group-hover:opacity-40 transition-opacity" />
                <div className="relative w-40 h-40 md:w-48 md:h-48 bg-blue-600 hover:bg-blue-500 rounded-full flex flex-col items-center justify-center shadow-[0_0_50px_rgba(37,99,235,0.4)] border-4 border-blue-400/20">
                  <PlayIcon className="w-16 h-16 md:w-20 md:h-20 text-white ml-2" />
                  <span className="mt-3 text-[10px] font-black text-white uppercase tracking-widest">Start Record</span>
                </div>
              </button>
            ) : (
              <div className="flex flex-col gap-10 items-center">
                <div className="flex gap-6">
                  {status === 'recording' ? (
                    <button onClick={pauseRecording} className="w-24 h-24 md:w-28 md:h-28 bg-zinc-800 border-2 border-zinc-700 rounded-full flex flex-col items-center justify-center hover:bg-zinc-700 transition-colors">
                      <PauseIcon className="w-10 h-10 text-white" />
                      <span className="mt-2 text-[8px] font-black text-zinc-500 uppercase">Pause</span>
                    </button>
                  ) : (
                    <button onClick={resumeRecording} className="w-24 h-24 md:w-28 md:h-28 bg-blue-600 border-2 border-blue-400 rounded-full flex flex-col items-center justify-center hover:bg-blue-500 transition-colors">
                      <PlayIcon className="w-10 h-10 text-white ml-1" />
                      <span className="mt-2 text-[8px] font-black text-white uppercase">Resume</span>
                    </button>
                  )}
                  <button onClick={stopRecording} className="w-24 h-24 md:w-28 md:h-28 bg-red-600 border-2 border-red-500 rounded-full flex flex-col items-center justify-center hover:bg-red-500 transition-colors">
                    <StopIcon className="w-10 h-10 text-white" />
                    <span className="mt-2 text-[8px] font-black text-white uppercase">Stop</span>
                  </button>
                </div>
                <div className="flex items-center gap-3 px-6 py-2 bg-red-500/10 border border-red-500/20 rounded-full animate-pulse">
                  <div className="w-2 h-2 rounded-full bg-red-600" />
                  <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">
                    {captureSurface === 'monitor' ? 'Entire Screen' : captureSurface === 'window' ? 'Active Window' : 'Single Tab'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recordings Gallery */}
        <div className={`${!isMobile ? 'lg:col-span-12' : ''} space-y-8`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-2 gap-4">
            <h3 className="text-xl font-black text-white italic tracking-tighter uppercase">Captured Sessions</h3>
            <div className="flex items-center gap-3">
              {results.length > 0 && (
                <button 
                  onClick={() => setShowClearConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-red-600/50 text-red-500 rounded-full text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                  Clear All
                </button>
              )}
              <span className="text-[10px] font-black text-zinc-600 border border-zinc-800 px-4 py-1.5 rounded-full uppercase">
                {results.length} Files
              </span>
            </div>
          </div>

          {results.length === 0 ? (
            <div className="py-24 border-2 border-dashed border-zinc-800 rounded-[3rem] bg-zinc-900/10 flex flex-col items-center justify-center text-zinc-800">
              <DownloadIcon className="w-12 h-12 mb-4 opacity-10" />
              <p className="text-sm font-bold uppercase tracking-widest opacity-20 italic text-center px-6">
                No recordings yet. Configure your source and hit record to start.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {results.map((res) => (
                <div key={res.timestamp} className="bg-zinc-900/40 border border-zinc-800 rounded-[2rem] overflow-hidden group hover:border-blue-500/50 transition-all shadow-2xl">
                  <div className="aspect-video bg-black relative">
                    <video src={res.url} className="w-full h-full object-cover" controls />
                    <button 
                      onClick={() => removeResult(res.timestamp)}
                      className="absolute top-4 right-4 p-3 bg-red-600/80 hover:bg-red-600 text-white rounded-2xl transition-all active:scale-90"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-6 space-y-4">
                    <div className="space-y-1">
                      <p className="text-sm font-black text-zinc-200 truncate uppercase tracking-tight">{res.name}</p>
                      <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">{new Date(res.timestamp).toLocaleString()}</p>
                    </div>
                    <button 
                      onClick={() => downloadRecording(res)}
                      className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-[0.2em] rounded-2xl flex items-center justify-center gap-3 transition-colors active:scale-95"
                    >
                      <DownloadIcon className="w-4 h-4" />
                      Download Video
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <footer className="w-full max-w-5xl mt-24 pb-12 text-center">
        <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent mb-12" />
        <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.5em] mb-4">OmniCapture Pro // Developed for High Fidelity Recording</p>
        <p className="text-[11px] text-zinc-500 max-w-2xl mx-auto leading-relaxed opacity-60 italic px-4">
          All processing is 100% local. Your screen data never leaves your device. For best performance, use Google Chrome on a Desktop or Android device.
        </p>
      </footer>
    </div>
  );
};

export default App;
