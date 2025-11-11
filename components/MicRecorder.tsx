"use client";

import { useState, useRef, useEffect } from "react";

interface MicRecorderProps {
	onRecordingComplete: (blob: Blob) => void;
	onStart?: () => void;
	onStop?: () => void;
	disabled?: boolean; // Disable recording while processing
}

export function MicRecorder({
	onRecordingComplete,
	onStart,
	onStop,
	disabled = false,
}: MicRecorderProps) {
	const [isRecording, setIsRecording] = useState(false);
	const [duration, setDuration] = useState(0);
	const [audioLevel, setAudioLevel] = useState(0);
	const [micConnected, setMicConnected] = useState(false);
	const [showLowAudioWarning, setShowLowAudioWarning] = useState(false);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const intervalRef = useRef<NodeJS.Timeout | null>(null);
	const levelCheckRef = useRef<number | null>(null);
	const lowAudioStartTimeRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			const interval = intervalRef.current;
			const levelCheck = levelCheckRef.current;
			const stream = streamRef.current;
			const audioContext = audioContextRef.current;
			const source = sourceRef.current;

			if (interval) {
				clearInterval(interval);
			}
			if (levelCheck) {
				cancelAnimationFrame(levelCheck);
			}
			// Disconnect source
			if (source) {
				try {
					source.disconnect();
				} catch {
					// Source might already be disconnected
				}
			}
			// Only stop stream when component unmounts (not between recordings)
			if (stream) {
				stream.getTracks().forEach((track) => track.stop());
			}
			if (audioContext) {
				audioContext.close();
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
		if (
			audioContextRef.current &&
			audioContextRef.current.state === "suspended"
		) {
			audioContextRef.current.resume().catch(() => {
				// Audio context resume failed - silently handle
			});
		}

		// Check if stream is active
		const audioTracks = streamRef.current.getAudioTracks();
		if (audioTracks.length === 0 || audioTracks[0].readyState !== "live") {
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
		const normalizedLevel = Math.min(100, Math.max(0, rms * 300));
		setAudioLevel(normalizedLevel);

		// Track low audio duration - only show warning after 3 seconds of low audio
		const LOW_AUDIO_THRESHOLD = 0.5; // Same threshold as before
		const LOW_AUDIO_DURATION_MS = 3000; // 3 seconds

		if (normalizedLevel < LOW_AUDIO_THRESHOLD) {
			// Audio is low
			if (lowAudioStartTimeRef.current === null) {
				// Start tracking low audio time
				lowAudioStartTimeRef.current = Date.now();
			} else {
				// Check if we've had low audio for long enough
				const lowAudioDuration = Date.now() - lowAudioStartTimeRef.current;
				if (lowAudioDuration >= LOW_AUDIO_DURATION_MS && !showLowAudioWarning) {
					setShowLowAudioWarning(true);
				}
			}
		} else {
			// Audio is good - reset tracking
			if (lowAudioStartTimeRef.current !== null) {
				lowAudioStartTimeRef.current = null;
				setShowLowAudioWarning(false);
			}
		}

		levelCheckRef.current = requestAnimationFrame(checkAudioLevel);
	};

	// Detect iOS/iPadOS
	const isIOS = () => {
		if (typeof window === "undefined") return false;
		return (
			/iPad|iPhone|iPod/.test(navigator.userAgent) ||
			(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
		);
	};

	// Get compatible MIME type for MediaRecorder
	const getCompatibleMimeType = (): string | undefined => {
		const isIOSDevice = isIOS();

		// iOS Safari doesn't support webm, needs mp4 or aac
		if (isIOSDevice) {
			// Try iOS-compatible formats
			if (MediaRecorder.isTypeSupported("audio/mp4")) {
				return "audio/mp4";
			}
			if (MediaRecorder.isTypeSupported("audio/aac")) {
				return "audio/aac";
			}
			if (MediaRecorder.isTypeSupported("audio/m4a")) {
				return "audio/m4a";
			}
			// Fallback: let MediaRecorder choose
			return undefined;
		}

		// For other browsers, prefer webm
		if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
			return "audio/webm;codecs=opus";
		}
		if (MediaRecorder.isTypeSupported("audio/webm")) {
			return "audio/webm";
		}

		// Fallback
		return undefined;
	};

	const startRecording = async () => {
		// Don't start if disabled
		if (disabled) return;

		try {
			// Reuse existing stream if available and active
			let stream = streamRef.current;

			// Check if existing stream is still active
			if (stream) {
				const audioTracks = stream.getAudioTracks();
				const isStreamActive =
					audioTracks.length > 0 &&
					audioTracks.some(
						(track) => track.readyState === "live" && track.enabled
					);

				if (!isStreamActive) {
					// Stream is dead, need to get a new one
					stream = null;
					streamRef.current = null;
				}
			}

			// Only request new stream if we don't have an active one
			if (!stream) {
				// Request microphone with iOS-compatible constraints
				const constraints: MediaStreamConstraints = {
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
						// iOS-specific: don't request sampleRate (let iOS choose)
						...(isIOS() ? {} : { sampleRate: 44100 }),
					},
				};

				stream = await navigator.mediaDevices.getUserMedia(constraints);
				streamRef.current = stream;
			}

			// Check if stream has audio tracks
			const audioTracks = stream.getAudioTracks();
			if (audioTracks.length === 0) {
				throw new Error("No audio tracks found in stream");
			}

			// Check if track is actually enabled and not muted
			const audioTrack = audioTracks[0];
			if (!audioTrack.enabled || audioTrack.muted) {
				throw new Error("Audio track is disabled or muted");
			}

			// Audio track initialized

			setMicConnected(true);

			// Set up audio analysis for level detection (reuse if already exists)
			let audioContext = audioContextRef.current;
			let analyser = analyserRef.current;

			if (!audioContext || audioContext.state === "closed") {
				// TypeScript doesn't have webkitAudioContext in types, but it exists in Safari
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const webkitAudioContext = (window as any).webkitAudioContext;
				const AudioContextClass = window.AudioContext || webkitAudioContext;
				audioContext = new AudioContextClass();

				// iOS requires AudioContext to be resumed on user interaction
				if (audioContext.state === "suspended") {
					try {
						await audioContext.resume();
					} catch {
						// Continue anyway - some browsers handle this differently
					}
				}

				analyser = audioContext.createAnalyser();
				analyser.fftSize = 2048; // Increased for better accuracy
				analyser.smoothingTimeConstant = 0.8;

				audioContextRef.current = audioContext;
				analyserRef.current = analyser;
			}

			// Reconnect source if needed (in case it was disconnected or doesn't exist)
			if (audioContext && analyser) {
				// Disconnect old source if it exists
				if (sourceRef.current) {
					try {
						sourceRef.current.disconnect();
					} catch {
						// Source might already be disconnected, that's okay
					}
				}

				// Create and connect new source
				try {
					const source = audioContext.createMediaStreamSource(stream);
					source.connect(analyser);
					sourceRef.current = source;
				} catch {
					// Failed to create/connect source - continue anyway
				}
			}

			// Use iOS-compatible MIME type
			const mimeType = getCompatibleMimeType();

			const recorderOptions: MediaRecorderOptions = {};
			if (mimeType) {
				recorderOptions.mimeType = mimeType;
			}

			// Check if MediaRecorder is supported
			if (typeof MediaRecorder === "undefined") {
				throw new Error(
					"MediaRecorder is not supported on this device. Please use a modern browser."
				);
			}

			const mediaRecorder = new MediaRecorder(stream, recorderOptions);

			// Check for MediaRecorder errors
			mediaRecorder.onerror = (event) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const error = (event as any).error;
				if (error) {
					alert(
						`Recording error: ${error.name || error.message || "Unknown error"}`
					);
				}
			};

			mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					chunksRef.current.push(event.data);
				}
			};

			mediaRecorder.onstop = () => {
				// Use the actual MIME type from the recorder, or fallback
				const actualMimeType =
					mediaRecorder.mimeType || mimeType || "audio/webm";
				const blob = new Blob(chunksRef.current, { type: actualMimeType });
				chunksRef.current = [];
				onRecordingComplete(blob);
				// Don't stop the stream tracks - keep them alive for next recording
				// This prevents having to request permission again
				setAudioLevel(0);
				// Keep audioContext alive for next recording
				if (levelCheckRef.current) {
					cancelAnimationFrame(levelCheckRef.current);
					levelCheckRef.current = null;
				}
			};

			mediaRecorderRef.current = mediaRecorder;

			// iOS Safari requires timeslice for MediaRecorder to work properly
			// Start with 100ms timeslice for better iOS compatibility
			try {
				mediaRecorder.start(isIOS() ? 100 : undefined);
			} catch (startError) {
				throw new Error(
					`Failed to start recording: ${
						startError instanceof Error ? startError.message : "Unknown error"
					}`
				);
			}

			setIsRecording(true);
			setDuration(0);
			setShowLowAudioWarning(false);
			lowAudioStartTimeRef.current = null;
			onStart?.();

			// Start timer
			intervalRef.current = setInterval(() => {
				setDuration((prev) => prev + 1);
			}, 1000);

			// Start audio level monitoring
			checkAudioLevel();
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);

			// Provide more helpful error messages for iOS
			let userMessage = "Unable to access microphone. ";
			if (isIOS()) {
				userMessage +=
					"On iOS: (1) Check Settings > Safari > Microphone permissions, (2) Try using Safari instead of Chrome, (3) Ensure you're on HTTPS.";
			} else if (
				errorMessage.includes("Permission denied") ||
				errorMessage.includes("NotAllowedError")
			) {
				userMessage +=
					"Please allow microphone access in your browser settings.";
			} else if (
				errorMessage.includes("NotFoundError") ||
				errorMessage.includes("no audio")
			) {
				userMessage += "No microphone found. Please connect a microphone.";
			} else {
				userMessage += `Error: ${errorMessage}`;
			}

			alert(userMessage);
			setMicConnected(false);
		}
	};

	const stopRecording = () => {
		if (mediaRecorderRef.current && isRecording) {
			mediaRecorderRef.current.stop();
			setIsRecording(false);
			setAudioLevel(0);
			setShowLowAudioWarning(false);
			lowAudioStartTimeRef.current = null;
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

	// Function to explicitly release microphone (optional, for cleanup)
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const releaseMicrophone = () => {
		if (sourceRef.current) {
			try {
				sourceRef.current.disconnect();
			} catch {
				// Source might already be disconnected
			}
			sourceRef.current = null;
		}
		if (streamRef.current) {
			streamRef.current.getTracks().forEach((track) => track.stop());
			streamRef.current = null;
			setMicConnected(false);
		}
		if (audioContextRef.current) {
			audioContextRef.current.close();
			audioContextRef.current = null;
		}
		if (analyserRef.current) {
			analyserRef.current = null;
		}
	};

	const formatTime = (seconds: number) => {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	};

	return (
		<div className="flex flex-col items-center gap-4">
			<button
				onClick={isRecording ? stopRecording : startRecording}
				disabled={disabled && !isRecording}
				className={`w-24 h-24 rounded-full flex items-center justify-center transition-all ${
					isRecording
						? "bg-red-500 hover:bg-red-600 text-white font-semibold"
						: disabled
						? "bg-slate-300 dark:bg-slate-600 text-slate-600 dark:text-slate-400 cursor-not-allowed font-normal"
						: "bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 font-semibold"
				}`}
			>
				{isRecording ? "Stop" : disabled ? "Processing" : "Record"}
			</button>

			{/* Audio Level Indicator */}
			{isRecording && (
				<div className="w-full max-w-xs">
					<div className="flex items-center justify-between mb-1">
						<span className="text-xs text-slate-700 dark:text-slate-300">
							Audio Level
						</span>
						<span className="text-xs text-slate-700 dark:text-slate-300">
							{Math.round(audioLevel)}%
						</span>
					</div>
					<div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
						<div
							className={`h-full transition-all duration-75 ${
								audioLevel > 70
									? "bg-green-500"
									: audioLevel > 30
									? "bg-yellow-500"
									: audioLevel > 0
									? "bg-red-500"
									: "bg-slate-300 dark:bg-slate-600"
							}`}
							style={{ width: `${audioLevel}%` }}
						/>
					</div>
					{showLowAudioWarning && isRecording && (
						<p className="text-xs text-yellow-500 dark:text-yellow-400 mt-1 text-center">
							⚠️ Low audio detected - speak louder or check microphone
						</p>
					)}
				</div>
			)}

			{isRecording && (
				<div className="text-lg font-mono text-slate-900 dark:text-slate-100">
					{formatTime(duration)}
				</div>
			)}
			{isRecording && (
				<div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
			)}

			{!isRecording && !micConnected && (
				<div className="text-sm text-slate-600 dark:text-slate-400 text-center max-w-xs">
					<p className="mb-2">
						Click Record to start. Make sure your microphone is enabled.
					</p>
					{isIOS() && (
						<p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
							💡 iOS tip: Use Safari for best compatibility. Ensure HTTPS and
							microphone permissions are enabled.
						</p>
					)}
				</div>
			)}
		</div>
	);
}
