/**
 * Canonical email form. Every place that stores or looks up an email must use this, so two spellings of
 * one address can never become two identities. The database enforces the same form with a CHECK
 * constraint (email = lower(btrim(email))).
 */
export function canonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}
