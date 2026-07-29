import { describe, it, expect, beforeEach } from "vitest";
import {
  registerCommands,
  getAllCommands,
  findCommand,
  resolveCommands,
  resetRegistry,
} from "./registry";
import type { Command, CommandContext } from "./types";

beforeEach(resetRegistry);

function command(id: string, extra: Partial<Command> = {}): Command {
  return {
    id,
    title: id,
    category: "Test",
    run: () => {},
    ...extra,
  };
}

/** A context stub — predicates in these tests only read what they are given. */
function context(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    store: {} as CommandContext["store"],
    terminalFocused: false,
    ui: {} as CommandContext["ui"],
    ...overrides,
  };
}

describe("registration", () => {
  it("exposes registered commands", () => {
    registerCommands([command("a"), command("b")]);
    expect(getAllCommands().map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("removes them again on dispose", () => {
    const dispose = registerCommands([command("a")]);
    expect(getAllCommands()).toHaveLength(1);
    dispose();
    expect(getAllCommands()).toHaveLength(0);
  });

  it("merges several sources", () => {
    registerCommands([command("a")]);
    registerCommands([command("b")]);
    expect(
      getAllCommands()
        .map((c) => c.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("lets a later source specialize a command by id", () => {
    registerCommands([command("a", { title: "base" })]);
    const dispose = registerCommands([command("a", { title: "override" })]);
    expect(findCommand("a")?.title).toBe("override");
    dispose();
    expect(findCommand("a")?.title).toBe("base");
  });

  it("finds a command by id", () => {
    registerCommands([command("a")]);
    expect(findCommand("a")?.id).toBe("a");
    expect(findCommand("nope")).toBeUndefined();
  });
});

describe("resolution", () => {
  it("keeps commands with no predicates", () => {
    const resolved = resolveCommands([command("a")], context());
    expect(resolved).toHaveLength(1);
    expect(resolved[0].enabled).toBe(true);
  });

  // Hiding is for commands that make no sense here at all; disabling is for
  // commands worth knowing about that cannot run right now. Collapsing the two
  // makes the palette look like the feature disappeared.
  it("drops invisible commands entirely", () => {
    const resolved = resolveCommands(
      [command("a", { isVisible: () => false }), command("b")],
      context(),
    );
    expect(resolved.map((r) => r.command.id)).toEqual(["b"]);
  });

  it("keeps disabled commands, marked", () => {
    const resolved = resolveCommands(
      [command("a", { isEnabled: () => false })],
      context(),
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].enabled).toBe(false);
  });

  it("evaluates predicates against the context it is given", () => {
    const cmd = command("a", { isEnabled: (ctx) => ctx.terminalFocused });
    expect(resolveCommands([cmd], context())[0].enabled).toBe(false);
    expect(
      resolveCommands([cmd], context({ terminalFocused: true }))[0].enabled,
    ).toBe(true);
  });

  it("re-evaluates on every call rather than caching", () => {
    let allowed = false;
    const cmd = command("a", { isEnabled: () => allowed });
    expect(resolveCommands([cmd], context())[0].enabled).toBe(false);
    allowed = true;
    expect(resolveCommands([cmd], context())[0].enabled).toBe(true);
  });
});
