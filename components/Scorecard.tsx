"use client";

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
	dontForget?: string[];
	questionTags?: string[]; // To determine if question is technical
}

// Move ScoreBar outside to avoid creating components during render
function ScoreBar({ label, value }: { label: string; value: number | null }) {
	const score = value ?? 0;
	const percentage = (score / 5) * 100;

	return (
		<div className="mb-4">
			<div className="flex justify-between mb-1">
				<span className="text-sm font-medium text-slate-900 dark:text-slate-100">
					{label}
				</span>
				<span className="text-sm text-slate-700 dark:text-slate-300">
					{score}/5
				</span>
			</div>
			<div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
				<div
					className={`h-2 rounded-full transition-all ${
						percentage >= 80
							? "bg-green-500 dark:bg-green-400"
							: percentage >= 60
							? "bg-yellow-500 dark:bg-yellow-400"
							: "bg-red-500 dark:bg-red-400"
					}`}
					style={{ width: `${percentage}%` }}
				/>
			</div>
		</div>
	);
}

// Helper to determine if question is technical (not behavioral/STAR)
function isTechnicalQuestion(tags?: string[]): boolean {
	if (!tags || tags.length === 0) return true; // Default to technical if no tags
	// Behavioral tags that indicate STAR format needed
	const behavioralTags = [
		"behavioral",
		"star",
		"situation",
		"leadership",
		"teamwork",
		"conflict",
		"challenge",
	];
	return !tags.some((tag) =>
		behavioralTags.some((bt) => tag.toLowerCase().includes(bt.toLowerCase()))
	);
}

