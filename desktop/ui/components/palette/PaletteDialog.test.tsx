import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PaletteDialog, type PaletteGroup } from "./PaletteDialog";

afterEach(cleanup);

interface Row {
  id: string;
  label: string;
}

const rows = (...labels: string[]): Row[] =>
  labels.map((label) => ({ id: label, label }));

function Harness({
  items,
  groups,
  onActivate = () => {},
  ...rest
}: {
  items?: Row[];
  groups?: PaletteGroup<Row>[];
  onActivate?: (item: Row) => void;
} & Partial<React.ComponentProps<typeof PaletteDialog<Row>>>) {
  const [query, setQuery] = useState("");
  return (
    <PaletteDialog<Row>
      open
      onClose={() => {}}
      title="Test palette"
      query={query}
      onQueryChange={setQuery}
      placeholder="Search…"
      items={items}
      groups={groups}
      getKey={(item) => item.id}
      renderRow={(item) => <span>{item.label}</span>}
      onActivate={onActivate}
      emptyMessage="Nothing here"
      {...rest}
    />
  );
}

const options = () => screen.getAllByRole("option");
const input = () => screen.getByRole("combobox");
const selected = () =>
  options().find((el) => el.getAttribute("aria-selected") === "true");

describe("selection and activation", () => {
  it("selects the first row by default", () => {
    render(<Harness items={rows("alpha", "beta")} />);
    expect(selected()?.textContent).toBe("alpha");
  });

  it("moves the selection with arrow keys", () => {
    render(<Harness items={rows("alpha", "beta", "gamma")} />);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selected()?.textContent).toBe("beta");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(selected()?.textContent).toBe("alpha");
  });

  it("clamps at both ends", () => {
    render(<Harness items={rows("alpha", "beta")} />);
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(selected()?.textContent).toBe("alpha");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selected()?.textContent).toBe("beta");
  });

  it("activates the selected row on Enter", () => {
    const onActivate = vi.fn();
    render(<Harness items={rows("alpha", "beta")} onActivate={onActivate} />);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate.mock.calls[0][0]).toMatchObject({ label: "beta" });
  });

  it("activates the clicked row", () => {
    const onActivate = vi.fn();
    render(<Harness items={rows("alpha", "beta")} onActivate={onActivate} />);
    fireEvent.click(options()[1]);
    expect(onActivate.mock.calls[0][0]).toMatchObject({ label: "beta" });
  });

  it("does not activate when there is nothing to activate", () => {
    const onActivate = vi.fn();
    render(<Harness items={[]} onActivate={onActivate} />);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("syncs the keyboard cursor to the hovered row", () => {
    render(<Harness items={rows("alpha", "beta", "gamma")} />);
    fireEvent.mouseMove(options()[2]);
    expect(selected()?.textContent).toBe("gamma");
  });
});

describe("grouped results", () => {
  const groups: PaletteGroup<Row>[] = [
    { key: "a", header: <div>Group A</div>, items: rows("a1", "a2") },
    { key: "b", header: <div>Group B</div>, items: rows("b1") },
    { key: "c", header: <div>Group C</div>, items: rows("c1", "c2") },
  ];

  it("renders every group's items in order", () => {
    render(<Harness groups={groups} />);
    expect(options().map((el) => el.textContent)).toEqual([
      "a1",
      "a2",
      "b1",
      "c1",
      "c2",
    ]);
  });

  // The previous per-surface implementations numbered rows with a counter
  // mutated during render over the *grouped* array, while arrow keys and the
  // activation handler indexed the *flat* array. Whenever grouping reordered
  // results the highlighted row and the activated row diverged.
  it("keyboard selection and click activation agree on every row", () => {
    const onActivate = vi.fn();
    render(<Harness groups={groups} onActivate={onActivate} />);

    for (let i = 0; i < 5; i++) {
      const label = selected()!.textContent;
      fireEvent.keyDown(input(), { key: "Enter" });
      expect(onActivate.mock.calls[i][0]).toMatchObject({ label });
      fireEvent.keyDown(input(), { key: "ArrowDown" });
    }
  });

  it("arrow keys cross group boundaries", () => {
    render(<Harness groups={groups} />);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selected()?.textContent).toBe("b1");
  });

  it("numbers rows continuously across groups", () => {
    render(<Harness groups={groups} />);
    expect(options().map((el) => el.getAttribute("data-index"))).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
  });
});

