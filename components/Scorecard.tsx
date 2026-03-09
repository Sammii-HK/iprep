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
	onReanalyze?: (correctedTranscript: string) => void;
	questionTags?: string[];
	questionType?: string; // QuestionType enum: BEHAVIORAL | TECHNICAL | DEFINITION | SCENARIO | PITCH
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

// STAR is only shown for behavioral/scenario questions
function showStarScoring(questionType?: string, tags?: string[]): boolean {
	if (questionType) {
		return questionType === "BEHAVIORAL" || questionType === "SCENARIO";
	}
	// Fallback to tag detection if type not provided
	if (!tags || tags.length === 0) return false;
	const behavioralTags = ["behavioral", "star", "situation", "leadership", "teamwork", "conflict", "challenge"];
	return tags.some((tag) => behavioralTags.some((bt) => tag.toLowerCase().includes(bt.toLowerCase())));
}

function scoreColor(pct: number) {
	if (pct >= 70) return "text-green-600 dark:text-green-400";
	if (pct >= 50) return "text-amber-600 dark:text-amber-400";
	return "text-red-500 dark:text-red-400";
}

function barColor(pct: number) {
	if (pct >= 70) return "bg-green-500 dark:bg-green-400";
	if (pct >= 50) return "bg-amber-500 dark:bg-amber-400";
	return "bg-red-500 dark:bg-red-400";
}

function ScoreBar({ label, value, previousValue }: { label: string; value: number | null; previousValue?: number | null }) {
	const score = value ?? 0;
	const pct = (score / 10) * 100;
	const delta = previousValue != null && value != null ? value - previousValue : null;

	return (
		<div className="mb-3">
			<div className="flex justify-between items-baseline mb-1">
				<span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate pr-2">{label}</span>
				<span className={`text-sm font-bold shrink-0 ${scoreColor(pct)}`}>
					{Number.isInteger(score) ? score : score.toFixed(1)}
					<span className="text-xs font-normal text-slate-400">/10</span>
					{delta !== null && delta !== 0 && (
						<span className={`ml-1 text-xs font-semibold ${delta > 0 ? "text-green-500" : "text-red-500"}`}>
							{delta > 0 ? "+" : ""}{Number.isInteger(delta) ? delta : delta.toFixed(1)}
						</span>
					)}
				</span>
			</div>
			<div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5">
				<div className={`h-1.5 rounded-full transition-all ${barColor(pct)}`} style={{ width: `${pct}%` }} />
			</div>
		</div>
	);
}

