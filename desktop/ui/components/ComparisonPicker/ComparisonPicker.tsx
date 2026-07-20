import { useState, useEffect, useCallback, useMemo } from "react";
import type { ReviewTarget, BranchList, PullRequest } from "../../types";
import { prReviewTarget } from "../../types";
import { BranchSelect, BranchIcon, PR_PREFIX } from "./BranchSelect";
import { Input } from "../ui/input";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../ui/collapsible";
import { getApiClient } from "../../api";

/** Format an ISO-8601 date string as a short relative time (e.g. "2h ago", "3d ago"). */
function relativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

interface ComparisonPickerProps {
  repoPath: string;
  onSelectReview: (target: ReviewTarget) => void;
  /** Refs of existing reviews, to disable rows already under review. */
  existingRefs: string[];
}

/**
 * Pick the best default compare branch: prefer the current branch if it
 * doesn't already have a review, otherwise pick the first local branch
 * (sorted by most recent commit) without an existing review. Reviews are keyed
 * by ref, so a branch is "reviewed" iff its name is a review ref.
 */
function pickSmartDefault(
  defaultBranch: string,
  localBranches: string[],
  currentBranch: string | null,
  reviewRefs: Set<string>,
): string | null {
  if (currentBranch && !reviewRefs.has(currentBranch)) return currentBranch;

  for (const branch of localBranches) {
    if (branch === defaultBranch) continue;
    if (!reviewRefs.has(branch)) return branch;
  }

  return null;
}

type SelectionKind = "pr" | "branch" | "remote" | "stash";

interface Selection {
  kind: SelectionKind;
  value: string; // branch name, stash ref, or PR_PREFIX+number
  pr?: PullRequest;
}

// --- Shared row component for branch/remote/stash lists ---

interface BranchRowProps {
  icon: "branch" | "remote" | "stash";
  label: string;
  selected: boolean;
  existing: boolean;
  date?: string;
  badge?: string;
  onClick: () => void;
}

