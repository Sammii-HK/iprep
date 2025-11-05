import Papa from 'papaparse';
import { z } from 'zod';

const QuestionRowSchema = z.object({
  text: z.string().min(1),
  tags: z.string(), // Comma-separated string
  difficulty: z
    .string()
    .transform((val) => {
      const num = parseInt(val, 10);
      if (isNaN(num) || num < 1 || num > 5) {
        throw new Error('Difficulty must be between 1 and 5');
      }
      return num;
    })
    .pipe(z.number().int().min(1).max(5)),
});

export interface ParsedQuestion {
  text: string;
  tags: string[];
  difficulty: number;
}

export function parseCSV(csvContent: string): ParsedQuestion[] {
  const result = Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
  });

  if (result.errors.length > 0) {
    throw new Error(`CSV parsing errors: ${result.errors.map((e) => e.message).join(', ')}`);
  }

  const questions: ParsedQuestion[] = [];

  for (const row of result.data) {
    try {
      const validated = QuestionRowSchema.parse(row);
      const tags = validated.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      questions.push({
        text: validated.text,
        tags,
        difficulty: validated.difficulty,
      });
    } catch (error) {
      console.error('Error parsing row:', row, error);
      throw new Error(`Invalid row: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return questions;
}

export function parseJSON(jsonContent: string): ParsedQuestion[] {
  let data: any[];
  try {
    data = JSON.parse(jsonContent);
  } catch (error) {
    throw new Error('Invalid JSON format');
  }

  if (!Array.isArray(data)) {
    throw new Error('JSON must be an array of question objects');
  }

  const questions: ParsedQuestion[] = [];

  for (const item of data) {
    try {
      // Handle tags as either array or comma-separated string
      let tags: string[];
      if (Array.isArray(item.tags)) {
        tags = item.tags.map((tag: any) => String(tag).trim()).filter((tag: string) => tag.length > 0);
      } else {
        tags = String(item.tags || '')
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0);
      }

      const difficulty = typeof item.difficulty === 'number' 
        ? item.difficulty 
        : parseInt(String(item.difficulty), 10);

      if (isNaN(difficulty) || difficulty < 1 || difficulty > 5) {
        throw new Error('Difficulty must be between 1 and 5');
      }

      questions.push({
        text: String(item.text),
        tags,
        difficulty,
      });
    } catch (error) {
      console.error('Error parsing item:', item, error);
      throw new Error(`Invalid item: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return questions;
}
