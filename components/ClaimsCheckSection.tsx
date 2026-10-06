import type { ClaimsCheck } from "@/lib/claims-check";

/**
 * Calm "Check these claims" panel. Shown only when the user has a fact sheet
 * and the answer contains figures or claims that are not in it. "Not in your
 * record" means unverified, never "wrong".
 */
export function ClaimsCheckSection({ claimsCheck }: { claimsCheck?: ClaimsCheck | null }) {
	if (!claimsCheck || claimsCheck.items.length === 0) return null;

	return (
		<section
			aria-labelledby="claims-check-heading"
			className="p-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg"
		>
			<h4
				id="claims-check-heading"
				className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1"
			>
				Check these claims
			</h4>
			<p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
				These are {claimsCheck.label}. That does not mean they are wrong. Only say what you
				can stand behind in the room.
			</p>
			<ul className="space-y-2">
				{claimsCheck.items.map((item, i) => (
					<li key={i} className="text-sm text-slate-700 dark:text-slate-300">
						<p className="leading-snug">&ldquo;{item.statement}&rdquo;</p>
						<p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
							<span className="text-slate-500 dark:text-slate-400">Not in your record:</span>
							{item.flagged.map((f) => (
								<span
									key={f}
									className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100 font-medium"
								>
									{f}
								</span>
							))}
						</p>
					</li>
				))}
			</ul>
		</section>
	);
}
