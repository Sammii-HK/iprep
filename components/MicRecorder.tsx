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
    if (!analyserRef.current || !isRecording || !streamRef.current) {
      if (levelCheckRef.current) {
        cancelAnimationFrame(levelCheckRef.current);
        levelCheckRef.current = null;
      }
      return;
    }

    // Check if audio context is running
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(console.error);
    }

    // Check if stream is active
    const audioTracks = streamRef.current.getAudioTracks();
    if (audioTracks.length === 0 || audioTracks[0].readyState !== 'live') {
      setAudioLevel(0);
      levelCheckRef.current = requestAnimationFrame(checkAudioLevel);
      return;
    }

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    // Use getByteTimeDomainData for volume detection (more accurate than frequency)
    analyserRef.current.getByteTimeDomainData(dataArray);
    
    // Calculate RMS (Root Mean Square) for volume level
    let sum = 0;
    let count = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      const squared = normalized * normalized;
      sum += squared;
      count++;
    }
    
    if (count === 0) {
      setAudioLevel(0);
      levelCheckRef.current = requestAnimationFrame(checkAudioLevel);
      return;
    }
    
    const rms = Math.sqrt(sum / count);
    // Convert to percentage (0-100) - scale more aggressively
    // RMS typically ranges from 0 to ~0.3 for normal speech
    const normalizedLevel = Math.min(100, Math.max(0, (rms * 300)));
    setAudioLevel(normalizedLevel);

    levelCheckRef.current = requestAnimationFrame(checkAudioLevel);
  };

  const startRecording = async () => {
    try {
      // Request microphone with better constraints
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      
      // Check if stream has audio tracks
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio tracks found in stream');
      }
      
      console.log('Audio track:', {
        label: audioTracks[0].label,
        enabled: audioTracks[0].enabled,
        readyState: audioTracks[0].readyState,
        muted: audioTracks[0].muted,
      });
      
      streamRef.current = stream;
      setMicConnected(true);

      // Set up audio analysis for level detection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      
      // Resume audio context if suspended (required by some browsers)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048; // Increased for better accuracy
      analyser.smoothingTimeConstant = 0.8;
      
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
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
          {audioLevel < 0.5 && micConnected && isRecording && (
            <p className="text-xs text-yellow-500 dark:text-yellow-400 mt-1 text-center">
              ⚠️ Low audio detected - speak louder or check microphone
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
