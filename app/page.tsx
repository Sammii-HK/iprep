import Link from "next/link";

export default function Home() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
			<main className="flex flex-col items-center gap-12 px-4 text-center max-w-6xl w-full py-16">
				{/* Hero Section */}
				<div className="space-y-6">
					<div className="inline-block">
						<h1 className="text-6xl md:text-7xl font-bold bg-gradient-to-r from-purple-400 to-purple-600 dark:from-purple-300 dark:to-purple-500 bg-clip-text text-transparent">
							iPrep
						</h1>
					</div>
					<p className="text-xl md:text-2xl text-slate-700 dark:text-slate-300 max-w-3xl mx-auto leading-relaxed">
						AI-powered spoken interview practice with automatic transcription,
						scoring, and actionable feedback.
					</p>
					<div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
						<Link
							href="/dashboard"
							className="px-8 py-4 bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-xl transition-all font-semibold text-lg shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
						>
							Get Started
						</Link>
						<Link
							href="/practice"
							className="px-8 py-4 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border-2 border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all font-semibold text-lg shadow-md hover:shadow-lg"
						>
							Practice Now
						</Link>
					</div>
				</div>

				{/* Features Grid */}
				<div className="mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl w-full">
					<div className="p-6 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl shadow-lg hover:shadow-xl transition-all border border-slate-200 dark:border-slate-700">
						<div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center mb-4 mx-auto">
							<svg
								className="w-6 h-6 text-purple-600 dark:text-purple-400 dark:text-purple-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
								/>
							</svg>
						</div>
						<h3 className="font-bold text-xl mb-2 text-slate-900 dark:text-slate-100">
							Voice Practice
						</h3>
						<p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm">
							Record your answers with live captions and get instant
							transcription with AI-powered analysis.
						</p>
					</div>

					<div className="p-6 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl shadow-lg hover:shadow-xl transition-all border border-slate-200 dark:border-slate-700">
						<div className="w-12 h-12 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center mb-4 mx-auto">
							<svg
								className="w-6 h-6 text-purple-600 dark:text-purple-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
								/>
							</svg>
						</div>
						<h3 className="font-bold text-xl mb-2 text-slate-900 dark:text-slate-100">
							Comprehensive Scoring
						</h3>
						<p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm">
							Delivery metrics (WPM, fillers, pauses), content quality (STAR,
							impact, clarity), and technical knowledge assessment.
						</p>
					</div>

					<div className="p-6 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl shadow-lg hover:shadow-xl transition-all border border-slate-200 dark:border-slate-700">
						<div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center mb-4 mx-auto">
							<svg
								className="w-6 h-6 text-green-600 dark:text-green-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
								/>
							</svg>
						</div>
						<h3 className="font-bold text-xl mb-2 text-slate-900 dark:text-slate-100">
							Progress Analytics
						</h3>
						<p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm">
							Track trends over time, identify weak areas by tags, and visualize
							your improvement with detailed charts.
						</p>
					</div>

					<div className="p-6 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl shadow-lg hover:shadow-xl transition-all border border-slate-200 dark:border-slate-700">
						<div className="w-12 h-12 bg-orange-100 dark:bg-orange-900 rounded-lg flex items-center justify-center mb-4 mx-auto">
							<svg
								className="w-6 h-6 text-orange-600 dark:text-orange-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
								/>
							</svg>
						</div>
						<h3 className="font-bold text-xl mb-2 text-slate-900 dark:text-slate-100">
							Question Banks
						</h3>
						<p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm">
							Import CSV/JSON question sets with drag-and-drop. Organize by tags
							and difficulty levels.
						</p>
					</div>

					<div className="p-6 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl shadow-lg hover:shadow-xl transition-all border border-slate-200 dark:border-slate-700">
						<div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900 rounded-lg flex items-center justify-center mb-4 mx-auto">
							<svg
								className="w-6 h-6 text-indigo-600 dark:text-indigo-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
						</div>
						<h3 className="font-bold text-xl mb-2 text-slate-900 dark:text-slate-100">
							AI-Powered Feedback
						</h3>
						<p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm">
							Get actionable tips on content structure, technical accuracy,
							delivery, and speaking skills.
						</p>
					</div>

					<div className="p-6 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl shadow-lg hover:shadow-xl transition-all border border-slate-200 dark:border-slate-700">
						<div className="w-12 h-12 bg-pink-100 dark:bg-pink-900 rounded-lg flex items-center justify-center mb-4 mx-auto">
							<svg
								className="w-6 h-6 text-pink-600 dark:text-pink-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
								/>
							</svg>
						</div>
						<h3 className="font-bold text-xl mb-2 text-slate-900 dark:text-slate-100">
							Practice & Quizzes
						</h3>
						<p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm">
							Practice sessions with retry capability and structured quizzes
							(spoken & written) with completion tracking.
						</p>
					</div>

					<div className="p-6 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl shadow-lg hover:shadow-xl transition-all border border-slate-200 dark:border-slate-700">
						<div className="w-12 h-12 bg-teal-100 dark:bg-teal-900 rounded-lg flex items-center justify-center mb-4 mx-auto">
							<svg
								className="w-6 h-6 text-teal-600 dark:text-teal-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
								/>
							</svg>
						</div>
						<h3 className="font-bold text-xl mb-2 text-slate-900 dark:text-slate-100">
							Technical Assessment
						</h3>
						<p className="text-slate-700 dark:text-slate-300 leading-relaxed text-sm">
							Domain-specific technical accuracy scoring and terminology usage
							evaluation based on question tags.
						</p>
					</div>
				</div>
			</main>
		</div>
	);
}
