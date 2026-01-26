import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useReviewStore } from "../stores/reviewStore";
import type { StatusEntry } from "../types";

interface GitStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Collapsible section component
function StatusSection({
  title,
  count,
  color,
  icon,
  children,
  defaultExpanded = true,
}: {
  title: string;
  count: number;
  color: "lime" | "amber" | "stone";
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (count === 0) return null;

  const colorClasses = {
    lime: {
      badge: "bg-lime-500/20 text-lime-400",
      icon: "text-lime-400",
      border: "border-l-lime-500",
    },
    amber: {
      badge: "bg-amber-500/20 text-amber-400",
      icon: "text-amber-400",
      border: "border-l-amber-500",
    },
    stone: {
      badge: "bg-stone-700 text-stone-400",
      icon: "text-stone-400",
      border: "border-l-stone-500",
    },
  };

  const colors = colorClasses[color];

  return (
    <div className="border-b border-stone-800/60 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`group flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors ${
          expanded ? "bg-stone-800/30" : "hover:bg-stone-800/40"
        }`}
      >
        {/* Expand icon */}
        <svg
          className={`h-3.5 w-3.5 text-stone-400 transition-transform duration-200 ease-out ${
            expanded ? "rotate-90" : ""
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>

        {/* Section icon */}
        <span className={colors.icon}>{icon}</span>

        {/* Title */}
        <span className="flex-1 text-xs font-medium text-stone-200 group-hover:text-stone-50">
          {title}
        </span>

        {/* Count badge */}
        <span
          className={`rounded-full px-1.5 py-0.5 text-xxs font-medium tabular-nums ${colors.badge}`}
        >
          {count}
        </span>
      </button>

      {/* Content */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          expanded ? "max-h-[20rem] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className={`border-l-2 ${colors.border} ml-4 mr-4 mb-2`}>
          {children}
        </div>
      </div>
    </div>
  );
}

// File row component
function FileRow({
  path,
  status,
  onClick,
}: {
  path: string;
  status?: StatusEntry["status"];
  onClick: () => void;
}) {
  const statusLabels: Record<string, string> = {
    modified: "M",
    added: "A",
    deleted: "D",
    renamed: "R",
    copied: "C",
  };

  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-sky-500/10 transition-colors"
    >
      {status && (
        <span className="w-4 text-center font-mono text-xxs font-medium text-stone-500">
          {statusLabels[status] || "?"}
        </span>
      )}
      <span className="flex-1 truncate font-mono text-2xs text-stone-300 group-hover:text-sky-200">
        {path}
      </span>
    </button>
  );
}

export function GitStatusModal({ isOpen, onClose }: GitStatusModalProps) {
  const { gitStatus, repoPath, setSelectedFile, revealFileInTree } =
    useReviewStore();
  const [activeTab, setActiveTab] = useState<"summary" | "raw">("summary");
  const [rawStatus, setRawStatus] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // Handle escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Load raw status when tab switches to raw
  useEffect(() => {
    if (isOpen && activeTab === "raw" && repoPath) {
      invoke<string>("get_git_status_raw", { repoPath })
        .then(setRawStatus)
        .catch((err) => {
          console.error("Failed to get raw git status:", err);
          setRawStatus("Failed to load git status");
        });
    }
  }, [isOpen, activeTab, repoPath]);

  // Handle file click - navigate to file
  const handleFileClick = (path: string) => {
    setSelectedFile(path);
    revealFileInTree(path);
    onClose();
  };

  // Handle copy
  const handleCopy = async () => {
    try {
      await writeText(rawStatus);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  if (!isOpen || !gitStatus) return null;

  const stagedCount = gitStatus.staged.length;
  const unstagedCount = gitStatus.unstaged.length;
  const untrackedCount = gitStatus.untracked.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-stone-700 bg-stone-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-800 border-t-2 border-t-sky-500/40 px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Branch icon */}
            <svg
              className="h-4 w-4 text-sky-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <h2 className="text-sm font-semibold tracking-wide text-stone-50">
              {gitStatus.currentBranch}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50"
            aria-label="Close git status"
          >
            <svg
              className="h-5 w-5"
              aria-hidden="true"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-stone-800">
          <button
            onClick={() => setActiveTab("summary")}
            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === "summary"
                ? "border-b-2 border-b-sky-500 text-sky-400"
                : "text-stone-400 hover:text-stone-200"
            }`}
          >
            Summary
          </button>
          <button
            onClick={() => setActiveTab("raw")}
            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === "raw"
                ? "border-b-2 border-b-sky-500 text-sky-400"
                : "text-stone-400 hover:text-stone-200"
            }`}
          >
            Raw Output
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {activeTab === "summary" ? (
            <>
              {/* Staged changes */}
              <StatusSection
                title="Staged Changes"
                count={stagedCount}
                color="lime"
                icon={
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                }
              >
                {gitStatus.staged.map((entry) => (
                  <FileRow
                    key={entry.path}
                    path={entry.path}
                    status={entry.status}
                    onClick={() => handleFileClick(entry.path)}
                  />
                ))}
              </StatusSection>

              {/* Unstaged changes */}
              <StatusSection
                title="Unstaged Changes"
                count={unstagedCount}
                color="amber"
                icon={
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                }
              >
                {gitStatus.unstaged.map((entry) => (
                  <FileRow
                    key={entry.path}
                    path={entry.path}
                    status={entry.status}
                    onClick={() => handleFileClick(entry.path)}
                  />
                ))}
              </StatusSection>

              {/* Untracked files */}
              <StatusSection
                title="Untracked Files"
                count={untrackedCount}
                color="stone"
                icon={
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                }
              >
                {gitStatus.untracked.map((path) => (
                  <FileRow
                    key={path}
                    path={path}
                    onClick={() => handleFileClick(path)}
                  />
                ))}
              </StatusSection>

              {/* Clean working tree message */}
              {stagedCount === 0 &&
                unstagedCount === 0 &&
                untrackedCount === 0 && (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-stone-500">
                    <svg
                      className="h-8 w-8 text-lime-500/50"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className="text-xs">Working tree clean</span>
                  </div>
                )}
            </>
          ) : (
            /* Raw output tab */
            <div className="relative">
              {/* Copy button */}
              <button
                onClick={handleCopy}
                className="absolute right-2 top-2 rounded px-2 py-1 text-xxs font-medium text-stone-400 hover:bg-stone-700 hover:text-stone-200 transition-colors"
                title="Copy to clipboard"
              >
                {copied ? (
                  <span className="flex items-center gap-1 text-lime-400">
                    <svg
                      className="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Copied
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <svg
                      className="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy
                  </span>
                )}
              </button>

              {/* Raw output */}
              <pre className="p-4 font-mono text-2xs leading-relaxed text-stone-300 whitespace-pre-wrap">
                {rawStatus || "Loading..."}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
