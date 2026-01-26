import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Comparison } from "../types";
import { makeComparison } from "../types";

interface ComparisonSelectorProps {
  repoPath: string | null;
  value: Comparison;
  onChange: (comparison: Comparison) => void;
}

// Special value for "Working Tree" option in the compare dropdown
const WORKING_TREE = "__WORKING_TREE__";

export function ComparisonSelector({
  repoPath,
  value,
  onChange,
}: ComparisonSelectorProps) {
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Load branches when repo path changes
  useEffect(() => {
    if (!repoPath) return;

    setLoading(true);
    invoke<string[]>("list_branches", { repoPath })
      .then((result) => {
        setBranches(result);
      })
      .catch((err) => {
        console.error("Failed to load branches:", err);
        setBranches([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [repoPath]);

  // Get the current compare value for the dropdown
  // If workingTree is true and new is HEAD, show "Working Tree"
  const getCompareValue = (): string => {
    if (value.workingTree && value.new === "HEAD") {
      return WORKING_TREE;
    }
    return value.new;
  };

  // Handle base (old) branch change
  const handleBaseChange = (newBase: string) => {
    onChange(makeComparison(newBase, value.new, value.workingTree));
  };

  // Handle compare (new) branch change
  const handleCompareChange = (newCompare: string) => {
    if (newCompare === WORKING_TREE) {
      // Working Tree = HEAD with working_tree flag
      onChange(makeComparison(value.old, "HEAD", true));
    } else {
      // Specific branch/ref - no working tree changes
      onChange(makeComparison(value.old, newCompare, false));
    }
  };

  const selectClass = `
    rounded-lg border border-stone-700/50 bg-stone-800 px-3 py-1.5 text-sm text-stone-200
    focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30
    transition-all cursor-pointer hover:border-stone-600/50
    disabled:opacity-50 disabled:cursor-not-allowed
  `;

  return (
    <div className="flex items-center gap-2">
      {/* Base (old) branch selector */}
      <select
        value={value.old}
        onChange={(e) => handleBaseChange(e.target.value)}
        disabled={loading}
        className={selectClass}
        title="Base branch"
      >
        {branches.map((branch) => (
          <option key={branch} value={branch}>
            {branch}
          </option>
        ))}
        {/* Show current value even if not in branches list */}
        {!branches.includes(value.old) && (
          <option value={value.old}>{value.old}</option>
        )}
      </select>

      <span className="text-stone-500 text-sm">..</span>

      {/* Compare (new) branch/state selector */}
      <select
        value={getCompareValue()}
        onChange={(e) => handleCompareChange(e.target.value)}
        disabled={loading}
        className={selectClass}
        title="Compare branch"
      >
        {/* Working Tree option - always at top */}
        <option value={WORKING_TREE}>Working Tree</option>

        <optgroup label="Branches">
          {branches.map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </optgroup>

        {/* Show current value if it's a custom ref not in branches */}
        {value.new !== "HEAD" && !branches.includes(value.new) && (
          <option value={value.new}>{value.new}</option>
        )}
      </select>

      {/* Working tree indicator */}
      {value.workingTree && (
        <span
          className="text-xs text-amber-500/70 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20"
          title="Includes uncommitted changes"
        >
          +uncommitted
        </span>
      )}
    </div>
  );
}
