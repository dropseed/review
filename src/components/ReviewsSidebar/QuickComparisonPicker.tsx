import { useState, useCallback, useMemo, useRef } from "react";
import { makeComparison, makePrComparison } from "../../types";
import type { BranchList, PullRequest } from "../../types";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { Input } from "../ui/input";
import { useSidebarData } from "./SidebarDataContext";

// Special value for working tree
const WORKING_TREE = "__WORKING_TREE__";

interface QuickOption {
  value: string;
  label: string;
  group: string;
  icon: "tree" | "branch" | "stash" | "pr";
  secondaryLabel?: string;
}

// Icons for different option types
function OptionIcon({ type }: { type: QuickOption["icon"] }) {
  const baseClass = "w-3.5 h-3.5 shrink-0";

  switch (type) {
    case "tree":
      return (
        <svg
          className={`${baseClass} text-amber-400`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M2 4.25A2.25 2.25 0 014.25 2h11.5A2.25 2.25 0 0118 4.25v8.5A2.25 2.25 0 0115.75 15h-3.105a3.501 3.501 0 001.1 1.677A.75.75 0 0113.26 18H6.74a.75.75 0 01-.484-1.323A3.501 3.501 0 007.355 15H4.25A2.25 2.25 0 012 12.75v-8.5z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "stash":
      return (
        <svg
          className={`${baseClass} text-violet-400`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M2 3a1 1 0 00-1 1v1a1 1 0 001 1h16a1 1 0 001-1V4a1 1 0 00-1-1H2z" />
          <path
            fillRule="evenodd"
            d="M2 7.5h16l-.811 7.71a2 2 0 01-1.99 1.79H4.802a2 2 0 01-1.99-1.79L2 7.5z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "pr":
      return (
        <svg
          className={`${baseClass} text-green-400`}
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
        </svg>
      );
    case "branch":
    default:
      return (
        <svg
          className={`${baseClass} text-stone-400`}
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
        </svg>
      );
  }
}

function getComparisonKey(
  base: string,
  compareValue: string,
  currentBranch: string,
): string {
  if (compareValue === WORKING_TREE) {
    return `${base}..${currentBranch}+working-tree`;
  }
  return `${base}..${compareValue}`;
}

function buildCompareOptions(
  branches: BranchList | null,
  baseBranch: string,
  currentBranch: string,
  existingComparisonKeys: string[],
  gitStatusHasChanges: boolean,
  pullRequests: PullRequest[],
): QuickOption[] {
  if (!branches || !baseBranch) return [];

  const opts: QuickOption[] = [];
  const existingKeys = new Set(existingComparisonKeys);

  // Working Tree option (if has uncommitted changes and not already reviewed)
  if (gitStatusHasChanges) {
    const workingTreeKey = getComparisonKey(
      baseBranch,
      WORKING_TREE,
      currentBranch,
    );
    if (!existingKeys.has(workingTreeKey)) {
      opts.push({
        value: WORKING_TREE,
        label: "Working Tree",
        group: "Local State",
        icon: "tree",
      });
    }
  }

  // Stashes
  for (const stash of branches.stashes) {
    const stashKey = `${baseBranch}..${stash.ref}`;
    if (existingKeys.has(stashKey)) continue;
    const shortMessage =
      stash.message.length > 30
        ? stash.message.slice(0, 30) + "..."
        : stash.message;
    opts.push({
      value: stash.ref,
      label: `${stash.ref}: ${shortMessage}`,
      group: "Local State",
      icon: "stash",
    });
  }

  // Pull requests targeting the selected base branch
  for (const pr of pullRequests) {
    if (pr.baseRefName !== baseBranch) continue;
    const prKey = `pr-${pr.number}`;
    if (existingKeys.has(prKey)) continue;
    const draftPrefix = pr.isDraft ? "[Draft] " : "";
    opts.push({
      value: `__PR_${pr.number}`,
      label: `${draftPrefix}#${pr.number} ${pr.title}`,
      group: "Pull Requests",
      icon: "pr",
      secondaryLabel: pr.author.login,
    });
  }

  // Current branch (if different from base and not already reviewed)
  if (currentBranch !== baseBranch) {
    const branchKey = `${baseBranch}..${currentBranch}`;
    if (!existingKeys.has(branchKey)) {
      opts.push({
        value: currentBranch,
        label: currentBranch,
        group: "Local Branches",
        icon: "branch",
        secondaryLabel: "current",
      });
    }
  }

  // Other local branches (excluding base and current)
  for (const branch of branches.local) {
    if (branch === baseBranch || branch === currentBranch) continue;
    const branchKey = `${baseBranch}..${branch}`;
    if (existingKeys.has(branchKey)) continue;
    opts.push({
      value: branch,
      label: branch,
      group: "Local Branches",
      icon: "branch",
    });
  }

  return opts;
}

// Base branch selector component
function BaseBranchSelector({
  value,
  onChange,
  branches,
}: {
  value: string;
  onChange: (branch: string) => void;
  branches: BranchList;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const { filteredLocal, filteredRemote } = useMemo(() => {
    // Filter out malformed remote entries (just "origin" without a branch name)
    const validRemotes = branches.remote.filter((b) => b.includes("/"));

    if (!searchQuery.trim()) {
      return { filteredLocal: branches.local, filteredRemote: validRemotes };
    }

    const query = searchQuery.toLowerCase();
    return {
      filteredLocal: branches.local.filter((b) =>
        b.toLowerCase().includes(query),
      ),
      filteredRemote: validRemotes.filter((b) =>
        b.toLowerCase().includes(query),
      ),
    };
  }, [branches.local, branches.remote, searchQuery]);

  const handleSelect = useCallback(
    (branch: string) => {
      onChange(branch);
      setIsOpen(false);
      setSearchQuery("");
    },
    [onChange],
  );

  const hasResults = filteredLocal.length > 0 || filteredRemote.length > 0;

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) setSearchQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="font-mono text-xs text-terracotta-400 hover:text-terracotta-300 hover:underline transition-colors"
          aria-label="Change base branch"
        >
          {value}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <div className="p-2 border-b border-stone-800/50">
          <Input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search branches..."
            className="py-1.5 text-xs"
            aria-label="Search branches"
          />
        </div>
        <ul className="max-h-48 overflow-auto py-1 scrollbar-thin">
          {!hasResults ? (
            <li className="px-3 py-2 text-xs text-stone-500">
              No branches found
            </li>
          ) : (
            <>
              {filteredLocal.length > 0 && (
                <li>
                  <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-stone-500">
                    Local
                  </div>
                  <ul>
                    {filteredLocal.map((branch) => (
                      <li
                        key={branch}
                        onClick={() => handleSelect(branch)}
                        className={`px-3 py-1.5 text-xs font-mono cursor-pointer transition-colors
                          ${branch === value ? "text-terracotta-400 bg-terracotta-500/10" : "text-stone-300 hover:bg-stone-800/50"}`}
                      >
                        {branch}
                      </li>
                    ))}
                  </ul>
                </li>
              )}
              {filteredRemote.length > 0 && (
                <li>
                  <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-stone-500">
                    Remote
                  </div>
                  <ul>
                    {filteredRemote.map((branch) => (
                      <li
                        key={branch}
                        onClick={() => handleSelect(branch)}
                        className={`px-3 py-1.5 text-xs font-mono cursor-pointer transition-colors
                          ${branch === value ? "text-terracotta-400 bg-terracotta-500/10" : "text-stone-300 hover:bg-stone-800/50"}`}
                      >
                        {branch}
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function QuickComparisonPicker() {
  const {
    branches,
    defaultBranch,
    currentBranch,
    existingComparisonKeys,
    gitStatus,
    pullRequests,
    onSelectReview,
    isLoadingBranches,
  } = useSidebarData();

  // Allow changing base branch (default to defaultBranch)
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const effectiveBase = baseBranch || defaultBranch;

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const gitStatusHasChanges = Boolean(
    gitStatus &&
    (gitStatus.staged.length > 0 ||
      gitStatus.unstaged.length > 0 ||
      gitStatus.untracked.length > 0),
  );

  const options = useMemo(
    () =>
      buildCompareOptions(
        branches,
        effectiveBase || "",
        currentBranch,
        existingComparisonKeys,
        gitStatusHasChanges,
        pullRequests,
      ),
    [
      branches,
      effectiveBase,
      currentBranch,
      existingComparisonKeys,
      gitStatusHasChanges,
      pullRequests,
    ],
  );

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(query) ||
        opt.value.toLowerCase().includes(query),
    );
  }, [options, searchQuery]);

  // Group filtered options for display
  const groupedOptions = useMemo(() => {
    const groups: Record<string, QuickOption[]> = {};
    filteredOptions.forEach((opt) => {
      if (!groups[opt.group]) groups[opt.group] = [];
      groups[opt.group].push(opt);
    });
    return groups;
  }, [filteredOptions]);

  const handleSelect = useCallback(
    (optionValue: string) => {
      if (!effectiveBase) return;

      // Handle PR selection
      if (optionValue.startsWith("__PR_")) {
        const prNumber = parseInt(optionValue.slice(5), 10);
        const pr = pullRequests.find((p) => p.number === prNumber);
        if (pr) {
          onSelectReview(makePrComparison(pr));
        }
        setIsOpen(false);
        setSearchQuery("");
        return;
      }

      // Handle Working Tree or branch selection
      const isWorkingTree = optionValue === WORKING_TREE;
      const newRef = isWorkingTree ? currentBranch : optionValue;
      const comparison = makeComparison(effectiveBase, newRef, isWorkingTree);
      onSelectReview(comparison);
      setIsOpen(false);
      setSearchQuery("");
    },
    [effectiveBase, currentBranch, pullRequests, onSelectReview],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((i) =>
            Math.min(i + 1, filteredOptions.length - 1),
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredOptions[highlightedIndex]) {
            handleSelect(filteredOptions[highlightedIndex].value);
          }
          break;
        case "Home":
          e.preventDefault();
          setHighlightedIndex(0);
          break;
        case "End":
          e.preventDefault();
          setHighlightedIndex(filteredOptions.length - 1);
          break;
      }
    },
    [filteredOptions, highlightedIndex, handleSelect],
  );

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setSearchQuery("");
      setHighlightedIndex(0);
    }
  }, []);

  // Show skeleton while loading
  if (isLoadingBranches) {
    return (
      <section aria-labelledby="new-review-heading" className="mt-2">
        <h2
          id="new-review-heading"
          className="mb-2 text-xs font-semibold text-stone-400 uppercase tracking-wider flex items-center gap-2"
        >
          <span
            className="w-1.5 h-1.5 rounded-full bg-terracotta-400"
            aria-hidden="true"
          />
          New Review
        </h2>
        <div className="h-4 w-32 bg-stone-800/50 rounded animate-pulse mb-3" />
        <div className="h-9 w-full bg-stone-800/50 rounded-lg animate-pulse" />
      </section>
    );
  }

  // Show nothing if no branches loaded
  if (!branches || !effectiveBase) {
    return null;
  }

  return (
    <section aria-labelledby="new-review-heading" className="mt-2">
      <h2
        id="new-review-heading"
        className="mb-2 text-xs font-semibold text-stone-400 uppercase tracking-wider flex items-center gap-2"
      >
        <span
          className="w-1.5 h-1.5 rounded-full bg-terracotta-400"
          aria-hidden="true"
        />
        New Review
      </h2>

      {/* Base branch - clickable to change */}
      <p className="mb-3 text-xs text-stone-500 flex items-center gap-1">
        Compare against{" "}
        <BaseBranchSelector
          value={effectiveBase}
          onChange={setBaseBranch}
          branches={branches}
        />
      </p>

      {/* Compare branch dropdown */}
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 rounded-lg border border-stone-800/60 bg-stone-900/50
                     px-3 py-2 text-sm text-stone-400
                     hover:bg-stone-900/80 hover:border-stone-700/60 hover:text-stone-300
                     transition-colors duration-150
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50"
            aria-haspopup="listbox"
            aria-expanded={isOpen}
          >
            <span className="text-xs">Select branch to compare...</span>
            <svg
              className={`h-4 w-4 text-stone-500 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[calc(420px-2.5rem)] max-w-[calc(90vw-2.5rem)] p-0"
          align="start"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            searchRef.current?.focus();
          }}
        >
          {/* Search input */}
          <div className="p-2 border-b border-stone-800/50">
            <Input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search branches..."
              className="py-1.5 text-xs"
              aria-label="Search branches"
            />
          </div>

          {/* Options list */}
          <ul
            ref={listRef}
            role="listbox"
            className="max-h-60 overflow-auto py-1 scrollbar-thin"
          >
            {Object.entries(groupedOptions).length === 0 ? (
              <li className="px-3 py-2 text-xs text-stone-500">
                {options.length === 0
                  ? "All branches already have reviews"
                  : "No matches found"}
              </li>
            ) : (
              Object.entries(groupedOptions).map(([group, groupOpts]) => (
                <li key={group}>
                  {/* Group header */}
                  <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-stone-500">
                    {group}
                  </div>
                  {/* Group options */}
                  <ul>
                    {groupOpts.map((opt) => {
                      const flatIndex = filteredOptions.indexOf(opt);
                      const isHighlighted = flatIndex === highlightedIndex;

                      return (
                        <li
                          key={opt.value}
                          role="option"
                          aria-selected={isHighlighted}
                          data-highlighted={isHighlighted}
                          onClick={() => handleSelect(opt.value)}
                          onMouseEnter={() => setHighlightedIndex(flatIndex)}
                          className={`
                            flex items-center gap-2 px-3 py-1.5 cursor-pointer
                            text-xs transition-colors duration-75
                            ${
                              isHighlighted
                                ? "bg-sage-500/10 text-stone-100"
                                : "text-stone-300 hover:bg-stone-800/50"
                            }
                          `}
                        >
                          <OptionIcon type={opt.icon} />
                          <span className="truncate font-mono">
                            {opt.label}
                          </span>
                          {opt.secondaryLabel && (
                            <span className="ml-auto text-2xs text-stone-500 shrink-0">
                              {opt.secondaryLabel}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
        </PopoverContent>
      </Popover>
    </section>
  );
}
