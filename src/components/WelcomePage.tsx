import { useEffect, useState, useCallback, memo } from "react";
import { useReviewStore } from "../stores";
import { getPlatformServices } from "../platform";
import { getApiClient } from "../api";
import type { GitStatusSummary } from "../types";
import type { RecentRepo } from "../utils/preferences";

interface WelcomePageProps {
  onOpenRepo: () => void;
  onSelectRepo: (path: string) => void;
}

// Recent repo card component
interface RecentRepoCardProps {
  repo: RecentRepo;
  onOpen: () => void;
  onRemove: () => void;
}

const RecentRepoCard = memo(function RecentRepoCard({
  repo,
  onOpen,
  onRemove,
}: RecentRepoCardProps) {
  const [isRemoving, setIsRemoving] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatusSummary | null>(null);

  useEffect(() => {
    getApiClient()
      .getGitStatus(repo.path)
      .then(setGitStatus)
      .catch(() => {
        // Repo may no longer exist — silently ignore
      });
  }, [repo.path]);

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsRemoving(true);
      // Small delay for visual feedback
      setTimeout(() => {
        onRemove();
      }, 150);
    },
    [onRemove],
  );

  return (
    <button
      onClick={onOpen}
      className={`group relative w-full focus:outline-none
                  ${isRemoving ? "opacity-50 scale-95" : ""}`}
    >
      <div
        className="w-full px-3 py-2.5 rounded-lg text-left
                    border border-stone-800/60 bg-stone-900/40
                    transition-all duration-150
                    group-hover:bg-stone-800/60 group-hover:border-stone-700/60
                    group-focus-visible:ring-2 group-focus-visible:ring-sage-500/50"
      >
        {/* Line 1: repo name + branch/status */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-stone-200 truncate">
            {repo.name}
          </span>
          <div className="flex-1 min-w-0" />
          {gitStatus && (
            <span className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-stone-500 shrink-0">
              <span className="text-stone-400 truncate max-w-[120px]">
                {gitStatus.currentBranch}
              </span>
              {gitStatus.staged.length === 0 &&
              gitStatus.unstaged.length === 0 &&
              gitStatus.untracked.length === 0 ? (
                <span className="flex items-center gap-1 text-stone-600">
                  <span className="text-stone-700">&middot;</span>
                  clean
                </span>
              ) : (
                <>
                  <span className="text-stone-700">&middot;</span>
                  {gitStatus.staged.length > 0 && (
                    <span className="text-emerald-500">
                      +{gitStatus.staged.length}
                    </span>
                  )}
                  {gitStatus.unstaged.length > 0 && (
                    <span className="text-amber-500">
                      ~{gitStatus.unstaged.length}
                    </span>
                  )}
                  {gitStatus.untracked.length > 0 && (
                    <span className="text-stone-500">
                      ?{gitStatus.untracked.length}
                    </span>
                  )}
                </>
              )}
            </span>
          )}
        </div>
        {/* Line 2: abbreviated path */}
        <p className="text-xs text-stone-500 truncate text-left mt-0.5">
          {repo.path.replace(/^\/Users\/[^/]+/, "~")}
        </p>
      </div>
      {/* Remove button — outside the card to the right */}
      <button
        onClick={handleRemove}
        className="absolute -right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded text-stone-500 hover:text-stone-300 hover:bg-stone-700/50 transition-all"
        aria-label={`Remove ${repo.name} from recent repositories`}
      >
        <svg
          className="w-3.5 h-3.5"
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
    </button>
  );
});

