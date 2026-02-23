import { useCallback, type RefObject } from "react";

/**
 * Compute the new value and cursor position for list continuation.
 * When Enter is pressed on a line starting with "- ", continues the list.
 * When Enter is pressed on an empty bullet "- ", removes it.
 */
function computeListContinuation(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): { value: string; cursor: number } | null {
  if (selectionStart !== selectionEnd) return null;

  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const currentLine = value.substring(lineStart, selectionStart);
  const match = currentLine.match(/^(\s*- )/);
  if (!match) return null;

  const prefix = match[1];
  const contentAfterPrefix = currentLine.substring(prefix.length);

  // Empty bullet — remove it instead of continuing
  if (!contentAfterPrefix.trim()) {
    const before = value.substring(0, lineStart);
    const after = value.substring(selectionStart);
    return { value: before + after, cursor: lineStart };
  }

  // Continue the list
  const insertion = "\n" + prefix;
  return {
    value:
      value.substring(0, selectionStart) +
      insertion +
      value.substring(selectionEnd),
    cursor: selectionStart + insertion.length,
  };
}

/**
 * Returns an onKeyDown handler that auto-continues "- " list items on Enter.
 * Pressing Enter on an empty bullet removes it.
 */
export function useListContinuation(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  setValue: (value: string) => void,
) {
  return useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey)
        return;

      const ta = e.currentTarget;
      const result = computeListContinuation(
        ta.value,
        ta.selectionStart,
        ta.selectionEnd,
      );
      if (!result) return;

      e.preventDefault();
      setValue(result.value);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart =
            textareaRef.current.selectionEnd = result.cursor;
        }
      });
    },
    [textareaRef, setValue],
  );
}
