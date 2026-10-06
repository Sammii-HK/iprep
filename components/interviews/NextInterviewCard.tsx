'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FolderPlaylist } from '@/components/banks/FolderPlaylist';
import { formatCountdown } from '@/lib/interviews';

interface NextInterview {
  id: string;
  company: string;
  role: string;
  round: string | null;
  startsAt: string;
  link: string | null;
}

interface PrepFolder {
  id: string;
  title: string;
  banks: Array<{ id: string; title: string; questionCount: number }>;
}

const startFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function NextInterviewCard() {
  const [data, setData] = useState<{ interview: NextInterview | null; folder: PrepFolder | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/interviews/next')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) setData(json);
      })
      .catch(() => undefined);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, []);

  if (!data) return null;

  const { interview, folder } = data;
  if (!interview) {
    return (
      <section
        aria-label="Next interview"
        className="mb-8 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 flex items-center justify-between gap-4"
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">No interview scheduled.</p>
        <Link href="/interviews" className="text-sm font-medium text-purple-600 dark:text-purple-400 hover:underline">
          Add an interview
        </Link>
      </section>
    );
  }

  const startsAt = new Date(interview.startsAt);
  const countdown = formatCountdown(startsAt.getTime() - now);

  return (
    <section
      aria-label="Next interview"
      className="mb-8 bg-white dark:bg-slate-800 rounded-xl border border-purple-200 dark:border-purple-800 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-purple-600 dark:text-purple-400">
            Next interview
          </p>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-1">{interview.company}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {interview.role}
            {interview.round ? `, ${interview.round}` : ''}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            <time dateTime={startsAt.toISOString()}>{startFormat.format(startsAt)}</time>
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100" aria-live="polite">
            {countdown}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">to go</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {interview.link && (
          <a
            href={interview.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
          >
            Join interview
          </a>
        )}
        {folder && (
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-expanded={playing}
            className="text-sm font-medium px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            {playing ? 'Hide prep audio' : 'Play prep audio'}
          </button>
        )}
        <Link
          href="/interviews"
          className="text-sm px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
        >
          All interviews
        </Link>
      </div>

      {folder ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Prep folder: {folder.title} ({folder.banks.length} {folder.banks.length === 1 ? 'bank' : 'banks'})
        </p>
      ) : (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          No prep folder linked. Name a folder &quot;{interview.company} Interview Prep&quot; or pick one on the{' '}
          <Link href="/interviews" className="underline">
            interviews page
          </Link>
          .
        </p>
      )}

      {folder && playing && folder.banks.length > 0 && (
        <div className="mt-3">
          <FolderPlaylist
            folderId={folder.id}
            banks={folder.banks.map((b) => ({ id: b.id, title: b.title }))}
            folderTitle={folder.title}
            onClose={() => setPlaying(false)}
          />
        </div>
      )}
    </section>
  );
}
