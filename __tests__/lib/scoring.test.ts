import { describe, it, expect } from 'vitest';
import {
  countWords,
  countFillers,
  calculateWPM,
  calculateFillerRate,
  detectLongPauses,
} from '@/lib/scoring';

describe('scoring', () => {
  describe('countWords', () => {
    it('should count words correctly', () => {
      expect(countWords('Hello world')).toBe(2);
      expect(countWords('This is a test sentence.')).toBe(5);
      expect(countWords('')).toBe(0);
      expect(countWords('   ')).toBe(0);
    });

    it('should handle punctuation', () => {
      expect(countWords('Hello, world!')).toBe(2);
      expect(countWords('What\'s up?')).toBe(2);
    });

    it('should handle multiple spaces', () => {
      expect(countWords('Hello    world')).toBe(2);
      expect(countWords('  Hello   world  ')).toBe(2);
    });
  });

  describe('countFillers', () => {
    it('should detect common fillers', () => {
      expect(countFillers('uh hello world')).toBeGreaterThan(0);
      expect(countFillers('um, like, you know')).toBeGreaterThan(0);
      expect(countFillers('erm, I think so')).toBeGreaterThan(0);
    });

    it('should not count fillers in normal speech', () => {
      expect(countFillers('Hello world')).toBe(0);
      expect(countFillers('This is a clear sentence')).toBe(0);
    });

    it('should handle empty strings', () => {
      expect(countFillers('')).toBe(0);
      expect(countFillers('   ')).toBe(0);
    });

    it('should detect British fillers', () => {
      expect(countFillers('er, well')).toBeGreaterThan(0);
      expect(countFillers('erm, actually')).toBeGreaterThan(0);
    });
  });

  describe('calculateWPM', () => {
    it('should calculate WPM correctly', () => {
      // 60 words in 60 seconds = 60 WPM
      expect(calculateWPM(60, 60)).toBe(60);
      // 120 words in 60 seconds = 120 WPM
      expect(calculateWPM(120, 60)).toBe(120);
    });

    it('should handle zero duration', () => {
      expect(calculateWPM(10, 0)).toBe(0);
    });

    it('should handle very fast speech', () => {
      expect(calculateWPM(200, 60)).toBe(200);
    });
  });

  describe('calculateFillerRate', () => {
    it('should calculate filler rate correctly', () => {
      // 10 fillers in 100 words = 10%
      expect(calculateFillerRate(10, 100)).toBe(10);
      // 5 fillers in 50 words = 10%
      expect(calculateFillerRate(5, 50)).toBe(10);
    });

    it('should handle zero words', () => {
      expect(calculateFillerRate(0, 0)).toBe(0);
    });

    it('should handle more fillers than words (edge case)', () => {
      expect(calculateFillerRate(10, 5)).toBe(200);
    });
  });

  describe('detectLongPauses', () => {
    it('should detect long pauses from timestamps', () => {
      const timestamps = [
        { word: 'hello', start: 0, end: 0.5 },
        { word: 'world', start: 1.0, end: 1.5 }, // 0.5s gap (not long)
        { word: 'test', start: 2.5, end: 3.0 }, // 1.0s gap (long pause)
      ];
      expect(detectLongPauses(timestamps)).toBeGreaterThan(0);
    });

    it('should return 0 for no long pauses', () => {
      const timestamps = [
        { word: 'hello', start: 0, end: 0.5 },
        { word: 'world', start: 0.6, end: 1.0 },
      ];
      expect(detectLongPauses(timestamps)).toBe(0);
    });

    it('should handle empty timestamps', () => {
      expect(detectLongPauses([])).toBe(0);
    });
  });
});

