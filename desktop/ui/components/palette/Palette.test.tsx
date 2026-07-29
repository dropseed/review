import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useReviewStore } from "../../stores";
import { registerCommands } from "../../commands/registry";
import { APP_COMMANDS } from "../../commands/appCommands";
import { Palette } from "./Palette";
import type { PaletteMode } from "./modes";

const input = () => screen.getByRole("combobox") as HTMLInputElement;

/** The mode chip, which is the only place the current mode is spelled out. */
const chip = () => screen.getByText(/^(Files|Commands|Symbols|In Files)$/);

function open(mode: PaletteMode) {
  useReviewStore.setState({ activeOverlay: "palette", paletteMode: mode });
  render(<Palette />);
}

// The registry is populated by the router in the running app, so an isolated
// palette starts with nothing to list.
let unregister = () => {};

beforeEach(() => {
  unregister = registerCommands(APP_COMMANDS);
  useReviewStore.setState({
    activeOverlay: null,
    paletteMode: "commands",
    searchQuery: "",
  });
});

afterEach(() => {
  unregister();
  cleanup();
});

describe("mounting", () => {
  it("renders nothing until an overlay asks for it", () => {
    render(<Palette />);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("opens in the mode the shortcut asked for", () => {
    open("files");
    expect(chip().textContent).toBe("Files");
  });
});

describe("prefix modes", () => {
  it("switches mode on a prefix and does not keep the character", () => {
    open("files");
    fireEvent.change(input(), { target: { value: ">" } });
    expect(chip().textContent).toBe("Commands");
    expect(input().value).toBe("");
  });

  it("keeps the query as typed when it is not a prefix", () => {
    open("files");
    fireEvent.change(input(), { target: { value: "src" } });
    expect(chip().textContent).toBe("Files");
    expect(input().value).toBe("src");
  });

  /**
   * The way back out. A prefix is consumed rather than left in the box, so
   * there is no character to delete — without this, entering a mode by
   * mistake would strand the user there.
   */
  it("steps back a mode on Backspace in an empty box", () => {
    open("files");
    fireEvent.change(input(), { target: { value: ">" } });
    expect(chip().textContent).toBe("Commands");

    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(chip().textContent).toBe("Files");
  });

  /**
   * Files is the mode with no prefix, so there is no character that reaches
   * it. Opening straight into another mode and finding Backspace inert would
   * leave it unreachable without closing the palette entirely.
   */
  it("falls back to files when there is nothing to unwind", () => {
    open("commands");
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(chip().textContent).toBe("Files");
  });

  it("stops at files rather than unwinding past it", () => {
    open("files");
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(chip().textContent).toBe("Files");
  });

  it("leaves Backspace alone while there is text to delete", () => {
    open("commands");
    fireEvent.change(input(), { target: { value: "zoom" } });
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(chip().textContent).toBe("Commands");
  });
});

describe("commands mode", () => {
  it("lists commands and finds one by name", () => {
    open("commands");
    fireEvent.change(input(), { target: { value: "zoom in" } });
    const labels = screen.getAllByRole("option").map((el) => el.textContent);
    expect(labels[0]).toContain("Zoom In");
  });
});
