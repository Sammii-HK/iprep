import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <main className="flex flex-col items-center gap-8 px-4 text-center">
        <h1 className="text-5xl font-bold text-gray-900">
          Interview Coach
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl">
          AI-powered spoken interview practice with automatic transcription, scoring, and actionable feedback.
        </p>
        <div className="flex gap-4">
          <Link
            href="/banks"
            className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-semibold"
          >
            Get Started
          </Link>
          <Link
            href="/practice"
            className="px-6 py-3 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
          >
            Practice Now
          </Link>
        </div>
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl">
          <div className="p-6 bg-white rounded-lg shadow">
            <h3 className="font-semibold text-lg mb-2">Voice Practice</h3>
            <p className="text-gray-600">
              Record your answers and get instant transcription with AI-powered analysis.
            </p>
          </div>
          <div className="p-6 bg-white rounded-lg shadow">
            <h3 className="font-semibold text-lg mb-2">Comprehensive Scoring</h3>
            <p className="text-gray-600">
              Track delivery metrics (WPM, fillers) and content quality (STAR, impact, clarity).
            </p>
          </div>
          <div className="p-6 bg-white rounded-lg shadow">
            <h3 className="font-semibold text-lg mb-2">Progress Analytics</h3>
            <p className="text-gray-600">
              Visualize your improvement over time and identify areas for growth.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}