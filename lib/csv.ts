import Papa from 'papaparse';
import { z } from 'zod';

// Support both formats: text,tags,difficulty AND front,back
const QuestionRowSchemaText = z.object({
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

const QuestionRowSchemaFrontBack = z.object({
  front: z.string().min(1),
  back: z.string().optional().default(''), // Optional - can be empty
});

export interface ParsedQuestion {
  text: string;
  hint?: string; // Optional hint/answer from back field
  tags: string[];
  difficulty: number;
}

export function parseCSV(csvContent: string): ParsedQuestion[] {
  const result = Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
    transform: (value) => value?.trim() || '', // Trim and handle undefined
  });

  // Log parsing errors but don't fail immediately
  if (result.errors.length > 0) {
    console.warn('CSV parsing warnings:', result.errors);
  }

  // Detect CSV format based on headers
  // Primary format: front,back (standard flashcard format)
  let format: 'frontback' | 'text' | null = null;
  if (result.data.length > 0) {
    const firstRow = result.data[0] as Record<string, string | undefined>;
    const headers = Object.keys(firstRow).map(h => h.toLowerCase().trim());
    
    if (headers.includes('front') && headers.includes('back')) {
      format = 'frontback';
    } else if (headers.includes('text')) {
      // Legacy format support
      format = 'text';
    } else {
      throw new Error(
        `CSV format not recognized. Found columns: ${Object.keys(firstRow).join(', ')}. ` +
        `Expected format: front,back (or legacy: text,tags,difficulty)`
      );
    }
  }

  const questions: ParsedQuestion[] = [];
  const errors: string[] = [];

  for (let i = 0; i < result.data.length; i++) {
    const row = result.data[i] as Record<string, string | undefined>;
    const rowNumber = i + 2; // +2 because row 1 is header, and arrays are 0-indexed

    // Skip completely empty rows
    if (!row || Object.keys(row).length === 0) {
      continue;
    }

    try {
      if (format === 'frontback') {
        // Handle front,back format
        if (!row.front || !row.front.trim()) {
          errors.push(`Row ${rowNumber}: Missing or empty "front" field`);
          continue;
        }

        // Back is optional - can be empty
        const backValueRaw = row.back?.trim() || '';
        
        const validated = QuestionRowSchemaFrontBack.parse({
          front: row.front.trim(),
          back: backValueRaw,
        });

        // Convert front/back to question format
        // front = question text (required)
        // back = optional answer/hint text (full sentence) - always treated as hint text
        const hint = validated.back && validated.back.trim().length > 0
          ? validated.back.trim()
          : undefined;
        
        questions.push({
          text: validated.front,
          hint,
          tags: [], // No tags from front,back format
          difficulty: 3, // Default difficulty
        });
      } else {
        // Handle text,tags,difficulty format
        if (!row.text || !row.text.trim()) {
          errors.push(`Row ${rowNumber}: Missing or empty "text" field`);
          continue;
        }

        if (row.difficulty === undefined || row.difficulty === null || row.difficulty === '') {
          errors.push(`Row ${rowNumber}: Missing "difficulty" field`);
          continue;
        }

        // Ensure tags field exists (default to empty string)
        const tagsString = row.tags || '';
        
        const validated = QuestionRowSchemaText.parse({
          text: row.text.trim(),
          tags: tagsString,
          difficulty: row.difficulty,
        });

        const tags = validated.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0);

        questions.push({
          text: validated.text,
          tags,
          difficulty: validated.difficulty,
        });
      }
    } catch (error) {
      console.error(`Error parsing row ${rowNumber}:`, row, error);
      if (error instanceof z.ZodError) {
        const errorDetails = error.issues.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        errors.push(`Row ${rowNumber}: ${errorDetails}`);
      } else {
        errors.push(`Row ${rowNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  // If no valid questions were parsed, throw an error with details
  if (questions.length === 0) {
    const errorMsg = errors.length > 0 
      ? `No valid questions found. Errors:\n${errors.join('\n')}`
      : 'No valid questions found in CSV file.';
    throw new Error(errorMsg);
  }

  // If there were some errors but we have valid questions, log them
  if (errors.length > 0) {
    console.warn(`Imported ${questions.length} questions, but ${errors.length} rows had errors:`, errors);
  }

  return questions;
}

export function parseJSON(jsonContent: string): ParsedQuestion[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonContent);
  } catch {
    throw new Error('Invalid JSON format');
  }

  if (!Array.isArray(data)) {
    throw new Error('JSON must be an array of question objects');
  }

  const questions: ParsedQuestion[] = [];

  for (const item of data) {
    const questionItem = item as Record<string, unknown>;
    
    try {
      // Handle tags as either array or comma-separated string
      let tags: string[];
      if (Array.isArray(questionItem.tags)) {
        tags = questionItem.tags.map((tag: unknown) => String(tag).trim()).filter((tag: string) => tag.length > 0);
      } else {
        tags = String(questionItem.tags || '')
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0);
      }

      const difficulty = typeof questionItem.difficulty === 'number' 
        ? questionItem.difficulty 
        : parseInt(String(questionItem.difficulty), 10);

      if (isNaN(difficulty) || difficulty < 1 || difficulty > 5) {
        throw new Error('Difficulty must be between 1 and 5');
      }

      questions.push({
        text: String(questionItem.text),
        tags,
        difficulty,
      });
    } catch (error) {
      console.error('Error parsing item:', questionItem, error);
      throw new Error(`Invalid item: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return questions;
}
