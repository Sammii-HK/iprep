'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  isPremium: boolean;
  createdAt: string;
  _count: {
    sessions: number;
    banks: number;
    quizzes: number;
  };
}

interface Stats {
  metrics: {
    totalUsers: number;
    activeUsers: number;
    premiumUsers: number;
    totalSessions: number;
    totalBanks: number;
    totalQuestions: number;
  };
  subscriptionStats: {
    premiumUsers: number;
    freeUsers: number;
    premiumPercentage: number;
  };
  recentUsers: Array<{
    id: string;
    email: string | null;
    name: string | null;
    createdAt: string;
  }>;
}

export default function AdminPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const isAdmin = user?.role === 'ADMIN' || user?.email?.toLowerCase() === 'kellow.sammii@gmail.com';
    if (!isAdmin) {
      router.push('/');
      return;
    }

    async function fetchData() {
      try {
        const [statsRes, usersRes] = await Promise.all([
          fetch('/api/admin/stats'),
          fetch('/api/admin/users'),
        ]);

        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        }

        if (usersRes.ok) {
          const usersData = await usersRes.json();
          setUsers(usersData.users);
        }
      } catch (error) {
        console.error('Error fetching admin data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [user, router]);

  if (loading) {
    return <div className="text-gray-600">Loading admin dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Admin Dashboard</h1>
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
            <div className="text-sm text-gray-600 dark:text-gray-400">Total Users</div>
            <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {stats.metrics.totalUsers}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
            <div className="text-sm text-gray-600 dark:text-gray-400">Active Users (30d)</div>
            <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {stats.metrics.activeUsers}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
            <div className="text-sm text-gray-600 dark:text-gray-400">Premium Users</div>
            <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {stats.metrics.premiumUsers}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {stats.subscriptionStats.premiumPercentage.toFixed(1)}% of total
            </div>
          </div>
        </div>
      )}

      {stats && (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Platform Statistics
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Sessions</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {stats.metrics.totalSessions}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Question Banks</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {stats.metrics.totalBanks}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Questions</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {stats.metrics.totalQuestions}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Recent Users
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Premium
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Sessions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Banks
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {users.slice(0, 20).map((u) => (
                <tr key={u.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {u.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {u.name || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {u.role}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {u.isPremium ? 'Yes' : 'No'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {u._count.sessions}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {u._count.banks}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

