"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { AuthGuard } from "@/components/AuthGuard";
import { SmartNotifications } from "@/components/SmartNotifications";

export default function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { user, logout } = useAuth();
	const router = useRouter();
	const pathname = usePathname();
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const isAdmin =
		user?.role === "ADMIN" ||
		user?.email?.toLowerCase() === "kellow.sammii@gmail.com";

	const handleLogout = async () => {
		await logout();
		router.push("/login");
		setMobileMenuOpen(false);
	};

	const navLinks = [
		{ href: "/banks", label: "Banks" },
		{ href: "/practice", label: "Practice" },
		{ href: "/analytics", label: "Analytics" },
		...(user?.isPremium ? [{ href: "/learning", label: "Learning" }] : []),
		{ href: "/quizzes", label: "Quizzes" },
		...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
		{ href: "/settings", label: "Settings" },
	];

	const isActive = (href: string) => pathname === href;

	return (
		<AuthGuard>
			<SmartNotifications />
			<div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors">
				<nav className="bg-white dark:bg-slate-800 shadow-sm border-b border-slate-200 dark:border-slate-700">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
						<div className="flex justify-between h-16">
							<div className="flex">
								<Link href="/" className="flex items-center px-2">
									<span className="text-xl font-bold text-slate-900 dark:text-slate-100">
										iPrep
									</span>
								</Link>
								{/* Desktop Navigation */}
								<div className="hidden sm:ml-6 sm:flex sm:space-x-8">
									{navLinks.map((link) => (
										<Link
											key={link.href}
											href={link.href}
											className={`${
												isActive(link.href)
													? "border-purple-500 text-slate-900 dark:text-slate-100"
													: "border-transparent text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-900 dark:hover:text-slate-100"
											} inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors`}
										>
											{link.label}
										</Link>
									))}
								</div>
							</div>
							{/* Desktop User Menu */}
							<div className="hidden sm:flex items-center space-x-4">
								{user && (
									<div className="flex items-center space-x-2">
										<span className="text-sm text-slate-600 dark:text-slate-400">
											{user.name || user.email}
										</span>
										{user.isPremium && (
											<span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
												Premium
											</span>
										)}
										<button
											onClick={handleLogout}
											className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
										>
											Logout
										</button>
									</div>
								)}
							</div>
							{/* Mobile menu button */}
							<div className="sm:hidden flex items-center">
								<button
									onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
									className="inline-flex items-center justify-center p-2 rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-purple-500"
									aria-expanded="false"
									aria-label="Toggle menu"
								>
									{mobileMenuOpen ? (
										<svg
											className="h-6 w-6"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M6 18L18 6M6 6l12 12"
											/>
										</svg>
									) : (
										<svg
											className="h-6 w-6"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M4 6h16M4 12h16M4 18h16"
											/>
										</svg>
									)}
								</button>
							</div>
						</div>
					</div>

					{/* Mobile menu */}
					{mobileMenuOpen && (
						<div className="sm:hidden border-t border-slate-200 dark:border-slate-700">
							<div className="px-2 pt-2 pb-3 space-y-1">
								{navLinks.map((link) => (
									<Link
										key={link.href}
										href={link.href}
										onClick={() => setMobileMenuOpen(false)}
										className={`${
											isActive(link.href)
												? "bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100"
												: "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100"
										} block px-3 py-2 rounded-md text-base font-medium transition-colors`}
									>
										{link.label}
									</Link>
								))}
							</div>
							{/* Mobile User Info */}
							{user && (
								<div className="pt-4 pb-3 border-t border-slate-200 dark:border-slate-700 px-2">
									<div className="flex items-center px-3 py-2">
										<div className="flex-1">
											<div className="text-base font-medium text-slate-900 dark:text-slate-100">
												{user.name || user.email}
											</div>
											{user.isPremium && (
												<div className="mt-1">
													<span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
														Premium
													</span>
												</div>
											)}
										</div>
									</div>
									<button
										onClick={handleLogout}
										className="mt-2 block w-full text-left px-3 py-2 rounded-md text-base font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
									>
										Logout
									</button>
								</div>
							)}
						</div>
					)}
				</nav>
				<main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
					{children}
				</main>
			</div>
		</AuthGuard>
	);
}
