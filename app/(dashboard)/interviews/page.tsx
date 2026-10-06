"use client";

import { useCallback, useEffect, useState } from "react";

interface Interview {
  id: string;
  company: string;
  role: string;
  round: string | null;
  startsAt: string;
  endsAt: string | null;
  link: string | null;
  bookingLink: string | null;
  interviewer: string | null;
  status: string;
  source: string;
  notes: string | null;
  folderId: string | null;
}

interface FolderOption {
  id: string;
  title: string;
}

interface FormState {
  company: string;
  role: string;
  round: string;
  startsAt: string;
  link: string;
  interviewer: string;
  folderId: string;
}

const EMPTY_FORM: FormState = {
  company: "",
  role: "",
  round: "",
  startsAt: "",
  link: "",
  interviewer: "",
  folderId: "",
};

const inputClass =
  "w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500";

/** Value for a datetime-local input in the viewer's own time zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function InterviewsPage() {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [includePast, setIncludePast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/interviews?includePast=${includePast}`);
    if (res.ok) setInterviews((await res.json()).interviews ?? []);
    setLoading(false);
  }, [includePast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/folders")
      .then((res) => (res.ok ? res.json() : []))
      .then((list: FolderOption[]) => setFolders(list.map((f) => ({ id: f.id, title: f.title }))))
      .catch(() => undefined);
  }, []);

  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const startEdit = (i: Interview) => {
    setEditingId(i.id);
    setForm({
      company: i.company,
      role: i.role,
      round: i.round ?? "",
      startsAt: toLocalInput(i.startsAt),
      link: i.link ?? "",
      interviewer: i.interviewer ?? "",
      folderId: i.folderId ?? "",
    });
    setError(null);
  };

  const reset = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      company: form.company,
      role: form.role,
      round: form.round || null,
      startsAt: new Date(form.startsAt).toISOString(),
      link: form.link || null,
      interviewer: form.interviewer || null,
      folderId: form.folderId || null,
    };
    try {
      const res = await fetch(editingId ? `/api/interviews/${editingId}` : "/api/interviews", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || "Could not save the interview");
        return;
      }
      reset();
      await load();
    } catch {
      setError("Could not save the interview");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, status: string) => {
    await fetch(`/api/interviews/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this interview?")) return;
    await fetch(`/api/interviews/${id}`, { method: "DELETE" });
    load();
  };

  const folderTitle = (id: string | null) => folders.find((f) => f.id === id)?.title;

  return (
    <div className="px-4 py-6 max-w-3xl">
      <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Interviews</h1>
      <p className="text-slate-600 dark:text-slate-400 mt-1 mb-6">
        Add your interviews and iPrep will show the next one on your dashboard with its prep folder.
      </p>

      <form
        onSubmit={submit}
        className="mb-8 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 grid gap-4 sm:grid-cols-2"
      >
        <h2 className="sm:col-span-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
          {editingId ? "Edit interview" : "Add an interview"}
        </h2>
        <label className="text-sm text-slate-700 dark:text-slate-300">
          Company
          <input required maxLength={200} value={form.company} onChange={update("company")} className={`${inputClass} mt-1`} />
        </label>
        <label className="text-sm text-slate-700 dark:text-slate-300">
          Role
          <input required maxLength={200} value={form.role} onChange={update("role")} className={`${inputClass} mt-1`} />
        </label>
        <label className="text-sm text-slate-700 dark:text-slate-300">
          Round
          <input maxLength={100} value={form.round} onChange={update("round")} placeholder="Recruiter screen" className={`${inputClass} mt-1`} />
        </label>
        <label className="text-sm text-slate-700 dark:text-slate-300">
          Date and time
          <input required type="datetime-local" value={form.startsAt} onChange={update("startsAt")} className={`${inputClass} mt-1`} />
        </label>
        <label className="text-sm text-slate-700 dark:text-slate-300">
          Joining link
          <input type="url" value={form.link} onChange={update("link")} placeholder="https://" className={`${inputClass} mt-1`} />
        </label>
        <label className="text-sm text-slate-700 dark:text-slate-300">
          Interviewer
          <input maxLength={200} value={form.interviewer} onChange={update("interviewer")} className={`${inputClass} mt-1`} />
        </label>
        <label className="text-sm text-slate-700 dark:text-slate-300 sm:col-span-2">
          Prep folder
          <select value={form.folderId} onChange={update("folderId")} className={`${inputClass} mt-1`}>
            <option value="">Match automatically by company name</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="sm:col-span-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="sm:col-span-2 flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
          >
            {saving ? "Saving..." : editingId ? "Save changes" : "Add interview"}
          </button>
          {editingId && (
            <button type="button" onClick={reset} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {includePast ? "All interviews" : "Upcoming"}
        </h2>
        <label className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-2">
          <input type="checkbox" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} />
          Show past and cancelled
        </label>
      </div>

      {loading ? (
        <p className="text-slate-600 dark:text-slate-400">Loading...</p>
      ) : interviews.length === 0 ? (
        <p className="text-slate-600 dark:text-slate-400">No interviews yet.</p>
      ) : (
        <ul className="space-y-3">
          {interviews.map((i) => (
            <li
              key={i.id}
              className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {i.company}
                    <span className="font-normal text-slate-600 dark:text-slate-400">
                      {`, ${i.role}`}
                      {i.round ? `, ${i.round}` : ""}
                    </span>
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    <time dateTime={i.startsAt}>{dateFormat.format(new Date(i.startsAt))}</time>
                    {i.interviewer ? ` with ${i.interviewer}` : ""}
                  </p>
                  {folderTitle(i.folderId) && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">Prep: {folderTitle(i.folderId)}</p>
                  )}
                </div>
                <span className="text-xs self-start px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  {i.status}
                  {i.source !== "manual" ? ` (${i.source})` : ""}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                {i.link && (
                  <a href={i.link} target="_blank" rel="noopener noreferrer" className="text-purple-600 dark:text-purple-400 hover:underline">
                    Join
                  </a>
                )}
                <button type="button" onClick={() => startEdit(i)} className="text-slate-600 dark:text-slate-400 hover:underline">
                  Edit
                </button>
                {i.status === "scheduled" && (
                  <button type="button" onClick={() => setStatus(i.id, "completed")} className="text-slate-600 dark:text-slate-400 hover:underline">
                    Mark done
                  </button>
                )}
                {i.status !== "scheduled" && (
                  <button type="button" onClick={() => setStatus(i.id, "scheduled")} className="text-slate-600 dark:text-slate-400 hover:underline">
                    Reschedule
                  </button>
                )}
                <button type="button" onClick={() => remove(i.id)} className="text-red-600 dark:text-red-400 hover:underline">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
