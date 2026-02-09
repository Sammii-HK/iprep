"use client";

import { useState } from "react";

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
		conciseness?: number | null;
		pacing?: number | null;
		emphasis?: number | null;
		engagement?: number | null;
	};
	tips: string[];
	audioUrl?: string | null;
	questionAnswered?: boolean | null;
	answerQuality?: number | null;
	whatWasRight?: string[];
	whatWasWrong?: string[];
	betterWording?: string[];
	dontForget?: string[];
	repeatedWords?: Array<{ word: string; count: number; percentage: number }>;
	hasExcessiveRepetition?: boolean;
	transcript?: string | null;
	onReanalyze?: (correctedTranscript: string) => void; // Callback for re-analysis with corrected transcript
	questionTags?: string[]; // To determine if question is technical
	previousScores?: {
		confidence: number | null;
		intonation: number | null;
		star: number | null;
		impact: number | null;
		clarity: number | null;
		technicalAccuracy?: number | null;
		terminologyUsage?: number | null;
		conciseness?: number | null;
		pacing?: number | null;
		emphasis?: number | null;
		engagement?: number | null;
	} | null;
	previousMetrics?: {
		words: number | null;
		wpm: number | null;
		fillerCount: number | null;
		fillerRate: number | null;
		longPauses: number | null;
	} | null;
}