function ScoreTile({ label, value, previousValue }: { label: string; value: number | null; previousValue?: number | null }) {
	const score = value ?? 0;
	const pct = (score / 10) * 100;
	const delta = previousValue != null && value != null ? value - previousValue : null;

	return (
		<div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
			<div className={`text-xl font-bold ${scoreColor(pct)}`}>
				{Number.isInteger(score) ? score : score.toFixed(1)}
				<span className="text-xs font-normal text-slate-400">/10</span>
			</div>
			<div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">{label}</div>
			{delta !== null && delta !== 0 && (
				<div className={`text-xs font-semibold mt-1 ${delta > 0 ? "text-green-500" : "text-red-500"}`}>
					{delta > 0 ? "+" : ""}{Number.isInteger(delta) ? delta : delta.toFixed(1)}
				</div>
			)}
			<div className="mt-2 h-1 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
				<div className={`h-full rounded-full ${barColor(pct)}`} style={{ width: `${pct}%` }} />
			</div>
		</div>
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
	questionType,
	previousScores,
	previousMetrics,
}: ScorecardProps) {
	const isBehavioral = showStarScoring(questionType, questionTags);
	const [showDelivery, setShowDelivery] = useState(false);
	const [isEditingTranscript, setIsEditingTranscript] = useState(false);
	const [editedTranscript, setEditedTranscript] = useState(transcript || "");
	const [reanalyzing, setReanalyzing] = useState(false);
	const [showTranscript, setShowTranscript] = useState(false);

	const quality = answerQuality ?? 0;
	const qualityPct = (quality / 10) * 100;

	return (
		<div className="bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700 overflow-hidden">

			{/* ── Overall score header ─────────────────────────── */}
			<div className={`px-5 py-4 border-b border-slate-200 dark:border-slate-700 ${
				qualityPct >= 70 ? "bg-green-50 dark:bg-green-900/10" :
				qualityPct >= 50 ? "bg-amber-50 dark:bg-amber-900/10" :
				"bg-red-50 dark:bg-red-900/10"
			}`}>
				<div className="flex items-center justify-between">
					<div>
						<div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
							Answer Quality
						</div>
						<div className={`text-4xl font-bold ${scoreColor(qualityPct)}`}>
							{Number.isInteger(quality) ? quality : quality.toFixed(1)}
							<span className="text-lg font-normal text-slate-400">/10</span>
						</div>
					</div>
					{questionAnswered !== undefined && (
						<span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold ${
							questionAnswered
								? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
								: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
						}`}>
							{questionAnswered ? "✓ Answered" : "✗ Not fully answered"}
						</span>
					)}
				</div>
				{previousScores && (
					<p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
						<span className="text-green-600 dark:text-green-400 font-medium">+green</span> improved · <span className="text-red-500 font-medium">-red</span> declined vs last attempt
					</p>
				)}
			</div>

			<div className="p-5 space-y-5">

				{/* ── Key Points to Include ────────────────────── */}
				{dontForget && dontForget.length > 0 && (
					<div className="p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg">
						<h4 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-2">
							Key Points to Include
						</h4>
						<ul className="space-y-1">
							{dontForget.map((item, i) => (
								<li key={i} className="flex gap-2 text-sm text-slate-700 dark:text-slate-300">
									<span className="text-amber-500 shrink-0">→</span>
									<span>{item}</span>
								</li>
							))}
						</ul>
					</div>
				)}

				{/* ── Better Wording ───────────────────────────── */}
				{betterWording && betterWording.length > 0 && (
					<div>
						<h4 className="text-xs font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400 mb-2">
							Better Wording
						</h4>
						<div className="space-y-2">
							{betterWording.map((item, i) => {
								const youSaidMatch = item.match(/You said:\s*['"]([^'"]+)['"]/i);
								const betterMatch = item.match(/Better:\s*['"]([^'"]+)['"]/i);
								const betterOnlyMatch = item.match(/Better:\s*(.+)/i);

								if (youSaidMatch && betterMatch) {
									return (
										<div key={i} className="text-sm bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
											<p className="italic text-slate-500 dark:text-slate-400 text-xs mb-1">You said: &ldquo;{youSaidMatch[1]}&rdquo;</p>
											<p className="font-medium text-slate-800 dark:text-slate-200">&ldquo;{betterMatch[1]}&rdquo;</p>
										</div>
									);
								}
								return (
									<div key={i} className="text-sm font-medium text-slate-700 dark:text-slate-300">
										{betterOnlyMatch ? betterOnlyMatch[1] : item}
									</div>
								);
							})}
						</div>
					</div>
				)}

				{/* ── What You Got Right ───────────────────────── */}
				{whatWasRight && whatWasRight.length > 0 && (
					<div>
						<h4 className="text-xs font-semibold uppercase tracking-wide text-green-600 dark:text-green-400 mb-2">
							What You Got Right
						</h4>
						<ul className="space-y-1">
							{whatWasRight.map((item, i) => (
								<li key={i} className="flex gap-2 text-sm text-slate-700 dark:text-slate-300">
									<span className="text-green-500 shrink-0">✓</span>
									<span>{item}</span>
								</li>
							))}
						</ul>
					</div>
				)}

				{whatWasWrong && whatWasWrong.length > 0 && (
					<div>
						<h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Points to Remember</h4>
						<ul className="space-y-1">
							{whatWasWrong.map((item, i) => (
								<li key={i} className="text-sm text-slate-600 dark:text-slate-400">· {item}</li>
							))}
						</ul>
					</div>
				)}

				{/* ── Repeated Words ───────────────────────────── */}
				{repeatedWords && repeatedWords.length > 0 && (
					<div className={`p-3 rounded-lg border text-sm ${
						hasExcessiveRepetition
							? "bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800"
							: "bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-700"
					}`}>
						<h4 className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
							hasExcessiveRepetition ? "text-orange-600 dark:text-orange-400" : "text-slate-500"
						}`}>
							{hasExcessiveRepetition ? "⚠ Overused Words" : "Repeated Words"}
						</h4>
						<div className="flex flex-wrap gap-1.5">
							{repeatedWords.map((item, i) => (
								<span key={i} className={`px-2 py-0.5 rounded text-xs font-medium ${
									hasExcessiveRepetition
										? "bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200"
										: "bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-300"
								}`}>
									&ldquo;{item.word}&rdquo; {item.count}x
								</span>
							))}
						</div>
					</div>
				)}

				{/* ── Score grid ───────────────────────────────── */}
				<div>
					<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">Scores</h3>
					<div className="grid grid-cols-2 gap-2">
						{isBehavioral && scores.star != null && (
							<ScoreTile label="STAR Structure" value={scores.star} previousValue={previousScores?.star} />
						)}
						{isBehavioral && scores.impact != null && (
							<ScoreTile label="Impact" value={scores.impact} previousValue={previousScores?.impact} />
						)}
						<ScoreTile label="Clarity" value={scores.clarity} previousValue={previousScores?.clarity} />
						{scores.conciseness != null && (
							<ScoreTile label="Conciseness" value={scores.conciseness} previousValue={previousScores?.conciseness} />
						)}
						{scores.technicalAccuracy != null && (
							<ScoreTile label="Technical Accuracy" value={scores.technicalAccuracy} previousValue={previousScores?.technicalAccuracy} />
						)}
						{scores.terminologyUsage != null && (
							<ScoreTile label="Terminology" value={scores.terminologyUsage} previousValue={previousScores?.terminologyUsage} />
						)}
						<ScoreTile label="Confidence" value={scores.confidence} previousValue={previousScores?.confidence} />
						<ScoreTile label="Intonation" value={scores.intonation} previousValue={previousScores?.intonation} />
					</div>
				</div>

				{/* ── Delivery details (collapsed) ─────────────── */}
				<div>
					<button
						onClick={() => setShowDelivery((v) => !v)}
						className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
					>
						<span>{showDelivery ? "▾" : "▸"}</span>
						Delivery Details
					</button>
					{showDelivery && (
						<div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
							{[
								{ label: "Words", value: metrics.words, prev: previousMetrics?.words, lowerBetter: false },
								{ label: "WPM", value: metrics.wpm, prev: null, lowerBetter: false },
								{ label: "Fillers", value: metrics.fillerCount, prev: previousMetrics?.fillerCount, lowerBetter: true },
								{ label: "Filler rate", value: metrics.fillerRate != null ? `${metrics.fillerRate.toFixed(1)}%` : null, prev: null, lowerBetter: true },
								{ label: "Long pauses", value: metrics.longPauses, prev: previousMetrics?.longPauses, lowerBetter: true },
							].map(({ label, value, prev, lowerBetter }) => (
								<div key={label} className="flex justify-between items-baseline border-b border-slate-100 dark:border-slate-700 pb-1">
									<span className="text-slate-500 dark:text-slate-400">{label}</span>
									<span className="font-semibold text-slate-900 dark:text-slate-100">
										{value ?? "—"}
										{typeof value === "number" && prev != null && value !== prev && (
											<span className={`ml-1 text-xs ${
												lowerBetter
													? value < prev ? "text-green-500" : "text-red-500"
													: value > prev ? "text-green-500" : "text-red-500"
											}`}>
												{value < prev ? "" : "+"}{value - prev}
											</span>
										)}
									</span>
								</div>
							))}
							{scores.pacing != null && <div className="col-span-2"><ScoreBar label="Pacing" value={scores.pacing} previousValue={previousScores?.pacing} /></div>}
							{scores.emphasis != null && <div className="col-span-2"><ScoreBar label="Emphasis" value={scores.emphasis} previousValue={previousScores?.emphasis} /></div>}
							{scores.engagement != null && <div className="col-span-2"><ScoreBar label="Engagement" value={scores.engagement} previousValue={previousScores?.engagement} /></div>}
						</div>
					)}
				</div>

				{/* ── Audio ────────────────────────────────────── */}
				{audioUrl && (
					<div>
						<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Your Recording</h3>
						<audio controls className="w-full h-8">
							<source src={audioUrl} type="audio/webm" />
							<source src={audioUrl} type="audio/mp4" />
							<source src={audioUrl} type="audio/m4a" />
							<source src={audioUrl} type="audio/aac" />
						</audio>
					</div>
				)}

				{/* ── Transcript (collapsed) ───────────────────── */}
				{transcript && (
					<div>
						<button
							onClick={() => setShowTranscript((v) => !v)}
							className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
						>
							<span>{showTranscript ? "▾" : "▸"}</span>
							Transcript
							{onReanalyze && showTranscript && (
								<span
									role="button"
									onClick={(e) => { e.stopPropagation(); setIsEditingTranscript((v) => !v); setEditedTranscript(transcript); }}
									className="ml-2 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded text-slate-600 dark:text-slate-300 normal-case font-normal"
								>
									{isEditingTranscript ? "cancel" : "edit"}
								</span>
							)}
						</button>
						{showTranscript && (
							<div className="mt-2">
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
												if (editedTranscript.trim() === transcript.trim()) { setIsEditingTranscript(false); return; }
												setReanalyzing(true);
												try { await onReanalyze!(editedTranscript.trim()); }
												finally { setReanalyzing(false); setIsEditingTranscript(false); }
											}}
											disabled={reanalyzing || editedTranscript.trim() === transcript.trim()}
											className="mt-2 px-3 py-1.5 bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
										>
											{reanalyzing ? "Re-analysing…" : "Re-analyse with corrections"}
										</button>
									</div>
								) : (
									<p className="text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-700/50 p-3 rounded-lg leading-relaxed">
										{transcript}
									</p>
								)}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
