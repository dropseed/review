import { useReviewStore } from "../stores";

declare global {
  interface Window {
    __reviewStore?: typeof useReviewStore;
  }
}

/**
 * Dev-mode escape hatch: reach the store from the browser console (and from
 * automation driving web mode, where some backends — terminals — don't exist
 * to produce state the UI can be exercised against). Never present in release.
 *
 * Installed from the entry point rather than `stores/index.ts` so that module
 * stays free of side effects — every component and every store-touching unit
 * test imports it.
 */
export function installDevtools(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  window.__reviewStore = useReviewStore;
}
