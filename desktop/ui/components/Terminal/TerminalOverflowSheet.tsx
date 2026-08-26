import { type ReactNode, useState } from "react";
import { useReviewStore } from "../../stores";
import {
  ActionSheet,
  ActionSheetRow,
  ActionSheetSeparator,
} from "../ui/action-sheet";
import { TERMINAL_FONT_SIZE_STEP } from "../../stores/slices/preferencesSlice";
import { useFocusedWorkspace } from "../../stores/selectors/workspaces";
import { applyTerminalFontSize } from "./TerminalTextSize";
import { closeTerminalPane } from "./close";
import { openTerminalTab } from "./newTab";
import { requestFit } from "./registry";

/**
 * Everything the terminal strip used to carry and no longer has room for.
 *
 * The strip on a phone is a scroll of session pills plus the two things you
 * reach for constantly — a new shell, and the code half. Text size and the
 * fit are neither: pinch-to-zoom is the gesture people actually use for the
 * first (see `touch-gestures`), and the second is a repair. Both belong one
 * tap deeper, in a sheet where they get a label and 44pt instead of a 20px
 * glyph competing with the tabs.
 *
 * "Kill terminal" is the one verb here from the desktop tab's own context
 * menu. Its other two are not: "Jump to terminal" names the screen you are
 * already looking at, and "Add to" is a submenu of every workspace in the
 * queue, which is a second sheet to answer a question a phone has a whole
 * drawer for.
 */
export function TerminalOverflowSheet({
  paneId,
}: {
  /** The pane the strip is showing — what "this terminal" means here. */
  paneId: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const fontSize = useReviewStore((s) => s.terminalFontSize);
  const workspace = useFocusedWorkspace();

  const step = (delta: number) =>
    applyTerminalFontSize(paneId, fontSize + delta);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="More terminal options"
        aria-haspopup="dialog"
        className="tap tap-target flex size-9 shrink-0 items-center justify-center
                   rounded-md text-fg-muted active:bg-surface-raised"
      >
        <svg
          className="size-5"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="5" cy="12" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>

      <ActionSheet open={open} onOpenChange={setOpen} title="Terminal">
        <ActionSheetRow
          label="Text size"
          detail={`${fontSize}pt`}
          trailing={
            <span className="flex shrink-0 items-center gap-1">
              <Stepper
                label="Smaller terminal text"
                glyph="−"
                onPress={() => step(-TERMINAL_FONT_SIZE_STEP)}
              />
              <Stepper
                label="Bigger terminal text"
                glyph="+"
                onPress={() => step(TERMINAL_FONT_SIZE_STEP)}
              />
            </span>
          }
        />
        {/* A resize of the grid every other client shares, which is why it is
            only ever a tap and never a side effect — see "One PTY grid" in the
            root CLAUDE.md. Offered unconditionally: a pane already at 1:1 fits
            to the same size it is, and a row that came and went with the scale
            would be a control nobody could find twice. */}
        <ActionSheetRow
          label="Fit to screen"
          onSelect={() => {
            setOpen(false);
            requestFit(paneId);
          }}
        />
        <ActionSheetSeparator />
        <ActionSheetRow
          label="New terminal"
          onSelect={() => {
            setOpen(false);
            void openTerminalTab(workspace);
          }}
        />
        <ActionSheetRow
          label="Close terminal"
          danger
          onSelect={() => {
            setOpen(false);
            void closeTerminalPane(paneId);
          }}
        />
      </ActionSheet>
    </>
  );
}

/** One half of a −/+ pair, sized for a thumb and labelled for everything else. */
function Stepper({
  label,
  glyph,
  onPress,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className="tap flex size-11 items-center justify-center rounded-lg
                 bg-fg/[0.06] text-[17px] leading-none text-fg-secondary
                 active:bg-fg/[0.14]"
    >
      {glyph}
    </button>
  );
}
