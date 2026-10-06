/**
 * Pure interview logic: validation schemas, ordering, next-interview
 * selection, folder matching and the Notion sync plan. No database access
 * here so everything is unit-testable.
 */
import { z } from 'zod';

/** An interview counts as "current" for this long after it starts (or until endsAt). */
export const IN_PROGRESS_GRACE_MS = 60 * 60 * 1000;
/** Sync never cancels interviews that started more than this long ago. */
export const SYNC_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

export const INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export const SYNC_SOURCES = ['notion'] as const;

const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid ID format');

/** http(s) only: these values are rendered as hrefs, so javascript: etc. must never get in. */
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .url('Must be a valid URL')
  .refine((v) => /^https?:\/\//i.test(v), 'Must start with http:// or https://');

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalUrl = httpUrl.nullable().optional();

const isoDate = z
  .string()
  .datetime({ offset: true, message: 'Must be an ISO 8601 date-time' })
  .transform((v) => new Date(v));

const fields = {
  company: z.string().trim().min(1, 'Company is required').max(200),
  role: z.string().trim().min(1, 'Role is required').max(200),
  round: optionalText(100),
  startsAt: isoDate,
  endsAt: isoDate.nullable().optional(),
  link: optionalUrl,
  bookingLink: optionalUrl,
  interviewer: optionalText(200),
  notes: optionalText(5000),
  folderId: idSchema.nullable().optional(),
};

function endsAfterStart(v: { startsAt?: Date; endsAt?: Date | null }): boolean {
  return !v.startsAt || !v.endsAt || v.endsAt.getTime() > v.startsAt.getTime();
}
const endsAfterStartMessage = { message: 'endsAt must be after startsAt', path: ['endsAt'] };

export const CreateInterviewSchema = z
  .object({ ...fields, status: z.enum(INTERVIEW_STATUSES).optional() })
  .refine(endsAfterStart, endsAfterStartMessage);

export const UpdateInterviewSchema = z
  .object({
    company: fields.company.optional(),
    role: fields.role.optional(),
    round: fields.round,
    startsAt: isoDate.optional(),
    endsAt: fields.endsAt,
    link: fields.link,
    bookingLink: fields.bookingLink,
    interviewer: fields.interviewer,
    notes: fields.notes,
    folderId: fields.folderId,
    status: z.enum(INTERVIEW_STATUSES).optional(),
  })
  .refine(endsAfterStart, endsAfterStartMessage);

export const SyncItemSchema = z.object({
  externalId: z.string().trim().min(1).max(200),
  ...fields,
  status: z.enum(INTERVIEW_STATUSES).optional(),
});

export const SyncPayloadSchema = z.object({
  source: z.enum(SYNC_SOURCES).default('notion'),
  /** When true the payload is the full set for this source: missing future interviews are cancelled. */
  complete: z.boolean().default(false),
  interviews: z.array(SyncItemSchema).max(200),
});

export type SyncItem = z.infer<typeof SyncItemSchema>;

export interface InterviewLike {
  id: string;
  startsAt: Date;
  endsAt: Date | null;
  status: string;
}

function endOfWindow(i: InterviewLike): number {
  return i.endsAt ? i.endsAt.getTime() : i.startsAt.getTime() + IN_PROGRESS_GRACE_MS;
}

/** True when the interview has not finished yet (upcoming or in progress). */
export function isUpcoming(i: InterviewLike, now: Date): boolean {
  return endOfWindow(i) >= now.getTime();
}

/** The single next interview a client should prioritise, or null. */
export function pickNextInterview<T extends InterviewLike>(list: T[], now: Date): T | null {
  const candidates = list
    .filter((i) => i.status === 'scheduled' && isUpcoming(i, now))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return candidates[0] ?? null;
}

/** Upcoming first (soonest first), then past (most recent first). */
export function sortInterviews<T extends InterviewLike>(list: T[], now: Date): T[] {
  const upcoming = list
    .filter((i) => isUpcoming(i, now))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const past = list
    .filter((i) => !isUpcoming(i, now))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  return [...upcoming, ...past];
}

export interface FolderLike {
  id: string;
  title: string;
}

/**
 * Finds the folder of prep banks for a company: its title must contain the
 * company name followed (later) by "Interview Prep", case-insensitive.
 * Mirrors the matching in scripts/sync-notion-interviews.py.
 */
export function matchFolderForCompany<T extends FolderLike>(company: string, folders: T[]): T | null {
  const name = company.trim().toLowerCase();
  if (!name) return null;
  for (const folder of folders) {
    const title = folder.title.toLowerCase();
    const at = title.indexOf(name);
    if (at !== -1 && title.indexOf('interview prep', at + name.length) !== -1) return folder;
  }
  return null;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Starting now';
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${Math.max(mins, 1)}m`;
}

export interface ExistingSynced {
  id: string;
  externalId: string | null;
  status: string;
  startsAt: Date;
}

export type SyncData = Omit<SyncItem, 'externalId'>;

export interface SyncPlan {
  create: SyncItem[];
  update: Array<{ id: string; data: SyncData }>;
  cancel: string[];
}

/**
 * Works out what a sync payload should do against the interviews already
 * stored for that user and source.
 *  - New externalIds are created, known ones updated.
 *  - A previously cancelled interview that reappears is rescheduled.
 *  - Only when `complete` is true, scheduled interviews that are missing from
 *    the payload are cancelled, and only if they start within the sync window
 *    (the script deliberately omits old rows, so old rows must not be touched).
 *  - Duplicate externalIds in one payload: the last one wins.
 */
export function planSync(
  existing: ExistingSynced[],
  items: SyncItem[],
  complete: boolean,
  now: Date,
): SyncPlan {
  const byExternal = new Map(existing.filter((e) => e.externalId).map((e) => [e.externalId as string, e]));
  const deduped = new Map<string, SyncItem>();
  for (const item of items) deduped.set(item.externalId, item);

  const plan: SyncPlan = { create: [], update: [], cancel: [] };
  for (const item of deduped.values()) {
    const found = byExternal.get(item.externalId);
    if (!found) {
      plan.create.push(item);
      continue;
    }
    const { externalId: _externalId, ...data } = item;
    void _externalId;
    // A sync that could not match a folder must not wipe one chosen by hand.
    if (data.folderId == null) delete data.folderId;
    const status = item.status ?? (found.status === 'cancelled' ? 'scheduled' : undefined);
    plan.update.push({ id: found.id, data: { ...data, ...(status ? { status } : {}) } });
  }

  if (complete) {
    const cutoff = now.getTime() - SYNC_CANCEL_WINDOW_MS;
    for (const e of existing) {
      if (!e.externalId || deduped.has(e.externalId)) continue;
      if (e.status === 'scheduled' && e.startsAt.getTime() >= cutoff) plan.cancel.push(e.id);
    }
  }
  return plan;
}
