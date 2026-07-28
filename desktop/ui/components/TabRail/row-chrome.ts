/**
 * Shared trailing-edge chrome for sidebar rows.
 *
 * The hover actions used to be grid-stacked with the status indicator so the
 * right edge wouldn't shift when they appeared. But `opacity-0` still occupies
 * layout, so every row permanently reserved the actions' width and labels
 * ellipsized well before they ran out of room. Absolutely positioning the
 * actions buys the same no-shift behaviour and hands the label the full row.
 */

/** Hover-revealed actions, overlaid on the row's trailing edge. */
export const ROW_ACTIONS =
  "absolute inset-y-0 right-2.5 flex items-center gap-0.5 transition-opacity duration-100";

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
