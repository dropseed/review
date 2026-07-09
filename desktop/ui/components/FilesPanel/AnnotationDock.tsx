import { type ReactNode, useState } from "react";
import { useFeedbackPanel, useFindingsPanel } from "../../hooks";
import { ReviewNotesPanel } from "./ReviewNotesPanel";
import { ReviewCommentsPanel } from "./ReviewCommentsPanel";
import { ReviewFindingsPanel } from "./ReviewFindingsPanel";

type DockPanel = "notes" | "comments" | "findings";

const NOTES_ICON = (
  <svg
    className="h-3.5 w-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
);

const COMMENTS_ICON = (
  <svg
    className="h-3.5 w-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
  </svg>
);

const FINDINGS_ICON = (
  <svg
    className="h-3.5 w-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
  </svg>
);

interface DockButtonProps {
  icon: ReactNode;
  label: string;
  count?: number;
  isOpen: boolean;
  onClick: () => void;
}

function DockButton({
  icon,
  label,
  count,
  isOpen,
  onClick,
}: DockButtonProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isOpen}
      className={`flex flex-1 items-center justify-center gap-1.5 py-1.5 text-xs font-medium transition-colors ${
        isOpen
          ? "bg-surface-raised text-fg-secondary"
          : "text-fg-muted hover:bg-surface-raised/50 hover:text-fg-secondary"
      }`}
    >
      {icon}
      {label}
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-status-modified/20 px-1.5 py-0.5 text-xxs font-medium tabular-nums text-status-modified">
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * Notes / Comments / Findings, docked at the bottom of the sidebar instead
 * of stacked into the queue's scroll column. Only one panel is expanded at a
 * time — clicking a strip button (or the active one again) swaps or
 * collapses it; the panel itself pushes up above the strip rather than
 * overlaying the queue, which keeps everything reachable without a portal.
 */
export function AnnotationDock(): ReactNode {
  const [openPanel, setOpenPanel] = useState<DockPanel | null>(null);
  const { openComments } = useFeedbackPanel();
  const { openFindings } = useFindingsPanel();

  const toggle = (panel: DockPanel) =>
    setOpenPanel((prev) => (prev === panel ? null : panel));

  return (
    <div className="shrink-0 border-t border-edge/40">
      {openPanel && (
        <div className="max-h-72 overflow-y-auto scrollbar-thin border-b border-edge/40">
          {openPanel === "notes" && <ReviewNotesPanel />}
          {openPanel === "comments" && <ReviewCommentsPanel />}
          {openPanel === "findings" && <ReviewFindingsPanel />}
        </div>
      )}
      <div className="flex items-stretch">
        <DockButton
          icon={NOTES_ICON}
          label="Notes"
          isOpen={openPanel === "notes"}
          onClick={() => toggle("notes")}
        />
        <DockButton
          icon={COMMENTS_ICON}
          label="Comments"
          count={openComments.length}
          isOpen={openPanel === "comments"}
          onClick={() => toggle("comments")}
        />
        <DockButton
          icon={FINDINGS_ICON}
          label="Findings"
          count={openFindings.length}
          isOpen={openPanel === "findings"}
          onClick={() => toggle("findings")}
        />
      </div>
    </div>
  );
}
