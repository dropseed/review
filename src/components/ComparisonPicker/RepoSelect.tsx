import { useState, useRef, useEffect, useCallback, memo, useMemo } from "react";
import type { RecentRepo } from "../../utils/preferences";
import { Input } from "../ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";

interface RepoSelectProps {
  value: string | null;
  onChange: (path: string) => void;
  recentRepos: RecentRepo[];
  onOpenRepository: () => void;
  disabled?: boolean;
}

export const RepoSelect = memo(function RepoSelect({
  value,
  onChange,
  recentRepos,
  onOpenRepository,
  disabled = false,
}: RepoSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listboxRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const displayName = value ? value.split("/").pop() : null;

  const filteredRepos = useMemo(() => {
    if (!searchQuery.trim()) return recentRepos;
    const query = searchQuery.toLowerCase();
    return recentRepos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.path.toLowerCase().includes(query),
    );
  }, [recentRepos, searchQuery]);

  const totalItems = filteredRepos.length + 1;
  const openRepoIndex = filteredRepos.length;

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setSearchQuery("");
  }, []);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((i) => Math.min(i + 1, totalItems - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (highlightedIndex === openRepoIndex) {
            onOpenRepository();
            closeDropdown();
          } else if (filteredRepos[highlightedIndex]) {
            onChange(filteredRepos[highlightedIndex].path);
            closeDropdown();
          }
          break;
        case "Home":
          e.preventDefault();
          setHighlightedIndex(0);
          break;
        case "End":
          e.preventDefault();
          setHighlightedIndex(totalItems - 1);
          break;
      }
    },
    [
      filteredRepos,
      highlightedIndex,
      onChange,
      onOpenRepository,
      totalItems,
      openRepoIndex,
      closeDropdown,
    ],
  );

  const handleSelect = useCallback(
    (path: string) => {
      onChange(path);
      closeDropdown();
    },
    [onChange, closeDropdown],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setIsOpen(true);
      } else {
        closeDropdown();
        setHighlightedIndex(0);
      }
    },
    [closeDropdown],
  );

  const showSearch = recentRepos.length > 3;

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`
            w-full appearance-none rounded-lg border border-stone-700/50 bg-stone-800/50
            px-3 py-2.5 text-sm text-left
            transition-colors duration-150
            focus:outline-hidden focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50
            hover:border-stone-600/60 hover:bg-stone-800/70
            ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
          `}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label="Repository"
        >
          <span className="flex items-center gap-2.5">
            <svg
              className="h-4 w-4 text-stone-500 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            </svg>
            <span
              className={`block truncate font-mono ${displayName ? "text-stone-200" : "text-stone-500"}`}
            >
              {displayName || "Select a repository…"}
            </span>
            <svg
              className={`ml-auto h-4 w-4 text-stone-500 shrink-0 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
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
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (showSearch) {
            searchRef.current?.focus();
          }
        }}
      >
        {showSearch && (
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
              placeholder="Search repositories…"
              className="py-1.5 text-sm"
              aria-label="Search repositories"
            />
          </div>
        )}

        <ul
          ref={listboxRef}
          role="listbox"
          className="max-h-60 overflow-auto py-1 scrollbar-thin"
          onKeyDown={!showSearch ? handleKeyDown : undefined}
        >
          {filteredRepos.map((repo, index) => {
            const isHighlighted = index === highlightedIndex;
            const isSelected = repo.path === value;

            return (
              <li
                key={repo.path}
                role="option"
                aria-selected={isSelected}
                data-highlighted={isHighlighted}
                onClick={() => handleSelect(repo.path)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`
                  flex items-center gap-2.5 px-3 py-2 cursor-pointer
                  text-sm transition-colors duration-75
                  ${
                    isHighlighted
                      ? "bg-amber-500/10 text-stone-100"
                      : "text-stone-300 hover:bg-stone-800/50"
                  }
                  ${isSelected ? "font-medium" : ""}
                `}
              >
                <svg
                  className="h-3.5 w-3.5 text-stone-600 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                  />
                </svg>
                <span className="truncate font-mono">{repo.name}</span>
                {isSelected && (
                  <svg
                    className="ml-auto h-4 w-4 shrink-0 text-amber-400"
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

          {filteredRepos.length > 0 && (
            <li
              className="my-1 border-t border-stone-800/50"
              aria-hidden="true"
            />
          )}

          <li
            data-highlighted={highlightedIndex === openRepoIndex}
            onClick={() => {
              onOpenRepository();
              closeDropdown();
            }}
            onMouseEnter={() => setHighlightedIndex(openRepoIndex)}
            className={`
              flex items-center gap-2.5 mx-2 px-3 py-2.5 cursor-pointer rounded-lg
              text-sm transition-colors duration-75
              border border-dashed
              ${
                highlightedIndex === openRepoIndex
                  ? "border-stone-600 bg-stone-800/50 text-stone-200"
                  : "border-stone-800/60 text-stone-400 hover:bg-stone-800/30"
              }
            `}
          >
            <svg
              className="h-3.5 w-3.5 text-stone-500 shrink-0"
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
            <span>Open Repository…</span>
            <kbd className="ml-auto text-2xs text-stone-600 font-mono">
              {"\u2318"}O
            </kbd>
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  );
});
