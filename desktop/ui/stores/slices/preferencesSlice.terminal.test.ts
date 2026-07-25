import { describe, it, expect, vi } from "vitest";

// preferencesSlice pulls in the Tauri bridge and the terminal registry at
// import time. Stub the Tauri invoke() and the api client so constructing the
// slice under vitest doesn't touch native code or the HMR-only api factory.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../api", () => ({
  getApiClient: () => ({
    terminalResize: vi.fn().mockResolvedValue(undefined),
  }),
}));

const {
  createPreferencesSlice,
  TERMINAL_FONT_FAMILY_DEFAULT,
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_WEIGHT_DEFAULT,
  TERMINAL_LINE_HEIGHT_DEFAULT,
  TERMINAL_LETTER_SPACING_DEFAULT,
} = await import("./preferencesSlice");

/** Minimal harness: real slice actions over an in-memory store + stub storage. */
function makeSlice(reads: Record<string, unknown> = {}) {
  const writes: Record<string, unknown> = {};
  const storage = {
    get: async (key: string) => reads[key],
    set: (key: string, value: unknown) => {
      writes[key] = value;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state: any = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (partial: any) => {
    state = {
      ...state,
      ...(typeof partial === "function" ? partial(state) : partial),
    };
  };
  const get = () => state;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = createPreferencesSlice(storage)(set, get, {} as any);
  return { get, writes, reads };
}

describe("preferencesSlice terminal font/rendering settings", () => {
  it("defaults every terminal field", () => {
    const { get } = makeSlice();
    expect(get().terminalFontFamily).toBe(TERMINAL_FONT_FAMILY_DEFAULT);
    expect(get().terminalFontSize).toBe(TERMINAL_FONT_SIZE_DEFAULT);
    expect(get().terminalFontWeight).toBe(TERMINAL_FONT_WEIGHT_DEFAULT);
    expect(get().terminalLineHeight).toBe(TERMINAL_LINE_HEIGHT_DEFAULT);
    expect(get().terminalLetterSpacing).toBe(TERMINAL_LETTER_SPACING_DEFAULT);
  });

  it("setTerminalFontFamily updates state and persists", () => {
    const { get, writes } = makeSlice();
    get().setTerminalFontFamily("JetBrains Mono");
    expect(get().terminalFontFamily).toBe("JetBrains Mono");
    expect(writes.terminalFontFamily).toBe("JetBrains Mono");
  });

  it("setTerminalFontSize updates state and persists", () => {
    const { get, writes } = makeSlice();
    get().setTerminalFontSize(15);
    expect(get().terminalFontSize).toBe(15);
    expect(writes.terminalFontSize).toBe(15);
  });

  it("setTerminalFontWeight updates state and persists", () => {
    const { get, writes } = makeSlice();
    get().setTerminalFontWeight(500);
    expect(get().terminalFontWeight).toBe(500);
    expect(writes.terminalFontWeight).toBe(500);
  });

  it("setTerminalLineHeight and setTerminalLetterSpacing persist", () => {
    const { get, writes } = makeSlice();
    get().setTerminalLineHeight(1.35);
    get().setTerminalLetterSpacing(0.5);
    expect(get().terminalLineHeight).toBe(1.35);
    expect(writes.terminalLineHeight).toBe(1.35);
    expect(get().terminalLetterSpacing).toBe(0.5);
    expect(writes.terminalLetterSpacing).toBe(0.5);
  });

  it("loadPreferences hydrates persisted terminal fields", async () => {
    const { get } = makeSlice({
      terminalFontFamily: "Fira Code",
      terminalFontSize: 12,
      terminalFontWeight: 300,
      terminalLineHeight: 1.2,
      terminalLetterSpacing: 1,
    });
    await get().loadPreferences();
    expect(get().terminalFontFamily).toBe("Fira Code");
    expect(get().terminalFontSize).toBe(12);
    expect(get().terminalFontWeight).toBe(300);
    expect(get().terminalLineHeight).toBe(1.2);
    expect(get().terminalLetterSpacing).toBe(1);
  });
});
