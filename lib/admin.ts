import { isAdminRole } from './access';

/** Admin is the stored role only. It is never inferred from an email address. */
export function isAdminUser(user: { role: string }): boolean {
  return isAdminRole(user);
}

export function requireAdminAccess(user: { role: string }): void {
  if (!isAdminRole(user)) {
    throw new Error('Admin access required');
  }
}
