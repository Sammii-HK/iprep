/**
 * Permanent calibration answers for the deterministic parts of scoring. Wording is the subject of these tests,
 * so the answers are fixed. No personal details. Each carries the question it answers (used to derive the
 * subject vocabulary) and what the deterministic checks must conclude.
 */
export interface CalibrationAnswer {
	id: string;
	question: { text: string; hint?: string; tags?: string[]; type: string };
	transcript: string;
	/** Words that are subject vocabulary here and must never be reported as overuse. */
	subjectWords: string[];
	/** Words that ARE genuine off-topic repetition and must still be reported. */
	reportedWords: string[];
	/** Exact count of genuine filler words (um, uh, you know, ...). */
	fillers: number;
}

const tokensQ = { text: "Explain design tokens in a design system.", hint: "Primitive, semantic and component tokens.", tags: ["design-systems"], type: "DEFINITION" };

export const CALIBRATION: CalibrationAnswer[] = [
	{
		id: "strong-tokens-natural-repetition",
		question: tokensQ,
		transcript:
			"Design tokens are named values for colour and spacing. Primitive tokens hold the raw values, semantic tokens give them meaning like danger or surface, and component tokens scope decisions for one component. Changing a token flows through every place the tokens are consumed, which keeps the system consistent.",
		subjectWords: ["tokens"],
		reportedWords: [],
		fillers: 0,
	},
	{
		id: "correct-but-concise",
		question: tokensQ,
		transcript: "Tokens are named design values, like colours and spacing, that components reference so a change in one place updates everything.",
		subjectWords: ["tokens"],
		reportedWords: [],
		fillers: 0,
	},
	{
		id: "genuine-filler",
		question: tokensQ,
		transcript:
			"So um design tokens are, you know, basically values. Um, I mean they are kind of like variables, uh, that the system uses, you know, everywhere in the product.",
		subjectWords: [],
		reportedWords: [],
		fillers: 9,
	},
	{
		id: "off-topic-padding",
		question: tokensQ,
		transcript:
			"The stuff is good and the stuff works because stuff is what we needed, and honestly the stuff made everything simple, so the stuff stayed in place for the whole project and nobody touched the stuff again.",
		subjectWords: [],
		reportedWords: ["stuff"],
		fillers: 0,
	},
	{
		id: "react-rendering-natural-repetition",
		question: { text: "How does React decide when to re-render a component?", tags: ["react"], type: "TECHNICAL" },
		transcript:
			"React re-renders a component when its state changes or when its parent re-renders and passes new props. During rendering React compares the new output to the previous output, and only the parts of the tree that differ are committed to the DOM, so rendering is cheap even when a component re-renders often.",
		subjectWords: ["render", "renders", "rendering", "component"],
		reportedWords: [],
		fillers: 0,
	},
];
