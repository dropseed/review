/**
 * Fixture builders shared across tests.
 *
 * A `TerminalStatus` has nine fields and most tests care about one of them, so
 * every suite that touched one had grown its own copy of the same literal. One
 * builder here means a field added to the type is fixed in one place, and each
 * suite states only the part it is actually about.
 */

import { buildSidebarTree } from "../utils/sidebar-tree";
import {
  sidebarRowsByKey,
  sidebarRowsByRepoRef,
} from "../stores/selectors/sidebar";
import { attachmentLabel } from "../stores/selectors/workspaceData";
import type { WorkspaceContext } from "../components/Sidebar/workspace-status";
import type {
  Attachment,
  GlobalReviewSummary,
  LocalBranchInfo,
  RepoLocalActivity,
  ShippedPr,
  TerminalPhase,
  TerminalSessionInfo,
  TerminalStatus,
  ViewerPr,
  ViewerPrSnapshot,
  Workspace,
} from "../types";

/**
 * The instant the fixtures are dated from.
 *
 * Fixed rather than `Date.now()`: several of these carry timestamps that tests
 * compare against each other, and a clock would make those comparisons
 * different on a slow machine.
 */
export const FIXTURE_NOW = Date.UTC(2026, 0, 15);

/**
 * A workspace as the backend hands it over.
 *
 * `displayTitle` follows the backend's own ladder unless it is overridden, so a
 * suite states the title *or* the attachments and gets the same answer the app
 * would render.
 */
export function workspace(
  id: string,
  overrides: Partial<Workspace> = {},
): Workspace {
  const title = overrides.title ?? null;
  const attachments = overrides.attachments ?? [];
  return {
    id,
    title,
    displayTitle: title || derivedTitle(attachments),
    attachments,
    autoCreated: false,
    createdAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
    // The tree facts the backend derives, after the spread so a fixture can
    // state `parentId` alone and get a consistent `depth` — a deeper one says
    // so explicitly.
    parentId: overrides.parentId ?? null,
    depth: overrides.depth ?? (overrides.parentId ? 1 : 0),
    ancestors: overrides.ancestors ?? [],
  };
}

/** The backend's derived title: the first attachment's label, else Untitled. */
function derivedTitle(attachments: Attachment[]): string {
  const first = attachments[0];
  return first ? attachmentLabel(first) : "Untitled";
}

/** One repo tab. */
export function attachment(
  path: string,
  refName: string | null = null,
): Attachment {
  return { path, refName };
}

/** A local branch, quiet unless overridden. */
export function localBranch(
  name: string,
  overrides: Partial<LocalBranchInfo> = {},
): LocalBranchInfo {
  return {
    name,
    isCurrent: false,
    commitsAhead: 0,
    unpushedCommits: 0,
    behindUpstream: 0,
    hasWorkingTreeChanges: false,
    lastCommitDate: new Date(FIXTURE_NOW).toISOString(),
    lastCommitMessage: "x",
    lastCommitByUser: false,
    worktreePath: null,
    lastModifiedAt: null,
    workingTreeStats: null,
    ...overrides,
  };
}

/** One repo's local activity, as the sidebar tree reads it. */
export function repoActivity(
  repoPath: string,
  branches: LocalBranchInfo[],
  overrides: Partial<RepoLocalActivity> = {},
): RepoLocalActivity {
  return {
    repoPath,
    repoName: repoPath.slice(repoPath.lastIndexOf("/") + 1),
    defaultBranch: "main",
    branches,
    recentRemoteBranches: [],
    ...overrides,
  };
}

/**
 * An open PR as the account-wide query returns it, joined to a local repo.
 *
 * Built rather than cast, so a field added to `ViewerPr` fails here — where it
 * is fixed once — instead of silently leaving every suite's PR incomplete.
 */
export function viewerPr(overrides: Partial<ViewerPr> = {}): ViewerPr {
  return {
    number: 12,
    title: "A change",
    url: "https://github.com/o/repo/pull/12",
    isDraft: false,
    updatedAt: new Date(FIXTURE_NOW).toISOString(),
    headRefName: "feature",
    baseRefName: "main",
    repoNameWithOwner: "o/repo",
    repoUrl: "https://github.com/o/repo",
    headRepoNameWithOwner: "o/repo",
    reviewDecision: null,
    checksState: null,
    repoPath: "/repo",
    ...overrides,
  };
}

/** A successful PR snapshot carrying `prs`. */
export function viewerPrSnapshot(
  prs: ViewerPr[],
  overrides: Partial<ViewerPrSnapshot> = {},
): ViewerPrSnapshot {
  return {
    fetchedAt: new Date(FIXTURE_NOW).toISOString(),
    prs,
    truncated: false,
    error: null,
    shipped: [],
    available: true,
    ...overrides,
  };
}

/**
 * A `WorkspaceContext` built from the real tree.
 *
 * Built rather than hand-written, so what a card says about an attachment is
 * joined the way the app joins it — the rows, the PR badges and the "is this
 * branch gone" answer all come from `buildSidebarTree` rather than from a
 * literal a test happened to write. Three suites had their own copy of this
 * before, and adding one field to the context meant editing all three.
 */
export function workspaceContext({
  repoPath = "/repo",
  branches = [],
  prs = [],
  reviews = {},
  shipped = new Map(),
}: {
  repoPath?: string;
  branches?: LocalBranchInfo[];
  prs?: ViewerPr[];
  reviews?: Record<string, GlobalReviewSummary>;
  shipped?: Map<string, ShippedPr>;
} = {}): WorkspaceContext {
  const tree = buildSidebarTree(
    [repoActivity(repoPath, branches)],
    Object.values(reviews),
    reviews,
    prs,
  );
  return {
    rows: sidebarRowsByKey(tree),
    rowsByRepoRef: sidebarRowsByRepoRef(tree),
    repoNames: new Map([
      [repoPath, repoPath.slice(repoPath.lastIndexOf("/") + 1)],
    ]),
    knownRepos: new Set([repoPath]),
    heads: new Map(),
    shipped,
  };
}

/** A terminal status in `phase`, with everything else quiet unless overridden. */
export function terminalStatus(
  phase: TerminalPhase = "idle",
  overrides: Partial<TerminalStatus> = {},
): TerminalStatus {
  return {
    id: "t1",
    phase,
    runningCommand: null,
    lastExitCode: null,
    cwd: null,
    title: null,
    enteredStateAt: 0,
    shellIntegrationActive: false,
    attentionMessage: null,
    ...overrides,
  };
}

/** A terminal session record, quiet unless overridden. */
export function terminalSession(
  id = "t1",
  overrides: Partial<TerminalSessionInfo> = {},
): TerminalSessionInfo {
  return {
    id,
    repoPath: "/repo",
    workspaceId: null,
    cwd: "/repo",
    title: null,
    cols: 80,
    rows: 24,
    status: terminalStatus("idle", { id }),
    ...overrides,
  };
}
