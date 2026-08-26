import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { getApiClient } from "../../api";
import { useAutoGrow } from "../../hooks";
import { useReviewStore } from "../../stores";
import { sendChar } from "./registry";
import { isCtrlArmed } from "./soft-keys";
import { Key } from "./SoftKeys";
import { submitComposed } from "./compose-send";

/**
 * The phone's way of saying something to the shell.
 *
 * Typing into the terminal itself on iOS means typing into xterm's hidden
 * textarea, and that is a bad place to write prose: autocorrect fights a
 * one-character-at-a-time input it cannot see, there is no way to put the
 * cursor back three words, and the keyboard covers the prompt you are aiming
 * at. A real `<textarea>` is a text field the phone already knows how to
 * drive — selection, dictation, autocorrect, a Send key — and what leaves it
 * is a finished sentence rather than a stream of keystrokes.
 *
 * It is a *compose* box, not an input mode: the terminal above still takes
 * taps and the key bar below still sends raw keys, so reading a running agent
 * and answering it are the same screen. Nothing here replaces the terminal for
 * a shell you are typing commands into — it replaces it for the case this app
 * is on a phone for, which is talking to an agent.
 *
 * Compact/touch only. At a desk there is a keyboard, and the terminal is the
 * right place to type into.
 */
export function ComposeBar({ terminalId }: { terminalId: string }): ReactNode {
  const [text, setText] = useState("");
  // A send is two writes with a delay between them (see compose-send). A
  // second send starting inside that gap would interleave its text with the
  // first one's Enter, so the box holds still until the first lands.
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const dead = useReviewStore((s) => terminalId in s.terminalExited);
  const empty = text.trim() === "";

  // Five rows of *this* box's type. Measured rather than declared in CSS, and
  // measured once: nothing the app can do changes the answer — the field's size
  // is pinned at `max(1rem, 16px)` so iOS never zooms the page on focus, which
  // is deliberately the one bit of type no preference reaches.
  // Keyed on `dead` because that is when the box exists to be measured: a bar
  // that first rendered over an exited shell rendered no textarea at all.
  const [maxPx, setMaxPx] = useState(0);
  useLayoutEffect(() => {
    if (box.current) setMaxPx(maxHeight(box.current));
  }, [dead]);
  useAutoGrow(box, maxPx, text);

  const send = () => {
    if (sending || empty) return;
    const value = text;
    setText("");
    setSending(true);
    void submitComposed(getApiClient(), terminalId, value)
      .catch((err: unknown) => {
        console.error("[terminal] Compose send failed:", err);
      })
      .finally(() => {
        setSending(false);
        // Stay where the person is: the keyboard must not drop, and focus must
        // not fall back into xterm — the next thing typed belongs here too.
        box.current?.focus();
      });
  };

  // A shell that has exited takes no input, and a compose box aimed at one is
  // an invitation to type into nothing.
  if (dead) return null;

  return (
    <div className="flex shrink-0 items-end gap-1 border-t border-t-edge/40 px-1 pt-1">
      <textarea
        ref={box}
        value={text}
        rows={1}
        placeholder="Message…"
        aria-label="Message this terminal"
        // Prose, not code: this is the one field in the app where the phone's
        // own text handling is the point.
        autoCorrect="on"
        autoCapitalize="sentences"
        spellCheck
        // The return key says what it does. iOS still delivers a keydown for
        // it, which is where the send below is hung.
        enterKeyHint="send"
        onChange={(e) => setText(e.target.value)}
        onFocus={keepPageAtTop}
        onBeforeInput={(e) => {
          // The key bar's ⌃ is a modifier on the *next* character, and while
          // this box has focus the next character arrives here rather than in
          // xterm's `onData`. Intercept it so ⌃C from a phone still interrupts
          // the agent instead of typing a "c" into the draft.
          if (!isCtrlArmed()) return;
          const data = e.data;
          if (data === null || data.length !== 1) return;
          e.preventDefault();
          sendChar(terminalId, data);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // A hardware keyboard's Shift+Enter is the newline — the software
          // keyboard has no such chord, which is what the auto-grow is for.
          if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
          // Mid-composition (IME, and iOS dictation) Enter belongs to the
          // candidate window, not to us.
          if (e.nativeEvent.isComposing) return;
          e.preventDefault();
          send();
        }}
        className={clsx(
          // The same 44px the keys below are, so the row is one height and the
          // field is as easy to hit as they are.
          `min-h-11 min-w-0 flex-1 resize-none rounded-md bg-fg/[0.06] px-2 py-2
           leading-snug text-fg placeholder:text-fg-faint
           focus:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring`,
          // At least 16px, whatever the UI scale is: below that iOS zooms the
          // whole page in on focus and leaves it zoomed.
          "text-[max(1rem,16px)]",
          // Past the cap it scrolls; that scroll must not chain out to the app
          // shell, which on iOS is what slides the layout out from under the
          // keyboard.
          "overflow-y-auto overscroll-contain",
        )}
      />
      {/* The same key the row below is made of: it sits in the same thumb
          zone, keeps focus the same way, and is the accented one because it is
          the only one here that commits anything. */}
      <Key
        label="Send"
        title="Send (⏎)"
        ariaLabel="Send message"
        variant="accent"
        disabled={sending || empty}
        onPress={send}
      />
    </div>
  );
}

/** Five rows of whatever this box's own type is, plus its chrome. */
const MAX_ROWS = 5;

function maxHeight(el: HTMLTextAreaElement): number {
  const style = getComputedStyle(el);
  const line = Number.parseFloat(style.lineHeight);
  const padding =
    Number.parseFloat(style.paddingTop) +
    Number.parseFloat(style.paddingBottom);
  // `scrollHeight` counts padding but not border, and the box is border-box.
  const border =
    Number.parseFloat(style.borderTopWidth) +
    Number.parseFloat(style.borderBottomWidth);
  return line * MAX_ROWS + padding + border;
}

/**
 * Undo WebKit's scroll-into-view.
 *
 * iOS does not resize the layout viewport for its keyboard — it scrolls the
 * focused element into the visual one, and the document goes with it. The app
 * shell is exactly one viewport tall and has nothing to scroll, so any offset
 * that appears is the whole page slid off its own top, taking the tab strip
 * with it. Once now and once after the browser has had its frame.
 */
function keepPageAtTop(): void {
  window.scrollTo(0, 0);
  requestAnimationFrame(() => window.scrollTo(0, 0));
}
