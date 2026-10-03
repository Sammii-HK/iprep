"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MicRecorder } from "@/components/MicRecorder";

interface DebriefResult {
	debrief: {
		questionsAsked: string[];
		wentWell: string[];
		stumbled: string[];
		followUps: string[];
		oneThingToFix: string;
	};
	bank: { id: string; title: string; added: number; skipped: number };
}

const STAGE_SUGGESTIONS = [
	"Recruiter screen",
	"Hiring manager",
	"Technical",
	"Take-home review",
	"Panel",
	"Final",
];

const inputClass =
	"mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-base text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500";

function ResultList({ title, items }: { title: string; items: string[] }) {
	if (items.length === 0) return null;
	return (
		<section aria-labelledby={`debrief-${title.replace(/\s+/g, "-").toLowerCase()}`}>
			<h2
				id={`debrief-${title.replace(/\s+/g, "-").toLowerCase()}`}
				className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2"
			>
				{title}
			</h2>
			<ul className="space-y-1.5">
				{items.map((item, i) => (
					<li key={i} className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
						{item}
					</li>
				))}
			</ul>
		</section>
	);
}

export default function DebriefPage() {
	const [company, setCompany] = useState("");
	const [role, setRole] = useState("");
	const [stage, setStage] = useState("");
	const [recording, setRecording] = useState<Blob | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [recorderKey, setRecorderKey] = useState(0);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<DebriefResult | null>(null);

	// Keep a playable preview of the recording, and release it when it changes.
	useEffect(() => {
		if (!recording) {
			setPreviewUrl(null);
			return;
		}
		const url = URL.createObjectURL(recording);
		setPreviewUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [recording]);

	const reset = useCallback(() => {
		setRecording(null);
		setError(null);
		setResult(null);
		setRecorderKey((k) => k + 1);
	}, []);

	const save = async () => {
		if (!recording || saving) return;
		setSaving(true);
		setError(null);
		try {
			const extension = recording.type.split("/")[1]?.split(";")[0] || "webm";
			const formData = new FormData();
			formData.append("audio", recording, `debrief.${extension}`);
			if (company.trim()) formData.append("company", company.trim());
			if (role.trim()) formData.append("role", role.trim());
			if (stage.trim()) formData.append("stage", stage.trim());

			const response = await fetch("/api/debriefs", { method: "POST", body: formData });
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				setError(data.error || "Something went wrong saving your debrief. Your recording is still here, so you can try again.");
				return;
			}
			setResult(data as DebriefResult);
		} catch {
			setError("We could not reach the server. Your recording is still here, so you can try again.");
		} finally {
			setSaving(false);
		}
	};

	if (result) {
		const { debrief, bank } = result;
		return (
			<div className="px-4 py-6 max-w-2xl mx-auto">
				<h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">
					Debrief saved
				</h1>
				<p className="mt-1 text-slate-600 dark:text-slate-400" role="status">
					{bank.added > 0
						? `Added ${bank.added} ${bank.added === 1 ? "question" : "questions"} to your practice bank.`
						: "No new questions to add."}
					{bank.skipped > 0 && ` ${bank.skipped} you had already saved.`}
				</p>

				<div className="mt-6 space-y-6 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
					{debrief.oneThingToFix && (
						<section
							aria-labelledby="debrief-one-thing"
							className="rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 p-3"
						>
							<h2
								id="debrief-one-thing"
								className="text-sm font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300 mb-1"
							>
								One thing to fix
							</h2>
							<p className="text-sm text-slate-800 dark:text-slate-200">{debrief.oneThingToFix}</p>
						</section>
					)}
					<ResultList title="Questions they asked" items={debrief.questionsAsked} />
					<ResultList title="What went well" items={debrief.wentWell} />
					<ResultList title="Where you stumbled" items={debrief.stumbled} />
					<ResultList title="Follow ups" items={debrief.followUps} />
					{debrief.questionsAsked.length === 0 && (
						<p className="text-sm text-slate-600 dark:text-slate-400">
							We did not catch any specific questions. Next time, try saying each question out
							loud as they asked it.
						</p>
					)}
				</div>

				<div className="mt-6 flex flex-col sm:flex-row gap-3">
					<Link
						href={`/study/${bank.id}`}
						className="inline-flex justify-center items-center px-4 py-3 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
					>
						Open {bank.title}
					</Link>
					<button
						type="button"
						onClick={reset}
						className="inline-flex justify-center items-center px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
					>
						Record another debrief
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="px-4 py-6 max-w-2xl mx-auto">
			<h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">
				Debrief a real interview
			</h1>
			<p className="mt-1 text-slate-600 dark:text-slate-400">
				Record a minute or two while it is fresh: what they asked, and where you stumbled. We turn
				it into notes and add the questions to your practice.
			</p>

			<form
				className="mt-6 space-y-4"
				onSubmit={(e) => {
					e.preventDefault();
					void save();
				}}
			>
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
					<label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
						Company
						<input
							type="text"
							value={company}
							onChange={(e) => setCompany(e.target.value)}
							maxLength={80}
							autoComplete="organization"
							className={inputClass}
						/>
					</label>
					<label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
						Role
						<input
							type="text"
							value={role}
							onChange={(e) => setRole(e.target.value)}
							maxLength={80}
							className={inputClass}
						/>
					</label>
					<label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
						Stage
						<input
							type="text"
							value={stage}
							onChange={(e) => setStage(e.target.value)}
							maxLength={80}
							list="debrief-stage-options"
							className={inputClass}
						/>
						<datalist id="debrief-stage-options">
							{STAGE_SUGGESTIONS.map((s) => (
								<option key={s} value={s} />
							))}
						</datalist>
					</label>
				</div>
				<p className="text-xs text-slate-500 dark:text-slate-400">
					All three are optional. They are saved with each question so you know where it came from.
				</p>

				<div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
					{recording ? (
						<div className="space-y-3">
							<p className="text-sm font-medium text-slate-800 dark:text-slate-200">
								Recording ready
							</p>
							{previewUrl && <audio controls src={previewUrl} className="w-full" />}
							<button
								type="button"
								onClick={() => {
									setRecording(null);
									setRecorderKey((k) => k + 1);
								}}
								disabled={saving}
								className="text-sm text-slate-600 dark:text-slate-400 underline hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-50"
							>
								Discard and record again
							</button>
						</div>
					) : (
						<MicRecorder
							key={recorderKey}
							onRecordingComplete={(blob) => {
								setError(null);
								setRecording(blob);
							}}
							disabled={saving}
							timeLimit={300}
						/>
					)}
				</div>

				<div aria-live="polite">
					{error && (
						<p
							role="alert"
							className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-slate-800 dark:text-slate-200"
						>
							{error}
						</p>
					)}
					{saving && (
						<p className="text-sm text-slate-600 dark:text-slate-400">
							Listening back and writing up your notes. This takes about half a minute.
						</p>
					)}
				</div>

				<button
					type="submit"
					disabled={!recording || saving}
					className="w-full sm:w-auto inline-flex justify-center items-center px-5 py-3 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{saving ? "Saving..." : "Save debrief"}
				</button>
			</form>
		</div>
	);
}
