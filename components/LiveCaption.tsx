'use client';

import { useEffect, useState } from 'react';

interface LiveCaptionProps {
  isRecording: boolean;
  onTranscriptChange?: (transcript: string) => void;
}

export function LiveCaption({ isRecording, onTranscriptChange }: LiveCaptionProps) {
  const [caption, setCaption] = useState('');
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    // Check if Web Speech API is supported
    const supported =
      typeof window !== 'undefined' &&
      ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
    setIsSupported(supported);

    if (!supported) {
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
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

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
    };

    if (isRecording) {
      recognition.start();
    } else {
      recognition.stop();
      setCaption('');
    }

    return () => {
      recognition.stop();
    };
  }, [isRecording, onTranscriptChange]);

  // Feature flag check
  const enabled =
    process.env.NEXT_PUBLIC_ENABLE_LIVE_CAPTIONS !== 'false' && isSupported;

  if (!enabled) {
    return null;
  }

  return (
    <div className="w-full max-w-2xl mx-auto p-4 bg-gray-100 rounded-lg min-h-[100px]">
      <div className="text-sm text-gray-500 mb-2">Live Caption</div>
      <div className="text-lg">
        {caption || (
          <span className="text-gray-400 italic">
            {isRecording ? 'Listening...' : 'Start recording to see live captions'}
          </span>
        )}
      </div>
    </div>
  );
}
