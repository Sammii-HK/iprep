"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

interface Question {
  id: string;
  text: string;
  hint?: string | null;
  tags: string[];
  difficulty: number;
}

type Confidence = "know" | "kinda" | "dont_know";

interface CardState {
  questionId: string;
  confidence: Confidence;
  lastReviewed: number;
  reviewCount: number;
}

export default function StudyBankPage() {
  const params = useParams();
  const router = useRouter();
  const bankId = params.bankId as string;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bankTitle, setBankTitle] = useState("");
  const [cardStates, setCardStates] = useState<Record<string, CardState>>({});
  const [studyQueue, setStudyQueue] = useState<string[]>([]);

  const loadCardStates = useCallback(() => {
    const saved = localStorage.getItem(`study_${bankId}_states`);
    if (saved) {
      try {
        return JSON.parse(saved) as Record<string, CardState>;
      } catch {
        return {};
      }
    }
    return {};
  }, [bankId]);

  const saveCardStates = useCallback(
    (states: Record<string, CardState>) => {
      localStorage.setItem(`study_${bankId}_states`, JSON.stringify(states));
    },
    [bankId]
  );

  const buildStudyQueue = useCallback(
    (questions: Question[], states: Record<string, CardState>) => {
      // Spaced repetition: prioritize cards the user doesn't know
      // Order: dont_know first, then kinda, then know (with longer intervals)
      const now = Date.now();
      const scored = questions.map((q) => {
        const state = states[q.id];
        if (!state) return { id: q.id, priority: 0 }; // Never seen = highest priority

        const hoursSince = (now - state.lastReviewed) / (1000 * 60 * 60);
        let priority: number;

        if (state.confidence === "dont_know") {
          priority = 1; // Always review soon
        } else if (state.confidence === "kinda") {
          priority = hoursSince > 1 ? 2 : 10; // Review after 1 hour
        } else {
          priority = hoursSince > 24 ? 3 : 20; // Review after 24 hours
        }

        return { id: q.id, priority };
      });

      scored.sort((a, b) => a.priority - b.priority);
      return scored.map((s) => s.id);
    },
    []
  );

  const fetchQuestions = useCallback(async () => {
    try {
      const res = await fetch(`/api/banks/${bankId}`);
      if (!res.ok) {
        alert("Failed to load bank");
        router.push("/study");
        return;
      }
      const data = await res.json();
      setBankTitle(data.title || "Study");
      const qs = data.questions || [];
      setQuestions(qs);

      const states = loadCardStates();
      setCardStates(states);
      const queue = buildStudyQueue(qs, states);
      setStudyQueue(queue);
      setCurrentIndex(0);
    } catch (error) {
      console.error("Error fetching bank:", error);
    } finally {
      setLoading(false);
    }
  }, [bankId, router, loadCardStates, buildStudyQueue]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const currentQuestionId = studyQueue[currentIndex];
  const currentQuestion = questions.find((q) => q.id === currentQuestionId);
  const currentState = currentQuestionId ? cardStates[currentQuestionId] : undefined;

  const markConfidence = (confidence: Confidence) => {
    if (!currentQuestionId) return;

    const newStates = {
      ...cardStates,
      [currentQuestionId]: {
        questionId: currentQuestionId,
        confidence,
        lastReviewed: Date.now(),
        reviewCount: (currentState?.reviewCount || 0) + 1,
      },
    };
    setCardStates(newStates);
    saveCardStates(newStates);

    // Move to next card
    setFlipped(false);
    if (currentIndex + 1 < studyQueue.length) {
      setCurrentIndex(currentIndex + 1);
    } else {
      // Rebuild queue for another round
      const newQueue = buildStudyQueue(questions, newStates);
      setStudyQueue(newQueue);
      setCurrentIndex(0);
    }
  };

  // Stats
  const totalCards = questions.length;
  const known = Object.values(cardStates).filter((s) => s.confidence === "know").length;
  const kinda = Object.values(cardStates).filter((s) => s.confidence === "kinda").length;
  const dontKnow = Object.values(cardStates).filter((s) => s.confidence === "dont_know").length;
  const unseen = totalCards - known - kinda - dontKnow;

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{bankTitle}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Card {currentIndex + 1} of {studyQueue.length}
          </p>
        </div>
        <button
          onClick={() => router.push("/study")}
          className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-sm hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
        >
          Back
        </button>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1 mb-6 h-2">
        {totalCards > 0 && (
          <>
            <div className="bg-green-500 rounded-full" style={{ width: `${(known / totalCards) * 100}%` }} />
            <div className="bg-yellow-500 rounded-full" style={{ width: `${(kinda / totalCards) * 100}%` }} />
            <div className="bg-red-500 rounded-full" style={{ width: `${(dontKnow / totalCards) * 100}%` }} />
            <div className="bg-slate-300 dark:bg-slate-600 rounded-full" style={{ width: `${(unseen / totalCards) * 100}%` }} />
          </>
        )}
      </div>
      <div className="flex gap-4 text-xs text-slate-600 dark:text-slate-400 mb-6">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-500 rounded-full inline-block" /> Know: {known}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-yellow-500 rounded-full inline-block" /> Kind of: {kinda}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-500 rounded-full inline-block" /> Don&apos;t know: {dontKnow}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-slate-300 rounded-full inline-block" /> Unseen: {unseen}</span>
      </div>

      {/* Flashcard */}
      {currentQuestion ? (
        <div className="mb-6">
          <div
            onClick={() => setFlipped(!flipped)}
            className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border-2 border-slate-200 dark:border-slate-700 p-8 min-h-[200px] flex flex-col items-center justify-center cursor-pointer hover:shadow-xl transition-all select-none"
          >
            {!flipped ? (
              <div className="text-center">
                <p className="text-lg text-slate-900 dark:text-slate-100 leading-relaxed">
                  {currentQuestion.text}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-4">
                  Tap to flip
                </p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm font-semibold text-purple-600 dark:text-purple-400 mb-3">Answer</p>
                <p className="text-base text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {currentQuestion.hint || "No answer provided for this card. Use the question tags as context."}
                </p>
              </div>
            )}
          </div>

          {/* Confidence buttons - only show when flipped */}
          {flipped && (
            <div className="flex gap-3 mt-4 justify-center">
              <button
                onClick={() => markConfidence("dont_know")}
                className="flex-1 px-4 py-3 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-800 dark:text-red-200 rounded-lg font-medium transition-colors"
              >
                Don&apos;t Know
              </button>
              <button
                onClick={() => markConfidence("kinda")}
                className="flex-1 px-4 py-3 bg-yellow-100 dark:bg-yellow-900/30 hover:bg-yellow-200 dark:hover:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200 rounded-lg font-medium transition-colors"
              >
                Kind Of
              </button>
              <button
                onClick={() => markConfidence("know")}
                className="flex-1 px-4 py-3 bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 text-green-800 dark:text-green-200 rounded-lg font-medium transition-colors"
              >
                Know It
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-slate-600 dark:text-slate-400">
          No cards to study.
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-2 justify-center">
        <button
          onClick={() => {
            setFlipped(false);
            setCurrentIndex(Math.max(0, currentIndex - 1));
          }}
          disabled={currentIndex === 0}
          className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
        >
          Previous
        </button>
        <button
          onClick={() => {
            setFlipped(false);
            if (currentIndex + 1 < studyQueue.length) {
              setCurrentIndex(currentIndex + 1);
            }
          }}
          disabled={currentIndex >= studyQueue.length - 1}
          className="px-4 py-2 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-lg hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors disabled:opacity-50"
        >
          Skip
        </button>
        <button
          onClick={() => {
            if (confirm("Reset all progress for this bank?")) {
              const newStates = { ...cardStates };
              questions.forEach((q) => delete newStates[q.id]);
              setCardStates(newStates);
              saveCardStates(newStates);
              const newQueue = buildStudyQueue(questions, newStates);
              setStudyQueue(newQueue);
              setCurrentIndex(0);
              setFlipped(false);
            }
          }}
          className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
