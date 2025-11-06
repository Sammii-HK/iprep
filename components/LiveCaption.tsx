'use client';

import { useEffect, useState, useRef } from 'react';

interface LiveCaptionProps {
  isRecording: boolean;
  onTranscriptChange?: (transcript: string) => void;
}

export function LiveCaption({ isRecording, onTranscriptChange }: LiveCaptionProps) {
  const [caption, setCaption] = useState('');
  const isNewRecordingRef = useRef(false);
  
  // Check if Web Speech API is supported (checked once on mount)
  const isSupported = typeof window !== 'undefined' &&
    ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  useEffect(() => {
    if (!isSupported) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionConstructor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognitionConstructor) {
      return;
    }
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new SpeechRecognitionConstructor() as any;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: Event & { resultIndex: number; results: Array<{ [key: number]: { transcript: string }; isFinal: boolean }> }) => {
      // Clear caption if this is a new recording session
      if (isNewRecordingRef.current) {
        setCaption('');
        isNewRecordingRef.current = false;
      }

      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }

      const fullTranscript = finalTranscript + interimTranscript;
      setCaption(fullTranscript);
      onTranscriptChange?.(fullTranscript);
    };

    recognition.onerror = (event: Event & { error?: string }) => {
      console.error('Speech recognition error:', event.error);
    };

    if (isRecording) {
      isNewRecordingRef.current = true;
      recognition.start();
    } else {
      recognition.stop();
    }

    return () => {
      recognition.stop();
    };
  }, [isRecording, onTranscriptChange, isSupported]);

  // Feature flag check
  const enabled =
    process.env.NEXT_PUBLIC_ENABLE_LIVE_CAPTIONS !== 'false' && isSupported;

  if (!enabled) {
    return null;
  }

  return (
    <div className="w-full max-w-2xl mx-auto p-4 bg-slate-100 dark:bg-slate-700 rounded-lg min-h-[100px] border border-slate-200 dark:border-slate-600">
      <div className="text-sm text-slate-600 dark:text-slate-400 mb-2">Live Caption</div>
      <div className="text-lg text-slate-900 dark:text-slate-100">
        {caption || (
          <span className="text-slate-500 dark:text-slate-400 italic">
            {isRecording ? 'Listening...' : 'Start recording to see live captions'}
          </span>
        )}
      </div>
    </div>
  );
}
