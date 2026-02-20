import { useState, useRef, useEffect, useCallback, memo, useMemo } from "react";
import type { BranchList, StashEntry, PullRequest } from "../../types";
import { Input } from "../ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";

interface BranchOption {
  value: string;
  label: string;
  group: string;
  icon?: "branch" | "remote" | "stash" | "pr";
  secondaryLabel?: string;
}

interface BranchSelectProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  branches: BranchList;
  variant: "base" | "compare";
  disabled?: boolean;
  excludeValue?: string; // For compare selector to exclude base branch
  baseValue?: string; // Current base value (for filtering existing comparisons)
  existingComparisonKeys?: string[]; // Keys of existing reviews to filter out
  placeholder?: string; // Placeholder text when value is empty
  pullRequests?: PullRequest[]; // PRs to show in compare dropdown
}

// Icons for different branch types
const BranchIcon = memo(function BranchIcon({
  type,
}: {
  type: BranchOption["icon"];
}) {
  const baseClass = "w-4 h-4 shrink-0";

  switch (type) {
    case "stash":
      return (
        <svg
          className={`${baseClass} text-guide`}
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
    case "remote":
      return (
        <svg
          className={`${baseClass} text-status-renamed`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.5 17a4.5 4.5 0 01-1.44-8.765 4.5 4.5 0 018.302-3.046 3.5 3.5 0 014.504 4.272A4 4 0 0115 17H5.5zm3.75-2.75a.75.75 0 001.5 0V9.66l1.95 2.1a.75.75 0 101.1-1.02l-3.25-3.5a.75.75 0 00-1.1 0l-3.25 3.5a.75.75 0 101.1 1.02l1.95-2.1v4.59z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "pr":
      // Pull request icon (GitHub Octicons style)
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
      // Git branch icon (GitHub Octicons style)
      return (
        <svg
          className={`${baseClass} text-fg-muted`}
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
        </svg>
      );
  }
});

// PR value prefix
const PR_PREFIX = "__PR_";

// Get display name for special values
function getDisplayName(
  value: string,
  branches: BranchList,
  pullRequests?: PullRequest[],
): string {
  // Check if it's a PR
  if (value.startsWith(PR_PREFIX) && pullRequests) {
    const prNumber = parseInt(value.slice(PR_PREFIX.length, -2), 10);
    const pr = pullRequests.find((p) => p.number === prNumber);
    if (pr) {
      const shortTitle =
        pr.title.length > 20 ? pr.title.slice(0, 20) + "…" : pr.title;
      return `#${pr.number} ${shortTitle}`;
    }
  }

  // Check if it's a stash
  const stash = branches.stashes.find((s) => s.ref === value);
  if (stash) {
    const shortMessage =
      stash.message.length > 25
        ? stash.message.slice(0, 25) + "…"
        : stash.message;
    return `${stash.ref}: ${shortMessage}`;
  }

  return value;
}

// Helper to generate comparison key (must match makeComparison logic)
function getComparisonKey(base: string, compareValue: string): string {
  if (compareValue.startsWith(PR_PREFIX)) {
    const prNumber = parseInt(compareValue.slice(PR_PREFIX.length, -2), 10);
    return `pr-${prNumber}`;
  }
  return `${base}..${compareValue}`;
}

export const BranchSelect = memo(function BranchSelect({
  value,
  onChange,
  label,
  branches,
  variant,
  disabled = false,
  excludeValue,
  baseValue,
  existingComparisonKeys = [],
  placeholder,
  pullRequests,
}: BranchSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listboxRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Check if a compare option would create an existing comparison
  const isExistingComparison = useCallback(
    (compareValue: string): boolean => {
      if (!baseValue || existingComparisonKeys.length === 0) return false;
      const key = getComparisonKey(baseValue, compareValue);
      return existingComparisonKeys.includes(key);
    },
    [baseValue, existingComparisonKeys],
  );

  // Build flat list of options
  const options = useMemo(() => {
    const opts: BranchOption[] = [];

    // Add stashes (filter out existing)
    branches.stashes.forEach((stash: StashEntry) => {
      if (isExistingComparison(stash.ref)) return;
      const shortMessage =
        stash.message.length > 20
          ? stash.message.slice(0, 20) + "…"
          : stash.message;
      opts.push({
        value: stash.ref,
        label: `${stash.ref}: ${shortMessage}`,
        group: "Stashes",
        icon: "stash",
      });
    });

    // Add pull requests (filtered by base branch)
    if (pullRequests && baseValue) {
      pullRequests
        .filter((pr) => pr.baseRefName === baseValue)
        .filter((pr) => !isExistingComparison(`${PR_PREFIX}${pr.number}__`))
        .forEach((pr) => {
          const draftPrefix = pr.isDraft ? "[Draft] " : "";
          opts.push({
            value: `${PR_PREFIX}${pr.number}__`,
            label: `${draftPrefix}#${pr.number} ${pr.title}`,
            group: "Pull Requests",
            icon: "pr",
            secondaryLabel: pr.author.login,
          });
        });
    }

    // Add local branches (filter out excluded and existing)
    branches.local
      .filter((b) => b !== excludeValue && !isExistingComparison(b))
      .forEach((branch) => {
        opts.push({
          value: branch,
          label: branch,
          group: "Local Branches",
          icon: "branch",
        });
      });

    // Add remote branches (filter out excluded and existing)
    branches.remote
      .filter((b) => b !== excludeValue && !isExistingComparison(b))
      .forEach((branch) => {
        opts.push({
          value: branch,
          label: branch,
          group: "Remote Branches",
          icon: "remote",
        });
      });

    return opts;
  }, [branches, excludeValue, isExistingComparison, pullRequests, baseValue]);

  // Filter options based on search
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
    const groups: Record<string, BranchOption[]> = {};
    filteredOptions.forEach((opt) => {
      if (!groups[opt.group]) groups[opt.group] = [];
      groups[opt.group].push(opt);
    });
    return groups;
  }, [filteredOptions]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (isOpen && listboxRef.current) {
      const highlighted = listboxRef.current.querySelector(
        '[data-highlighted="true"]',
      );
      if (highlighted) {
        highlighted.scrollIntoView({ block: "nearest" });
      }
    }
  }, [isOpen, highlightedIndex]);

  // Handle keyboard navigation within the dropdown
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
            onChange(filteredOptions[highlightedIndex].value);
            setIsOpen(false);
            setSearchQuery("");
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
    [filteredOptions, highlightedIndex, onChange],
  );

  // Handle option selection
  const handleSelect = useCallback(
    (optionValue: string) => {
      onChange(optionValue);
      setIsOpen(false);
      setSearchQuery("");
    },
    [onChange],
  );

  // Reset state when popover closes
  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setSearchQuery("");
      setHighlightedIndex(0);
    }
  }, []);

  // Get current display text
  const displayText = value
    ? getDisplayName(value, branches, pullRequests)
    : null;
  const showPlaceholder = !value && placeholder;

  // Variant-specific colors
  const variantClasses =
    variant === "base"
      ? "border-terracotta-500/30 hover:border-terracotta-500/50 focus:ring-terracotta-500/30"
      : "border-sage-500/30 hover:border-sage-500/50 focus:ring-sage-500/30 text-sage-400";

  const buttonId = `branch-select-${variant}`;
  const listboxId = `branch-listbox-${variant}`;

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={buttonId}
          disabled={disabled}
          className={`
            relative w-full max-w-[200px] min-w-0 appearance-none rounded-lg border bg-surface-raised/50
            pl-3 pr-8 py-2 text-sm font-mono
            text-left
            transition-colors duration-150
            ${variantClasses}
            ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-surface-raised/70"}
            focus:outline-hidden focus:ring-2
          `}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={label}
        >
          <span
            className={`block truncate ${showPlaceholder ? "text-fg-muted" : ""}`}
          >
            {displayText || placeholder || "Select…"}
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <svg
              className={`h-4 w-4 text-fg-muted transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
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
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
      >
        {/* Search input */}
        <div className="p-2 border-b border-edge/50">
          <Input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search branches…"
            className="py-1.5 text-sm"
            aria-label="Search branches"
          />
        </div>

        {/* Options list */}
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={buttonId}
          className="max-h-60 overflow-auto py-1 scrollbar-thin"
        >
          {Object.entries(groupedOptions).length === 0 ? (
            <li className="px-3 py-2 text-sm text-fg-muted">
              No branches found
            </li>
          ) : (
            Object.entries(groupedOptions).map(([group, groupOpts]) => (
              <li key={group}>
                {/* Group header */}
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                  {group}
                </div>
                {/* Group options */}
                <ul>
                  {groupOpts.map((opt) => {
                    const flatIndex = filteredOptions.indexOf(opt);
                    const isHighlighted = flatIndex === highlightedIndex;
                    const isSelected = opt.value === value;

                    return (
                      <li
                        key={opt.value}
                        role="option"
                        aria-selected={isSelected}
                        data-highlighted={isHighlighted}
                        onClick={() => handleSelect(opt.value)}
                        onMouseEnter={() => setHighlightedIndex(flatIndex)}
                        className={`
                          flex items-center gap-2 px-3 py-2 cursor-pointer
                          text-sm transition-colors duration-75
                          ${
                            isHighlighted
                              ? variant === "base"
                                ? "bg-terracotta-500/10 text-fg"
                                : "bg-sage-500/10 text-fg"
                              : "text-fg-secondary hover:bg-surface-raised/50"
                          }
                          ${isSelected ? "font-medium" : ""}
                        `}
                      >
                        <BranchIcon type={opt.icon} />
                        <span className="truncate font-mono">{opt.label}</span>
                        {opt.secondaryLabel && (
                          <span className="ml-auto text-xs text-fg-muted shrink-0">
                            {opt.secondaryLabel}
                          </span>
                        )}
                        {isSelected && (
                          <svg
                            className={`ml-auto h-4 w-4 shrink-0 ${variant === "base" ? "text-terracotta-400" : "text-sage-400"}`}
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
  );
});

export { PR_PREFIX };
