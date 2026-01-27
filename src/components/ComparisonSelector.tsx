import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Comparison, BranchList } from "../types";
import { makeComparison } from "../types";

interface ComparisonSelectorProps {
  repoPath: string | null;
  value: Comparison;
  onChange: (comparison: Comparison) => void;
}

// Special values for local state options in the compare dropdown
const WORKING_TREE = "__WORKING_TREE__";
const STAGED_ONLY = "__STAGED_ONLY__";

export function ComparisonSelector({
  repoPath,
  value,
  onChange,
}: ComparisonSelectorProps) {
  const [branches, setBranches] = useState<BranchList>({
    local: [],
    remote: [],
    stashes: [],
  });
  const [currentBranch, setCurrentBranch] = useState("HEAD");
  const [loading, setLoading] = useState(false);

  // Load branches when repo path changes
  useEffect(() => {
    if (!repoPath) return;

    setLoading(true);
    Promise.all([
      invoke<BranchList>("list_branches", { repoPath }),
      invoke<string>("get_current_branch", { repoPath }),
    ])
      .then(([result, curBranch]) => {
        setBranches(result);
        setCurrentBranch(curBranch);
      })
      .catch((err) => {
        console.error("Failed to load branches:", err);
        setBranches({ local: [], remote: [], stashes: [] });
      })
      .finally(() => {
        setLoading(false);
      });
  }, [repoPath]);

  // All branches combined for validation checks
  const allBranches = [...branches.local, ...branches.remote];

  // Get the current compare value for the dropdown
  const getCompareValue = (): string => {
    if (value.stagedOnly) {
      return STAGED_ONLY;
    }
    if (value.workingTree) {
      return WORKING_TREE;
    }
    return value.new;
  };

  // Handle base (old) branch change
  const handleBaseChange = (newBase: string) => {
    // If the new base matches the current compare, reset compare to Working Tree
    if (newBase === value.new) {
      onChange(makeComparison(newBase, currentBranch, true, false));
    } else {
      onChange(
        makeComparison(newBase, value.new, value.workingTree, value.stagedOnly),
      );
    }
  };

  // Handle compare (new) branch change
  const handleCompareChange = (newCompare: string) => {
    if (newCompare === WORKING_TREE) {
      // Working Tree = current branch with working_tree flag
      onChange(makeComparison(value.old, currentBranch, true, false));
    } else if (newCompare === STAGED_ONLY) {
      // Staged Only = current branch with staged_only flag
      onChange(makeComparison(value.old, currentBranch, false, true));
    } else {
      // Specific branch/ref - no special flags
      onChange(makeComparison(value.old, newCompare, false, false));
    }
  };

  const selectClass = `
    max-w-[11rem] rounded-lg border border-stone-700/50 bg-stone-800 px-3 py-1.5 text-sm text-stone-200
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
        {branches.local.length > 0 && (
          <optgroup label="Local Branches">
            {branches.local.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </optgroup>
        )}
        {branches.remote.length > 0 && (
          <optgroup label="Remote Branches">
            {branches.remote.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </optgroup>
        )}
        {/* Show current value even if not in branches list */}
        {!allBranches.includes(value.old) && (
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
        <optgroup label="Local State">
          <option value={WORKING_TREE}>Working Tree</option>
          <option value={STAGED_ONLY}>Staged Only</option>
          {branches.stashes.map((stash) => (
            <option key={stash.ref} value={stash.ref}>
              {stash.ref}: {stash.message.slice(0, 20)}
              {stash.message.length > 20 ? "…" : ""}
            </option>
          ))}
        </optgroup>

        {branches.local.filter((b) => b !== value.old).length > 0 && (
          <optgroup label="Local Branches">
            {branches.local
              .filter((branch) => branch !== value.old)
              .map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
          </optgroup>
        )}
        {branches.remote.filter((b) => b !== value.old).length > 0 && (
          <optgroup label="Remote Branches">
            {branches.remote
              .filter((branch) => branch !== value.old)
              .map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
          </optgroup>
        )}

        {/* Show current value if it's a custom ref not in branches */}
        {!value.workingTree &&
          !value.stagedOnly &&
          !allBranches.includes(value.new) && (
            <option value={value.new}>{value.new}</option>
          )}
      </select>

      {/* Local state indicator */}
      {value.workingTree && (
        <span
          className="text-xs text-amber-500/70 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20"
          title="Includes all uncommitted changes (staged + unstaged)"
        >
          +uncommitted
        </span>
      )}
      {value.stagedOnly && (
        <span
          className="text-xs text-emerald-500/70 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20"
          title="Shows only staged changes"
        >
          staged
        </span>
      )}
    </div>
  );
}
