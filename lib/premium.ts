import { isAdminRole } from './access';

export interface User {
  email: string | null;
  role: string;
  isPremium: boolean;
}

export function isPremiumUser(user: User): boolean {
  // Admin users always have premium access (the stored role, never an email match)
  if (isAdminRole(user)) {
    return true;
  }
  // Check isPremium flag for regular users
  return user.isPremium;
}

