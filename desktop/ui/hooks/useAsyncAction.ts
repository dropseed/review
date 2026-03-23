import { useState, useCallback, useRef } from "react";

/**
 * Hook for async actions with loading state and re-entrancy protection.
 * Returns [handler, isLoading] — the handler is stable (no deps on loading state).
 */
export function useAsyncAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<void>,
  label: string,
): [(...args: Args) => Promise<void>, boolean] {
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

  const handler = useCallback(
    async (...args: Args) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        await action(...args);
      } catch (err) {
        console.error(`Failed to ${label}:`, err);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [action, label],
  );

  return [handler, loading];
}
