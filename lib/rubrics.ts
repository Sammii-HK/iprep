/**
 * Versioned, question-aware rubrics. A rubric names what a good answer contains so the
 * evaluator judges knowledge against the right criteria; it never rewards keywords or
 * penalises subject vocabulary. Historical scores keep the version they were produced with.
 */

import { isAdministrativeQuestion } from "./learning-context";

export type RubricKind =
	| "TECHNICAL_EXPLANATION"
	| "SYSTEM_DESIGN"
	| "BEHAVIOURAL"
	| "PRODUCT_JUDGEMENT"
	| "FOUNDER"
	| "INTERVIEW_SIMULATION";

export interface RubricCriterion {
	id: string;
	label: string;
	/** Core criteria are required for a strong answer; the rest are optional depth. */
	core: boolean;
	guidance: string;
}

export interface Rubric {
	kind: RubricKind;
	version: string;
	criteria: RubricCriterion[];
}

const c = (id: string, label: string, core: boolean, guidance: string): RubricCriterion => ({
	id,
	label,
	core,
	guidance,
});

export const RUBRICS: Record<RubricKind, Rubric> = {
	TECHNICAL_EXPLANATION: {
		kind: "TECHNICAL_EXPLANATION",
		version: "rubric-technical@1",
		criteria: [
			c("correctness", "Technical correctness", true, "Claims are accurate. A confident but wrong claim is a misconception."),
			c("coverage", "Conceptual coverage", true, "Covers the concepts the question is really about, in any wording."),
			c("clarity", "Explanation clarity", true, "Explains why, not just names terms."),
			c("tradeoffs", "Trade-offs", false, "Notes when the approach does not fit."),
			c("examples", "Relevant examples", false, "Concrete example or application."),
		],
	},
	SYSTEM_DESIGN: {
		kind: "SYSTEM_DESIGN",
		version: "rubric-system-design@1",
		criteria: [
			c("requirements", "Requirements and constraints", true, "Clarifies or states what is being built and its limits."),
			c("architecture", "Architecture", true, "Coherent components and how they interact."),
			c("tradeoffs", "Trade-offs", true, "Justifies choices against alternatives."),
			c("scaling", "Scalability", false, "How it behaves under growth."),
			c("reliability", "Reliability and failure modes", false, "What breaks and how it recovers."),
			c("accessibility", "Accessibility", false, "Only where relevant to the system."),
		],
	},
	BEHAVIOURAL: {
		kind: "BEHAVIOURAL",
		version: "rubric-behavioural@1",
		criteria: [
			c("situation", "Situation and context", true, "Enough context to understand the story."),
			c("contribution", "Personal contribution", true, "What the learner specifically did, not the team."),
			c("actions", "Decisions and actions", true, "Why they chose what they did."),
			c("outcome", "Outcome", true, "What happened. Numbers are not required and must never be invented."),
			c("reflection", "Reflection", false, "What they learned or would change."),
		],
	},
	PRODUCT_JUDGEMENT: {
		kind: "PRODUCT_JUDGEMENT",
		version: "rubric-product@1",
		criteria: [
			c("framing", "Problem framing", true, "Identifies the real problem and users."),
			c("constraints", "Constraints", true, "Time, cost, risk and technical limits."),
			c("prioritisation", "Prioritisation", true, "What to do first and why."),
			c("outcomes", "Outcomes and measures", false, "How success would be judged."),
		],
	},
	FOUNDER: {
		kind: "FOUNDER",
		version: "rubric-founder@1",
		criteria: [
			c("problem", "Problem and customer", true, "Clear problem for a specific customer."),
			c("market", "Market", true, "Credible size and reasoning."),
			c("differentiation", "Differentiation", true, "Why this wins."),
			c("evidence", "Traction and evidence", false, "Evidence, not assertions."),
			c("model", "Business model", true, "How it makes money."),
			c("risks", "Risks and assumptions", false, "Names what could be wrong."),
		],
	},
	INTERVIEW_SIMULATION: {
		kind: "INTERVIEW_SIMULATION",
		version: "rubric-interview@1",
		criteria: [
			c("relevance", "Relevance to the question", true, "Answers what was asked."),
			c("depth", "Depth for the role", true, "Appropriate to the seniority."),
			c("communication", "Communication", true, "Structured and easy to follow."),
			c("followup", "Follow-up handling", false, "Handles probing without defensiveness."),
		],
	},
};

export interface RubricSubject {
	text: string;
	type?: string | null;
	tags?: readonly string[];
	bankTitle?: string | null;
	/** Set for mock-interview style sessions. */
	interviewSimulation?: boolean;
}

/** Chooses the rubric from the question itself. Administrative questions get none. */
export function selectRubric(q: RubricSubject): Rubric | null {
	if (isAdministrativeQuestion(q.text)) return null;
	if (q.interviewSimulation) return RUBRICS.INTERVIEW_SIMULATION;
	const hay = `${q.text} ${q.bankTitle ?? ""} ${(q.tags ?? []).join(" ")}`.toLowerCase();
	if (/\b(fundrais|valuation|investor|pitch|go-?to-?market|business model|startup|unit economics)\w*/.test(hay) || q.type === "PITCH") {
		return RUBRICS.FOUNDER;
	}
	if (q.type === "BEHAVIORAL" || /\b(tell me about a time|describe a time|a time you)\b/.test(hay)) {
		return RUBRICS.BEHAVIOURAL;
	}
	if (/\b(system design|architect|scal(e|able|ing)|design a|how would you (build|design))\b/.test(hay)) {
		return RUBRICS.SYSTEM_DESIGN;
	}
	if (/\b(prioriti[sz]e|trade-?off with users|product (judg|decision|strategy)|roadmap)\w*/.test(hay)) {
		return RUBRICS.PRODUCT_JUDGEMENT;
	}
	return RUBRICS.TECHNICAL_EXPLANATION;
}

/** Prompt text for the evaluator. Version it alongside the evaluator prompt version. */
export function rubricPromptSection(r: Rubric): string {
	const lines = r.criteria.map(
		(x) => `- ${x.label} (${x.core ? "core" : "optional depth"}): ${x.guidance}`,
	);
	return [
		`RUBRIC ${r.version}`,
		...lines,
		"Rules: judge meaning, not keywords. Credit correct ideas expressed in different words.",
		"Repeating terminology central to the question is expected and is never a flaw.",
		"Only core criteria can lower a score when missing. Optional depth is an improvement opportunity, not a mistake.",
		"Never criticise something the transcript does not support; quote or point to the omission.",
	].join("\n");
}
