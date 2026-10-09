/**
 * Seed concept taxonomy and alias-based question tagging. Aliases are matched as whole
 * phrases, so shared keywords alone do not create a link, and edges are only the
 * relationships listed here (no inferred relationships). Extend as banks are reviewed.
 */

import { ConceptGraph, type Edge } from "./concept-graph";

interface Seed {
	id: string;
	label: string;
	aliases: string[];
}

export const SEED_CONCEPTS: Seed[] = [
	{ id: "closures", label: "Closures", aliases: ["closure", "closures", "lexical scope"] },
	{ id: "referential-equality", label: "Referential equality", aliases: ["referential equality", "object identity", "reference equality"] },
	{ id: "react-rendering", label: "React rendering", aliases: ["react rendering", "re-render", "rerender", "reconciliation", "virtual dom"] },
	{ id: "react-memoisation", label: "React memoisation", aliases: ["usememo", "usecallback", "react.memo", "memoisation", "memoization"] },
	{ id: "react-hooks", label: "React hooks", aliases: ["hooks", "useeffect", "usestate", "custom hook"] },
	{ id: "design-tokens", label: "Design tokens", aliases: ["design token", "design tokens", "semantic token", "primitive token"] },
	{ id: "design-systems", label: "Design systems", aliases: ["design system", "component library"] },
	{ id: "component-architecture", label: "Component architecture", aliases: ["compound component", "component api", "component architecture", "composition"] },
	{ id: "accessibility", label: "Accessibility", aliases: ["accessibility", "a11y", "aria", "screen reader", "wcag"] },
	{ id: "css-layout", label: "CSS layout", aliases: ["css grid", "flexbox", "css layout"] },
	{ id: "typescript-generics", label: "TypeScript generics", aliases: ["generics", "generic type", "type parameter"] },
	{ id: "mcp", label: "MCP", aliases: ["mcp", "model context protocol"] },
	{ id: "agent-orchestration", label: "Agent orchestration", aliases: ["agent orchestration", "multi-agent", "orchestrat", "tool calling"] },
	{ id: "database-indexing", label: "Database indexing", aliases: ["database index", "indexing", "b-tree"] },
	{ id: "system-design", label: "System design", aliases: ["system design", "scalab", "load balanc"] },
];

export const SEED_EDGES: Edge[] = [
	{ from: "closures", to: "react-hooks", kind: "PREREQUISITE" },
	{ from: "referential-equality", to: "react-memoisation", kind: "PREREQUISITE" },
	{ from: "react-rendering", to: "react-memoisation", kind: "PREREQUISITE" },
	{ from: "design-tokens", to: "design-systems", kind: "BUILDS_ON" },
	{ from: "component-architecture", to: "design-systems", kind: "BUILDS_ON" },
	{ from: "accessibility", to: "design-systems", kind: "RELATED" },
	{ from: "react-memoisation", to: "react-rendering", kind: "COMMONLY_CONFUSED" },
];

export function buildSeedGraph(): ConceptGraph {
	const g = new ConceptGraph();
	SEED_CONCEPTS.forEach((c) => g.addConcept({ id: c.id, label: c.label }));
	SEED_EDGES.forEach((e) => g.addEdge(e));
	return g;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MATCHERS = SEED_CONCEPTS.map((c) => ({
	id: c.id,
	re: new RegExp(`(^|[^a-z0-9])(${c.aliases.map(escape).join("|")})`, "i"),
}));

/** Concepts a question (text plus optional reference answer) tests. One question may map to several. */
export function extractConcepts(text: string, hint?: string | null): string[] {
	const hay = `${text} ${hint ?? ""}`;
	return MATCHERS.filter((m) => m.re.test(hay)).map((m) => m.id);
}

/** Tags many questions into a graph. Questions with no matching concept are simply untagged. */
export function tagQuestions(
	graph: ConceptGraph,
	questions: readonly { id: string; text: string; hint?: string | null }[],
): { tagged: number; untagged: string[] } {
	const untagged: string[] = [];
	let tagged = 0;
	for (const q of questions) {
		const ids = extractConcepts(q.text, q.hint);
		if (ids.length) {
			graph.tagQuestion(q.id, ids);
			tagged++;
		} else untagged.push(q.id);
	}
	return { tagged, untagged };
}
