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
