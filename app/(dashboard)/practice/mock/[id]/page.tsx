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
  type?: string;
}

interface AttemptResult {
  questionId: string;
  questionText: string;
  transcript: string;
  metrics: {
    words: number | null;
    wpm: number | null;
    fillerCount: number | null;
    fillerRate: number | null;
    longPauses: number | null;
  };
  scores: {
    confidence: number | null;
    intonation: number | null;
    star: number | null;
    impact: number | null;
    clarity: number | null;
    technicalAccuracy?: number | null;
    terminologyUsage?: number | null;
  };
  answerQuality: number | null;
  whatWasRight?: string[];
  dontForget?: string[];
  tips: string[];
}

export default function MockInterviewPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [results, setResults] = useState<AttemptResult[]>([]);
  const [interviewComplete, setInterviewComplete] = useState(false);
  const [timePerQuestion] = useState(120); // 2 minutes per question
  const submittingRef = useRef(false);

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
            questionText: currentQuestion.text,
            transcript: result.transcript,
            metrics: result.metrics,
            scores: result.scores,
            answerQuality: result.answerQuality,
            whatWasRight: result.whatWasRight,
            dontForget: result.dontForget,
            tips: result.tips,
          },
        ]);

        // Move to next question or end interview
        if (currentIndex + 1 < questions.length) {
          setCurrentIndex(currentIndex + 1);
        } else {
          setInterviewComplete(true);
        }
      } else {
        alert("Failed to process answer. Skipping to next question.");
        if (currentIndex + 1 < questions.length) {
          setCurrentIndex(currentIndex + 1);
        } else {
          setInterviewComplete(true);
        }
      }
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  // Calculate overall averages for debrief
  const avgScore = (key: string) => {
    const values = results
      .map((r) => {
        const scores = r.scores as Record<string, number | null | undefined>;
        return scores[key];
      })
      .filter((v): v is number => v != null);
    return values.length > 0
      ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)
      : "N/A";
  };

  if (initialLoading) {
    return <div className="text-center py-12">Loading interview...</div>;
  }

  // Debrief view
  if (interviewComplete) {
    return (
      <div className="px-4 py-6 max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 text-slate-900 dark:text-slate-100">
          Mock Interview Complete
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mb-8">
          You answered {results.length} of {questions.length} questions.
        </p>

        {/* Overall Scores */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Clarity", key: "clarity" },
            { label: "Confidence", key: "confidence" },
            { label: "STAR", key: "star" },
            { label: "Impact", key: "impact" },
          ].map(({ label, key }) => (
            <div
              key={key}
              className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 text-center"
            >
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {avgScore(key)}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">
                Avg {label}
              </div>
            </div>
          ))}
        </div>

        {/* Per-question Results */}
        <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">
          Question-by-Question Review
        </h2>
        <div className="space-y-4 mb-8">
          {results.map((result, idx) => (
            <div
              key={idx}
              className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700"
            >
              <div className="font-medium text-slate-900 dark:text-slate-100 mb-2">
                Q{idx + 1}: {result.questionText}
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-2 italic">
                &ldquo;{result.transcript.substring(0, 150)}
                {result.transcript.length > 150 ? "..." : ""}&rdquo;
              </p>
              <div className="flex gap-3 text-xs text-slate-600 dark:text-slate-400">
                <span>Quality: {result.answerQuality}/10</span>
                <span>Words: {result.metrics.words}</span>
                <span>Fillers: {result.metrics.fillerCount}</span>
                <span>WPM: {result.metrics.wpm}</span>
              </div>
              {result.dontForget && result.dontForget.length > 0 && (
                <div className="mt-2 p-2 bg-slate-50 dark:bg-slate-700 rounded text-sm">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Key points missed: </span>
                  <span className="text-slate-600 dark:text-slate-400">
                    {result.dontForget.join("; ")}
                  </span>
                </div>
              )}
            </div>
          ))}
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
              setInterviewComplete(false);
              setResults([]);
              setCurrentIndex(0);
            }}
            className="px-4 py-2 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-lg hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors font-medium"
          >
            Try Again
          </button>
          <button
            onClick={async () => {
              try {
                const res = await fetch(`/api/reports?sessionId=${sessionId}`);
                if (res.ok) {
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "iprep-mock-report.pdf";
                  a.click();
                  URL.revokeObjectURL(url);
                } else {
                  alert("Failed to generate report");
                }
              } catch {
                alert("Failed to download report");
              }
            }}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm"
          >
            Download PDF
          </button>
        </div>
      </div>
    );
  }

  // Interview in progress
  const currentQuestion = questions[currentIndex];

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Mock Interview
          </h1>
          <span className="text-sm text-slate-600 dark:text-slate-400">
            Question {currentIndex + 1} of {questions.length}
          </span>
        </div>
        {/* Progress bar */}
        <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full">
          <div
            className="h-full bg-purple-500 rounded-full transition-all"
            style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
          />
        </div>
      </div>

      {currentQuestion && (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700 mb-6">
          <p className="text-lg text-slate-900 dark:text-slate-100 leading-relaxed">
            {currentQuestion.text}
          </p>
          <div className="flex gap-2 mt-3">
            {currentQuestion.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
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
            onStart={() => setIsRecording(true)}
            onStop={() => setIsRecording(false)}
            disabled={loading}
            timeLimit={timePerQuestion}
          />
        )}
      </div>

      {isRecording && (
        <p className="text-xs text-center text-slate-500 dark:text-slate-400 mt-4">
          No going back. No hints. Answer as if this were a real interview.
        </p>
      )}
    </div>
  );
}
