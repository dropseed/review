import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { useReviewStore } from "../../stores/reviewStore";
import { RollingFileSection } from "./RollingFileSection";

export function RollingDiffView() {
  const { hunks, scrollToFileInRolling, setScrollToFileInRolling } =
    useReviewStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const fileSectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [visibleFiles, setVisibleFiles] = useState<Set<string>>(new Set());

  // Get unique file paths from hunks, preserving order
  const changedFiles = useMemo(() => {
    const seen = new Set<string>();
    const files: string[] = [];
    for (const hunk of hunks) {
      if (!seen.has(hunk.filePath)) {
        seen.add(hunk.filePath);
        files.push(hunk.filePath);
      }
    }
    return files;
  }, [hunks]);

  // Setup IntersectionObserver for lazy loading
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const updates: { path: string; visible: boolean }[] = [];
        for (const entry of entries) {
          const path = entry.target.getAttribute("data-filepath");
          if (path) {
            updates.push({ path, visible: entry.isIntersecting });
          }
        }
        if (updates.length > 0) {
          setVisibleFiles((prev) => {
            const next = new Set(prev);
            for (const { path, visible } of updates) {
              if (visible) {
                next.add(path);
              }
              // Don't remove from visible set - keeps content loaded once visible
            }
            return next;
          });
        }
      },
      {
        root: containerRef.current,
        rootMargin: "200px 0px", // Load content 200px before it enters viewport
        threshold: 0,
      },
    );

    // Observe all file sections
    fileSectionRefs.current.forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [changedFiles]);

  // Handle scroll-to-file requests (from file tree clicks)
  useEffect(() => {
    if (scrollToFileInRolling) {
      const el = fileSectionRefs.current.get(scrollToFileInRolling);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      setScrollToFileInRolling(null);
    }
  }, [scrollToFileInRolling, setScrollToFileInRolling]);

  // Register ref for a file section
  const registerRef = useCallback((path: string, el: HTMLDivElement | null) => {
    if (el) {
      fileSectionRefs.current.set(path, el);
    } else {
      fileSectionRefs.current.delete(path);
    }
  }, []);

  if (changedFiles.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <svg
          className="h-12 w-12 text-stone-700"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-sm text-stone-500">No files to review</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto scrollbar-thin">
      {changedFiles.map((filePath) => (
        <RollingFileSection
          key={filePath}
          ref={(el) => registerRef(filePath, el)}
          filePath={filePath}
          isVisible={visibleFiles.has(filePath)}
        />
      ))}
    </div>
  );
}
