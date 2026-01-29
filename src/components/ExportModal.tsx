import { useState, useEffect, useMemo } from "react";
import { getPlatformServices } from "../platform";
import type { Comparison, LineAnnotation, DiffHunk, HunkState } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  comparison: Comparison;
  hunks: DiffHunk[];
  hunkStates: Record<string, HunkState>;
  annotations: LineAnnotation[];
  notes: string;
}

export function ExportModal({
  isOpen,
  onClose,
  comparison,
  hunks,
  hunkStates,
  annotations,
  notes,
}: ExportModalProps) {
  const [copied, setCopied] = useState(false);

  // Reset copied state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCopied(false);
    }
  }, [isOpen]);

  // Calculate stats and generate markdown
  const { markdown, stats } = useMemo(() => {
    // Find rejected hunks
    const rejectedHunks = hunks.filter(
      (h) => hunkStates[h.id]?.status === "rejected",
    );
    const approvedCount = hunks.filter(
      (h) => hunkStates[h.id]?.status === "approved",
    ).length;
    const pendingCount = hunks.length - rejectedHunks.length - approvedCount;

    // Build markdown content
    const lines: string[] = [];

    lines.push("# Review Feedback");
    lines.push("");
    lines.push(`**Comparison:** ${comparison.key}`);
    lines.push(
      `**Status:** ${rejectedHunks.length} changes requested, ${approvedCount} approved, ${pendingCount} pending`,
    );
    lines.push("");

    // Changes Requested section
    if (rejectedHunks.length > 0) {
      lines.push("## Changes Requested");
      lines.push("");

      for (const hunk of rejectedHunks) {
        const lineRange =
          hunk.newStart === hunk.newStart + hunk.newCount - 1
            ? `${hunk.newStart}`
            : `${hunk.newStart}-${hunk.newStart + hunk.newCount - 1}`;

        lines.push(`### ${hunk.filePath}:${lineRange}`);
        lines.push("");
        lines.push("```diff");
        lines.push(hunk.content.trim());
        lines.push("```");
        lines.push("");
      }
    }

    // Annotations section
    if (annotations.length > 0) {
      lines.push("## Annotations");
      lines.push("");

      for (const annotation of annotations) {
        lines.push(
          `- **${annotation.filePath}:${annotation.lineNumber}** — ${annotation.content}`,
        );
      }
      lines.push("");
    }

    // Review Notes section
    if (notes.trim()) {
      lines.push("## Review Notes");
      lines.push("");
      lines.push(notes.trim());
      lines.push("");
    }

    return {
      markdown: lines.join("\n"),
      stats: {
        rejected: rejectedHunks.length,
        approved: approvedCount,
        pending: pendingCount,
        annotations: annotations.length,
        hasNotes: notes.trim().length > 0,
      },
    };
  }, [comparison, hunks, hunkStates, annotations, notes]);

  const handleCopy = async () => {
    const platform = getPlatformServices();
    await platform.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex w-full max-w-2xl max-h-[80vh] m-4 flex-col rounded-xl overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-4 py-3">
          <div>
            <DialogTitle>Export Review Feedback</DialogTitle>
            <DialogDescription className="mt-0.5">
              {comparison.key}
            </DialogDescription>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-500 hover:text-stone-300 hover:bg-stone-800 rounded transition-colors"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </DialogHeader>

        {/* Stats bar */}
        <div className="flex items-center gap-4 px-4 py-2 bg-stone-800/50 border-b border-stone-800 text-xs">
          {stats.rejected > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              <span className="text-stone-400">
                {stats.rejected} changes requested
              </span>
            </span>
          )}
          {stats.annotations > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-stone-400">
                {stats.annotations} annotations
              </span>
            </span>
          )}
          {stats.hasNotes && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              <span className="text-stone-400">Review notes</span>
            </span>
          )}
          {stats.rejected === 0 &&
            stats.annotations === 0 &&
            !stats.hasNotes && (
              <span className="text-stone-500">No feedback to export</span>
            )}
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="font-mono text-xs text-stone-300 whitespace-pre-wrap leading-relaxed">
            {markdown}
          </pre>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-stone-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded transition-colors"
          >
            Close
          </button>
          <button
            onClick={handleCopy}
            className={`px-4 py-1.5 text-xs font-medium rounded transition-all flex items-center gap-1.5 ${
              copied
                ? "bg-lime-500/20 text-lime-400 border border-lime-500/30"
                : "bg-amber-600 text-stone-100 hover:bg-amber-500"
            }`}
          >
            {copied ? (
              <>
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Copied!
              </>
            ) : (
              <>
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
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Copy to Clipboard
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