describe("empty, error, and busy states", () => {
  it("shows the empty message when there are no results", () => {
    render(<Harness items={[]} />);
    expect(screen.getByText("Nothing here")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("shows an error in place of results", () => {
    render(<Harness items={rows("alpha")} error="it broke" />);
    expect(screen.getByText("it broke")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("hides the clear button while busy", () => {
    const { rerender } = render(<Harness items={rows("alpha")} />);
    fireEvent.change(input(), { target: { value: "x" } });
    expect(screen.getByLabelText("Clear search")).toBeTruthy();

    rerender(<Harness items={rows("alpha")} busy />);
    fireEvent.change(input(), { target: { value: "x" } });
    expect(screen.queryByLabelText("Clear search")).toBeNull();
  });
});

describe("query handling", () => {
  it("resets the selection when the query changes", () => {
    render(<Harness items={rows("alpha", "beta", "gamma")} />);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selected()?.textContent).toBe("gamma");

    fireEvent.change(input(), { target: { value: "a" } });
    expect(selected()?.textContent).toBe("alpha");
  });

  // An async source replaces its results array on every response; resetting
  // the cursor on that identity would fight the user mid-navigation.
  it("keeps the selection when results change but the query does not", () => {
    const { rerender } = render(
      <Harness items={rows("alpha", "beta", "gamma")} />,
    );
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selected()?.textContent).toBe("beta");

    rerender(<Harness items={rows("alpha", "beta", "gamma")} />);
    expect(selected()?.textContent).toBe("beta");
  });

  it("clamps a stale selection when the list shrinks", () => {
    const { rerender } = render(
      <Harness items={rows("alpha", "beta", "gamma")} />,
    );
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    rerender(<Harness items={rows("alpha")} />);
    expect(selected()?.textContent).toBe("alpha");
  });
});

describe("extension points", () => {
  it("lets a caller claim a keystroke before the shell sees it", () => {
    const onKeyDown = vi.fn((e: React.KeyboardEvent) => e.key === "Tab");
    render(<Harness items={rows("alpha", "beta")} onKeyDown={onKeyDown} />);

    fireEvent.keyDown(input(), { key: "Tab" });
    expect(selected()?.textContent).toBe("alpha");

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selected()?.textContent).toBe("beta");
  });

  it("renders input accessories", () => {
    render(
      <Harness
        items={rows("alpha")}
        inputAccessories={<button aria-label="Aa">Aa</button>}
      />,
    );
    expect(screen.getByLabelText("Aa")).toBeTruthy();
  });

  it("renders a custom count and enter label", () => {
    render(
      <Harness
        items={rows("alpha", "beta")}
        enterLabel="go to line"
        renderCount={(n) => `${n} matches`}
      />,
    );
    expect(screen.getByText("2 matches")).toBeTruthy();
    expect(screen.getByText("go to line")).toBeTruthy();
  });
});

describe("accessibility", () => {
  it("wires the combobox to the listbox", () => {
    render(<Harness items={rows("alpha", "beta")} />);
    const listbox = screen.getByRole("listbox");
    expect(input().getAttribute("aria-controls")).toBe(listbox.id);
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(input().getAttribute("aria-autocomplete")).toBe("list");
  });

  // Focus must stay on the input so typing continues to work; the highlighted
  // row is communicated via aria-activedescendant instead.
  it("points aria-activedescendant at the selected option", () => {
    render(<Harness items={rows("alpha", "beta")} />);
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0].id);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[1].id);
  });

  it("drops aria-activedescendant when there are no results", () => {
    render(<Harness items={[]} />);
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("never moves focus off the input", () => {
    render(<Harness items={rows("alpha", "beta")} />);
    input().focus();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(input());
  });
});
