import type { MutableRefObject } from "react";
import type { DiffHunk, HunkState } from "../../../types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../ui/dropdown-menu";

interface TrustedHunkBadgeProps {
  hunk: DiffHunk;
  hunkState: HunkState | undefined;
  focusedHunkId: string | null | undefined;
  focusedHunkRef: MutableRefObject<HTMLDivElement | null>;
  trustList: string[];
  onApprove: (hunkId: string) => void;
  onReject: (hunkId: string) => void;
  onRemoveTrustPattern: (pattern: string) => void;
  onCopyHunk: (hunk: DiffHunk) => void;
}

export function TrustedHunkBadge({
  hunk,
  hunkState,
  focusedHunkId,
  focusedHunkRef,
  trustList,
  onApprove,
  onReject,
  onRemoveTrustPattern,
  onCopyHunk,
}: TrustedHunkBadgeProps) {
  const isFocused = hunk.id === focusedHunkId;
  const labels = hunkState?.label ?? [];
  const trustedLabels = labels.filter((lbl) => trustList.includes(lbl));

  return (
    <div
      data-hunk-id={hunk.id}
      ref={isFocused ? focusedHunkRef : undefined}
      className={`flex items-center gap-2 px-3 py-1 mx-2 my-1 rounded-md transition-[border-color,box-shadow] duration-150 ${
        isFocused
          ? "border border-edge-strong/40 ring-1 ring-fg/15 bg-status-renamed/5"
          : "border border-transparent bg-status-renamed/[0.03]"
      }`}
    >
      {/* Shield icon */}
      <svg
        className="h-3 w-3 shrink-0 text-status-renamed/60"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>

      {/* Trust label pills */}
      <div className="flex items-center gap-1">
        {trustedLabels.map((lbl, i) => (
          <span
            key={i}
            className="rounded px-1.5 py-0.5 text-xxs font-medium bg-status-renamed/10 text-status-renamed/60"
          >
            {lbl}
          </span>
        ))}
      </div>

      {/* Dropdown with actions */}
      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded p-0.5 text-fg-faint hover:bg-surface-hover hover:text-fg-muted transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring/50"
              aria-label="Trusted hunk options"
            >
              <svg
                className="h-3.5 w-3.5"
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
            {trustedLabels.map((lbl) => (
              <DropdownMenuItem
                key={lbl}
                onClick={() => onRemoveTrustPattern(lbl)}
              >
                <svg
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                  />
                </svg>
                Untrust "{lbl}"
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={() => onApprove(hunk.id)}>
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Approve anyway
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onReject(hunk.id)}>
              <svg
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
              Reject
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCopyHunk(hunk)}>
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy hunk
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
