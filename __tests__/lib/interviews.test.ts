import { describe, it, expect } from 'vitest';
import {
  CreateInterviewSchema,
  SyncPayloadSchema,
  UpdateInterviewSchema,
  formatCountdown,
  matchFolderForCompany,
  pickNextInterview,
  planSync,
  sortInterviews,
  type SyncItem,
} from '@/lib/interviews';

const now = new Date('2026-10-06T12:00:00Z');
const at = (iso: string) => new Date(iso);
const iv = (id: string, startsAt: string, status = 'scheduled', endsAt: string | null = null) => ({
  id,
  startsAt: at(startsAt),
  endsAt: endsAt ? at(endsAt) : null,
  status,
});

describe('pickNextInterview', () => {
  it('returns the soonest scheduled interview that has not finished', () => {
    const list = [iv('later', '2026-10-09T10:00:00Z'), iv('soon', '2026-10-07T10:00:00Z'), iv('past', '2026-10-01T10:00:00Z')];
    expect(pickNextInterview(list, now)?.id).toBe('soon');
  });

  it('ignores cancelled and completed interviews', () => {
    const list = [iv('c', '2026-10-07T10:00:00Z', 'cancelled'), iv('d', '2026-10-07T11:00:00Z', 'completed'), iv('ok', '2026-10-08T10:00:00Z')];
    expect(pickNextInterview(list, now)?.id).toBe('ok');
  });

  it('keeps an interview that started less than an hour ago', () => {
    expect(pickNextInterview([iv('live', '2026-10-06T11:30:00Z')], now)?.id).toBe('live');
  });

  it('drops one that started over an hour ago with no end time', () => {
    expect(pickNextInterview([iv('over', '2026-10-06T10:30:00Z')], now)).toBeNull();
  });

  it('uses endsAt when present', () => {
    expect(pickNextInterview([iv('long', '2026-10-06T10:00:00Z', 'scheduled', '2026-10-06T13:00:00Z')], now)?.id).toBe('long');
  });

  it('returns null for an empty list', () => {
    expect(pickNextInterview([], now)).toBeNull();
  });
});

describe('sortInterviews', () => {
  it('puts upcoming first (soonest first) then past (latest first)', () => {
    const list = [iv('p1', '2026-09-01T10:00:00Z'), iv('u2', '2026-10-10T10:00:00Z'), iv('p2', '2026-09-20T10:00:00Z'), iv('u1', '2026-10-07T10:00:00Z')];
    expect(sortInterviews(list, now).map((i) => i.id)).toEqual(['u1', 'u2', 'p2', 'p1']);
  });
});

