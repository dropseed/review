import { useCallback, useMemo } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReviewStore } from "../../stores";
import { SimpleTooltip } from "../ui/tooltip";
import { getPlatformServices } from "../../platform";
import { calculateFileHunkStatus } from "../FilesPanel/FileTree.utils";

/**
 * Shared narrative markdown renderer.
 * Handles review:// links, file status indicators, and external links.
 */
export function NarrativeContent({
  content,
  className = "guide-prose text-xs text-fg-secondary",
  onBeforeNavigate,
}: {
  content: string;
  className?: string;
  onBeforeNavigate?: () => void;
}) {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const lastClickedNarrativeLinkOffset = useReviewStore(
    (s) => s.lastClickedNarrativeLinkOffset,
  );
  const setLastClickedNarrativeLinkOffset = useReviewStore(
    (s) => s.setLastClickedNarrativeLinkOffset,
  );
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);

  const fileHunkStatusMap = useMemo(
    () =>
      calculateFileHunkStatus(hunks, reviewState, {
        autoApproveStaged: reviewState?.autoApproveStaged,
        stagedFilePaths,
      }),
    [hunks, reviewState, stagedFilePaths],
  );

  const handleNavigate = useCallback(
    (offset: number, filePath: string, hunkId?: string, line?: number) => {
      onBeforeNavigate?.();
      setLastClickedNarrativeLinkOffset(offset);
      navigateToBrowse(filePath);
      if (hunkId) {
        const hunkIndex = hunks.findIndex((h) => h.id === hunkId);
        if (hunkIndex >= 0) {
          useReviewStore.setState({ focusedHunkIndex: hunkIndex });
        }
      } else if (line) {
        useReviewStore.setState({
          scrollToLine: { filePath, lineNumber: line },
        });
      }
    },
    [
      navigateToBrowse,
      hunks,
      setLastClickedNarrativeLinkOffset,
      onBeforeNavigate,
    ],
  );

  const markdownComponents = useMemo(
    () => ({
      a: ({
        href,
        children,
        node,
      }: {
        href?: string;
        children?: React.ReactNode;
        node?: { position?: { start: { offset?: number } } };
      }) => {
        if (href?.startsWith("review://")) {
          const url = new URL(href.replace("review://", "http://placeholder/"));
          const filePath = url.pathname.slice(1);
          const hunkId = url.searchParams.get("hunk") || undefined;
          const lineParam = url.searchParams.get("line");
          const line = lineParam ? parseInt(lineParam, 10) : undefined;
          const offset = node?.position?.start?.offset ?? -1;
          const isActive = lastClickedNarrativeLinkOffset === offset;
          const childText = typeof children === "string" ? children : "";
          const fileName = filePath.split("/").pop() ?? "";
          const needsTooltip = childText !== filePath && childText !== fileName;

          // File hunk status indicator
          let indicator: React.ReactNode = null;
          const fileStatus = fileHunkStatusMap.get(filePath);
          if (fileStatus && fileStatus.total > 0) {
            const reviewed =
              fileStatus.approved + fileStatus.trusted + fileStatus.rejected;
            const allDone = reviewed === fileStatus.total;
            indicator = (
              <span
                className={`inline-flex items-center ml-1 text-2xs tabular-nums ${allDone ? "text-status-approved/70" : "text-fg0"}`}
              >
                {allDone ? (
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                  </svg>
                ) : (
                  `${reviewed}/${fileStatus.total}`
                )}
              </span>
            );
          }

          const link = (
            <button
              onClick={() => handleNavigate(offset, filePath, hunkId, line)}
              className={
                isActive
                  ? "text-blue-200 bg-blue-500/25 rounded-sm cursor-pointer"
                  : "text-blue-400 hover:text-blue-300 underline underline-offset-2 cursor-pointer"
              }
            >
              {children}
              {indicator}
            </button>
          );
          if (needsTooltip) {
            return (
              <SimpleTooltip content={filePath} side="bottom">
                {link}
              </SimpleTooltip>
            );
          }
          return link;
        }
        return (
          <button
            onClick={() => {
              if (href) {
                getPlatformServices().opener.openUrl(href);
              }
            }}
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2 cursor-pointer"
          >
            {children}
          </button>
        );
      },
    }),
    [handleNavigate, lastClickedNarrativeLinkOffset, fileHunkStatusMap],
  );

  return (
    <div className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          url.startsWith("review://") ? url : defaultUrlTransform(url)
        }
        components={markdownComponents}
      >
        {content}
      </Markdown>
    </div>
  );
}
