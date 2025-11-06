import { isAdmin } from './auth';

export interface User {
  email: string | null;
  role: string;
  isPremium: boolean;
}

export function isPremiumUser(user: User): boolean {
  // Admin users always have premium access
  if (user.email && isAdmin(user.email)) {
    return true;
  }
  // Check isPremium flag for regular users
  return user.isPremium;
}