export function Scorecard({
	metrics,
	scores,
	audioUrl,
	questionAnswered,
	answerQuality,
	whatWasRight,
	whatWasWrong,
	betterWording,
	dontForget,
	questionTags,
}: ScorecardProps) {
	const isTechnical = isTechnicalQuestion(questionTags);
	// tips removed from display but kept in interface for future session recap feature

	return (
		<div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
			<h2 className="text-2xl font-bold mb-6 text-slate-900 dark:text-slate-100">
				Scorecard
			</h2>

			{/* Consolidated Answer Quality */}
			{(questionAnswered !== undefined ||
				answerQuality !== undefined ||
				whatWasRight ||
				whatWasWrong ||
				betterWording ||
				dontForget) && (
				<div className="mb-6 p-4 rounded-lg border-2 border-slate-200 dark:border-slate-700">
					<h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-slate-100">
						Answer Feedback
					</h3>

					{questionAnswered !== undefined && (
						<div className="mb-3">
							<span
								className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${
									questionAnswered
										? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
										: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
								}`}
							>
								{questionAnswered
									? "✓ Question Answered"
									: "✗ Question Not Fully Answered"}
							</span>
						</div>
					)}

					{whatWasRight && whatWasRight.length > 0 && (
						<div className="mb-3">
							<h4 className="text-sm font-semibold text-green-700 dark:text-green-300 mb-2">
								✓ What You Got Right:
							</h4>
							<ul className="list-disc list-inside space-y-1 text-sm text-slate-700 dark:text-slate-300">
								{whatWasRight.map((item, index) => (
									<li key={index}>{item}</li>
								))}
							</ul>
						</div>
					)}

					{whatWasWrong && whatWasWrong.length > 0 && (
						<div className="mb-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
							<h4 className="text-sm font-semibold text-purple-700 dark:text-purple-300 dark:text-purple-300 mb-2">
								📝 Points to Remember:
							</h4>
							<ul className="list-disc list-inside space-y-1 text-sm text-slate-700 dark:text-slate-300">
								{whatWasWrong.map((item, index) => (
									<li key={index}>{item}</li>
								))}
							</ul>
						</div>
					)}

					{dontForget && dontForget.length > 0 && (
						<div className="mb-3 p-3 bg-slate-50 dark:bg-slate-700 rounded-lg">
							<h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
								Key Points to Include:
							</h4>
							<ul className="list-disc list-inside space-y-1 text-sm text-slate-700 dark:text-slate-200">
								{dontForget.map((item, index) => (
									<li key={index}>{item}</li>
								))}
							</ul>
						</div>
					)}

					{betterWording && betterWording.length > 0 && (
						<div className="mb-3">
							<h4 className="text-sm font-semibold text-purple-700 dark:text-purple-300 dark:text-purple-300 mb-2">
								💡 Better Wording Suggestions:
							</h4>
							<ul className="list-disc list-inside space-y-2 text-sm text-slate-700 dark:text-slate-300">
								{betterWording.map((item, index) => (
									<li key={index} className="leading-relaxed">
										{item}
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			)}

			{/* Delivery Metrics */}
			<div className="mb-6">
				<h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-slate-100">
					Delivery Metrics
				</h3>
				<div className="grid grid-cols-2 gap-4 text-sm">
					<div>
						<span className="text-slate-600 dark:text-slate-400">Words:</span>{" "}
						<span className="font-semibold text-slate-900 dark:text-slate-100">
							{metrics.words ?? "N/A"}
						</span>
					</div>
					<div>
						<span className="text-slate-600 dark:text-slate-400">WPM:</span>{" "}
						<span className="font-semibold text-slate-900 dark:text-slate-100">
							{metrics.wpm ?? "N/A"}
						</span>
					</div>
					<div>
						<span className="text-slate-600 dark:text-slate-400">Fillers:</span>{" "}
						<span className="font-semibold text-slate-900 dark:text-slate-100">
							{metrics.fillerCount ?? "N/A"}
						</span>
					</div>
					<div>
						<span className="text-slate-600 dark:text-slate-400">
							Filler Rate:
						</span>{" "}
						<span className="font-semibold text-slate-900 dark:text-slate-100">
							{metrics.fillerRate !== null
								? `${metrics.fillerRate.toFixed(1)}%`
								: "N/A"}
						</span>
					</div>
					<div>
						<span className="text-slate-600 dark:text-slate-400">
							Long Pauses:
						</span>{" "}
						<span className="font-semibold text-slate-900 dark:text-slate-100">
							{metrics.longPauses ?? "N/A"}
						</span>
					</div>
				</div>
			</div>

			{/* Scores */}
			<div className="mb-6">
				<h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-slate-100">
					Content Scores
				</h3>
				{!isTechnical && (
					<>
						<ScoreBar label="STAR" value={scores.star} />
						<ScoreBar label="Impact" value={scores.impact} />
					</>
				)}
				<ScoreBar label="Clarity" value={scores.clarity} />
			</div>

			{/* Technical Scores */}
			{(scores.technicalAccuracy !== undefined ||
				scores.terminologyUsage !== undefined) && (
				<div className="mb-6">
					<h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-slate-100">
						Technical Knowledge
					</h3>
					<ScoreBar
						label="Technical Accuracy"
						value={scores.technicalAccuracy ?? null}
					/>
					<ScoreBar
						label="Terminology Usage"
						value={scores.terminologyUsage ?? null}
					/>
				</div>
			)}

			{/* Delivery Scores */}
			<div className="mb-6">
				<h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-slate-100">
					Delivery
				</h3>
				<div className="mb-2">
					<ScoreBar label="Confidence" value={scores.confidence} />
					<p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
						Based on: sentence completion, filler usage (
						{metrics.fillerRate?.toFixed(1) ?? 0}%), long pauses (
						{metrics.longPauses ?? 0}), and strong declarative statements
					</p>
				</div>
				<div className="mb-2">
					<ScoreBar label="Intonation" value={scores.intonation} />
					<p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
						Based on: sentence length variation, emphasis words, expressiveness
						(exclamations/questions), and natural speech patterns
					</p>
				</div>
			</div>

			{/* Audio Playback */}
			{audioUrl && (
				<div className="mt-4">
					<audio controls className="w-full">
						{/* Support multiple formats for iOS compatibility */}
						<source src={audioUrl} type="audio/webm" />
						<source src={audioUrl} type="audio/mp4" />
						<source src={audioUrl} type="audio/m4a" />
						<source src={audioUrl} type="audio/aac" />
						Your browser does not support the audio element.
					</audio>
				</div>
			)}
		</div>
	);
}
