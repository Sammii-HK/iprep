import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeSessionPerformance } from '@/lib/learning-analytics';
import { prisma } from '@/lib/db';

// Mock Prisma
vi.mock('@/lib/db', () => ({
	prisma: {
		session: {
			findUnique: vi.fn(),
		},
	},
}));

describe('Learning Analytics', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('analyzeSessionPerformance', () => {
		it('should return empty arrays for session with no items', async () => {
			(prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
				id: 'session-1',
				userId: 'user-1',
				items: [],
			});

			const result = await analyzeSessionPerformance('session-1', 'user-1');

			expect(result.commonMistakes).toEqual([]);
			expect(result.frequentlyForgottenPoints).toEqual([]);
			expect(result.weakTags).toEqual([]);
			expect(result.strongTags).toEqual([]);
			expect(result.overallScore).toBe(0);
		});

		it('should calculate performance by tag correctly', async () => {
			(prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
				id: 'session-1',
				userId: 'user-1',
				items: [
					{
						id: 'item-1',
						questionId: 'q-1',
						starScore: 4,
						impactScore: 4,
						clarityScore: 4,
						technicalAccuracy: 4,
						terminologyUsage: 4,
						whatWasWrong: [],
						dontForget: [],
						question: {
							id: 'q-1',
							tags: ['javascript'],
						},
					},
					{
						id: 'item-2',
						questionId: 'q-2',
						starScore: 2,
						impactScore: 2,
						clarityScore: 2,
						technicalAccuracy: 2,
						terminologyUsage: 2,
						whatWasWrong: ['Missing details'],
						dontForget: ['Key point 1'],
						question: {
							id: 'q-2',
							tags: ['react'],
						},
					},
				],
			});

			const result = await analyzeSessionPerformance('session-1', 'user-1');

			// Should identify react as weak tag (avg score < 3)
			expect(result.weakTags).toContain('react');
			// javascript should be strong (avg score >= 4)
			expect(result.strongTags).toContain('javascript');
			expect(result.commonMistakes.length).toBeGreaterThan(0);
			expect(result.frequentlyForgottenPoints.length).toBeGreaterThan(0);
			expect(result.overallScore).toBeGreaterThan(0);
		});

		it('should track frequently forgotten points', async () => {
			(prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
				id: 'session-1',
				userId: 'user-1',
				items: [
					{
						id: 'item-1',
						questionId: 'q-1',
						starScore: 3,
						impactScore: 3,
						clarityScore: 3,
						technicalAccuracy: 3,
						terminologyUsage: 3,
						whatWasWrong: [],
						dontForget: ['Point A', 'Point B'],
						question: {
							id: 'q-1',
							tags: ['react'],
						},
					},
					{
						id: 'item-2',
						questionId: 'q-2',
						starScore: 3,
						impactScore: 3,
						clarityScore: 3,
						technicalAccuracy: 3,
						terminologyUsage: 3,
						whatWasWrong: [],
						dontForget: ['Point A'],
						question: {
							id: 'q-2',
							tags: ['react'],
						},
					},
				],
			});

			const result = await analyzeSessionPerformance('session-1', 'user-1');

			// Point A appears twice, should be in frequently forgotten points
			const pointA = result.frequentlyForgottenPoints.find((p) =>
				p.point.toLowerCase().includes('point a')
			);
			expect(pointA).toBeDefined();
			expect(pointA?.frequency).toBeGreaterThanOrEqual(2);
		});
	});
});

