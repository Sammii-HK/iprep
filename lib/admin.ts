import { isAdmin } from './auth';

export function isAdminUser(email: string): boolean {
  return isAdmin(email);
}

export function requireAdminAccess(user: { email: string | null; role: string }): void {
  if (!user.email || !isAdmin(user.email)) {
    throw new Error('Admin access required');
  }
  // Also check role if set in database
  if (user.role !== 'ADMIN') {
    throw new Error('Admin access required');
  }
}