function BranchRow({
  icon,
  label,
  selected,
  existing,
  date,
  badge,
  onClick,
}: BranchRowProps) {
  let cursorClass = "";
  let bgClass = "hover:bg-surface-raised/50";
  if (existing) {
    cursorClass = "opacity-40 cursor-not-allowed";
    bgClass = "";
  } else if (selected) {
    bgClass = "bg-sage-500/10";
  }

  return (
    <button
      type="button"
      disabled={existing}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-100 ${cursorClass} ${bgClass}`}
    >
      <BranchIcon type={icon} />
      <span
        className={`truncate font-mono text-sm ${selected ? "font-medium text-fg" : "text-fg-secondary"}`}
      >
        {label}
      </span>
      {badge && (
        <span className="shrink-0 rounded-full bg-sage-500/15 px-1.5 py-0.5 text-2xs text-sage-400">
          {badge}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2 shrink-0">
        {date && (
          <span className="text-2xs text-fg-faint">{relativeDate(date)}</span>
        )}
        {existing && <span className="text-2xs text-fg-faint">reviewed</span>}
        {selected && <CheckIcon />}
      </span>
    </button>
  );
}

// --- Section heading (reused across PR, branch, and stash sections) ---

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
      {children}
    </h3>
  );
}

// --- Main component ---

export function ComparisonPicker({
  repoPath,
  onSelectReview,
  existingRefs,
}: ComparisonPickerProps) {
  const [branches, setBranches] = useState<BranchList>({
    local: [],
    remote: [],
    stashes: [],
  });
  const [loading, setLoading] = useState(false);
  const [baseRef, setBaseRef] = useState("");
  // The repo's default branch — the natural base. When the chosen base equals
  // it, no override is stored (the resolution ladder derives it).
  const [defaultBranch, setDefaultBranch] = useState("");
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [smartDefault, setSmartDefault] = useState<string | null>(null);
  const [branchSearch, setBranchSearch] = useState("");
  const [remoteOpen, setRemoteOpen] = useState(false);
  // The base defaults to the repo's default branch and stays hidden behind a
  // quiet "vs <base>" affordance; expanded only when the user wants to override.
  const [baseExpanded, setBaseExpanded] = useState(false);

  // Reset state when repoPath changes
  useEffect(() => {
    setBaseRef("");
    setSelection(null);
    setSmartDefault(null);
    setPullRequests([]);
    setBranches({ local: [], remote: [], stashes: [] });
    setBranchSearch("");
    setRemoteOpen(false);
    setBaseExpanded(false);
  }, [repoPath]);

  useEffect(() => {
    const client = getApiClient();
    setLoading(true);

    // Fetch PRs (non-blocking)
    client
      .checkGitHubAvailable(repoPath)
      .then((avail) => (avail ? client.listPullRequests(repoPath) : []))
      .then((prs) => setPullRequests(prs))
      .catch(() => setPullRequests([]));

    // Fetch branches + context
    Promise.all([
      client.listBranches(repoPath),
      client.getDefaultBranch(repoPath),
      client.getCurrentBranch(repoPath),
      client.listSavedReviews(repoPath),
    ])
      .then(([branchList, defBranch, curBranch, reviews]) => {
        setBranches(branchList);
        setBaseRef(defBranch);
        setDefaultBranch(defBranch);

        const reviewRefs = new Set(reviews.map((r) => r.ref));
        const smart = pickSmartDefault(
          defBranch,
          branchList.local,
          curBranch,
          reviewRefs,
        );
        if (smart) {
          setSmartDefault(smart);
          setSelection({ kind: "branch", value: smart });
        }
      })
      .catch((err) => {
        console.error("Failed to load branches:", err);
        setBranches({ local: ["main", "master"], remote: [], stashes: [] });
        setBaseRef("main");
      })
      .finally(() => setLoading(false));
  }, [repoPath]);

  const existingRefsSet = useMemo(() => new Set(existingRefs), [existingRefs]);

  const isExisting = useCallback(
    (kind: SelectionKind, value: string, pr?: PullRequest): boolean => {
      // A review is identified by its ref: the head branch for a PR, otherwise
      // the selected value (branch name or stash ref).
      if (kind === "pr" && pr) return existingRefsSet.has(pr.headRefName);
      return existingRefsSet.has(value);
    },
    [existingRefsSet],
  );

  const filteredPrs = useMemo(
    () => pullRequests.filter((pr) => pr.baseRefName === baseRef),
    [pullRequests, baseRef],
  );

  const filteredLocal = useMemo(() => {
    if (!branchSearch.trim()) return branches.local;
    const q = branchSearch.toLowerCase();
    return branches.local.filter((b) => b.toLowerCase().includes(q));
  }, [branches.local, branchSearch]);

  const filteredRemote = useMemo(() => {
    if (!branchSearch.trim()) return branches.remote;
    const q = branchSearch.toLowerCase();
    return branches.remote.filter((b) => b.toLowerCase().includes(q));
  }, [branches.remote, branchSearch]);

  const handleSelect = useCallback((sel: Selection) => {
    setSelection((prev) => {
      if (prev?.kind === sel.kind && prev?.value === sel.value) return null;
      return sel;
    });
  }, []);

  const handleStart = useCallback(() => {
    if (!selection || !baseRef) return;

    if (selection.kind === "pr" && selection.pr) {
      onSelectReview(prReviewTarget(selection.pr));
      return;
    }

    if (selection.kind === "stash") {
      // Review the stash's own changes — the stash ref is the review identity;
      // the base is derived by the resolution ladder (stash@{n}^).
      onSelectReview({ ref: selection.value });
      return;
    }

    // Branch/remote: the ref is the selected branch. Only record a base
    // override when the chosen base differs from the default branch.
    const baseOverride =
      baseRef && baseRef !== defaultBranch ? baseRef : undefined;
    onSelectReview({ ref: selection.value, baseOverride });
  }, [selection, baseRef, defaultBranch, onSelectReview]);

  const handleBaseChange = useCallback(
    (newBase: string) => {
      setBaseRef(newBase);
      if (selection) {
        if (selection.kind === "branch" && selection.value === newBase) {
          setSelection(null);
        } else if (selection.kind === "pr" && selection.pr) {
          if (selection.pr.baseRefName !== newBase) {
            setSelection(null);
          }
        }
      }
    },
    [selection],
  );

  const isSelected = useCallback(
    (kind: SelectionKind, value: string) =>
      selection?.kind === kind && selection?.value === value,
    [selection],
  );

  return (
    <div className="rounded-xl border border-edge/60 bg-gradient-to-br from-surface-panel/60 to-surface/80 shadow-inner shadow-black/20 overflow-hidden">
      <div className="flex items-center justify-between border-b border-edge/40 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {baseExpanded ? (
            <>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Base
              </span>
              <BranchSelect
                value={baseRef}
                onChange={handleBaseChange}
                label="Base branch"
                branches={branches}
                variant="base"
                disabled={loading}
              />
            </>
          ) : (
            <button
              type="button"
              onClick={() => setBaseExpanded(true)}
              disabled={loading}
              className="group flex min-w-0 items-center gap-1 text-xs text-fg-faint
                         transition-colors duration-100 hover:text-fg-secondary
                         focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
              title="Change base"
            >
              <span>vs</span>
              <span className="truncate font-mono text-fg-muted group-hover:text-fg-secondary">
                {baseRef || defaultBranch || "…"}
              </span>
            </button>
          )}
        </div>

        <button
          onClick={handleStart}
          disabled={!selection || !baseRef}
          className="group/btn btn-interactive relative shrink-0 rounded-lg bg-gradient-to-r from-sage-500 to-sage-400 px-5 py-2
                   text-sm font-semibold text-surface
                   transition-all duration-200
                   hover:from-sage-400 hover:to-sage-400 hover:shadow-lg hover:shadow-sage-500/30 hover:-translate-y-0.5
                   focus:outline-hidden focus:ring-2 focus:ring-sage-400 focus:ring-offset-2 focus:ring-offset-surface-panel
                   disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none disabled:from-sage-600 disabled:to-sage-600
                   active:translate-y-0 active:shadow-none"
        >
          <span className="flex items-center gap-1.5">
            Start
            <svg
              className="w-4 h-4 transition-transform duration-200 group-hover/btn:translate-x-0.5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        </button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto scrollbar-thin p-4 space-y-5">
        {loading && (
          <div className="space-y-3">
            <div className="h-4 w-24 bg-surface-raised rounded animate-pulse" />
            <div className="space-y-1.5">
              <div className="h-10 bg-surface-raised rounded-lg animate-pulse" />
              <div className="h-10 bg-surface-raised rounded-lg animate-pulse" />
            </div>
          </div>
        )}

        {!loading && pullRequests.length > 0 && (
          <PullRequestSection
            filteredPrs={filteredPrs}
            baseRef={baseRef}
            isSelected={isSelected}
            isExisting={isExisting}
            onSelect={handleSelect}
          />
        )}

        {!loading && (
          <section>
            <SectionHeading>Branches</SectionHeading>
            <div className="rounded-lg border border-edge/40 overflow-hidden">
              {branches.local.length > 5 && (
                <div className="border-b border-edge/30 px-2 py-1.5">
                  <Input
                    type="text"
                    value={branchSearch}
                    onChange={(e) => setBranchSearch(e.target.value)}
                    placeholder="Search branches..."
                    className="py-1 text-sm"
                    aria-label="Search branches"
                  />
                </div>
              )}
              <div className="max-h-[280px] overflow-y-auto scrollbar-thin divide-y divide-edge/20">
                {filteredLocal.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-fg-faint">
                    No matching branches
                  </div>
                ) : (
                  filteredLocal.map((branch) => (
                    <BranchRow
                      key={branch}
                      icon="branch"
                      label={branch}
                      selected={isSelected("branch", branch)}
                      existing={isExisting("branch", branch)}
                      date={branches.dates?.[branch]}
                      badge={
                        branch === smartDefault && !isExisting("branch", branch)
                          ? "suggested"
                          : undefined
                      }
                      onClick={() =>
                        handleSelect({ kind: "branch", value: branch })
                      }
                    />
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {!loading && branches.remote.length > 0 && (
          <Collapsible open={remoteOpen} onOpenChange={setRemoteOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left group"
              >
                <svg
                  className={`h-3.5 w-3.5 text-fg-muted transition-transform duration-150 ${remoteOpen ? "rotate-90" : ""}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted group-hover:text-fg-secondary transition-colors duration-100">
                  Remote Branches ({branches.remote.length})
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 rounded-lg border border-edge/40 overflow-hidden">
                <div className="max-h-[280px] overflow-y-auto scrollbar-thin divide-y divide-edge/20">
                  {filteredRemote.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-fg-faint">
                      No matching remote branches
                    </div>
                  ) : (
                    filteredRemote.map((branch) => (
                      <BranchRow
                        key={branch}
                        icon="remote"
                        label={branch}
                        selected={isSelected("remote", branch)}
                        existing={isExisting("remote", branch)}
                        date={branches.dates?.[branch]}
                        onClick={() =>
                          handleSelect({ kind: "remote", value: branch })
                        }
                      />
                    ))
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {!loading && branches.stashes.length > 0 && (
          <section>
            <SectionHeading>Stashes</SectionHeading>
            <div className="rounded-lg border border-edge/40 overflow-hidden divide-y divide-edge/20">
              {branches.stashes.map((stash) => (
                <BranchRow
                  key={stash.ref}
                  icon="stash"
                  label={`${stash.ref}: ${stash.message}`}
                  selected={isSelected("stash", stash.ref)}
                  existing={isExisting("stash", stash.ref)}
                  date={branches.dates?.[stash.ref]}
                  onClick={() =>
                    handleSelect({ kind: "stash", value: stash.ref })
                  }
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// --- Pull Request section (kept separate due to its unique two-line layout) ---

interface PullRequestSectionProps {
  filteredPrs: PullRequest[];
  baseRef: string;
  isSelected: (kind: SelectionKind, value: string) => boolean;
  isExisting: (kind: SelectionKind, value: string, pr?: PullRequest) => boolean;
  onSelect: (sel: Selection) => void;
}

function PullRequestSection({
  filteredPrs,
  baseRef,
  isSelected,
  isExisting,
  onSelect,
}: PullRequestSectionProps) {
  return (
    <section>
      <SectionHeading>Pull Requests</SectionHeading>
      {filteredPrs.length > 0 ? (
        <div className="rounded-lg border border-edge/40 overflow-hidden divide-y divide-edge/30">
          {filteredPrs.map((pr) => {
            const prValue = `${PR_PREFIX}${pr.number}__`;
            const selected = isSelected("pr", prValue);
            const existing = isExisting("pr", prValue, pr);

            let cursorClass = "";
            let bgClass = "hover:bg-surface-raised/50";
            if (existing) {
              cursorClass = "opacity-40 cursor-not-allowed";
              bgClass = "";
            } else if (selected) {
              bgClass = "bg-sage-500/10";
            }

            return (
              <button
                key={pr.number}
                type="button"
                disabled={existing}
                onClick={() => onSelect({ kind: "pr", value: prValue, pr })}
                className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors duration-100 ${cursorClass} ${bgClass}`}
              >
                <div className="mt-0.5 shrink-0">
                  <BranchIcon type="pr" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm truncate ${selected ? "font-medium text-fg" : "text-fg-secondary"}`}
                    >
                      #{pr.number} {pr.title}
                    </span>
                    {pr.isDraft && (
                      <span className="shrink-0 rounded-full bg-surface-raised px-1.5 py-0.5 text-2xs text-fg-muted">
                        Draft
                      </span>
                    )}
                  </div>
                  <div className="text-2xs text-fg-muted truncate">
                    {pr.headRefName} &middot; @{pr.author.login}
                    {pr.updatedAt && (
                      <span className="ml-1 text-fg-faint">
                        &middot; {relativeDate(pr.updatedAt)}
                      </span>
                    )}
                  </div>
                </div>
                {selected && <CheckIcon />}
                {existing && (
                  <span className="shrink-0 text-2xs text-fg-faint mt-0.5">
                    reviewed
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-fg-faint px-1">
          No open PRs targeting {baseRef}
        </p>
      )}
    </section>
  );
}

function CheckIcon() {
  return (
    <svg
      className="ml-auto h-4 w-4 shrink-0 text-sage-400"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
        clipRule="evenodd"
      />
    </svg>
  );
}
