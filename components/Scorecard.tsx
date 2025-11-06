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
  questionAnswered?: boolean | null;
  answerQuality?: number | null;
  whatWasRight?: string[];
  whatWasWrong?: string[];
  betterWording?: string[];
}

// Move ScoreBar outside to avoid creating components during render
function ScoreBar({ label, value }: { label: string; value: number | null }) {
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
}

export function Scorecard({ 
  metrics, 
  scores, 
  tips, 
  audioUrl,
  questionAnswered,
  answerQuality,
  whatWasRight,
  whatWasWrong,
  betterWording,
}: ScorecardProps) {

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
      <h2 className="text-2xl font-bold mb-6 text-slate-900 dark:text-slate-100">Scorecard</h2>

      {/* Consolidated Answer Quality & Coaching Tips */}
      {((questionAnswered !== undefined || answerQuality !== undefined || whatWasRight || whatWasWrong || betterWording) || (tips && tips.length > 0)) && (
        <div className="mb-6 p-4 rounded-lg border-2 border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-slate-100">Feedback & Coaching</h3>
          
          {questionAnswered !== undefined && (
            <div className="mb-3">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${
                questionAnswered 
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                  : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
              }`}>
                {questionAnswered ? '✓ Question Answered' : '✗ Question Not Fully Answered'}
              </span>
            </div>
          )}

          {whatWasRight && whatWasRight.length > 0 && (
            <div className="mb-3">
              <h4 className="text-sm font-semibold text-green-700 dark:text-green-300 mb-2">✓ What You Got Right:</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-slate-700 dark:text-slate-300">
                {whatWasRight.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {whatWasWrong && whatWasWrong.length > 0 && (
            <div className="mb-3">
              <h4 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2">✗ What Needs Improvement:</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-slate-700 dark:text-slate-300">
                {whatWasWrong.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {betterWording && betterWording.length > 0 && (
            <div className="mb-3">
              <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-300 mb-2">💡 Better Wording Suggestions:</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-slate-700 dark:text-slate-300">
                {betterWording.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Coaching Tips - consolidated with answer quality */}
          {tips && tips.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-purple-700 dark:text-purple-300 mb-2">🎯 Actionable Tips:</h4>
              <ul className="list-disc list-inside space-y-2 text-sm text-slate-700 dark:text-slate-300">
                {tips.map((tip, index) => (
                  <li key={index} className="leading-relaxed">{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

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
