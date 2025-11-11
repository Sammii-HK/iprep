"use client";

import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PWAInstaller() {
	const [deferredPrompt, setDeferredPrompt] =
		useState<BeforeInstallPromptEvent | null>(null);
	const [isInstalled, setIsInstalled] = useState(() => {
		if (typeof window === "undefined") return false;
		return window.matchMedia("(display-mode: standalone)").matches;
	});
	const [showInstallButton, setShowInstallButton] = useState(false);

	useEffect(() => {
		// Listen for beforeinstallprompt event
		const handleBeforeInstallPrompt = (e: Event) => {
			e.preventDefault();
			setDeferredPrompt(e as BeforeInstallPromptEvent);
			setShowInstallButton(true);
		};

		window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

		// Check if app was just installed
		window.addEventListener("appinstalled", () => {
			setIsInstalled(true);
			setShowInstallButton(false);
			setDeferredPrompt(null);
		});

		return () => {
			window.removeEventListener(
				"beforeinstallprompt",
				handleBeforeInstallPrompt
			);
		};
	}, []);

	const handleInstallClick = async () => {
		if (!deferredPrompt) return;

		deferredPrompt.prompt();
		const { outcome } = await deferredPrompt.userChoice;

		if (outcome === "accepted") {
			setIsInstalled(true);
			setShowInstallButton(false);
		}

		setDeferredPrompt(null);
	};

	if (isInstalled || !showInstallButton) {
		return null;
	}

	return (
		<div className="fixed bottom-4 right-4 bg-blue-600 dark:bg-blue-500 text-white px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3">
			<div>
				<p className="text-sm font-semibold">Install Interview Coach</p>
				<p className="text-xs opacity-90">
					Get practice reminders and faster access
				</p>
			</div>
			<button
				onClick={handleInstallClick}
				className="px-4 py-2 bg-white text-blue-600 rounded-lg font-semibold hover:bg-blue-50 transition-colors text-sm"
			>
				Install
			</button>
			<button
				onClick={() => setShowInstallButton(false)}
				className="text-white hover:text-blue-200 transition-colors"
				aria-label="Dismiss"
			>
				×
			</button>
		</div>
	);
}
