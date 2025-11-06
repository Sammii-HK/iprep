import { describe, it, expect } from 'vitest';
import { validateAudioFile, validateId, sanitizeString } from '@/lib/validation';

describe('validation', () => {
  describe('validateAudioFile', () => {
    it('should accept valid webm audio file', () => {
      const file = new File([''], 'test.webm', { type: 'audio/webm' });
      const result = validateAudioFile(file);
      expect(result.valid).toBe(true);
    });

    it('should accept iOS-compatible mp4 audio file', () => {
      const file = new File([''], 'test.m4a', { type: 'audio/mp4; codecs=mp4a.40.2' });
      const result = validateAudioFile(file);
      expect(result.valid).toBe(true);
    });

    it('should reject file that is too large', () => {
      const largeBuffer = new ArrayBuffer(51 * 1024 * 1024); // 51MB
      const file = new File([largeBuffer], 'large.webm', { type: 'audio/webm' });
      const result = validateAudioFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too large');
    });

    it('should reject invalid file type', () => {
      const file = new File([''], 'test.txt', { type: 'text/plain' });
      const result = validateAudioFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid file type');
    });

    it('should handle empty file', () => {
      const file = new File([], 'empty.webm', { type: 'audio/webm' });
      const result = validateAudioFile(file);
      expect(result.valid).toBe(true); // Size validation is separate
    });
  });

  describe('validateId', () => {
    it('should accept valid CUID', () => {
      expect(validateId('cmhnujogk000pju04z1kmk403')).toBe(true);
    });

    it('should reject invalid CUID format', () => {
      expect(validateId('invalid-id')).toBe(false);
      expect(validateId('1234567890123456789012345')).toBe(false);
      expect(validateId('')).toBe(false);
      expect(validateId('cmhnujogk000pju04z1kmk403x')).toBe(false); // Too long
    });

    it('should reject SQL injection attempts', () => {
      expect(validateId("'; DROP TABLE users; --")).toBe(false);
      expect(validateId("1' OR '1'='1")).toBe(false);
    });
  });

  describe('sanitizeString', () => {
    it('should remove HTML tags', () => {
      expect(sanitizeString('<script>alert("xss")</script>')).not.toContain('<script>');
      expect(sanitizeString('<img src=x onerror=alert(1)>')).not.toContain('<img');
    });

    it('should trim whitespace', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
    });

    it('should limit length', () => {
      const longString = 'a'.repeat(20000);
      expect(sanitizeString(longString).length).toBeLessThanOrEqual(10000);
    });

    it('should handle empty strings', () => {
      expect(sanitizeString('')).toBe('');
      expect(sanitizeString('   ')).toBe('');
    });
  });
});

