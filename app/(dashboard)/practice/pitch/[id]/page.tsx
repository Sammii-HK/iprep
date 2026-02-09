"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { MicRecorder } from "@/components/MicRecorder";

interface Question {
  id: string;
  text: string;
  hint?: string | null;
  tags: string[];
  difficulty: number;
}

interface TalkingPointResult {
  questionId: string;
  pointText: string;
  transcript: string;
  metrics: {
    words: number | null;
    wpm: number | null;
    fillerCount: number | null;
  };
  scores: {
    confidence: number | null;
    clarity: number | null;
    impact: number | null;
    conciseness: number | null;
  };
  answerQuality: number | null;
  tips: string[];
}

export default function PitchPracticePage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [results, setResults] = useState<TalkingPointResult[]>([]);
  const [pitchComplete, setPitchComplete] = useState(false);
  const [timePerPoint, setTimePerPoint] = useState(90);
  const [totalTimeLimit] = useState<number | null>(null);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const submittingRef = useRef(false);
  const startTimeRef = useRef<number | null>(null);

  // Track total elapsed time
  useEffect(() => {
    if (!initialLoading && !pitchComplete && questions.length > 0) {
      startTimeRef.current = Date.now();
      const interval = setInterval(() => {
        if (startTimeRef.current) {
          setTotalElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [initialLoading, pitchComplete, questions.length]);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) {
        alert("Failed to load session");
        router.push("/practice");
        return;
      }
      const data = await res.json();
      setQuestions(data.questions || []);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setInitialLoading(false);
    }
  }, [sessionId, router]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const handleRecordingComplete = async (blob: Blob) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const currentQuestion = questions[currentIndex];
    if (!currentQuestion) return;

    setLoading(true);
    try {
      const formData = new FormData();
      const ext = blob.type?.split("/")[1]?.split(";")[0] || "webm";
      formData.append("audio", blob, `recording.${ext}`);
      formData.append("sessionId", sessionId);
      formData.append("questionId", currentQuestion.id);
      formData.append(
        "preferences",
        JSON.stringify({
          focusAreas: ["impact", "clarity", "confidence"],
          priorities: ["conciseness", "impact language", "confidence"],
        })
      );

      const res = await fetch("/api/practice", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const result = await res.json();
        setResults((prev) => [
          ...prev,
          {
            questionId: currentQuestion.id,
            pointText: currentQuestion.text,
            transcript: result.transcript,
            metrics: {
              words: result.metrics.words,
              wpm: result.metrics.wpm,
              fillerCount: result.metrics.fillerCount,
            },
            scores: {
              confidence: result.scores.confidence,
              clarity: result.scores.clarity,
              impact: result.scores.impact,
              conciseness: result.scores.conciseness,
            },
            answerQuality: result.answerQuality,
            tips: result.tips,
          },
        ]);

        if (currentIndex + 1 < questions.length) {
          setCurrentIndex(currentIndex + 1);
        } else {
          setPitchComplete(true);
        }
      } else {
        alert("Failed to process. Skipping to next point.");
        if (currentIndex + 1 < questions.length) {
          setCurrentIndex(currentIndex + 1);
        } else {
          setPitchComplete(true);
        }
      }
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Coverage: how many points were addressed
  const coverage = questions.length > 0
    ? Math.round((results.length / questions.length) * 100)
    : 0;

  // Average scores
  const avgOf = (key: keyof TalkingPointResult["scores"]) => {
    const values = results
      .map((r) => r.scores[key])
      .filter((v): v is number => v != null);
    return values.length > 0
      ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)
      : "N/A";
  };

  const totalWords = results.reduce((sum, r) => sum + (r.metrics.words || 0), 0);
  const totalFillers = results.reduce((sum, r) => sum + (r.metrics.fillerCount || 0), 0);

  if (initialLoading) {
    return <div className="text-center py-12">Loading pitch practice...</div>;
  }

  // Debrief view
  if (pitchComplete) {
    return (
      <div className="px-4 py-6 max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 text-slate-900 dark:text-slate-100">
          Pitch Practice Complete
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mb-2">
          You covered {results.length} of {questions.length} talking points.
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
          Total time: {formatTime(totalElapsed)} | Total words: {totalWords} | Fillers: {totalFillers}
        </p>

        {/* Coverage & Scores */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 text-center">
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {coverage}%
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-400">Coverage</div>
          </div>
          {(["confidence", "clarity", "impact", "conciseness"] as const).map((key) => (
            <div
              key={key}
              className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 text-center"
            >
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {avgOf(key)}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400 capitalize">
                Avg {key}
              </div>
            </div>
          ))}
        </div>

        {/* Per-point Results */}
        <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">
          Point-by-Point Review
        </h2>
        <div className="space-y-4 mb-8">
          {questions.map((q, idx) => {
            const result = results.find((r) => r.questionId === q.id);
            return (
              <div
                key={idx}
                className={`bg-white dark:bg-slate-800 rounded-lg p-4 border ${
                  result
                    ? "border-slate-200 dark:border-slate-700"
                    : "border-red-200 dark:border-red-800 opacity-60"
                }`}
              >
                <div className="font-medium text-slate-900 dark:text-slate-100 mb-1">
                  {idx + 1}. {q.text}
                </div>
                {result ? (
                  <>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2 italic">
                      &ldquo;{result.transcript.substring(0, 120)}
                      {result.transcript.length > 120 ? "..." : ""}&rdquo;
                    </p>
                    <div className="flex gap-3 text-xs text-slate-600 dark:text-slate-400">
                      <span>Quality: {result.answerQuality}/5</span>
                      <span>Words: {result.metrics.words}</span>
                      <span>Confidence: {result.scores.confidence}/5</span>
                      <span>Impact: {result.scores.impact}/5</span>
                    </div>
                    {result.tips.length > 0 && (
                      <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Tip: {result.tips[0]}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-red-600 dark:text-red-400">Not covered</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => router.push("/practice")}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
          >
            Back to Practice
          </button>
          <button
            onClick={() => {
              setPitchComplete(false);
              setResults([]);
              setCurrentIndex(0);
              setTotalElapsed(0);
              startTimeRef.current = Date.now();
            }}
            className="px-4 py-2 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-lg hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors font-medium"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Practice in progress
  const currentQuestion = questions[currentIndex];

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Pitch Practice
          </h1>
          <div className="text-right">
            <span className="text-sm text-slate-600 dark:text-slate-400 block">
              Point {currentIndex + 1} of {questions.length}
            </span>
            {totalElapsed > 0 && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Elapsed: {formatTime(totalElapsed)}
                {totalTimeLimit && ` / ${formatTime(totalTimeLimit)}`}
              </span>
            )}
          </div>
        </div>
        {/* Progress bar */}
        <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full">
          <div
            className="h-full bg-purple-500 rounded-full transition-all"
            style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Timer per point */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm text-slate-600 dark:text-slate-400">Time per point:</label>
        <select
          value={timePerPoint}
          onChange={(e) => setTimePerPoint(Number(e.target.value))}
          className="px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
        >
          <option value={30}>30s</option>
          <option value={60}>1 min</option>
          <option value={90}>90s</option>
          <option value={120}>2 min</option>
        </select>
      </div>

      {currentQuestion && (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700 mb-6">
          <div className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider mb-2">
            Talking Point {currentIndex + 1}
          </div>
          <p className="text-lg text-slate-900 dark:text-slate-100 leading-relaxed">
            {currentQuestion.text}
          </p>
          {currentQuestion.hint && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-3 border-t border-slate-100 dark:border-slate-700 pt-3">
              Key points: {currentQuestion.hint}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col items-center">
        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mb-4" />
            <p className="text-slate-700 dark:text-slate-300">Processing...</p>
          </div>
        ) : (
          <MicRecorder
            onRecordingComplete={handleRecordingComplete}
            onStart={() => {}}
            onStop={() => {}}
            disabled={loading}
            timeLimit={timePerPoint}
          />
        )}
      </div>

      <p className="text-xs text-center text-slate-500 dark:text-slate-400 mt-4">
        Deliver each talking point as if presenting to investors. Be concise and impactful.
      </p>
    </div>
  );
}
