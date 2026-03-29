
export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopped';

export type VideoQuality = '1080p' | '720p' | '480p';

export interface RecorderState {
  status: RecordingStatus;
  duration: number;
  hasAudio: boolean;
  hasMic: boolean;
  error: string | null;
}

export interface RecordingResult {
  blob: Blob;
  url: string;
  name: string;
  timestamp: number;
}
