import { prisma } from "./db";
import { Prisma } from "@prisma/client";

interface CommonMistake {
	pattern: string;
	frequency: number;
	examples: string[];
}

interface FrequentlyForgottenPoint {
	point: string;
	frequency: number;
	questions: string[]; // Question IDs where this was forgotten
	tags: string[]; // Tags associated with questions where this was forgotten
}

interface FrequentlyMisusedTerm {
	incorrectTerm: string;
	correctTerm: string;
	frequency: number;
	questions: string[]; // Question IDs where this was misused
	tags: string[]; // Tags associated with questions where this was misused
	examples: string[]; // Examples of the correction
}

interface PerformanceByTag {
	[tag: string]: {
		avgScore: number;
		count: number;
		questions: string[];
	};
}

export async function analyzeSessionPerformance(
	sessionId: string,
	userId: string
): Promise<{
	commonMistakes: CommonMistake[];
	frequentlyForgottenPoints: FrequentlyForgottenPoint[];
	frequentlyMisusedTerms: FrequentlyMisusedTerm[];
	weakTags: string[];
	strongTags: string[];
	recommendedFocus: string[];
	performanceByTag: PerformanceByTag;
	overallScore: number;
}> {
	// Get all session items with questions
	const session = await prisma.session.findUnique({
		where: { id: sessionId, userId },
		include: {
			items: {
				include: {
					question: true,
				},
			},
		},
	});

	if (!session) {
		throw new Error("Session not found");
	}

	const items = session.items;
	if (items.length === 0) {
		return {
			commonMistakes: [],
			frequentlyForgottenPoints: [],
			frequentlyMisusedTerms: [],
			weakTags: [],
			strongTags: [],
			recommendedFocus: [],
			performanceByTag: {},
			overallScore: 0,
		};
	}

	// Collect mistakes from multiple sources:
	// 1. Legacy whatWasWrong arrays (for backward compatibility)
	// 2. Score patterns (derive from consistently low scores)
	// 3. betterWording patterns (common phrasing issues)
	const mistakeFrequency: Map<string, number> = new Map();
	const mistakeExamples: Map<string, Set<string>> = new Map();

	// Source 1: Legacy whatWasWrong (for backward compatibility with old data)
	items.forEach((item) => {
		if (item.whatWasWrong && item.whatWasWrong.length > 0) {
			item.whatWasWrong.forEach((mistake) => {
				const normalized = mistake.toLowerCase().trim();
				mistakeFrequency.set(
					normalized,
					(mistakeFrequency.get(normalized) || 0) + 1
				);
				if (!mistakeExamples.has(normalized)) {
					mistakeExamples.set(normalized, new Set());
				}
				mistakeExamples.get(normalized)?.add(mistake);
			});
		}
	});

	// Source 2: Derive patterns from consistently low scores
	const scorePatterns: Map<string, number> = new Map();
	const lowScoreThreshold = 3; // Scores below 3 indicate issues
	
	items.forEach((item) => {
		// Technical accuracy issues
		if (item.technicalAccuracy !== null && item.technicalAccuracy < lowScoreThreshold) {
			const pattern = "Lacks technical depth or accuracy";
			scorePatterns.set(pattern, (scorePatterns.get(pattern) || 0) + 1);
			if (!mistakeExamples.has(pattern)) {
				mistakeExamples.set(pattern, new Set());
			}
			mistakeExamples.get(pattern)?.add(
				`Technical accuracy: ${item.technicalAccuracy}/5`
			);
		}
		
		// Terminology usage issues
		if (item.terminologyUsage !== null && item.terminologyUsage < lowScoreThreshold) {
			const pattern = "Uses generic terms instead of domain-specific language";
			scorePatterns.set(pattern, (scorePatterns.get(pattern) || 0) + 1);
			if (!mistakeExamples.has(pattern)) {
				mistakeExamples.set(pattern, new Set());
			}
			mistakeExamples.get(pattern)?.add(
				`Terminology usage: ${item.terminologyUsage}/5`
			);
		}
		
		// Clarity/structure issues
		if (item.clarityScore !== null && item.clarityScore < lowScoreThreshold) {
			const pattern = "Unclear structure or organization";
			scorePatterns.set(pattern, (scorePatterns.get(pattern) || 0) + 1);
			if (!mistakeExamples.has(pattern)) {
				mistakeExamples.set(pattern, new Set());
			}
			mistakeExamples.get(pattern)?.add(
				`Clarity score: ${item.clarityScore}/5`
			);
		}
		
		// Impact/metrics issues (for behavioral questions)
		if (item.impactScore !== null && item.impactScore < lowScoreThreshold) {
			const pattern = "Missing specific metrics or impact statements";
			scorePatterns.set(pattern, (scorePatterns.get(pattern) || 0) + 1);
			if (!mistakeExamples.has(pattern)) {
				mistakeExamples.set(pattern, new Set());
			}
			mistakeExamples.get(pattern)?.add(
				`Impact score: ${item.impactScore}/5`
			);
		}
		
		// STAR structure issues (for behavioral questions)
		if (item.starScore !== null && item.starScore < lowScoreThreshold) {
			const pattern = "Incomplete STAR structure (missing Situation/Task/Action/Result)";
			scorePatterns.set(pattern, (scorePatterns.get(pattern) || 0) + 1);
			if (!mistakeExamples.has(pattern)) {
				mistakeExamples.set(pattern, new Set());
			}
			mistakeExamples.get(pattern)?.add(
				`STAR score: ${item.starScore}/5`
			);
		}
		
		// Question not answered
		if (item.questionAnswered === false) {
			const pattern = "Answer doesn't fully address the question";
			scorePatterns.set(pattern, (scorePatterns.get(pattern) || 0) + 1);
			if (!mistakeExamples.has(pattern)) {
				mistakeExamples.set(pattern, new Set());
			}
			mistakeExamples.get(pattern)?.add("Question not fully answered");
		}
	});

	// Merge score patterns into mistake frequency
	scorePatterns.forEach((frequency, pattern) => {
		mistakeFrequency.set(
			pattern.toLowerCase().trim(),
			(mistakeFrequency.get(pattern.toLowerCase().trim()) || 0) + frequency
		);
	});

	// Source 3: Extract patterns from betterWording suggestions
	// Track terminology/nomenclature mistakes separately from general wording patterns
	const terminologyMistakesMap: Map<string, {
		incorrectTerm: string;
		correctTerm: string;
		frequency: number;
		questions: Set<string>;
		tags: Set<string>;
		examples: Set<string>;
	}> = new Map();
	
	items.forEach((item) => {
		if (item.betterWording && item.betterWording.length > 0) {
			const question = item.question;
			const questionTags = question.tags || [];
			
			// Look for common patterns in betterWording suggestions
			item.betterWording.forEach((suggestion) => {
				const lower = suggestion.toLowerCase();
				
				// Check for terminology/nomenclature corrections (format: "Instead of 'X', say 'Y'" or "You said: 'X'. Better: 'Y'")
				const terminologyPatterns = [
					// Pattern 1: "Instead of 'incorrect', say 'correct'" - group 1=incorrect, group 2=correct
					{ pattern: /instead of ['"]([^'"]+)['"](?:,|\.)?\s*(?:say|use|better:)\s*['"]([^'"]+)['"]/i, swapGroups: false },
					// Pattern 2: "You said: 'incorrect'. Better: 'correct'" - group 1=incorrect, group 2=correct
					{ pattern: /you said:\s*['"]([^'"]+)['"]\s*\.?\s*better:\s*['"]([^'"]+)['"]/i, swapGroups: false },
					// Pattern 3: "Better: 'correct' (instead of 'incorrect')" - group 1=correct, group 2=incorrect (REVERSED)
					{ pattern: /better:\s*['"]([^'"]+)['"]\s*(?:\(|instead of|rather than)\s*['"]([^'"]+)['"]/i, swapGroups: true },
				];
				
				let terminologyMatch: RegExpMatchArray | null = null;
				let shouldSwapGroups = false;
				
				for (const { pattern, swapGroups } of terminologyPatterns) {
					terminologyMatch = suggestion.match(pattern);
					if (terminologyMatch) {
						shouldSwapGroups = swapGroups;
						break;
					}
				}
				
				if (terminologyMatch) {
					// Extract incorrect and correct terms
					// Note: Pattern 3 has groups reversed, so we swap if needed
					let incorrectTerm = terminologyMatch[1]?.trim();
					let correctTerm = terminologyMatch[2]?.trim();
					
					// Swap if Pattern 3 matched (where correct comes first)
					if (shouldSwapGroups && incorrectTerm && correctTerm) {
						[incorrectTerm, correctTerm] = [correctTerm, incorrectTerm];
					}
					
					if (incorrectTerm && correctTerm && incorrectTerm !== correctTerm) {
						// This is a terminology/nomenclature correction
						const key = `${incorrectTerm.toLowerCase()} -> ${correctTerm.toLowerCase()}`;
						
						if (!terminologyMistakesMap.has(key)) {
							terminologyMistakesMap.set(key, {
								incorrectTerm: incorrectTerm,
								correctTerm: correctTerm,
								frequency: 0,
								questions: new Set(),
								tags: new Set(),
								examples: new Set(),
							});
						}
						
						const entry = terminologyMistakesMap.get(key)!;
						entry.frequency++;
						entry.questions.add(item.question.id);
						questionTags.forEach(tag => entry.tags.add(tag));
						entry.examples.add(suggestion);
					} else {
						// General wording improvement
						const pattern = "Could use more precise wording";
						mistakeFrequency.set(
							pattern.toLowerCase().trim(),
							(mistakeFrequency.get(pattern.toLowerCase().trim()) || 0) + 1
						);
						if (!mistakeExamples.has(pattern)) {
							mistakeExamples.set(pattern, new Set());
						}
						mistakeExamples.get(pattern)?.add(suggestion.substring(0, 100));
					}
				} else if (lower.includes("instead of") || lower.includes("better:")) {
					// General improvement pattern
					const pattern = "Could use more precise wording";
					mistakeFrequency.set(
						pattern.toLowerCase().trim(),
						(mistakeFrequency.get(pattern.toLowerCase().trim()) || 0) + 1
					);
					if (!mistakeExamples.has(pattern)) {
						mistakeExamples.set(pattern, new Set());
					}
					mistakeExamples.get(pattern)?.add(suggestion.substring(0, 100));
				}
			});
		}
	});

	// Convert terminology mistakes to array
	const frequentlyMisusedTerms: FrequentlyMisusedTerm[] = Array.from(terminologyMistakesMap.values())
		.map((entry) => ({
			incorrectTerm: entry.incorrectTerm,
			correctTerm: entry.correctTerm,
			frequency: entry.frequency,
			questions: Array.from(entry.questions),
			tags: Array.from(entry.tags),
			examples: Array.from(entry.examples).slice(0, 3),
		}))
		.sort((a, b) => b.frequency - a.frequency)
		.slice(0, 10); // Top 10 most frequently misused terms
	
	// Convert general mistakes to array
	const commonMistakes: CommonMistake[] = Array.from(mistakeFrequency.entries())
		.map(([pattern, frequency]) => ({
			pattern,
			frequency,
			examples: Array.from(mistakeExamples.get(pattern) || []).slice(0, 3),
		}))
		.sort((a, b) => b.frequency - a.frequency)
		.slice(0, 10); // Top 10 most common

	// Track frequently forgotten key points (dontForget)
	const forgottenPointFrequency: Map<
		string,
		{ count: number; questions: Set<string>; tags: Set<string> }
	> = new Map();

	items.forEach((item) => {
		if (item.dontForget && item.dontForget.length > 0) {
			const question = item.question;
			const questionTags = question.tags || [];

			item.dontForget.forEach((point) => {
				const normalized = point.toLowerCase().trim();
				if (!forgottenPointFrequency.has(normalized)) {
					forgottenPointFrequency.set(normalized, {
						count: 0,
						questions: new Set(),
						tags: new Set(),
					});
				}
				const entry = forgottenPointFrequency.get(normalized)!;
				entry.count++;
				entry.questions.add(question.id);
				questionTags.forEach((tag) => entry.tags.add(tag));
			});
		}
	});

	// Convert to frequently forgotten points array
	const frequentlyForgottenPoints: FrequentlyForgottenPoint[] = Array.from(
		forgottenPointFrequency.entries()
	)
		.map(([point, data]) => ({
			point,
			frequency: data.count,
			questions: Array.from(data.questions),
			tags: Array.from(data.tags),
		}))
		.sort((a, b) => b.frequency - a.frequency)
		.slice(0, 10); // Top 10 most frequently forgotten

	// Calculate performance by tag
	const tagScores: Map<string, number[]> = new Map();
	const tagQuestions: Map<string, Set<string>> = new Map();

	items.forEach((item) => {
		const question = item.question;
		const tags = question.tags || [];

		// Calculate average score for this item
		const scores = [
			item.starScore,
			item.impactScore,
			item.clarityScore,
			item.technicalAccuracy,
			item.terminologyUsage,
		].filter((s): s is number => s !== null && s !== undefined);

		const avgScore =
			scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

		tags.forEach((tag) => {
			if (!tagScores.has(tag)) {
				tagScores.set(tag, []);
				tagQuestions.set(tag, new Set());
			}
			tagScores.get(tag)?.push(avgScore);
			tagQuestions.get(tag)?.add(question.id);
		});
	});

	// Build performance by tag object
	const performanceByTag: PerformanceByTag = {};
	Array.from(tagScores.entries()).forEach(([tag, scores]) => {
		const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
		performanceByTag[tag] = {
			avgScore: Math.round(avgScore * 10) / 10, // Round to 1 decimal
			count: scores.length,
			questions: Array.from(tagQuestions.get(tag) || []),
		};
	});

	// Identify weak tags (avg score < 3) and strong tags (avg score >= 4)
	const weakTags: string[] = [];
	const strongTags: string[] = [];

	Object.entries(performanceByTag).forEach(([tag, data]) => {
		if (data.avgScore < 3) {
			weakTags.push(tag);
		} else if (data.avgScore >= 4) {
			strongTags.push(tag);
		}
	});

	// Generate recommended focus areas (weak tags sorted by frequency/importance)
	const recommendedFocus = weakTags
		.sort((a, b) => {
			const aData = performanceByTag[a];
			const bData = performanceByTag[b];
			// Sort by count (more questions = more important) then by score (lower = more important)
			if (aData.count !== bData.count) {
				return bData.count - aData.count;
			}
			return aData.avgScore - bData.avgScore;
		})
		.slice(0, 5); // Top 5 focus areas

	// Calculate overall score
	const allScores: number[] = [];
	items.forEach((item) => {
		const scores = [
			item.starScore,
			item.impactScore,
			item.clarityScore,
			item.technicalAccuracy,
			item.terminologyUsage,
		].filter((s): s is number => s !== null && s !== undefined);
		allScores.push(...scores);
	});

	const overallScore =
		allScores.length > 0
			? Math.round(
					(allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10
			  ) / 10
			: 0;

	return {
		commonMistakes,
		frequentlyForgottenPoints,
		frequentlyMisusedTerms,
		weakTags,
		strongTags,
		recommendedFocus,
		performanceByTag,
		overallScore,
	};
}

/**
 * Analyze quiz performance from quiz attempts
 * Similar to analyzeSessionPerformance but for quizzes
 */
export async function analyzeQuizPerformance(
	quizId: string,
	userId: string
): Promise<{
	weakTags: string[];
	strongTags: string[];
	recommendedFocus: string[];
	performanceByTag: PerformanceByTag;
	overallScore: number;
	frequentlyForgottenPoints: FrequentlyForgottenPoint[];
}> {
	// Get all quiz attempts for this quiz
	const attempts = await prisma.quizAttempt.findMany({
		where: {
			quizId,
			quiz: {
				userId,
			},
		},
		include: {
			question: true,
		},
	});

	if (attempts.length === 0) {
		return {
			weakTags: [],
			strongTags: [],
			recommendedFocus: [],
			performanceByTag: {},
			overallScore: 0,
			frequentlyForgottenPoints: [],
		};
	}

	// Calculate performance by tag
	const tagScores: Map<string, number[]> = new Map();
	const tagQuestions: Map<string, Set<string>> = new Map();

	attempts.forEach((attempt) => {
		const question = attempt.question;
		const tags = question.tags || [];
		const score = attempt.score ? attempt.score / 20 : 0; // Convert 0-100 to 0-5

		tags.forEach((tag) => {
			if (!tagScores.has(tag)) {
				tagScores.set(tag, []);
				tagQuestions.set(tag, new Set());
			}
			tagScores.get(tag)?.push(score);
			tagQuestions.get(tag)?.add(question.id);
		});
	});

	// Build performance by tag object
	const performanceByTag: PerformanceByTag = {};
	Array.from(tagScores.entries()).forEach(([tag, scores]) => {
		const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
		performanceByTag[tag] = {
			avgScore: Math.round(avgScore * 10) / 10,
			count: scores.length,
			questions: Array.from(tagQuestions.get(tag) || []),
		};
	});

	// Identify weak tags (avg score < 3) and strong tags (avg score >= 4)
	const weakTags: string[] = [];
	const strongTags: string[] = [];

	Object.entries(performanceByTag).forEach(([tag, data]) => {
		if (data.avgScore < 3) {
			weakTags.push(tag);
		} else if (data.avgScore >= 4) {
			strongTags.push(tag);
		}
	});

	// Generate recommended focus areas (weak tags sorted by frequency/importance)
	const recommendedFocus = weakTags
		.sort((a, b) => {
			const aData = performanceByTag[a];
			const bData = performanceByTag[b];
			if (aData.count !== bData.count) {
				return bData.count - aData.count;
			}
			return aData.avgScore - bData.avgScore;
		})
		.slice(0, 5);

	// Calculate overall score
	const allScores = attempts
		.map((a) => (a.score ? a.score / 20 : 0))
		.filter((s) => s > 0);
	const overallScore =
		allScores.length > 0
			? Math.round(
					(allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10
			  ) / 10
			: 0;

	// For quizzes, we don't have dontForget data, so return empty array
	return {
		weakTags,
		strongTags,
		recommendedFocus,
		performanceByTag,
		overallScore,
		frequentlyForgottenPoints: [],
	};
}

export async function aggregateUserInsights(userId: string): Promise<void> {
	// Get all completed sessions for user
	const sessions = await prisma.session.findMany({
		where: {
			userId,
			isCompleted: true,
		},
		include: {
			summary: true,
			items: true,
		},
	});

	// Get all quizzes with attempts for user
	const quizzes = await prisma.quiz.findMany({
		where: {
			userId,
		},
		include: {
			attempts: {
				include: {
					question: true,
				},
			},
		},
	});

	// Filter to quizzes with completed attempts
	const quizzesWithAttempts = quizzes.filter((q) => q.attempts.length > 0);

	// Initialize total questions counter
	let totalQuestions = 0;

	// Analyze quiz performance for each quiz
	const quizSummaries: Array<{
		weakTags: string[];
		strongTags: string[];
		recommendedFocus: string[];
		performanceByTag: PerformanceByTag;
		overallScore: number;
	}> = [];

	for (const quiz of quizzesWithAttempts) {
		try {
			const quizAnalysis = await analyzeQuizPerformance(quiz.id, userId);
			quizSummaries.push(quizAnalysis);
			// Add quiz questions to total count
			const uniqueQuestionIds = new Set(quiz.attempts.map((a) => a.questionId));
			totalQuestions += uniqueQuestionIds.size;
		} catch (error) {
			console.error(`Error analyzing quiz ${quiz.id}:`, error);
			// Continue with other quizzes
		}
	}

	const totalSessionsAndQuizzes = sessions.length + quizzesWithAttempts.length;

	if (sessions.length === 0 && quizzesWithAttempts.length === 0) {
		// Create empty insight record
		await prisma.userLearningInsight.upsert({
			where: { userId },
			create: {
				userId,
				aggregatedWeakTags: [],
				aggregatedStrongTags: [],
				topFocusAreas: [],
				topForgottenPoints: Prisma.JsonNull,
				totalSessions: 0,
				totalQuestions: 0,
			},
			update: {
				aggregatedWeakTags: [],
				aggregatedStrongTags: [],
				topFocusAreas: [],
				topForgottenPoints: Prisma.JsonNull,
				totalSessions: 0,
				totalQuestions: 0,
				lastUpdated: new Date(),
			},
		});
		return;
	}

	// Aggregate all summaries
	const summaries = sessions
		.map((s) => s.summary)
		.filter((s): s is NonNullable<typeof s> => s !== null);

	// Calculate total questions from sessions (quiz questions already added above)
	sessions.forEach((session) => {
		totalQuestions += session.items?.length || 0;
	});

	// If no summaries and no quiz summaries, still update insights with counts
	if (summaries.length === 0 && quizSummaries.length === 0) {
		await prisma.userLearningInsight.upsert({
			where: { userId },
			create: {
				userId,
				aggregatedWeakTags: [],
				aggregatedStrongTags: [],
				topFocusAreas: [],
				topForgottenPoints: Prisma.JsonNull,
				totalSessions: totalSessionsAndQuizzes,
				totalQuestions,
			},
			update: {
				aggregatedWeakTags: [],
				aggregatedStrongTags: [],
				topFocusAreas: [],
				topForgottenPoints: Prisma.JsonNull,
				totalSessions: totalSessionsAndQuizzes,
				totalQuestions,
				lastUpdated: new Date(),
			},
		});
		return;
	}

	// Aggregate frequently forgotten points across all sessions
	const allForgottenPoints: Map<
		string,
		{ count: number; sessions: Set<string>; tags: Set<string> }
	> = new Map();

	sessions.forEach((session) => {
		const summary = session.summary;
		if (summary && summary.frequentlyForgottenPoints) {
			const points =
				summary.frequentlyForgottenPoints as unknown as FrequentlyForgottenPoint[];
			points.forEach((point) => {
				const normalized = point.point.toLowerCase().trim();
				if (!allForgottenPoints.has(normalized)) {
					allForgottenPoints.set(normalized, {
						count: 0,
						sessions: new Set(),
						tags: new Set(),
					});
				}
				const entry = allForgottenPoints.get(normalized)!;
				entry.count += point.frequency;
				entry.sessions.add(session.id);
				point.tags.forEach((tag) => entry.tags.add(tag));
			});
		}
	});

	// Get top 5 most frequently forgotten points across all sessions
	const topForgottenPoints = Array.from(allForgottenPoints.entries())
		.map(([point, data]) => ({
			point,
			totalFrequency: data.count,
			sessionCount: data.sessions.size,
			tags: Array.from(data.tags),
		}))
		.sort((a, b) => b.totalFrequency - a.totalFrequency)
		.slice(0, 5);

	// Collect all tags from both session summaries AND quiz summaries
	const tagFrequency: Map<
		string,
		{ weak: number; strong: number; focus: number }
	> = new Map();

	// Aggregate from session summaries
	summaries.forEach((summary) => {
		// Count weak tags
		summary.weakTags.forEach((tag) => {
			if (!tagFrequency.has(tag)) {
				tagFrequency.set(tag, { weak: 0, strong: 0, focus: 0 });
			}
			tagFrequency.get(tag)!.weak++;
		});

		// Count strong tags
		summary.strongTags.forEach((tag) => {
			if (!tagFrequency.has(tag)) {
				tagFrequency.set(tag, { weak: 0, strong: 0, focus: 0 });
			}
			tagFrequency.get(tag)!.strong++;
		});

		// Count recommended focus
		summary.recommendedFocus.forEach((tag) => {
			if (!tagFrequency.has(tag)) {
				tagFrequency.set(tag, { weak: 0, strong: 0, focus: 0 });
			}
			tagFrequency.get(tag)!.focus++;
		});
	});

	// Aggregate from quiz summaries
	quizSummaries.forEach((quizSummary) => {
		// Count weak tags
		quizSummary.weakTags.forEach((tag) => {
			if (!tagFrequency.has(tag)) {
				tagFrequency.set(tag, { weak: 0, strong: 0, focus: 0 });
			}
			tagFrequency.get(tag)!.weak++;
		});

		// Count strong tags
		quizSummary.strongTags.forEach((tag) => {
			if (!tagFrequency.has(tag)) {
				tagFrequency.set(tag, { weak: 0, strong: 0, focus: 0 });
			}
			tagFrequency.get(tag)!.strong++;
		});

		// Count recommended focus
		quizSummary.recommendedFocus.forEach((tag) => {
			if (!tagFrequency.has(tag)) {
				tagFrequency.set(tag, { weak: 0, strong: 0, focus: 0 });
			}
			tagFrequency.get(tag)!.focus++;
		});
	});

	// Calculate total questions
	sessions.forEach((session) => {
		totalQuestions += session.items?.length || 0;
	});

	// Determine aggregated weak/strong tags
	// For 1-2 sessions/quizzes: include if appears in any
	// For 3+ sessions/quizzes: include if appears in >50%
	const totalSummaries = summaries.length + quizSummaries.length;
	const threshold = totalSummaries <= 2 ? 1 : Math.ceil(totalSummaries * 0.5);
	const aggregatedWeakTags: string[] = [];
	const aggregatedStrongTags: string[] = [];

	tagFrequency.forEach((counts, tag) => {
		if (counts.weak >= threshold) {
			aggregatedWeakTags.push(tag);
		}
		if (counts.strong >= threshold) {
			aggregatedStrongTags.push(tag);
		}
	});

	// Top focus areas (tags with highest focus count)
	const topFocusAreas = Array.from(tagFrequency.entries())
		.filter(([, counts]) => counts.focus > 0)
		.sort((a, b) => b[1].focus - a[1].focus)
		.slice(0, 5)
		.map(([tag]) => tag);

	// Update or create insight record
	// Handle topForgottenPoints gracefully if column doesn't exist yet
	try {
		await prisma.userLearningInsight.upsert({
			where: { userId },
			create: {
				userId,
				aggregatedWeakTags,
				aggregatedStrongTags,
				topFocusAreas,
				topForgottenPoints: JSON.parse(
					JSON.stringify(topForgottenPoints)
				) as Prisma.InputJsonValue,
				totalSessions: totalSessionsAndQuizzes,
				totalQuestions,
			},
			update: {
				aggregatedWeakTags,
				aggregatedStrongTags,
				topFocusAreas,
				topForgottenPoints: JSON.parse(
					JSON.stringify(topForgottenPoints)
				) as Prisma.InputJsonValue,
				totalSessions: totalSessionsAndQuizzes,
				totalQuestions,
				lastUpdated: new Date(),
			},
		});
	} catch (error) {
		// If topForgottenPoints column doesn't exist, try without it
		if (
			error instanceof Error &&
			error.message.includes("topForgottenPoints")
		) {
			console.warn(
				"topForgottenPoints column not found, creating/updating without it"
			);
			await prisma.userLearningInsight.upsert({
				where: { userId },
				create: {
					userId,
					aggregatedWeakTags,
					aggregatedStrongTags,
					topFocusAreas,
					totalSessions: sessions.length,
					totalQuestions,
				},
				update: {
					aggregatedWeakTags,
					aggregatedStrongTags,
					topFocusAreas,
					totalSessions: sessions.length,
					totalQuestions,
					lastUpdated: new Date(),
				},
			});
		} else {
			throw error;
		}
	}
}
