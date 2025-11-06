'use client';

interface ScorecardProps {
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
  tips: string[];
  audioUrl?: string | null;
}

export function Scorecard({ metrics, scores, tips, audioUrl }: ScorecardProps) {
  const ScoreBar = ({ label, value }: { label: string; value: number | null }) => {
    const score = value ?? 0;
    const percentage = (score / 5) * 100;

    return (
      <div className="mb-4">
        <div className="flex justify-between mb-1">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</span>
          <span className="text-sm text-slate-700 dark:text-slate-300">{score}/5</span>
        </div>
        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              percentage >= 80
                ? 'bg-green-500 dark:bg-green-400'
                : percentage >= 60
                  ? 'bg-yellow-500 dark:bg-yellow-400'
                  : 'bg-red-500 dark:bg-red-400'
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
      <h2 className="text-2xl font-bold mb-6 text-slate-900 dark:text-slate-100">Scorecard</h2>

      {/* Delivery Metrics */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-slate-100">Delivery Metrics</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-slate-600 dark:text-slate-400">Words:</span>{' '}
            <span className="font-semibold text-slate-900 dark:text-slate-100">{metrics.words ?? 'N/A'}</span>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">WPM:</span>{' '}
            <span className="font-semibold text-slate-900 dark:text-slate-100">{metrics.wpm ?? 'N/A'}</span>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">Fillers:</span>{' '}
            <span className="font-semibold text-slate-900 dark:text-slate-100">{metrics.fillerCount ?? 'N/A'}</span>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">Filler Rate:</span>{' '}
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {metrics.fillerRate !== null ? `${metrics.fillerRate.toFixed(1)}%` : 'N/A'}
            </span>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">Long Pauses:</span>{' '}
            <span className="font-semibold text-slate-900 dark:text-slate-100">{metrics.longPauses ?? 'N/A'}</span>
          </div>
        </div>
      </div>

      {/* Scores */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-slate-100">Content Scores</h3>
        <ScoreBar label="STAR" value={scores.star} />
        <ScoreBar label="Impact" value={scores.impact} />
        <ScoreBar label="Clarity" value={scores.clarity} />
      </div>

      {/* Technical Scores */}
      {(scores.technicalAccuracy !== undefined || scores.terminologyUsage !== undefined) && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-slate-100">Technical Knowledge</h3>
          <ScoreBar label="Technical Accuracy" value={scores.technicalAccuracy ?? null} />
          <ScoreBar label="Terminology Usage" value={scores.terminologyUsage ?? null} />
        </div>
      )}

      {/* Delivery Scores */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-slate-100">Delivery</h3>
        <ScoreBar label="Confidence" value={scores.confidence} />
        <ScoreBar label="Intonation" value={scores.intonation} />
      </div>

      {/* Tips */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-slate-100">Coaching Tips</h3>
        <ul className="list-disc list-inside space-y-2 text-sm">
          {tips.map((tip, index) => (
            <li key={index} className="text-slate-700 dark:text-slate-300">
              {tip}
            </li>
          ))}
        </ul>
      </div>

      {/* Audio Playback */}
      {audioUrl && (
        <div className="mt-4">
          <audio controls className="w-full">
            <source src={audioUrl} type="audio/webm" />
            Your browser does not support the audio element.
          </audio>
        </div>
      )}
    </div>
  );
}
