/**
 * Concept graph and evidence-derived concept state. The graph links concepts, questions and
 * prerequisites; state comes ONLY from completed evaluations. Exposure (listening, opening a
 * question, naming a term) never produces demonstrated mastery, a self-grade is not an
 * evaluation, and a failed evaluation counts as nothing.
 */

export type EdgeKind = "PREREQUISITE" | "RELATED" | "BUILDS_ON" | "COMMONLY_CONFUSED" | "APPLIED_IN";

export interface Concept {
	id: string;
	label: string;
}

export interface Edge {
	from: string;
	to: string;
	kind: EdgeKind;
}

export class ConceptGraph {
	private edges: Edge[] = [];
	private concepts = new Map<string, Concept>();
	private questionConcepts = new Map<string, Set<string>>();

	addConcept(c: Concept) {
		this.concepts.set(c.id, c);
		return this;
	}

	/** "from" is a prerequisite OF "to" when kind is PREREQUISITE. Unknown concepts are rejected. */
	addEdge(e: Edge) {
		if (!this.concepts.has(e.from) || !this.concepts.has(e.to)) {
			throw new Error(`Unknown concept in edge ${e.from} -> ${e.to}`);
		}
		if (e.kind === "PREREQUISITE" && this.reaches(e.from, e.to)) {
			throw new Error(`Prerequisite cycle: ${e.from} -> ${e.to}`);
		}
		this.edges.push(e);
		return this;
	}

	tagQuestion(questionId: string, conceptIds: readonly string[]) {
		this.questionConcepts.set(questionId, new Set(conceptIds.filter((c) => this.concepts.has(c))));
		return this;
	}

	conceptsOf(questionId: string): string[] {
		return [...(this.questionConcepts.get(questionId) ?? [])];
	}

	questionsFor(conceptId: string): string[] {
		return [...this.questionConcepts].filter(([, s]) => s.has(conceptId)).map(([q]) => q);
	}

	prerequisitesOf(conceptId: string, transitive = true): string[] {
		const direct = this.edges.filter((e) => e.kind === "PREREQUISITE" && e.to === conceptId).map((e) => e.from);
		if (!transitive) return direct;
		const seen = new Set<string>();
		const walk = (id: string) => {
			for (const p of this.prerequisitesOf(id, false)) {
				if (!seen.has(p)) {
					seen.add(p);
					walk(p);
				}
			}
		};
		walk(conceptId);
		return [...seen];
	}

	related(conceptId: string, kind?: EdgeKind): string[] {
		return this.edges
			.filter((e) => e.kind !== "PREREQUISITE" && (!kind || e.kind === kind) && (e.from === conceptId || e.to === conceptId))
			.map((e) => (e.from === conceptId ? e.to : e.from));
	}

	/** True if `to` is already a (transitive) prerequisite-descendant of `from`. */
	private reaches(from: string, to: string): boolean {
		return from === to || this.prerequisitesOf(from, true).includes(to);
	}
}

export type EvidenceKind = "EXPOSURE" | "RECALL" | "EXPLANATION" | "APPLICATION" | "DELIVERY" | "DISCRIMINATION";

export interface ConceptEvidence {
	conceptId: string;
	kind: EvidenceKind;
	at: Date;
	/** Where it came from. Only evaluator-produced evidence can demonstrate understanding. */
	source: "AI_EVALUATION" | "SELF_GRADE" | "LISTENING" | "VIEWED" | "XP";
	evaluationStatus?: "COMPLETED" | "FAILED";
	/** 0..10 from a completed evaluation. */
	score?: number;
}

export type ConceptState =
	| "NOT_ENCOUNTERED"
	| "EXPOSED"
	| "PRACTISING"
	| "DEVELOPING"
	| "DEMONSTRATED"
	| "NEEDS_REVIEW";

const DEMONSTRATING: EvidenceKind[] = ["RECALL", "EXPLANATION", "APPLICATION", "DISCRIMINATION"];
const DAY = 86_400_000;

function counts(e: ConceptEvidence) {
	return (
		e.source === "AI_EVALUATION" &&
		e.evaluationStatus === "COMPLETED" &&
		typeof e.score === "number" &&
		Number.isFinite(e.score)
	);
}

export function conceptState(evidence: readonly ConceptEvidence[], now: Date): ConceptState {
	if (evidence.length === 0) return "NOT_ENCOUNTERED";
	const real = evidence.filter(counts).sort((a, b) => a.at.getTime() - b.at.getTime());
	if (real.length === 0) return "EXPOSED"; // listening, viewing, self-grade, failed evals
	const latest = real[real.length - 1];
	const good = real.filter((e) => (e.score as number) >= 7 && DEMONSTRATING.includes(e.kind));
	const goodKinds = new Set(good.map((e) => e.kind));
	const spanDays = good.length > 1 ? (good[good.length - 1].at.getTime() - good[0].at.getTime()) / DAY : 0;

	if ((latest.score as number) < 5 && real.length >= 2) return "NEEDS_REVIEW";
	// Demonstrated needs repeated success, over time, in more than one way of knowing.
	if (good.length >= 3 && goodKinds.size >= 2 && spanDays >= 3 && (latest.score as number) >= 7) {
		// Demonstrations fade: long-unseen concepts go back to review, not to "mastered forever".
		return (now.getTime() - latest.at.getTime()) / DAY > 45 ? "NEEDS_REVIEW" : "DEMONSTRATED";
	}
	if (good.length >= 2) return "DEVELOPING";
	return "PRACTISING";
}

/**
 * Prerequisites worth repairing: unmastered prerequisites of a concept the learner struggles
 * with, nearest first. Never suggests re-asking the same question.
 */
export function prerequisiteGaps(
	graph: ConceptGraph,
	conceptId: string,
	stateOf: (id: string) => ConceptState,
): string[] {
	return graph
		.prerequisitesOf(conceptId)
		.filter((p) => !["DEMONSTRATED", "DEVELOPING"].includes(stateOf(p)));
}
