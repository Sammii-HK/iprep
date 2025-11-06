/**
 * Input validation utilities for API routes
 */

import { z } from 'zod';

export const AudioFileSchema = z.object({
  size: z.number().max(50 * 1024 * 1024, 'Audio file too large (max 50MB)'),
  type: z.string().refine(
    (type) => type.startsWith('audio/') || type === 'video/webm',
    'Invalid file type. Must be audio file.'
  ),
});

export const SessionIdSchema = z.string().cuid('Invalid session ID format');
export const QuestionIdSchema = z.string().cuid('Invalid question ID format');
export const BankIdSchema = z.string().cuid('Invalid bank ID format');

export const CreateSessionSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  bankId: BankIdSchema.optional(),
});

export const ImportBankSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
});

export const PracticeRequestSchema = z.object({
  audio: z.instanceof(File).refine(
    (file) => file.size <= 50 * 1024 * 1024,
    'Audio file too large (max 50MB)'
  ),
  sessionId: SessionIdSchema,
  questionId: QuestionIdSchema,
});

export const AnalyticsQuerySchema = z.object({
  range: z
    .string()
    .optional()
    .transform((val) => {
      const num = val ? parseInt(val, 10) : 30;
      if (isNaN(num) || num < 1 || num > 365) {
        return 30;
      }
      return num;
    }),
});

/**
 * Sanitize string input to prevent XSS
 */
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .slice(0, 10000); // Limit length
}

/**
 * Validate audio file
 */
export function validateAudioFile(file: File): { valid: boolean; error?: string } {
  // Check file size (50MB max)
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `Audio file too large. Maximum size is ${maxSize / 1024 / 1024}MB.`,
    };
  }

  // Check file type (including iOS-compatible formats)
  const validTypes = [
    'audio/webm',
    'audio/mp4', // iOS Safari
    'audio/m4a', // iOS Safari
    'audio/aac', // iOS Safari
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'video/webm', // Some browsers record as video/webm
  ];

  if (!validTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type: ${file.type}. Supported types: ${validTypes.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Validate ID format (CUID)
 */
export function validateId(id: string): boolean {
  return /^c[a-z0-9]{24}$/.test(id);
}
