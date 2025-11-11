import { describe, it, expect } from 'vitest';
import { parseCSV } from '@/lib/csv';

describe('CSV parsing', () => {
	describe('front,back format', () => {
		it('should parse front,back CSV correctly', () => {
			const csv = `front,back
"What is React?","React is a JavaScript library for building user interfaces"
"What is TypeScript?","TypeScript is a typed superset of JavaScript"`;

			const result = parseCSV(csv);
			expect(result).toHaveLength(2);
			expect(result[0].text).toBe('What is React?');
			expect(result[0].hint).toBe('React is a JavaScript library for building user interfaces');
			expect(result[1].text).toBe('What is TypeScript?');
			expect(result[1].hint).toBe('TypeScript is a typed superset of JavaScript');
		});

		it('should handle empty back field', () => {
			const csv = `front,back
"What is React?",""
"What is TypeScript?","TypeScript is a typed superset of JavaScript"`;

			const result = parseCSV(csv);
			expect(result).toHaveLength(2);
			expect(result[0].hint).toBeUndefined();
			expect(result[1].hint).toBe('TypeScript is a typed superset of JavaScript');
		});

		it('should handle missing back value (empty)', () => {
			const csv = `front,back
"What is React?",""`;

			const result = parseCSV(csv);
			expect(result).toHaveLength(1);
			expect(result[0].text).toBe('What is React?');
			expect(result[0].hint).toBeUndefined();
		});

		it('should skip empty rows', () => {
			const csv = `front,back
"What is React?","React is a library"

"What is TypeScript?","TypeScript is typed"`;

			const result = parseCSV(csv);
			expect(result).toHaveLength(2);
		});
	});

	describe('error handling', () => {
		it('should throw error for invalid format', () => {
			const csv = `invalid,columns,here
"Row 1","Row 2","Row 3"`;

			expect(() => parseCSV(csv)).toThrow();
		});

		it('should throw error for empty front field', () => {
			const csv = `front,back
"","This is the answer"`;

			expect(() => parseCSV(csv)).toThrow();
		});
	});
});

