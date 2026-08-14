/**
 * Shared trailing-edge chrome for sidebar rows.
 *
 * The hover actions used to be grid-stacked with the status indicator so the
 * right edge wouldn't shift when they appeared. But `opacity-0` still occupies
 * layout, so every row permanently reserved the actions' width and labels
 * ellipsized well before they ran out of room. Absolutely positioning the
 * actions buys the same no-shift behaviour and hands the label the full row.
 */

/**
 * Hover-revealed actions, overlaid on the row's trailing edge.
 *
 * Anchored to the left edge of the row's status cluster (`ROW_STATUS`, which
 * must be the positioning parent) rather than to the row itself, so the two
 * never occupy the same pixels. They used to: the status faded out on hover to
 * make room, which works for the inert markers but not for the terminal badge,
 * whose popover opens on *click* — the pointer has to be on the row to reach
 * it, so fading on hover meant it could never be opened at all. What the
 * actions cover instead is the tail of the label, which already fades for them
 * (`ROW_LABEL_HOVER_FADE`).
 */
export const ROW_ACTIONS =
  "absolute right-full top-1/2 -translate-y-1/2 mr-1.5 flex items-center gap-0.5 transition-opacity duration-100";

/**
 * The status cluster at the row's trailing edge: the positioning parent for
 * `ROW_ACTIONS`, and never faded — see above.
 */
export const ROW_STATUS = "relative flex shrink-0 items-center gap-1.5";

/**
 * Fades a label out where the overlaid actions sit. Apply only to a label that
 * *stretches* to the trailing edge (`flex-1`): the mask is measured against the
 * element box, so a stretched label fades only once its text actually runs that
 * far, while a shrink-to-fit one would fade its last word unconditionally.
 *
 * A mask rather than a background gradient: rows tint on hover and again when
 * active, so there is no single colour that could be painted behind the text
 * without leaving a visible seam. Masking the text is background-agnostic.
 */
export const ROW_LABEL_HOVER_FADE =
  "group-hover:[mask-image:linear-gradient(to_right,#000_calc(100%_-_1.5rem),transparent)]";

/**
 * The "M" working-tree-changes hint. A status note about the row, not a peer of
 * its name — deliberately below the `text-xs` label rather than level with it.
 */
export const ROW_MODIFIED_BADGE = "text-xxs text-status-modified/80";

/**
 * The keyboard half of a row's click.
 *
 * Every row in this sidebar is a `div role="button"` — `draggable` on a real
 * button is where webviews disagree about whether a drag starts at all — so
 * each one has to restore the Enter/Space activation the element it isn't
 * would have given it for free.
 */
export function activateOnKey(
  activate: () => void,
): (event: React.KeyboardEvent) => void {
  return (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };
}
