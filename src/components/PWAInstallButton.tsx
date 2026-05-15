"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
}

function isSafariIOS() {
  if (!isIOS()) return false;
  return /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
}

export function PWAInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    if (isStandalone()) { setInstalled(true); return; }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setDeferredPrompt(null); };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!ready || installed) return null;

  async function handleClick() {
    if (deferredPrompt) {
      setLoading(true);
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === "accepted") { setInstalled(true); setDeferredPrompt(null); }
      } finally { setLoading(false); }
      return;
    }
    // iOS: show brief inline hint
    setHint((v) => !v);
  }

  // Hide if no install mechanism available and not iOS
  if (!deferredPrompt && !isIOS()) return null;

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={loading}
        title="Install app on your device"
        className="flex items-center gap-1.5 rounded-lg border border-blue-500/50 bg-blue-500/20 px-2.5 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-500/30 hover:border-blue-400/70 hover:text-blue-200 active:scale-95 transition-all duration-150 disabled:opacity-50 whitespace-nowrap"
      >
        {loading ? (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
            <circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="10" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 1.5v8M5.5 7.5L8 10l2.5-2.5" />
            <path d="M2.5 11.5v1A1.5 1.5 0 004 14h8a1.5 1.5 0 001.5-1.5v-1" />
          </svg>
        )}
        {loading ? "Installing…" : "Install"}
      </button>

      {hint && isSafariIOS() && (
        <div className="absolute right-0 top-full mt-2 z-50 w-56 rounded-xl bg-[#0d1f35] border border-white/15 shadow-xl px-4 py-3 text-xs text-white/70 leading-relaxed">
          Tap <span className="text-white font-semibold">Share ↑</span> then{" "}
          <span className="text-white font-semibold">Add to Home Screen</span>
          <button onClick={() => setHint(false)} className="block mt-2 text-white/40 hover:text-white/70">Dismiss</button>
        </div>
      )}
    </div>
  );
}
