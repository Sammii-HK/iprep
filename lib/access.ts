/**
 * Ownership rules, in one place.
 *
 * The bug this replaces: checks written as `row.userId && row.userId !== user.id` treat a row with no owner
 * (userId null) as "anyone may touch it". Ownership is now always an explicit equality, and the only
 * special case is stated in words:
 *
 *  - user-owned data (sessions, quizzes, attempts, folders, progress): only the owner. A row with no owner is
 *    an orphan; only an admin may read or delete it, to repair it.
 *  - shared content (a bank with userId null): any signed-in user may read it, only an admin may change it.
 *  - private banks: only the owner.
 *
 * `role` is never ADMIN for a machine principal (see lib/auth.ts), so a machine credential can never pass
 * an admin check.
 */

export interface Actor {
  id: string;
  role: string;
}

export function isAdminRole(actor: Pick<Actor, 'role'>): boolean {
  return actor.role === 'ADMIN';
}

/** The owner, explicitly. A null owner never matches. */
export function ownsRecord(record: { userId: string | null }, actor: Pick<Actor, 'id'>): boolean {
  return record.userId !== null && record.userId === actor.id;
}

/** Sessions, quizzes and similar: the owner, or an admin repairing an orphan (no owner). */
export function canAccessOwnedRecord(record: { userId: string | null }, actor: Actor): boolean {
  if (ownsRecord(record, actor)) return true;
  return record.userId === null && isAdminRole(actor);
}

/** A bank the actor may read: their own, or shared content (no owner). */
export function canReadBank(bank: { userId: string | null }, actor: Pick<Actor, 'id'>): boolean {
  return bank.userId === null || bank.userId === actor.id;
}

/** A bank the actor may change: their own, or shared content when the actor is an admin. */
export function canWriteBank(bank: { userId: string | null }, actor: Actor): boolean {
  if (ownsRecord(bank, actor)) return true;
  return bank.userId === null && isAdminRole(actor);
}