export function WelcomePage({ onOpenRepo, onSelectRepo }: WelcomePageProps) {
  const { recentRepositories, loadPreferences, removeRecentRepository } =
    useReviewStore();
  const [appVersion, setAppVersion] = useState<string>("");

  // Load preferences and version on mount
  useEffect(() => {
    loadPreferences();
    getPlatformServices()
      .window.getVersion()
      .then(setAppVersion)
      .catch(console.error);
  }, [loadPreferences]);

  // Handle Cmd+O keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        onOpenRepo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenRepo]);

  // Listen for menu events (for menu-driven open repo)
  useEffect(() => {
    const platform = getPlatformServices();
    const unlisten = platform.menuEvents.on("menu:open-repo", () => {
      onOpenRepo();
    });
    return unlisten;
  }, [onOpenRepo]);

  // Handle opening a recent repo in the same window
  const handleOpenRecentRepo = useCallback(
    (path: string) => {
      onSelectRepo(path);
    },
    [onSelectRepo],
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

      {/* Main content - horizontal two-column split */}
      <main className="relative flex-1 flex items-center justify-center mx-auto w-full max-w-3xl px-6 py-10">
        <div className="flex items-center gap-16">
          {/* Left column: branding */}
          <div className="shrink-0">
            {/* Logo */}
            <svg
              className="w-12 h-12 mb-5"
              viewBox="0 0 256 256"
              fill="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id="welcome-logo-red"
                  x1="0"
                  y1="1"
                  x2="0"
                  y2="0"
                >
                  <stop offset="0%" stopColor="#a63d2f" />
                  <stop offset="100%" stopColor="#c75d4a" />
                </linearGradient>
                <linearGradient
                  id="welcome-logo-green"
                  x1="0"
                  y1="1"
                  x2="0"
                  y2="0"
                >
                  <stop offset="0%" stopColor="#4a7c59" />
                  <stop offset="100%" stopColor="#6b9b7a" />
                </linearGradient>
                <clipPath id="welcome-logo-body">
                  <rect x="28" y="28" width="200" height="200" rx="48" />
                </clipPath>
                <mask
                  id="welcome-logo-mark"
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
              <rect
                x="28"
                y="28"
                width="88"
                height="200"
                fill="url(#welcome-logo-red)"
                clipPath="url(#welcome-logo-body)"
                mask="url(#welcome-logo-mark)"
              />
              <rect
                x="140"
                y="28"
                width="88"
                height="200"
                fill="url(#welcome-logo-green)"
                clipPath="url(#welcome-logo-body)"
                mask="url(#welcome-logo-mark)"
              />
            </svg>

            <h1 className="text-3xl font-bold tracking-tight text-stone-100">
              Review
            </h1>
            <p className="text-base text-stone-400 mt-2">
              Trust the <span className="italic text-stone-300">trivial</span>.
              <br />
              Review the{" "}
              <span className="font-medium text-stone-200">rest</span>.
            </p>
          </div>

          {/* Right column: actions */}
          <div className="w-80 shrink-0 flex flex-col">
            {recentRepositories.length > 0 && (
              <section aria-labelledby="recent-repos-heading">
                <h2
                  id="recent-repos-heading"
                  className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-3"
                >
                  Recent
                </h2>
                <div className="space-y-2">
                  {recentRepositories.map((repo) => (
                    <RecentRepoCard
                      key={repo.path}
                      repo={repo}
                      onOpen={() => handleOpenRecentRepo(repo.path)}
                      onRemove={() => removeRecentRepository(repo.path)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Open Repository button */}
            <button
              onClick={onOpenRepo}
              className={`group w-full flex items-center justify-center gap-3 px-5 py-3 rounded-xl
                         bg-gradient-to-r from-sage-500 to-sage-400
                         text-stone-950 font-semibold text-sm
                         transition-all duration-200
                         hover:from-sage-400 hover:to-sage-400 hover:shadow-lg hover:shadow-sage-500/30 hover:-translate-y-0.5
                         focus:outline-none focus:ring-2 focus:ring-sage-400 focus:ring-offset-2 focus:ring-offset-stone-950
                         active:translate-y-0 active:shadow-none
                         ${recentRepositories.length > 0 ? "mt-4" : ""}`}
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
                  d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
                />
              </svg>
              <span className="flex-1 text-center">Open Repository</span>
              <kbd className="inline-flex items-center gap-0.5 rounded border border-stone-950/20 bg-stone-950/10 px-1.5 py-0.5 font-mono text-[10px] text-stone-950/60">
                <span>⌘</span>
                <span>O</span>
              </kbd>
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative shrink-0 px-6 py-5 flex items-center justify-center text-xs text-stone-600 border-t border-stone-900/50">
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
          {appVersion && (
            <>
              <span className="text-stone-800">·</span>
              <span className="font-mono text-stone-600 tabular-nums">
                v{appVersion}
              </span>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
