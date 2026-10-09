"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PRACTICE_PRESETS, type PracticePreset } from "@/lib/coaching-config";
import {
	LEARNING_CONTEXTS,
	inferContexts,
	type LearningContext,
} from "@/lib/learning-context";
import { recommendForInterview } from "@/lib/role-profiles";
import {
	DEFAULT_PREFS,
	dismissRecommendation,
	getContextState,
	loadPrefs,
	reconcileSelection,
	savePrefs,
	setSelection,
	switchContext,
	updateContext,
	type PracticePrefs,
} from "@/lib/practice-preferences";

const CONTEXT_LABELS: Record<LearningContext, string> = {
	INTERVIEW: "Interview",
	TECHNICAL_LEARNING: "Technical",
	FOUNDER: "Founder",
	FUNDRAISING: "Fundraising",
	GENERAL: "General",
};

interface QuestionBank {
	id: string;
	title: string;
	_count: {
		questions: number;
	};
}

interface Session {
	id: string;
	title: string;
	createdAt: string;
	bankId: string | null;
	isCompleted: boolean;
	completedAt: string | null;
	itemCount: number;
	filterTags?: string[]; // Tags used to filter questions for this session
}

export default function PracticePage() {
	const router = useRouter();
	const [banks, setBanks] = useState<QuestionBank[]>([]);
	const [sessions, setSessions] = useState<Session[]>([]);
	const [loading, setLoading] = useState(true);
	const [showNewSession, setShowNewSession] = useState(false);
	const [newSessionTitle, setNewSessionTitle] = useState("");
	const [selectedBankId, setSelectedBankId] = useState<string>("");
	const [maxQuestions, setMaxQuestions] = useState<number>(0); // 0 means "all"
	const [selectedPreset, setSelectedPreset] = useState<PracticePreset>("interview");
	const [nextInterview, setNextInterview] = useState<{
		interview: { company: string; role: string; startsAt: string; status?: string };
		folder: { title: string; banks: { id: string; title: string }[] } | null;
	} | null>(null);
	const [prefs, setPrefs] = useState<PracticePrefs>(DEFAULT_PREFS);
	const [prefsLoaded, setPrefsLoaded] = useState(false);
	const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
		null
	);
	const [creatingWeakTopicsSession, setCreatingWeakTopicsSession] = useState<
		string | null
	>(null);
	const [sessionsWithWeakTopics, setSessionsWithWeakTopics] = useState<
		Set<string>
	>(new Set());
	const [checkingWeakTopics, setCheckingWeakTopics] = useState<Set<string>>(
		new Set()
	);

	// Check if a session has weak topics (lazy load)
	const checkSessionWeakTopics = async (sessionId: string) => {
		// If already checked or currently checking, skip
		if (
			sessionsWithWeakTopics.has(sessionId) ||
			checkingWeakTopics.has(sessionId)
		) {
			return;
		}

		setCheckingWeakTopics((prev) => new Set(prev).add(sessionId));

		try {
			const summaryResponse = await fetch(`/api/sessions/${sessionId}/summary`);
			if (summaryResponse.ok) {
				const summaryData = await summaryResponse.json();
				const summary = summaryData.summary;

				// Check if there are weak tags
				const weakTags =
					summary.weakTags && summary.weakTags.length > 0
						? summary.weakTags
						: [];

				if (weakTags.length === 0) {
					// Try to calculate from performanceByTag
					const performanceByTag = summary.performanceByTag || {};
					const needsReview = Object.entries(performanceByTag)
						.filter(([, data]) => {
							const typedData = data as { avgScore?: number };
							return (
								typeof typedData === "object" &&
								typedData !== null &&
								typeof typedData.avgScore === "number" &&
								typedData.avgScore < 7
							);
						})
						.map(([tag]) => tag);

					if (needsReview.length > 0) {
						setSessionsWithWeakTopics((prev) => new Set(prev).add(sessionId));
					}
				} else {
					setSessionsWithWeakTopics((prev) => new Set(prev).add(sessionId));
				}
			}
		} catch (error) {
			// Silently fail - button will just not show
			console.error(
				`Error checking weak topics for session ${sessionId}:`,
				error
			);
		} finally {
			setCheckingWeakTopics((prev) => {
				const next = new Set(prev);
				next.delete(sessionId);
				return next;
			});
		}
	};

	const fetchData = useCallback(async () => {
		try {
			const [banksRes, sessionsRes] = await Promise.all([
				fetch("/api/banks"),
				fetch("/api/sessions"),
			]);

			if (banksRes.ok) {
				const banksData = await banksRes.json();
				setBanks(banksData);
			}

			// Optional: the next interview drives "Recommended". Failure just means no recommendations.
			try {
				const nextRes = await fetch("/api/interviews/next");
				if (nextRes.ok) {
					const next = await nextRes.json();
					setNextInterview(next?.interview ? next : null);
				}
			} catch {
				setNextInterview(null);
			}

			if (sessionsRes.ok) {
				const sessionsData = await sessionsRes.json();
				setSessions(sessionsData);

				// Lazy load weak topics check - only check when needed (on hover or when button is visible)
				// This reduces CPU usage by not fetching all summaries on page load
				// We'll check weak topics individually when the user hovers over a session
			}
		} catch (error) {
			console.error("Error fetching data:", error);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	// Restore remembered practice context locally and immediately; no network needed.
	useEffect(() => {
		try {
			setPrefs(loadPrefs(window.localStorage));
		} catch {
			// Storage unavailable: fall back to defaults.
		}
		setPrefsLoaded(true);
	}, []);

	const updatePrefs = useCallback((next: PracticePrefs) => {
		setPrefs(next);
		try {
			savePrefs(window.localStorage, next);
		} catch {
			// Persistence is best-effort; practice still works.
		}
	}, []);

	// Re-apply the remembered bank/mode when banks load or the context changes. Only
	// selections that no longer exist are dropped; other choices are never reset.
	useEffect(() => {
		if (!prefsLoaded || banks.length === 0) return;
		const cs = getContextState(prefs);
		const { selectedBankIds } = reconcileSelection(
			cs.selectedBankIds,
			banks.map((b) => b.id)
		);
		const bank = banks.find((b) => b.id === selectedBankIds[0]);
		setSelectedBankId(bank?.id ?? "");
		if (bank) {
			setNewSessionTitle((t) => t || bank.title);
			setMaxQuestions(cs.questionCount ?? bank._count.questions);
		}
		if (cs.mode in PRACTICE_PRESETS) setSelectedPreset(cs.mode as PracticePreset);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [prefsLoaded, banks, prefs.activeContext]);

	const activeContext = prefs.activeContext;
	// Banks relevant to the active context, always keeping the remembered selection visible.
	const visibleBanks = banks.filter(
		(b) =>
			b.id === selectedBankId ||
			inferContexts({ title: b.title }).includes(activeContext)
	);
	// Recommended for the next interview. Advice only: it never changes the selection until accepted.
	const recommended = (() => {
		const cs = getContextState(prefs);
		return recommendForInterview({
			next: nextInterview,
			banks: banks.map((b) => ({ id: b.id, title: b.title })),
			activeContext,
			now: new Date(),
			exclude: new Set([...cs.selectedBankIds, ...cs.excludedBankIds, ...cs.dismissedBankIds]),
		});
	})();

	// Practice one bank for this session (web sessions are single-bank; the iOS app handles several).
	const chooseBank = (bankId: string) => {
		const bank = banks.find((b) => b.id === bankId);
		if (!bank) return;
		updatePrefs(setSelection(prefs, [bankId]));
		setSelectedBankId(bankId);
		setNewSessionTitle(bank.title);
		setMaxQuestions(bank._count.questions);
		setShowNewSession(true);
	};
	const resumableSession = sessions.find(
		(s) => !s.isCompleted && (!s.bankId || visibleBanks.some((b) => b.id === s.bankId))
	);

	const createSession = async () => {
		if (!newSessionTitle.trim()) {
			alert("Please enter a session title");
			return;
		}

		if (!selectedBankId) {
			alert("Please select a question bank");
			return;
		}

		try {
			const response = await fetch("/api/sessions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					title: newSessionTitle,
					bankId: selectedBankId,
					maxQuestions: maxQuestions > 0 ? maxQuestions : undefined,
				}),
			});

			if (response.ok) {
				const session = await response.json();
				// Store maxQuestions for this session in localStorage (store even if 0/all to distinguish from undefined)
				localStorage.setItem(
					`session_${session.id}_maxQuestions`,
					(maxQuestions || 0).toString()
				);
				// Store selected preset for the session
				if (selectedPreset !== "custom") {
					localStorage.setItem(
						`session_${session.id}_preset`,
						selectedPreset
					);
				}
				router.push(`/practice/session/${session.id}`);
			} else {
				alert("Failed to create session");
			}
		} catch (error) {
			console.error("Error creating session:", error);
			alert("Failed to create session");
		}
	};

	const handleDeleteSession = async (sessionId: string) => {
		try {
			const response = await fetch(`/api/sessions/${sessionId}`, {
				method: "DELETE",
			});

			if (response.ok) {
				setDeletingSessionId(null);
				fetchData();
			} else {
				const error = await response.json();
				alert(`Error: ${error.error}`);
			}
		} catch (error) {
			console.error("Error deleting session:", error);
			alert("Failed to delete session");
		}
	};

	const handlePracticeWeakTopics = async (
		sessionId: string,
		bankId: string | null
	) => {
		if (!bankId) {
			alert("Cannot practice weak topics: session has no associated bank");
			return;
		}

		setCreatingWeakTopicsSession(sessionId);
		try {
			// Fetch session summary to get weak tags
			const summaryResponse = await fetch(`/api/sessions/${sessionId}/summary`);
			if (!summaryResponse.ok) {
				alert(
					"Session summary not found. Complete the session first to see weak topics."
				);
				return;
			}

			const summaryData = await summaryResponse.json();
			const summary = summaryData.summary;

			// Get weak tags from summary
			const weakTags =
				summary.weakTags && summary.weakTags.length > 0 ? summary.weakTags : [];

			if (weakTags.length === 0) {
				// Try to calculate from performanceByTag
				const performanceByTag = summary.performanceByTag || {};
				const needsReview = Object.entries(performanceByTag)
					.filter(([, data]) => {
						const typedData = data as { avgScore?: number };
						return (
							typeof typedData === "object" &&
							typedData !== null &&
							typeof typedData.avgScore === "number" &&
							typedData.avgScore < 7
						);
					})
					.map(([tag]) => tag);

				if (needsReview.length === 0) {
					alert("No weak topics identified. Great job!");
					return;
				}
				weakTags.push(...needsReview);
			}

			// Create new session with filtered tags
			const response = await fetch("/api/sessions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					title: `Practice: ${weakTags.slice(0, 3).join(", ")}${
						weakTags.length > 3 ? "..." : ""
					}`,
					bankId: bankId,
					filterTags: weakTags,
				}),
			});

			if (response.ok) {
				const session = await response.json();
				router.push(`/practice/session/${session.id}`);
			} else {
				const error = await response.json();
				alert(error.error || "Failed to create practice session");
			}
		} catch (error) {
			console.error("Error creating weak topics session:", error);
			alert("Failed to create practice session");
		} finally {
			setCreatingWeakTopicsSession(null);
		}
	};

	if (loading) {
		return <div className="text-center py-12">Loading...</div>;
	}

	return (
		<div className="px-4 py-6">
			<div className="mb-6">
				<h1 className="text-3xl font-bold mb-2">Practice</h1>
				<p className="text-slate-600 dark:text-slate-400 text-lg">
					Free-form practice sessions where you can retry questions, view
					previous attempts, and improve through repetition. Perfect for
					learning and skill development.
				</p>
			</div>

			<div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Learning context">
				{LEARNING_CONTEXTS.map((c) => (
					<button
						key={c}
						type="button"
						role="tab"
						aria-selected={activeContext === c}
						onClick={() => updatePrefs(switchContext(prefs, c))}
						className={`px-3 py-1 rounded-full text-sm border ${
							activeContext === c
								? "border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-800 dark:text-purple-200"
								: "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300"
						}`}
					>
						{CONTEXT_LABELS[c]}
					</button>
				))}
			</div>

			{recommended.length > 0 && nextInterview && (
				<div className="mb-4 p-4 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800">
					<div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
						Recommended for your {nextInterview.interview.role} interview at{" "}
						{nextInterview.interview.company}
					</div>
					<p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
						Suggestions only. Your own selection is not changed unless you choose one.
					</p>
					<ul className="space-y-2">
						{recommended.map((rec) => {
							const bank = banks.find((b) => b.id === rec.id);
							if (!bank) return null;
							return (
								<li key={rec.id} className="flex items-center justify-between gap-2">
									<div className="min-w-0">
										<div className="text-sm text-slate-900 dark:text-slate-100 truncate">{bank.title}</div>
										<div className="text-xs text-slate-600 dark:text-slate-400">{rec.reason}</div>
									</div>
									<div className="flex gap-2 shrink-0">
										<button
											type="button"
											onClick={() => chooseBank(rec.id)}
											className="px-2 py-1 text-xs rounded bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200"
										>
											Use
										</button>
										<button
											type="button"
											onClick={() => updatePrefs(dismissRecommendation(prefs, rec.id))}
											className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300"
										>
											Dismiss
										</button>
									</div>
								</li>
							);
						})}
					</ul>
				</div>
			)}

			{resumableSession && (
				<button
					type="button"
					onClick={() => router.push(`/practice/session/${resumableSession.id}`)}
					className="w-full text-left mb-4 p-4 rounded-lg border border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20"
				>
					<div className="text-sm font-semibold text-purple-900 dark:text-purple-100">
						Continue where you left off
					</div>
					<div className="text-xs text-slate-600 dark:text-slate-400">
						{resumableSession.title}
					</div>
				</button>
			)}

			{showNewSession ? (
				<div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 mb-6 border border-slate-200 dark:border-slate-700">
					<h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">
						Create New Session
					</h2>
					<div className="space-y-4">
						<div>
							<label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">
								Session Title
							</label>
							<input
								type="text"
								value={newSessionTitle}
								onChange={(e) => setNewSessionTitle(e.target.value)}
								className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400"
								placeholder="e.g., Technical Interview Practice"
							/>
						</div>
						<div>
							<label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">
								Question Bank <span className="text-red-500">*</span>
							</label>
							<select
								value={selectedBankId}
								onChange={(e) => {
									const bankId = e.target.value;
									setSelectedBankId(bankId);
									updatePrefs(setSelection(prefs, bankId ? [bankId] : []));
									// Auto-populate title and maxQuestions from selected bank
									if (bankId) {
										const selectedBank = banks.find((b) => b.id === bankId);
										if (selectedBank) {
											setNewSessionTitle(selectedBank.title);
											setMaxQuestions(selectedBank._count.questions); // Default to all questions
										}
									} else {
										setNewSessionTitle("");
										setMaxQuestions(0);
									}
								}}
								className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
								required
							>
								<option value="">Select a question bank...</option>
								{visibleBanks.map((bank) => (
									<option key={bank.id} value={bank.id}>
										{bank.title} ({bank._count.questions} questions)
									</option>
								))}
							</select>
						</div>
						<div>
							<label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">
								Max Questions
							</label>
							<input
								type="number"
								value={maxQuestions || ""}
								onChange={(e) => {
									const value = e.target.value;
									const n = value === "" ? 0 : parseInt(value) || 0;
									setMaxQuestions(n);
									updatePrefs(updateContext(prefs, { questionCount: n || null }));
								}}
								min="1"
								max={
									selectedBankId
										? banks.find((b) => b.id === selectedBankId)?._count
												.questions || 50
										: 50
								}
								className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
								placeholder="All"
							/>
							<p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
								{selectedBankId ? (
									<>
										Leave empty or set to{" "}
										{banks.find((b) => b.id === selectedBankId)?._count
											.questions || 0}{" "}
										to use all questions
									</>
								) : (
									<>Limit number of questions (leave empty for all)</>
								)}
							</p>
						</div>
						<div>
							<label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">
								Practice Mode
							</label>
							<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
								{(Object.entries(PRACTICE_PRESETS) as [PracticePreset, typeof PRACTICE_PRESETS[PracticePreset]][]).map(([key, preset]) => (
									<button
										key={key}
										type="button"
										onClick={() => {
											setSelectedPreset(key);
											updatePrefs(updateContext(prefs, { mode: key }));
										}}
										className={`p-3 rounded-lg border-2 text-left transition-all ${
											selectedPreset === key
												? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
												: "border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500"
										}`}
									>
										<div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
											{preset.label}
										</div>
										<div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
											{preset.description}
										</div>
									</button>
								))}
							</div>
						</div>
						<div className="flex gap-2">
							<button
								onClick={createSession}
								className="px-4 py-2 bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-lg transition-colors font-medium"
							>
								Start Session
							</button>
							<button
								onClick={async () => {
									if (!newSessionTitle.trim() || !selectedBankId) {
										alert("Please enter a title and select a bank");
										return;
									}
									try {
										const response = await fetch("/api/sessions", {
											method: "POST",
											headers: { "Content-Type": "application/json" },
											body: JSON.stringify({
												title: `Mock: ${newSessionTitle}`,
												bankId: selectedBankId,
												maxQuestions: maxQuestions > 0 ? maxQuestions : undefined,
											}),
										});
										if (response.ok) {
											const session = await response.json();
											router.push(`/practice/mock/${session.id}`);
										} else {
											alert("Failed to create session");
										}
									} catch {
										alert("Failed to create session");
									}
								}}
								className="px-4 py-2 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-200 rounded-lg transition-colors font-medium"
							>
								Mock Interview
							</button>
							<button
								onClick={async () => {
									if (!newSessionTitle.trim() || !selectedBankId) {
										alert("Please enter a title and select a bank");
										return;
									}
									try {
										const response = await fetch("/api/sessions", {
											method: "POST",
											headers: { "Content-Type": "application/json" },
											body: JSON.stringify({
												title: `Pitch: ${newSessionTitle}`,
												bankId: selectedBankId,
												maxQuestions: maxQuestions > 0 ? maxQuestions : undefined,
											}),
										});
										if (response.ok) {
											const session = await response.json();
											localStorage.setItem("practicePreset", "pitch");
											router.push(`/practice/pitch/${session.id}`);
										} else {
											alert("Failed to create session");
										}
									} catch {
										alert("Failed to create session");
									}
								}}
								className="px-4 py-2 bg-emerald-100 dark:bg-emerald-900/30 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 rounded-lg transition-colors font-medium"
							>
								Pitch Practice
							</button>
							<button
								onClick={() => {
									setShowNewSession(false);
									setNewSessionTitle("");
									setSelectedBankId("");
									setMaxQuestions(0);
									setSelectedPreset("interview");
								}}
								className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
							>
								Cancel
							</button>
						</div>
					</div>
				</div>
			) : (
				<div className="mb-6">
					<button
						onClick={() => setShowNewSession(true)}
						className="px-4 py-2 bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-lg transition-colors font-medium"
					>
						New Practice Session
					</button>
					<div className="mt-4 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
						<p className="text-sm text-slate-700 dark:text-slate-300">
							<strong className="font-semibold">Practice Mode:</strong> Retry
							questions multiple times, view all your previous attempts, and
							navigate freely between questions. Great for learning and
							improvement.
						</p>
					</div>
				</div>
			)}

			{sessions.length > 0 && (
				<div>
					<h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">
						Recent Sessions
					</h2>
					<div className="space-y-2">
						{sessions.map((session) => (
							<div
								key={session.id}
								className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-700 group"
							>
								<div
									className="cursor-pointer"
									onClick={() => router.push(`/practice/session/${session.id}`)}
								>
									<div className="flex items-center justify-between mb-1">
										<h3 className="font-semibold text-slate-900 dark:text-slate-100">
											{session.title}
										</h3>
										{session.isCompleted && (
											<span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded text-xs font-medium">
												Completed ({session.itemCount} {session.itemCount === 1 ? 'answer' : 'answers'})
											</span>
										)}
									</div>
									<p className="text-sm text-slate-700 dark:text-slate-300">
										{new Date(session.createdAt).toLocaleDateString()}
										{session.completedAt && (
											<span className="ml-2">
												• Completed{" "}
												{new Date(session.completedAt).toLocaleDateString()}
											</span>
										)}
									</p>
								</div>
								<div className="mt-3 flex gap-2 flex-wrap">
									<button
										onClick={async (e) => {
											e.stopPropagation();
											
											// If session is completed, create a new session with same questions
											if (session.isCompleted && session.bankId) {
												try {
													// Create a new session with the same bank and filterTags
													const response = await fetch('/api/sessions', {
														method: 'POST',
														headers: {
															'Content-Type': 'application/json',
														},
														body: JSON.stringify({
															title: session.title + ' (Practice Again)',
															bankId: session.bankId,
															filterTags: session.filterTags || [],
														}),
													});

													if (response.ok) {
														const newSession = await response.json();
														router.push(`/practice/session/${newSession.id}`);
													} else {
														const error = await response.json();
														alert(error.error || 'Failed to create new practice session');
													}
												} catch (error) {
													console.error('Error creating new session:', error);
													alert('Failed to create new practice session');
												}
											} else {
												// For incomplete sessions, just navigate to continue
												router.push(`/practice/session/${session.id}`);
											}
										}}
										className={`px-4 py-2 rounded-lg transition-all font-medium text-sm ${
											session.isCompleted
												? "bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200"
												: "bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200"
										}`}
										title={
											session.isCompleted
												? "Create a new practice session with the same questions"
												: !session.isCompleted && session.itemCount > 0
												? "Continue this unfinished session"
												: "Start this session"
										}
									>
										{session.isCompleted
											? "Practice Again"
											: !session.isCompleted && session.itemCount > 0
											? "Continue Session"
											: "Start Session"}
									</button>
									{session.isCompleted && session.bankId && (
										<button
											onClick={(e) => {
												e.stopPropagation();
												handlePracticeWeakTopics(session.id, session.bankId);
											}}
											onMouseEnter={() => {
												// Lazy load weak topics check on hover
												if (
													!sessionsWithWeakTopics.has(session.id) &&
													!checkingWeakTopics.has(session.id)
												) {
													checkSessionWeakTopics(session.id);
												}
											}}
											disabled={
												creatingWeakTopicsSession === session.id ||
												(!sessionsWithWeakTopics.has(session.id) &&
													checkingWeakTopics.has(session.id))
											}
											className={`px-4 py-2 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-200 rounded-lg text-sm transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
												!sessionsWithWeakTopics.has(session.id) &&
												!checkingWeakTopics.has(session.id)
													? "opacity-50"
													: ""
											}`}
											title={
												checkingWeakTopics.has(session.id)
													? "Checking for weak topics..."
													: sessionsWithWeakTopics.has(session.id)
													? "Practice weak topics from this session"
													: "Hover to check for weak topics"
											}
										>
											{checkingWeakTopics.has(session.id)
												? "Checking..."
												: "Practice Weak Topics"}
										</button>
									)}
									<button
										onClick={(e) => {
											e.stopPropagation();
											setDeletingSessionId(session.id);
										}}
										className="px-4 py-2 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-800 dark:text-red-200 rounded-lg text-sm transition-all font-medium ml-auto"
										title="Delete session"
									>
										Delete
									</button>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Delete Confirmation Modal */}
			{deletingSessionId && (
				<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
					<div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4 border border-slate-200 dark:border-slate-700">
						<h3 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">
							Delete Session?
						</h3>
						<p className="text-slate-700 dark:text-slate-300 mb-6">
							Are you sure you want to delete this practice session? This will
							also delete all practice attempts and recordings associated with
							it. This action cannot be undone.
						</p>
						<div className="flex gap-3 justify-end">
							<button
								onClick={() => setDeletingSessionId(null)}
								className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
							>
								Cancel
							</button>
							<button
								onClick={() => handleDeleteSession(deletingSessionId)}
								className="px-4 py-2 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-800 dark:text-red-200 rounded-lg transition-all font-medium"
							>
								Delete
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
