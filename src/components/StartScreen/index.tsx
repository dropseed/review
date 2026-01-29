import { useState, useEffect, useMemo } from "react";
import type { Comparison } from "../../types";
import { useReviewStore } from "../../stores/reviewStore";
import { getPlatformServices } from "../../platform";
import { SimpleTooltip } from "../ui/tooltip";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { SavedReviewList } from "./SavedReviewList";
import { NewComparisonForm } from "./NewComparisonForm";

interface StartScreenProps {
  repoPath: string;
  onSelectReview: (comparison: Comparison) => void;
  onOpenRepo: () => void;
  onCloseRepo: () => void;
  onOpenSettings?: () => void;
}

// Main component
export function StartScreen({
  repoPath,
  onSelectReview,
  onOpenRepo,
  onCloseRepo,
  onOpenSettings,
}: StartScreenProps) {
  const { savedReviews, savedReviewsLoading, loadSavedReviews, deleteReview } =
    useReviewStore();

  // Accessibility: reactive reduced motion preference
  const prefersReducedMotion = usePrefersReducedMotion();

  // App version
  const [appVersion, setAppVersion] = useState<string>("");

  // Load app version on mount
  useEffect(() => {
    getPlatformServices()
      .window.getVersion()
      .then(setAppVersion)
      .catch(console.error);
  }, []);

  // Load saved reviews on mount
  useEffect(() => {
    loadSavedReviews();
  }, [loadSavedReviews]);

  // Extract existing comparison keys to filter duplicates
  const existingComparisonKeys = useMemo(
    () => savedReviews.map((r) => r.comparison.key),
    [savedReviews],
  );

  return (
    <div className="h-screen overflow-auto bg-stone-950 flex flex-col relative texture-noise">
      {/* Subtle gradient overlay for depth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(74, 140, 90, 0.07) 0%, transparent 60%)",
        }}
        aria-hidden="true"
      />

      {/* Main content - vertically centered */}
      <main className="relative flex-1 flex flex-col justify-center mx-auto w-full max-w-xl px-6 py-10">
        {/* App branding */}
        <header className="mb-12">
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <svg
              className="w-20 h-20 shrink-0"
              viewBox="0 0 256 256"
              fill="none"
              aria-hidden="true"
            >
              <defs>
                {/* Gradients for each half */}
                <linearGradient id="logo-red" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#a63d2f" />
                  <stop offset="100%" stopColor="#c75d4a" />
                </linearGradient>
                <linearGradient id="logo-green" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#4a7c59" />
                  <stop offset="100%" stopColor="#6b9b7a" />
                </linearGradient>
                {/* Clip to overall rounded square shape */}
                <clipPath id="logo-body">
                  <rect x="28" y="28" width="200" height="200" rx="48" />
                </clipPath>
                {/* Mask for the checkmark cutout */}
                <mask
                  id="logo-mark"
                  maskUnits="userSpaceOnUse"
                  x="0"
                  y="0"
                  width="256"
                  height="256"
                >
                  <rect width="256" height="256" fill="white" />
                  <path
                    d="M 68 138 L 108 178 L 188 82"
                    stroke="black"
                    strokeWidth="24"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </mask>
              </defs>
              {/* Left half - terracotta gradient (before/removed) */}
              <rect
                x="28"
                y="28"
                width="88"
                height="200"
                fill="url(#logo-red)"
                clipPath="url(#logo-body)"
                mask="url(#logo-mark)"
              />
              {/* Right half - sage green gradient (after/added) */}
              <rect
                x="140"
                y="28"
                width="88"
                height="200"
                fill="url(#logo-green)"
                clipPath="url(#logo-body)"
                mask="url(#logo-mark)"
              />
            </svg>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-stone-100">
                Compare
              </h1>
              <p className="text-base text-stone-400 mt-1.5">
                Trust the <span className="italic text-stone-300">trivial</span>
                . Review the{" "}
                <span className="font-medium text-stone-200">rest</span>.
              </p>
            </div>
          </div>

          {/* Repo path indicator */}
          <div className="mt-6 inline-flex items-center gap-1">
            <button
              onClick={onOpenRepo}
              className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-900/50 border border-stone-800/50 transition-all duration-150 hover:bg-stone-800/50 hover:border-stone-700/50 focus:outline-none focus:ring-2 focus:ring-sage-500/50"
            >
              <svg
                className="w-4 h-4 text-stone-500 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                />
              </svg>
              <span className="font-mono text-sm text-stone-400 group-hover:text-stone-300 transition-colors">
                {repoPath.replace(/^\/Users\/[^/]+/, "~")}
              </span>
            </button>
            <SimpleTooltip content="Close repository">
              <button
                onClick={onCloseRepo}
                className="p-1.5 rounded-lg text-stone-600 hover:text-stone-300 hover:bg-stone-800/50 transition-all focus:outline-none focus:ring-2 focus:ring-sage-500/50"
                aria-label="Close repository"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </SimpleTooltip>
          </div>
        </header>

        {/* Recent Reviews */}
        <SavedReviewList
          savedReviews={savedReviews}
          savedReviewsLoading={savedReviewsLoading}
          onSelectReview={onSelectReview}
          onDeleteReview={deleteReview}
          prefersReducedMotion={prefersReducedMotion}
        />

        {/* New Comparison - inline form */}
        <NewComparisonForm
          repoPath={repoPath}
          onSelectReview={onSelectReview}
          existingComparisonKeys={existingComparisonKeys}
        />
      </main>

      {/* Footer - subtle, anchored to bottom */}
      <footer className="relative shrink-0 px-6 py-5 flex items-center justify-between text-xs text-stone-600 border-t border-stone-900/50">
        {/* Left: PullApprove attribution + version + docs */}
        <div className="flex items-center gap-3">
          <span className="text-stone-600">A tool from</span>
          <a
            href="https://www.pullapprove.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-stone-500 hover:text-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500/50 rounded px-1 -mx-1 transition-colors"
          >
            <svg
              className="h-3 w-auto opacity-70"
              viewBox="0 0 350 239"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M283.772 102.429C264.913 121.174 241.341 144.605 213.278 172.5L167.255 218.247C152.213 232.082 133.579 239 111.578 239C89.5767 239 70.9429 232.082 55.9012 218.247L37.2675 199.725L0 236.768V126.083H111.353L74.3105 163.127L92.9442 181.649C97.8833 186.335 104.169 188.567 111.578 188.567C118.987 188.567 125.048 186.335 130.212 181.649L246.729 65.831C244.484 56.9048 244.259 48.2017 246.504 39.2754C248.525 30.3492 253.239 22.5387 260.199 15.6209C270.975 5.13259 283.323 0 297.242 0C311.161 0 323.509 5.13259 334.285 15.6209C344.612 26.3324 350 38.606 350 52.4416C350 66.2773 344.836 78.5509 334.285 89.2624C327.325 96.1802 319.468 100.643 310.488 102.875C301.507 104.883 292.752 104.883 283.772 102.429ZM319.468 30.1261C313.182 24.1008 305.548 21.1998 297.242 21.1998C288.711 21.1998 281.302 24.324 275.241 30.3492C268.954 36.5976 266.036 43.7386 266.036 52.2185C266.036 60.6984 269.179 68.0626 275.241 74.0878C281.527 80.3361 288.711 83.2372 297.242 83.2372C305.773 83.2372 313.182 80.113 319.243 74.0878C325.529 67.8394 328.448 60.6984 328.448 52.2185C328.448 43.9617 325.305 36.5976 319.468 30.1261Z" />
            </svg>
            <span>PullApprove</span>
          </a>
          <span className="text-stone-800">&middot;</span>
          {appVersion && (
            <span className="font-mono text-stone-600 tabular-nums">
              v{appVersion}
            </span>
          )}
          <span className="text-stone-800">&middot;</span>
          <a
            href="https://github.com/dropseed/compare#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="text-stone-500 hover:text-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500/50 rounded transition-colors"
          >
            Docs
          </a>
        </div>

        {/* Right: settings + keyboard shortcut */}
        <div className="flex items-center gap-4 text-stone-500">
          {onOpenSettings && (
            <SimpleTooltip content="Settings">
              <button
                onClick={onOpenSettings}
                className="flex items-center gap-1.5 text-stone-500 hover:text-stone-300 transition-colors focus:outline-none focus:ring-2 focus:ring-sage-500/50 rounded px-1 -mx-1"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>Settings</span>
              </button>
            </SimpleTooltip>
          )}
          <div className="flex items-center gap-2">
            <kbd className="inline-flex items-center gap-0.5 rounded-md border border-stone-800/80 bg-stone-900/80 px-1.5 py-1 font-mono text-[10px] text-stone-400 shadow-sm">
              <span>{"\u2318"}</span>
              <span>O</span>
            </kbd>
            <span className="text-stone-600">open new repo</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
