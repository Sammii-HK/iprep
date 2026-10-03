import { z } from "zod";
import { FACT_SHEET_MAX_CHARS } from "@/lib/fact-sheet-limits";

export const FactSheetBodySchema = z.object({
	text: z
		.string()
		.max(
			FACT_SHEET_MAX_CHARS,
			`Fact sheet is too long (max ${FACT_SHEET_MAX_CHARS} characters)`
		),
});
