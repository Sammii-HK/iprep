import { describe, it, expect } from 'vitest';
import {
	AppError,
	ValidationError,
	NotFoundError,
	ExternalServiceError,
	handleApiError,
} from '@/lib/errors';

describe('Error handling', () => {
	describe('AppError', () => {
		it('should create error with message and status code', () => {
			const error = new AppError('Test error', 400);
			expect(error.message).toBe('Test error');
			expect(error.statusCode).toBe(400);
			expect(error.code).toBeUndefined(); // Code is optional, defaults to undefined
		});

		it('should create error with custom code', () => {
			const error = new AppError('Test error', 400, 'CUSTOM_CODE');
			expect(error.code).toBe('CUSTOM_CODE');
		});
	});

	describe('ValidationError', () => {
		it('should create validation error', () => {
			const error = new ValidationError('Invalid input');
			expect(error.message).toBe('Invalid input');
			expect(error.statusCode).toBe(400);
			expect(error.code).toBe('VALIDATION_ERROR');
		});
	});

	describe('NotFoundError', () => {
		it('should create not found error', () => {
			const error = new NotFoundError('Resource', '123');
			expect(error.message).toBe('Resource with ID 123 not found');
			expect(error.statusCode).toBe(404);
			expect(error.code).toBe('NOT_FOUND');
		});
	});

	describe('ExternalServiceError', () => {
		it('should create external service error', () => {
			const error = new ExternalServiceError('OpenAI', 'API timeout');
			expect(error.message).toBe('External service error (OpenAI): API timeout');
			expect(error.statusCode).toBe(502);
			expect(error.code).toBe('EXTERNAL_SERVICE_ERROR');
		});
	});

	describe('handleApiError', () => {
		it('should handle AppError correctly', () => {
			const error = new ValidationError('Test');
			const result = handleApiError(error);
			expect(result.statusCode).toBe(400);
			expect(result.message).toBe('Test');
			expect(result.code).toBe('VALIDATION_ERROR');
		});

		it('should handle unknown errors', () => {
			const error = new Error('Unknown error');
			const result = handleApiError(error);
			expect(result.statusCode).toBe(500);
			expect(result.message).toBe('Unknown error'); // In non-production, shows actual error message
			expect(result.code).toBe('INTERNAL_ERROR');
		});

		it('should preserve error details', () => {
			const error = new AppError('Test', 400, 'CUSTOM', { field: 'value' });
			const result = handleApiError(error);
			expect(result.details).toEqual({ field: 'value' });
		});
	});
});