describe('matchFolderForCompany', () => {
  const folders = [
    { id: '1', title: 'Interview Prep Attio' },
    { id: '2', title: 'attio Interview Prep' },
    { id: '3', title: 'Acme Interview Prep' },
  ];
  it('needs the company name before "Interview Prep", case-insensitively', () => {
    expect(matchFolderForCompany('Attio', folders)?.id).toBe('2');
  });
  it('returns null with no match or an empty company', () => {
    expect(matchFolderForCompany('Zed', folders)).toBeNull();
    expect(matchFolderForCompany('  ', folders)).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('formats days, hours and minutes', () => {
    expect(formatCountdown(2 * 86400000 + 3 * 3600000)).toBe('2d 3h');
    expect(formatCountdown(3 * 3600000 + 5 * 60000)).toBe('3h 5m');
    expect(formatCountdown(20 * 60000)).toBe('20m');
    expect(formatCountdown(5000)).toBe('1m');
    expect(formatCountdown(0)).toBe('Starting now');
  });
});

describe('planSync', () => {
  const item = (externalId: string, extra: Partial<SyncItem> = {}): SyncItem => ({
    externalId,
    company: 'Attio',
    role: 'Engineer',
    startsAt: at('2026-10-10T10:00:00Z'),
    ...extra,
  });
  const existing = (id: string, externalId: string | null, status = 'scheduled', startsAt = '2026-10-10T10:00:00Z') => ({
    id,
    externalId,
    status,
    startsAt: at(startsAt),
  });

  it('creates unknown ids and updates known ones', () => {
    const plan = planSync([existing('a', 'n1')], [item('n1'), item('n2')], false, now);
    expect(plan.create.map((c) => c.externalId)).toEqual(['n2']);
    expect(plan.update.map((u) => u.id)).toEqual(['a']);
    expect(plan.cancel).toEqual([]);
  });

  it('cancels missing scheduled interviews only when complete is true', () => {
    const rows = [existing('a', 'n1'), existing('b', 'n2')];
    expect(planSync(rows, [item('n1')], false, now).cancel).toEqual([]);
    expect(planSync(rows, [item('n1')], true, now).cancel).toEqual(['b']);
  });

  it('never cancels completed, already cancelled, manual or long-past rows', () => {
    const rows = [
      existing('done', 'n2', 'completed'),
      existing('gone', 'n3', 'cancelled'),
      existing('manual', null),
      existing('old', 'n4', 'scheduled', '2026-09-01T10:00:00Z'),
    ];
    expect(planSync(rows, [], true, now).cancel).toEqual([]);
  });

  it('reschedules a cancelled interview that reappears', () => {
    const plan = planSync([existing('a', 'n1', 'cancelled')], [item('n1')], false, now);
    expect(plan.update[0].data.status).toBe('scheduled');
  });

  it('leaves status alone for a normal update', () => {
    const plan = planSync([existing('a', 'n1', 'completed')], [item('n1')], false, now);
    expect(plan.update[0].data.status).toBeUndefined();
  });

  it('does not wipe a hand-picked folder when the sync has none', () => {
    const plan = planSync([existing('a', 'n1')], [item('n1', { folderId: null })], false, now);
    expect('folderId' in plan.update[0].data).toBe(false);
    const withFolder = planSync([existing('a', 'n1')], [item('n1', { folderId: 'f1' })], false, now);
    expect(withFolder.update[0].data.folderId).toBe('f1');
  });

  it('keeps the last of duplicate ids in one payload', () => {
    const plan = planSync([], [item('n1', { role: 'First' }), item('n1', { role: 'Second' })], false, now);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0].role).toBe('Second');
  });
});

describe('schemas', () => {
  const valid = { company: 'Attio', role: 'Engineer', startsAt: '2026-10-10T10:00:00+01:00' };

  it('accepts a minimal interview and parses the date', () => {
    const parsed = CreateInterviewSchema.parse(valid);
    expect(parsed.startsAt).toBeInstanceOf(Date);
  });

  it('rejects missing company, bad dates and non-http links', () => {
    expect(CreateInterviewSchema.safeParse({ ...valid, company: '' }).success).toBe(false);
    expect(CreateInterviewSchema.safeParse({ ...valid, startsAt: 'tomorrow' }).success).toBe(false);
    expect(CreateInterviewSchema.safeParse({ ...valid, link: 'javascript:alert(1)' }).success).toBe(false);
    expect(CreateInterviewSchema.safeParse({ ...valid, link: 'https://meet.example.com/x' }).success).toBe(true);
  });

  it('rejects an end before the start', () => {
    expect(CreateInterviewSchema.safeParse({ ...valid, endsAt: '2026-10-10T09:00:00+01:00' }).success).toBe(false);
  });

  it('rejects unknown statuses and bad folder ids', () => {
    expect(CreateInterviewSchema.safeParse({ ...valid, status: 'maybe' }).success).toBe(false);
    expect(UpdateInterviewSchema.safeParse({ folderId: '../etc' }).success).toBe(false);
  });

  it('allows partial updates', () => {
    expect(UpdateInterviewSchema.safeParse({ status: 'completed' }).success).toBe(true);
  });

  it('sync payload defaults to notion and incomplete, and requires externalId', () => {
    const parsed = SyncPayloadSchema.parse({ interviews: [{ ...valid, externalId: 'n1' }] });
    expect(parsed.source).toBe('notion');
    expect(parsed.complete).toBe(false);
    expect(SyncPayloadSchema.safeParse({ interviews: [valid] }).success).toBe(false);
    expect(SyncPayloadSchema.safeParse({ source: 'manual', interviews: [] }).success).toBe(false);
  });
});
