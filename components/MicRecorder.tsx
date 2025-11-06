'use client';

import { useState, useRef, useEffect } from 'react';

interface MicRecorderProps {
  onRecordingComplete: (blob: Blob) => void;
  onStart?: () => void;
  onStop?: () => void;
}

export function MicRecorder({
  onRecordingComplete,
  onStart,
  onStop,
}: MicRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micConnected, setMicConnected] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const levelCheckRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (levelCheckRef.current) {
        cancelAnimationFrame(levelCheckRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Check audio levels for visualization - use time domain data for accurate volume
  const checkAudioLevel = () => {
    if (!analyserRef.current || !isRecording) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    // Use getByteTimeDomainData for volume detection (more accurate than frequency)
    analyserRef.current.getByteTimeDomainData(dataArray);
    
    // Calculate RMS (Root Mean Square) for volume level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    // Convert to percentage (0-100)
    const normalizedLevel = Math.min(100, Math.max(0, rms * 200));
    setAudioLevel(normalizedLevel);

    levelCheckRef.current = requestAnimationFrame(checkAudioLevel);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicConnected(true);

      // Set up audio analysis for level detection
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 256;
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        chunksRef.current = [];
        onRecordingComplete(blob);
        stream.getTracks().forEach((track) => track.stop());
        setMicConnected(false);
        setAudioLevel(0);
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        if (levelCheckRef.current) {
          cancelAnimationFrame(levelCheckRef.current);
          levelCheckRef.current = null;
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setDuration(0);
      onStart?.();

      // Start timer
      intervalRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);

      // Start audio level monitoring
      checkAudioLevel();
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Unable to access microphone. Please check permissions.');
      setMicConnected(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setAudioLevel(0);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (levelCheckRef.current) {
        cancelAnimationFrame(levelCheckRef.current);
        levelCheckRef.current = null;
      }
      onStop?.();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={isRecording ? stopRecording : startRecording}
        className={`w-24 h-24 rounded-full flex items-center justify-center text-white font-semibold transition-all ${
          isRecording
            ? 'bg-red-500 hover:bg-red-600'
            : 'bg-blue-500 hover:bg-blue-600'
        }`}
      >
        {isRecording ? 'Stop' : 'Record'}
      </button>
      
      {/* Audio Level Indicator */}
      {isRecording && (
        <div className="w-full max-w-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-700 dark:text-slate-300">Audio Level</span>
            <span className="text-xs text-slate-700 dark:text-slate-300">{Math.round(audioLevel)}%</span>
          </div>
          <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-75 ${
                audioLevel > 70
                  ? 'bg-green-500'
                  : audioLevel > 30
                  ? 'bg-yellow-500'
                  : audioLevel > 0
                  ? 'bg-red-500'
                  : 'bg-slate-300 dark:bg-slate-600'
              }`}
              style={{ width: `${audioLevel}%` }}
            />
          </div>
          {audioLevel < 5 && (
            <p className="text-xs text-red-500 dark:text-red-400 mt-1 text-center">
              ⚠️ No audio detected - check your microphone
            </p>
          )}
        </div>
      )}

      {isRecording && (
        <div className="text-lg font-mono text-slate-900 dark:text-slate-100">{formatTime(duration)}</div>
      )}
      {isRecording && (
        <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
      )}
      
      {!isRecording && !micConnected && (
        <p className="text-sm text-slate-600 dark:text-slate-400 text-center max-w-xs">
          Click Record to start. Make sure your microphone is enabled.
        </p>
      )}
    </div>
  );
}
