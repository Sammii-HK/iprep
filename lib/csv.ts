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
    transform: (value) => value?.trim() || '', // Trim and handle undefined
  });

  // Log parsing errors but don't fail immediately
  if (result.errors.length > 0) {
    console.warn('CSV parsing warnings:', result.errors);
  }

  // Validate that we have the expected headers
  if (result.data.length > 0) {
    const firstRow = result.data[0] as Record<string, any>;
    const headers = Object.keys(firstRow);
    const requiredHeaders = ['text'];
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    
    if (missingHeaders.length > 0) {
      throw new Error(
        `CSV is missing required columns: ${missingHeaders.join(', ')}. ` +
        `Found columns: ${headers.join(', ')}. ` +
        `Expected format: text,tags,difficulty`
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

    // Check if required fields exist
    if (!row.text || !row.text.trim()) {
      errors.push(`Row ${rowNumber}: Missing or empty "text" field`);
      continue;
    }

    if (row.difficulty === undefined || row.difficulty === null || row.difficulty === '') {
      errors.push(`Row ${rowNumber}: Missing "difficulty" field`);
      continue;
    }

    try {
      // Ensure tags field exists (default to empty string)
      const tagsString = row.tags || '';
      
      const validated = QuestionRowSchema.parse({
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