// Move ScoreBar outside to avoid creating components during render
function ScoreBar({ label, value, previousValue }: { label: string; value: number | null; previousValue?: number | null }) {
	const score = value ?? 0;
	const percentage = (score / 5) * 100;
	const delta = previousValue != null && value != null ? value - previousValue : null;

	return (
		<div className="mb-4">
			<div className="flex justify-between mb-1">
				<span className="text-sm font-medium text-slate-900 dark:text-slate-100">
					{label}
				</span>
				<span className="text-sm text-slate-700 dark:text-slate-300">
					{Number.isInteger(score) ? score : score.toFixed(1)}/5
					{delta !== null && delta !== 0 && (
						<span className={`ml-1.5 text-xs font-semibold ${
							delta > 0
								? "text-green-600 dark:text-green-400"
								: "text-red-600 dark:text-red-400"
						}`}>
							{delta > 0 ? "+" : ""}{Number.isInteger(delta) ? delta : delta.toFixed(1)}
						</span>
					)}
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
	repeatedWords,
	hasExcessiveRepetition,
	transcript,
	onReanalyze,
	questionTags,
	previousScores,
	previousMetrics,
}: ScorecardProps) {
	const isTechnical = isTechnicalQuestion(questionTags);
	const [isEditingTranscript, setIsEditingTranscript] = useState(false);
	const [editedTranscript, setEditedTranscript] = useState(transcript || "");
	const [reanalyzing, setReanalyzing] = useState(false);
	// tips removed from display but kept in interface for future session recap feature

	return (
		<div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
			<h2 className="text-2xl font-bold mb-2 text-slate-900 dark:text-slate-100">
				Scorecard
			</h2>
			{previousScores && (
				<p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
					Compared to previous attempt. <span className="text-green-600 dark:text-green-400">+green</span> = improved, <span className="text-red-600 dark:text-red-400">-red</span> = declined.
				</p>
			)}
			{!previousScores && <div className="mb-4" />}

			{/* Consolidated Answer Quality */}
			{(questionAnswered !== undefined ||
				answerQuality !== undefined ||
				whatWasRight ||
				whatWasWrong ||
				betterWording ||
				dontForget ||
				repeatedWords) && (
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

					{/* Key Points to Include - First */}
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

					{/* Better Wording Suggestions - Second */}
					{betterWording && betterWording.length > 0 && (
						<div className="mb-3">
							<h4 className="text-sm font-semibold text-purple-700 dark:text-purple-300 mb-2">
								💡 Better Wording Suggestions:
							</h4>
							<div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
								{betterWording.map((item, index) => {
									// Check if it's in "You said: '...'. Better: '...'" format
									const youSaidMatch = item.match(
										/You said:\s*['"]([^'"]+)['"]/i
									);
									const betterMatch = item.match(/Better:\s*['"]([^'"]+)['"]/i);

									if (youSaidMatch && betterMatch) {
										// Format: "You said" in italics, "Better" suggestion in bold
										return (
											<div key={index} className="leading-relaxed">
												<p className="italic text-slate-600 dark:text-slate-400 mb-1">
													You said: &ldquo;{youSaidMatch[1]}&rdquo;
												</p>
												<p className="font-semibold">
													Suggestion: &ldquo;{betterMatch[1]}&rdquo;
												</p>
											</div>
										);
									}

									// Check if it starts with "Better:" (without "You said")
									const betterOnlyMatch = item.match(/Better:\s*(.+)/i);
									if (betterOnlyMatch) {
										return (
											<div key={index} className="leading-relaxed">
												<p className="font-semibold">
													Better: {betterOnlyMatch[1]}
												</p>
											</div>
										);
									}

									// Regular suggestion - make it bold
									return (
										<div key={index} className="leading-relaxed">
											<p className="font-semibold">{item}</p>
										</div>
									);
								})}
							</div>
						</div>
					)}

					{/* What You Got Right - Third */}
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
							<h4 className="text-sm font-semibold text-purple-700 dark:text-purple-300 mb-2">
								📝 Points to Remember:
							</h4>
							<ul className="list-disc list-inside space-y-1 text-sm text-slate-700 dark:text-slate-300">
								{whatWasWrong.map((item, index) => (
									<li key={index}>{item}</li>
								))}
							</ul>
						</div>
					)}

					{/* Repeated Words Analysis */}
					{repeatedWords && repeatedWords.length > 0 && (
						<div className={`mb-3 p-3 rounded-lg border ${
							hasExcessiveRepetition
								? "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800"
								: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
						}`}>
							<h4 className={`text-sm font-semibold mb-2 ${
								hasExcessiveRepetition
									? "text-orange-700 dark:text-orange-300"
									: "text-blue-700 dark:text-blue-300"
							}`}>
								{hasExcessiveRepetition ? "⚠️" : "📊"} Repeated Words:
							</h4>
							<p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
								{hasExcessiveRepetition
									? "You're overusing these words. Try using synonyms or varying your vocabulary."
									: "These words appear frequently in your answer. Consider using synonyms for variety."}
							</p>
							<div className="flex flex-wrap gap-2">
								{repeatedWords.map((item, index) => (
									<div
										key={index}
										className={`px-2 py-1 rounded text-xs font-medium ${
											hasExcessiveRepetition
												? "bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200"
												: "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200"
										}`}
									>
										<span className="font-semibold">&ldquo;{item.word}&rdquo;</span>
										<span className="ml-1 opacity-75">
											({item.count}x, {item.percentage}%)
										</span>
									</div>
								))}
							</div>
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
							{previousMetrics?.fillerCount != null && metrics.fillerCount != null && metrics.fillerCount !== previousMetrics.fillerCount && (
								<span className={`ml-1 text-xs font-semibold ${
									metrics.fillerCount < previousMetrics.fillerCount
										? "text-green-600 dark:text-green-400"
										: "text-red-600 dark:text-red-400"
								}`}>
									{metrics.fillerCount < previousMetrics.fillerCount ? "" : "+"}{metrics.fillerCount - previousMetrics.fillerCount}
								</span>
							)}
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
						<ScoreBar label="STAR" value={scores.star} previousValue={previousScores?.star} />
						<ScoreBar label="Impact" value={scores.impact} previousValue={previousScores?.impact} />
					</>
				)}
				<ScoreBar label="Clarity" value={scores.clarity} previousValue={previousScores?.clarity} />
				{scores.conciseness !== undefined && scores.conciseness !== null && (
					<ScoreBar label="Conciseness" value={scores.conciseness} previousValue={previousScores?.conciseness} />
				)}
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
						previousValue={previousScores?.technicalAccuracy}
					/>
					<ScoreBar
						label="Terminology Usage"
						value={scores.terminologyUsage ?? null}
						previousValue={previousScores?.terminologyUsage}
					/>
				</div>
			)}

			{/* Delivery Scores */}
			<div className="mb-6">
				<h3 className="text-lg font-semibold mb-3 text-slate-900 dark:text-slate-100">
					Delivery
				</h3>
				<div className="mb-2">
					<ScoreBar label="Confidence" value={scores.confidence} previousValue={previousScores?.confidence} />
					<p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
						Based on: sentence completion, filler usage (
						{metrics.fillerRate?.toFixed(1) ?? 0}%), long pauses (
						{metrics.longPauses ?? 0}), and strong declarative statements
					</p>
				</div>
				<div className="mb-2">
					<ScoreBar label="Intonation" value={scores.intonation} previousValue={previousScores?.intonation} />
					<p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
						Based on: sentence length variation, emphasis words, expressiveness
						(exclamations/questions), and natural speech patterns
					</p>
				</div>
				{scores.pacing !== undefined && scores.pacing !== null && (
					<ScoreBar label="Pacing" value={scores.pacing} previousValue={previousScores?.pacing} />
				)}
				{scores.emphasis !== undefined && scores.emphasis !== null && (
					<ScoreBar label="Emphasis" value={scores.emphasis} previousValue={previousScores?.emphasis} />
				)}
				{scores.engagement !== undefined && scores.engagement !== null && (
					<ScoreBar label="Engagement" value={scores.engagement} previousValue={previousScores?.engagement} />
				)}
			</div>

			{/* Transcript */}
			{transcript && (
				<div className="mb-6">
					<div className="flex items-center justify-between mb-2">
						<h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
							Transcript
						</h3>
						{onReanalyze && (
							<button
								onClick={() => {
									if (isEditingTranscript) {
										setIsEditingTranscript(false);
										setEditedTranscript(transcript);
									} else {
										setEditedTranscript(transcript);
										setIsEditingTranscript(true);
									}
								}}
								className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded transition-colors"
							>
								{isEditingTranscript ? "Cancel" : "Edit"}
							</button>
						)}
					</div>
					{isEditingTranscript ? (
						<div>
							<textarea
								value={editedTranscript}
								onChange={(e) => setEditedTranscript(e.target.value)}
								className="w-full p-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100 resize-y min-h-[100px]"
								rows={4}
							/>
							<button
								onClick={async () => {
									if (editedTranscript.trim() === transcript.trim()) {
										setIsEditingTranscript(false);
										return;
									}
									setReanalyzing(true);
									try {
										await onReanalyze!(editedTranscript.trim());
									} finally {
										setReanalyzing(false);
										setIsEditingTranscript(false);
									}
								}}
								disabled={reanalyzing || editedTranscript.trim() === transcript.trim()}
								className="mt-2 px-3 py-1.5 bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{reanalyzing ? "Re-analyzing..." : "Re-analyze with corrections"}
							</button>
						</div>
					) : (
						<p className="text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-700/50 p-3 rounded-lg leading-relaxed">
							{transcript}
						</p>
					)}
				</div>
			)}

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
