import { describe, expect, it, vi } from 'vitest';
import { ensureLearner, resolveLearnerActor } from '@/lib/learner';

function fakeDb() {
  const upsert = vi.fn(async (args: { where: { userId: string } }) => ({ id: `learner-for-${args.where.userId}` }));
  return { db: { learner: { upsert } } as never, upsert };
}

describe('User -> Learner mapping', () => {
  it('gives each user exactly one learner, keyed by the user, created on first use and reused after', async () => {
    const { db, upsert } = fakeDb();
    const a = await ensureLearner('user-1', db);
    const b = await ensureLearner('user-1', db);
    expect(a).toEqual(b);
    expect(upsert).toHaveBeenCalledWith({ where: { userId: 'user-1' }, update: {}, create: { userId: 'user-1' }, select: { id: true } });
  });

  it('a human acts as their own learner with no actor', async () => {
    const { db } = fakeDb();
    expect(await resolveLearnerActor({ user: { id: 'user-1' } }, db)).toEqual({
      learnerId: 'learner-for-user-1',
      actorPrincipalId: null,
    });
  });
});

describe('machine principals', () => {
  it('act on behalf of the learner they are bound to and are recorded as the actor, never as the learner', async () => {
    const { db, upsert } = fakeDb();
    const actor = await resolveLearnerActor(
      { user: { id: 'user-1' }, principal: { id: 'principal-9', learnerId: 'learner-bound' } },
      db
    );
    expect(actor).toEqual({ learnerId: 'learner-bound', actorPrincipalId: 'principal-9' });
    expect(actor.learnerId).not.toBe(actor.actorPrincipalId);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('a principal created before it was bound resolves its user\'s learner (and is still the actor, not the learner)', async () => {
    const { db } = fakeDb();
    const actor = await resolveLearnerActor({ user: { id: 'user-1' }, principal: { id: 'principal-9', learnerId: null } }, db);
    expect(actor).toEqual({ learnerId: 'learner-for-user-1', actorPrincipalId: 'principal-9' });
  });
});
