import type { ReactNode } from "react";
import { CheckIcon } from "../ui/icons";
import { DropdownMenuItem } from "../ui/dropdown-menu";
import { useReviewStore } from "../../stores";
import type { FileSortOrder } from "../../stores/slices/preferencesSlice";

export const SORT_LABELS: Record<FileSortOrder, string> = {
  name: "Name",
  size: "Size",
  modified: "Last modified",
};

export const SELECTED_CHECK = (
  <CheckIcon className="h-3 w-3 text-fg-secondary" />
);

const SORT_ORDERS = ["name", "size", "modified"] as const;

/**
 * The sort-order rows of a files-panel overflow menu.
 *
 * Reads the preference itself rather than taking it as a prop: both call sites
 * (`FilesPanel`, `StatusGroupList`) drop these items into a `menuContent`
 * fragment and both already held the same two store bindings to build them.
 */
export function SortMenuItems(): ReactNode {
  const fileSortOrder = useReviewStore((s) => s.fileSortOrder);
  const setFileSortOrder = useReviewStore((s) => s.setFileSortOrder);

  return (
    <>
      {SORT_ORDERS.map((order) => (
        <DropdownMenuItem key={order} onClick={() => setFileSortOrder(order)}>
          <span className="flex-1">{SORT_LABELS[order]}</span>
          {fileSortOrder === order && SELECTED_CHECK}
        </DropdownMenuItem>
      ))}
    </>
  );
}
