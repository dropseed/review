import { memo, useMemo } from "react";
import { useReviewStore } from "../../stores";
import type { DiffViewMode } from "../../stores/slices/preferencesSlice";
import { Breadcrumbs } from "../Breadcrumbs";
import { getPlatformServices } from "../../platform";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { SimpleTooltip } from "../ui/tooltip";
import { isMarkdownFile, type SupportedLanguages } from "./languageMap";
import { LanguageSelector } from "./LanguageSelector";
import { DiffOptionsPopover } from "./DiffOptionsPopover";
import { SimilarFilesModal } from "./annotations/SimilarFilesModal";

interface ToggleButtonGroupProps<T extends string> {
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
}

function ToggleButtonGroup<T extends string>({
  options,
  value,
  onChange,
}: ToggleButtonGroupProps<T>): JSX.Element {
  return (
    <div className="flex items-center rounded bg-stone-800/30 p-0.5">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          onClick={() => onChange(optionValue)}
          className={`rounded px-2 py-0.5 text-xxs font-medium transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
            value === optionValue
              ? "bg-stone-700/50 text-stone-200"
              : "text-stone-500 hover:text-stone-300"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const MARKDOWN_VIEW_OPTIONS: ["preview" | "code", string][] = [
  ["preview", "Preview"],
  ["code", "Code"],
];

const SVG_VIEW_OPTIONS: ["rendered" | "code", string][] = [
  ["rendered", "Rendered"],
  ["code", "Code"],
];

const DIFF_VIEW_OPTIONS: [DiffViewMode, string][] = [
  ["unified", "Unified"],
  ["split", "Split"],
  ["old", "Old"],
  ["new", "New"],
];

interface FileViewerToolbarProps {
  filePath: string;
  hasChanges: boolean;
  isUntracked: boolean;
  isImage: boolean;
  isSvg: boolean;
  hasImageDataUrl: boolean;
  showImageViewer: boolean;
  reviewProgress: { reviewed: number; total: number };
  effectiveLanguage: SupportedLanguages | undefined;
  detectedLanguage: SupportedLanguages | undefined;
  isLanguageOverridden: boolean;
  markdownViewMode: "preview" | "code";
  svgViewMode: "rendered" | "code";
  onLanguageChange: (lang: SupportedLanguages | undefined) => void;
  onMarkdownViewModeChange: (mode: "preview" | "code") => void;
  onSvgViewModeChange: (mode: "rendered" | "code") => void;
  onClearHighlight: () => void;
  onAddFileComment?: () => void;
}

export const FileViewerToolbar = memo(function FileViewerToolbar({
  filePath,
  hasChanges,
  isUntracked,
  isImage,
  isSvg,
  hasImageDataUrl,
  showImageViewer,
  reviewProgress,
  effectiveLanguage,
  detectedLanguage,
  isLanguageOverridden,
  markdownViewMode,
  svgViewMode,
  onLanguageChange,
  onMarkdownViewModeChange,
  onSvgViewModeChange,
  onClearHighlight,
  onAddFileComment,
}: FileViewerToolbarProps) {
  const repoPath = useReviewStore((s) => s.repoPath);
  const revealDirectoryInTree = useReviewStore((s) => s.revealDirectoryInTree);
  const approveAllFileHunks = useReviewStore((s) => s.approveAllFileHunks);
  const rejectAllFileHunks = useReviewStore((s) => s.rejectAllFileHunks);
  const viewMode = useReviewStore((s) => s.diffViewMode);
  const setViewMode = useReviewStore((s) => s.setDiffViewMode);
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);
  const rejectHunkIds = useReviewStore((s) => s.rejectHunkIds);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  // Count other files sharing this basename for the SimilarFilesModal trigger
  const basename = filePath.split("/").pop() ?? "";
  const matchingFileCount = useMemo(() => {
    const seen = new Set<string>();
    for (const h of hunks) {
      const name = h.filePath.split("/").pop();
      if (name === basename && h.filePath !== filePath) {
        seen.add(h.filePath);
      }
    }
    return seen.size;
  }, [hunks, basename, filePath]);

  const fullPath = `${repoPath}/${filePath}`;

  const handleCopyPath = async () => {
    const platform = getPlatformServices();
    await platform.clipboard.writeText(fullPath);
  };

  const handleReveal = async () => {
    const platform = getPlatformServices();
    await platform.opener.revealItemInDir(fullPath);
  };

  const handleOpenInEditor = async () => {
    try {
      const platform = getPlatformServices();
      await platform.opener.openPath(fullPath);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  const handleDiffViewModeChange = (mode: DiffViewMode) => {
    setViewMode(mode);
    onClearHighlight();
  };

  function renderFileStatusBadge(): JSX.Element | null {
    if (isUntracked) {
      return (
        <>
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xxs font-medium text-emerald-400">
            New
          </span>
          {matchingFileCount > 0 && (
            <SimilarFilesModal
              currentFilePath={filePath}
              hunks={hunks}
              hunkStates={reviewState?.hunks ?? {}}
              trustList={reviewState?.trustList ?? []}
              onApproveAll={approveHunkIds}
              onRejectAll={rejectHunkIds}
              onNavigateToFile={navigateToBrowse}
            />
          )}
        </>
      );
    }

    if (!hasChanges) {
      return null;
    }

    const isComplete = reviewProgress.reviewed === reviewProgress.total;
    const badgeClass = isComplete
      ? "bg-emerald-500/15 text-emerald-300"
      : "bg-amber-500/15 text-amber-300";

    return (
      <>
        <span
          className={`rounded px-1.5 py-0.5 text-xxs font-medium tabular-nums ${badgeClass}`}
        >
          {reviewProgress.reviewed}/{reviewProgress.total} reviewed
        </span>
        {!isComplete && (
          <SimpleTooltip content="Approve all hunks in this file">
            <button
              onClick={() => approveAllFileHunks(filePath)}
              className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xxs font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors"
            >
              Approve
            </button>
          </SimpleTooltip>
        )}
        {matchingFileCount > 0 && (
          <SimilarFilesModal
            currentFilePath={filePath}
            hunks={hunks}
            hunkStates={reviewState?.hunks ?? {}}
            trustList={reviewState?.trustList ?? []}
            onApproveAll={approveHunkIds}
            onRejectAll={rejectHunkIds}
            onNavigateToFile={navigateToBrowse}
          />
        )}
      </>
    );
  }

  const showDiffControls =
    !isImage && !showImageViewer && !isUntracked && hasChanges;

  return (
    <div className="flex items-center justify-between border-b border-stone-800/50 bg-stone-900 px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <Breadcrumbs
          filePath={filePath}
          onNavigateToDirectory={revealDirectoryInTree}
        />
        {!isImage && !hasChanges && (
          <LanguageSelector
            language={effectiveLanguage}
            detectedLanguage={detectedLanguage}
            isOverridden={isLanguageOverridden}
            onLanguageChange={onLanguageChange}
          />
        )}
        {renderFileStatusBadge()}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded p-1 text-stone-500 hover:bg-stone-700 hover:text-stone-300 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/50"
              aria-label="More options"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
                />
              </svg>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleCopyPath}>
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy path
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleReveal}>
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              Reveal in Finder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleOpenInEditor}>
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
              Open in editor
            </DropdownMenuItem>
            {onAddFileComment && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onAddFileComment}>
                  <svg
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
                    />
                  </svg>
                  Comment on file
                </DropdownMenuItem>
              </>
            )}
            {hasChanges && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => rejectAllFileHunks(filePath)}>
                  <svg
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                    />
                  </svg>
                  Reject all hunks
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-2">
        {isMarkdownFile(filePath) && (
          <ToggleButtonGroup
            options={MARKDOWN_VIEW_OPTIONS}
            value={markdownViewMode}
            onChange={onMarkdownViewModeChange}
          />
        )}
        {isSvg && hasImageDataUrl && (
          <ToggleButtonGroup
            options={SVG_VIEW_OPTIONS}
            value={svgViewMode}
            onChange={onSvgViewModeChange}
          />
        )}
        {showDiffControls && (
          <>
            <ToggleButtonGroup
              options={DIFF_VIEW_OPTIONS}
              value={viewMode}
              onChange={handleDiffViewModeChange}
            />
            <DiffOptionsPopover />
          </>
        )}
      </div>
    </div>
  );
});
