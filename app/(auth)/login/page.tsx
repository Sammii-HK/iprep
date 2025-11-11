import Link from 'next/link';
import { LoginForm } from '@/components/LoginForm';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Or{' '}
            <Link href="/register" className="font-medium text-purple-600 dark:text-purple-400 hover:text-purple-500">
              create a new account
            </Link>
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}

