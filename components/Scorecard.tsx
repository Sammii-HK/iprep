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
          <span className="text-sm font-medium">{label}</span>
          <span className="text-sm text-gray-600">{score}/5</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              percentage >= 80
                ? 'bg-green-500'
                : percentage >= 60
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold mb-6">Scorecard</h2>

      {/* Delivery Metrics */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3">Delivery Metrics</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-600">Words:</span>{' '}
            <span className="font-semibold">{metrics.words ?? 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-600">WPM:</span>{' '}
            <span className="font-semibold">{metrics.wpm ?? 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-600">Fillers:</span>{' '}
            <span className="font-semibold">{metrics.fillerCount ?? 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-600">Filler Rate:</span>{' '}
            <span className="font-semibold">
              {metrics.fillerRate !== null ? `${metrics.fillerRate.toFixed(1)}%` : 'N/A'}
            </span>
          </div>
          <div>
            <span className="text-gray-600">Long Pauses:</span>{' '}
            <span className="font-semibold">{metrics.longPauses ?? 'N/A'}</span>
          </div>
        </div>
      </div>

      {/* Scores */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3">Scores</h3>
        <ScoreBar label="Confidence" value={scores.confidence} />
        <ScoreBar label="Intonation" value={scores.intonation} />
        <ScoreBar label="STAR" value={scores.star} />
        <ScoreBar label="Impact" value={scores.impact} />
        <ScoreBar label="Clarity" value={scores.clarity} />
      </div>

      {/* Tips */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3">Coaching Tips</h3>
        <ul className="list-disc list-inside space-y-2 text-sm">
          {tips.map((tip, index) => (
            <li key={index} className="text-gray-700">
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
