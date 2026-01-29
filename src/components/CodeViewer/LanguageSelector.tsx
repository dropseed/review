import { useState, useRef, useCallback } from "react";
import type { SupportedLanguages } from "./languageMap";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { SimpleTooltip } from "../ui/tooltip";
import { Input } from "../ui/input";

// Human-readable display names for languages
export const languageDisplayNames: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  go: "Go",
  java: "Java",
  kotlin: "Kotlin",
  swift: "Swift",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  php: "PHP",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  json: "JSON",
  yaml: "YAML",
  xml: "XML",
  markdown: "Markdown",
  sql: "SQL",
  bash: "Shell",
  dockerfile: "Dockerfile",
  toml: "TOML",
  ini: "INI",
  vue: "Vue",
  svelte: "Svelte",
  graphql: "GraphQL",
  makefile: "Makefile",
  cmake: "CMake",
  perl: "Perl",
};

// Get sorted list of all language options
const languageOptions = Object.entries(languageDisplayNames)
  .map(([key, label]) => ({ key, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

interface LanguageSelectorProps {
  /** The currently active language (either detected or overridden) */
  language: SupportedLanguages | undefined;
  /** The auto-detected language from the file */
  detectedLanguage: SupportedLanguages | undefined;
  /** Whether the language is currently overridden */
  isOverridden: boolean;
  /** Callback when user selects a language (undefined = reset to auto) */
  onLanguageChange: (language: SupportedLanguages | undefined) => void;
}

export function LanguageSelector({
  language,
  detectedLanguage,
  isOverridden,
  onLanguageChange,
}: LanguageSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const displayName = language
    ? languageDisplayNames[language] || language
    : null;

  const detectedDisplayName = detectedLanguage
    ? languageDisplayNames[detectedLanguage] || detectedLanguage
    : null;

  // Filter languages based on search query
  const filteredLanguages = searchQuery
    ? languageOptions.filter(
        (opt) =>
          opt.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          opt.key.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : languageOptions;

  const handleSelect = useCallback(
    (langKey: SupportedLanguages | undefined) => {
      onLanguageChange(langKey);
      setIsOpen(false);
      setSearchQuery("");
    },
    [onLanguageChange],
  );

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setSearchQuery("");
    }
  }, []);

  if (!displayName && !detectedLanguage) return null;

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      {/* Badge button */}
      <SimpleTooltip
        content={
          isOverridden
            ? `Language override: ${displayName} (click to change)`
            : `Detected: ${displayName} (click to override)`
        }
      >
        <PopoverTrigger asChild>
          <button
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xxs font-medium transition-colors ${
              isOverridden
                ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25"
                : "bg-stone-800/60 text-stone-400 hover:bg-stone-700/60"
            }`}
          >
            <svg
              className="h-2.5 w-2.5 text-stone-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            {isOverridden ? displayName : `Auto (${displayName})`}
            <svg
              className={`h-2.5 w-2.5 text-stone-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </PopoverTrigger>
      </SimpleTooltip>

      <PopoverContent
        className="w-48 p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchInputRef.current?.focus();
        }}
      >
        {/* Search input */}
        <div className="border-b border-stone-700 p-1.5">
          <Input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search languages..."
            className="rounded bg-stone-900/50 py-1 text-xs focus:ring-1 focus:ring-amber-500/50"
          />
        </div>

        {/* Options list */}
        <div className="max-h-64 overflow-y-auto scrollbar-thin p-1">
          {/* Auto-detect option */}
          {detectedLanguage && (
            <>
              <button
                onClick={() => handleSelect(undefined)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
                  !isOverridden
                    ? "bg-amber-500/15 text-amber-400"
                    : "text-stone-300 hover:bg-stone-700"
                }`}
              >
                <span className="flex-1 text-left">
                  Auto ({detectedDisplayName})
                </span>
                {!isOverridden && (
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
              <div className="my-1 border-t border-stone-700" />
            </>
          )}

          {/* Language options */}
          {filteredLanguages.length > 0 ? (
            filteredLanguages.map((opt) => (
              <button
                key={opt.key}
                onClick={() => handleSelect(opt.key as SupportedLanguages)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
                  isOverridden && language === opt.key
                    ? "bg-amber-500/15 text-amber-400"
                    : "text-stone-300 hover:bg-stone-700"
                }`}
              >
                <span className="flex-1 text-left">{opt.label}</span>
                {isOverridden && language === opt.key && (
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))
          ) : (
            <div className="px-2 py-3 text-center text-xs text-stone-500">
              No languages found
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
