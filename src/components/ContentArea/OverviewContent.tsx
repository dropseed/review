import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ReactFlow,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { useReviewStore } from "../../stores";
import { useReviewProgress } from "../../hooks/useReviewProgress";
import { getPlatformServices } from "../../platform";
import { StructuredDiagram } from "../GuideView/StructuredDiagram";
import { SummaryStats } from "../GuideView/SummaryStats";
import { CopyErrorButton } from "../GuideView/CopyErrorButton";
import { buildDependencyGraph } from "../../utils/dependencyGraph";
import { SummaryFileTree } from "../GuideView/SummaryFileTree";
import { SymbolKindBadge, ChangeIndicator } from "../symbols";
import type {
  SymbolKind,
  SymbolChangeType,
  SymbolDiff,
  FileSymbolDiff,
  FileCluster,
} from "../../types";

function Spinner({ className = "h-4 w-4" }: { className?: string }): ReactNode {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function SparkleIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}): ReactNode {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

function ExternalLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) getPlatformServices().opener.openUrl(href);
      }}
      className="text-link hover:text-link/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-link/50 rounded underline underline-offset-2 cursor-pointer"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

function urlTransform(url: string): string {
  return url.startsWith("review://") ? url : defaultUrlTransform(url);
}

const markdownComponents = { a: ExternalLink };

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): ReactNode {
  return (
    <div className="rounded-lg border border-status-rejected/50 bg-status-rejected/10 p-4">
      <p className="text-xs text-status-rejected">{message}</p>
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={onRetry}
          className="text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
        >
          Retry
        </button>
        <CopyErrorButton error={message} />
      </div>
    </div>
  );
}

function SummarySection(): ReactNode {
  const guideSummary = useReviewStore((s) => s.guideSummary);
  const guideSummaryError = useReviewStore((s) => s.guideSummaryError);
  const summaryStatus = useReviewStore((s) => s.summaryStatus);
  const isSummaryStale = useReviewStore((s) => s.isSummaryStale);
  const generateSummary = useReviewStore((s) => s.generateSummary);
  const claudeAvailable = useReviewStore((s) => s.claudeAvailable);
  const prBody = useReviewStore((s) => s.reviewState?.githubPr?.body);

  const displaySummary = guideSummary || prBody || null;
  const stale = guideSummary ? isSummaryStale() : false;
  const showCta =
    !displaySummary &&
    !guideSummaryError &&
    summaryStatus !== "loading" &&
    claudeAvailable !== false;

  return (
    <div className="space-y-4">
      {summaryStatus === "loading" && !displaySummary && !guideSummaryError && (
        <div className="rounded-lg border border-edge p-4">
          <div className="flex items-center gap-2 text-fg-muted">
            <Spinner />
            <span className="text-xs">Generating summary…</span>
          </div>
        </div>
      )}
      {guideSummaryError && (
        <ErrorPanel
          message={`Failed to generate summary: ${guideSummaryError}`}
          onRetry={() => generateSummary()}
        />
      )}
      {showCta && (
        <div className="rounded-lg border border-edge-default/60 overflow-hidden bg-surface-panel">
          <div className="flex items-center w-full gap-3 px-3.5 py-3 bg-surface-raised/40">
            <SparkleIcon className="h-4 w-4 text-status-classifying" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-fg-secondary">
                AI Summary
              </span>
              <p className="text-xs text-fg-muted mt-0.5">
                Generate a summary of the changes in this review
              </p>
            </div>
            <button
              onClick={() => generateSummary()}
              className="flex-shrink-0 rounded-md bg-surface-raised/80 px-2.5 py-1 text-2xs text-fg-muted inset-ring-1 inset-ring-edge-default/50 hover:bg-surface-hover/80 hover:text-fg-secondary transition-colors"
            >
              Generate
            </button>
          </div>
        </div>
      )}
      {displaySummary && (
        <div className="rounded-lg border border-edge p-4">
          <div className="guide-prose text-sm text-fg-secondary leading-relaxed">
            <Markdown
              remarkPlugins={[remarkGfm]}
              urlTransform={urlTransform}
              components={markdownComponents}
            >
              {displaySummary}
            </Markdown>
          </div>
          {stale && !prBody && (
            <div className="flex items-center justify-end mt-2">
              <button
                onClick={() => generateSummary()}
                className="flex items-center gap-1 rounded-full bg-status-modified/15 px-2 py-0.5 text-xxs font-medium text-status-modified hover:bg-status-modified/25 transition-colors"
              >
                Regenerate
              </button>
            </div>
          )}
        </div>
      )}
      <DiagramSection />
    </div>
  );
}

function DiagramSection(): ReactNode {
  const guideDiagram = useReviewStore((s) => s.guideDiagram);
  const guideDiagramError = useReviewStore((s) => s.guideDiagramError);
  const diagramStatus = useReviewStore((s) => s.diagramStatus);
  const isSummaryStale = useReviewStore((s) => s.isSummaryStale);
  const generateDiagram = useReviewStore((s) => s.generateDiagram);

  const stale = guideDiagram ? isSummaryStale() : false;
  const isValidJson = guideDiagram?.trimStart().startsWith("{") ?? false;
  const skipped =
    !guideDiagram && !guideDiagramError && diagramStatus === "done";

  if (!guideDiagram && !guideDiagramError && diagramStatus === "idle")
    return null;

  return (
    <div className="space-y-4">
      {diagramStatus === "loading" && !guideDiagram && !guideDiagramError && (
        <div className="rounded-lg border border-edge p-4">
          <div className="flex items-center gap-2 text-fg-muted">
            <Spinner />
            <span className="text-xs">Generating diagram…</span>
          </div>
        </div>
      )}
      {skipped && (
        <div className="rounded-lg border border-edge/50 p-3">
          <p className="text-xxs text-fg-faint">
            Diagram was skipped for this review.
          </p>
        </div>
      )}
      {guideDiagramError && (
        <ErrorPanel
          message={`Failed to generate diagram: ${guideDiagramError}`}
          onRetry={() => generateDiagram()}
        />
      )}
      {guideDiagram && !isValidJson && (
        <div className="rounded-lg border border-edge p-4">
          <p className="text-xs text-fg-muted">Diagram format has changed.</p>
          <button
            onClick={() => generateDiagram()}
            className="mt-2 text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
          >
            Regenerate
          </button>
        </div>
      )}
      {guideDiagram && isValidJson && (
        <div className="rounded-lg border border-edge overflow-hidden">
          <StructuredDiagram
            sceneJson={guideDiagram}
            onRetry={() => generateDiagram()}
          />
          {stale && (
            <div className="flex items-center justify-end px-4 pb-3">
              <button
                onClick={() => generateDiagram()}
                className="flex items-center gap-1 rounded-full bg-status-modified/15 px-2 py-0.5 text-xxs font-medium text-status-modified hover:bg-status-modified/25 transition-colors"
              >
                Regenerate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Dependency graph diagram (React Flow + dagre) ---

interface DiagramSymbol {
  name: string;
  kind: SymbolKind | null;
  changeType: SymbolChangeType;
  hunkIds: string[];
  hasSourceHandle: boolean;
  hasTargetHandle: boolean;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** Recursively walk a SymbolDiff tree, calling `visitor` on each node (depth-first). */
function walkSymbolTree(
  symbols: SymbolDiff[],
  visitor: (sym: SymbolDiff) => void,
): void {
  for (const sym of symbols) {
    visitor(sym);
    walkSymbolTree(sym.children, visitor);
  }
}

/** Get or create a Set entry in a Map. */
function getOrCreateSet<K, V>(map: Map<K, Set<V>>, key: K): Set<V> {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  return set;
}

type DepNodeData = {
  filePath: string;
  dir: string;
  basename: string;
  symbols: DiagramSymbol[];
  onNavigate: (filePath: string, hunkId?: string) => void;
};

type DepNode = Node<DepNodeData, "depFile">;

function symbolTextColor(changeType: SymbolChangeType): string {
  switch (changeType) {
    case "removed":
      return "text-status-rejected/70 line-through";
    case "added":
      return "text-status-approved";
    case "modified":
      return "text-fg-secondary";
  }
}

function symbolHandleTop(index: number): number {
  return (
    DEP_HEADER_H +
    DEP_BODY_PAD +
    index * DEP_SYMBOL_ROW_H +
    DEP_SYMBOL_ROW_H / 2
  );
}

const HANDLE_CLASS =
  "!w-1.5 !h-1.5 !bg-fg-faint !border-none !min-w-0 !min-h-0";

function DepFileNode({ data }: NodeProps<DepNode>): ReactNode {
  const hasSpecificTarget = data.symbols.some((s) => s.hasTargetHandle);

  return (
    <div className="rounded-md bg-surface-panel border border-edge overflow-hidden">
      {!hasSpecificTarget && (
        <Handle type="target" position={Position.Left} className="!opacity-0" />
      )}
      <button
        type="button"
        onClick={() => data.onNavigate(data.filePath)}
        className="nopan block w-full text-left px-2.5 py-1.5 cursor-pointer hover:bg-surface-raised/40 transition-colors"
      >
        <span className="text-xs font-mono truncate block hover:underline underline-offset-2">
          {data.dir && <span className="text-fg-muted">{data.dir}</span>}
          <span className="text-fg-secondary font-medium">{data.basename}</span>
        </span>
      </button>
      {data.symbols.length > 0 && (
        <div className="border-t border-edge/30 px-2.5 py-1">
          {data.symbols.map((sym) => (
            <button
              key={sym.name}
              type="button"
              onClick={() => data.onNavigate(data.filePath, sym.hunkIds[0])}
              className="nopan flex items-center gap-1 py-0.5 w-full cursor-pointer hover:bg-surface-raised/40 transition-colors rounded-sm"
            >
              <ChangeIndicator changeType={sym.changeType} />
              <SymbolKindBadge kind={sym.kind} />
              <span
                className={`text-xs font-mono truncate hover:underline underline-offset-2 ${symbolTextColor(sym.changeType)}`}
              >
                {sym.name}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Per-symbol handles positioned at each symbol row */}
      {data.symbols.map((sym, i) => (
        <Fragment key={sym.name}>
          {sym.hasTargetHandle && (
            <Handle
              type="target"
              position={Position.Left}
              id={sym.name}
              style={{ top: symbolHandleTop(i) }}
              className={HANDLE_CLASS}
            />
          )}
          {sym.hasSourceHandle && (
            <Handle
              type="source"
              position={Position.Right}
              id={sym.name}
              style={{ top: symbolHandleTop(i) }}
              className={HANDLE_CLASS}
            />
          )}
        </Fragment>
      ))}

      {data.symbols.length === 0 && (
        <Handle
          type="source"
          position={Position.Right}
          className="!opacity-0"
        />
      )}
    </div>
  );
}

const depNodeTypes = { depFile: DepFileNode };

const DEP_CHAR_WIDTH = 7.2;
const DEP_NODE_PAD_X = 20;
const DEP_HEADER_H = 28;
const DEP_SYMBOL_ROW_H = 22;
const DEP_BODY_PAD = 8;

function estimateDepNodeSize(
  dir: string,
  basename: string,
  symbolCount: number,
): { width: number; height: number } {
  const pathWidth = (dir.length + basename.length) * DEP_CHAR_WIDTH;
  const width = Math.max(pathWidth + DEP_NODE_PAD_X * 2, 160);
  const height =
    DEP_HEADER_H +
    (symbolCount > 0
      ? DEP_BODY_PAD + symbolCount * DEP_SYMBOL_ROW_H + DEP_BODY_PAD
      : 0);
  return { width: Math.min(width, 280), height };
}

/** Build hunkId to deepest containing SymbolDiff (children visited after parents, so deepest wins). */
function buildHunkToSymbol(
  symbolDiffs: FileSymbolDiff[],
): Map<string, SymbolDiff> {
  const map = new Map<string, SymbolDiff>();
  for (const diff of symbolDiffs) {
    walkSymbolTree(diff.symbols, (sym) => {
      for (const hunkId of sym.hunkIds) {
        map.set(hunkId, sym);
      }
    });
  }
  return map;
}

interface EdgeRoute {
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string | undefined;
}

/**
 * Collect symbols for each file node and compute per-symbol edge routes.
 *
 * For each file, finds:
 * - Defining symbols: defined here, referenced elsewhere (right-side source handles)
 * - Referencing symbols: contain references to external symbols (left-side target handles)
 */
function collectNodeData(
  cluster: FileCluster,
  symbolDiffs: FileSymbolDiff[],
): {
  fileSymbols: Map<string, DiagramSymbol[]>;
  edgeRoutes: EdgeRoute[];
} {
  const diffByPath = new Map(symbolDiffs.map((d) => [d.filePath, d]));

  // Defining symbols (right-side source handles)
  const defSymNames = new Map<string, Set<string>>();
  for (const edge of cluster.edges) {
    const set = getOrCreateSet(defSymNames, edge.definesFile);
    for (const s of edge.symbols) set.add(s);
  }

  // Build hunk-to-symbol map for finding container symbols in target files
  const hunkToSymbol = buildHunkToSymbol(symbolDiffs);

  // Referencing symbols (left-side target handles) + edge routes
  const refSymNames = new Map<string, Set<string>>();
  const edgeRoutes: EdgeRoute[] = [];

  for (const edge of cluster.edges) {
    const targetDiff = diffByPath.get(edge.referencesFile);
    for (const symName of edge.symbols) {
      let targetContainer: string | undefined;

      if (targetDiff) {
        for (const ref of targetDiff.symbolReferences) {
          if (ref.symbolName === symName) {
            const container = hunkToSymbol.get(ref.hunkId);
            if (container) {
              targetContainer = container.name;
              getOrCreateSet(refSymNames, edge.referencesFile).add(
                container.name,
              );
              break;
            }
          }
        }
      }

      edgeRoutes.push({
        source: edge.definesFile,
        target: edge.referencesFile,
        sourceHandle: symName,
        targetHandle: targetContainer,
      });
    }
  }

  // Build merged symbol list per file (defining + referencing)
  const fileSymbols = new Map<string, DiagramSymbol[]>();

  for (const filePath of cluster.files) {
    const diff = diffByPath.get(filePath);
    if (!diff) continue;

    const defNames = defSymNames.get(filePath) ?? new Set<string>();
    const refNames = refSymNames.get(filePath) ?? new Set<string>();
    const allNames = new Set([...defNames, ...refNames]);
    if (allNames.size === 0) continue;

    const syms: DiagramSymbol[] = [];
    walkSymbolTree(diff.symbols, (sym) => {
      if (allNames.has(sym.name)) {
        syms.push({
          name: sym.name,
          kind: sym.kind,
          changeType: sym.changeType,
          hunkIds: sym.hunkIds,
          hasSourceHandle: defNames.has(sym.name),
          hasTargetHandle: refNames.has(sym.name),
        });
      }
    });

    if (syms.length > 0) fileSymbols.set(filePath, syms);
  }

  return { fileSymbols, edgeRoutes };
}

function splitFilePath(filePath: string): { dir: string; basename: string } {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash < 0) return { dir: "", basename: filePath };
  return {
    dir: filePath.slice(0, lastSlash + 1),
    basename: filePath.slice(lastSlash + 1),
  };
}

function buildDepFlowGraph(
  cluster: FileCluster,
  fileSymbols: Map<string, DiagramSymbol[]>,
  edgeRoutes: EdgeRoute[],
  onNavigate: (filePath: string, hunkId?: string) => void,
): { nodes: Node[]; edges: Edge[]; width: number; height: number } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  const fileMeta = new Map<
    string,
    { dir: string; basename: string; symbols: DiagramSymbol[] }
  >();

  for (const filePath of cluster.files) {
    const { dir, basename } = splitFilePath(filePath);
    const symbols = fileSymbols.get(filePath) ?? [];
    fileMeta.set(filePath, { dir, basename, symbols });

    const size = estimateDepNodeSize(dir, basename, symbols.length);
    g.setNode(filePath, { width: size.width, height: size.height });
  }

  for (const edge of cluster.edges) {
    g.setEdge(edge.definesFile, edge.referencesFile);
  }

  dagre.layout(g);

  const faint = cssVar("--color-fg-faint");

  const nodes: Node[] = cluster.files.map((filePath) => {
    const pos = g.node(filePath);
    const meta = fileMeta.get(filePath)!;
    return {
      id: filePath,
      type: "depFile",
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
      data: {
        filePath,
        dir: meta.dir,
        basename: meta.basename,
        symbols: meta.symbols,
        onNavigate,
      },
    };
  });

  const edges: Edge[] = edgeRoutes.map((route) => ({
    id: `${route.source}:${route.sourceHandle}->${route.target}${route.targetHandle ? `:${route.targetHandle}` : ""}`,
    source: route.source,
    sourceHandle: route.sourceHandle,
    target: route.target,
    targetHandle: route.targetHandle,
    style: { stroke: faint, strokeWidth: 1.5 },
  }));

  const graphMeta = g.graph();
  return {
    nodes,
    edges,
    width: graphMeta.width ?? 0,
    height: graphMeta.height ?? 0,
  };
}

function ClusterDiagram({
  cluster,
  symbolDiffs,
  onNavigate,
}: {
  cluster: FileCluster;
  symbolDiffs: FileSymbolDiff[];
  onNavigate: (filePath: string, hunkId?: string) => void;
}): ReactNode {
  const { fileSymbols, edgeRoutes } = useMemo(
    () => collectNodeData(cluster, symbolDiffs),
    [cluster, symbolDiffs],
  );

  const {
    nodes,
    edges,
    height: layoutHeight,
  } = useMemo(
    () => buildDepFlowGraph(cluster, fileSymbols, edgeRoutes, onNavigate),
    [cluster, fileSymbols, edgeRoutes, onNavigate],
  );

  // Use layout height + padding, with a reasonable min/max
  const containerHeight = Math.max(200, layoutHeight + 60);

  return (
    <div style={{ height: containerHeight }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={depNodeTypes}
        colorMode="dark"
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
      />
    </div>
  );
}

function DependencyGraphSection(): ReactNode {
  const symbolDiffs = useReviewStore((s) => s.symbolDiffs);
  const symbolsLoaded = useReviewStore((s) => s.symbolsLoaded);
  const symbolsLoading = useReviewStore((s) => s.symbolsLoading);
  const loadSymbols = useReviewStore((s) => s.loadSymbols);
  const files = useReviewStore((s) => s.files);
  const hunks = useReviewStore((s) => s.hunks);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  useEffect(() => {
    if (!symbolsLoaded && !symbolsLoading && files.length > 0) {
      loadSymbols();
    }
  }, [symbolsLoaded, symbolsLoading, files.length, loadSymbols]);

  // Index map for O(1) hunk ID → index lookups
  const hunkIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < hunks.length; i++) map.set(hunks[i].id, i);
    return map;
  }, [hunks]);

  const handleNavigate = useCallback(
    (filePath: string, hunkId?: string) => {
      navigateToBrowse(filePath);
      if (hunkId) {
        const hunkIndex = hunkIndexMap.get(hunkId);
        if (hunkIndex !== undefined) {
          useReviewStore.setState({ focusedHunkIndex: hunkIndex });
        }
      }
    },
    [navigateToBrowse, hunkIndexMap],
  );

  const graph = useMemo(() => buildDependencyGraph(symbolDiffs), [symbolDiffs]);

  const multiFileClusters = useMemo(
    () => graph.clusters.filter((c) => c.files.length > 1),
    [graph.clusters],
  );

  const standaloneCount = graph.clusters.length - multiFileClusters.length;

  // Hide entirely if no multi-file clusters
  if (!symbolsLoading && multiFileClusters.length === 0) return null;

  if (symbolsLoading) {
    return (
      <div className="rounded-lg border border-edge p-4">
        <div className="flex items-center gap-2 text-fg-muted">
          <Spinner />
          <span className="text-xs">Analyzing file dependencies…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wide">
        Connected Changes
      </h3>
      {multiFileClusters.map((cluster, i) => (
        <div key={i} className="rounded-lg border border-edge overflow-hidden">
          <ClusterDiagram
            cluster={cluster}
            symbolDiffs={symbolDiffs}
            onNavigate={handleNavigate}
          />
        </div>
      ))}
      {standaloneCount > 0 && (
        <p className="text-xxs text-fg-faint">
          + {standaloneCount} standalone{" "}
          {standaloneCount === 1 ? "file" : "files"}
        </p>
      )}
    </div>
  );
}

export function OverviewContent(): ReactNode {
  const progress = useReviewProgress();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-5xl w-full mx-auto px-4 py-4">
          <SummaryStats {...progress} />
          <div className="mt-4 space-y-4">
            <SummaryFileTree />
            <SummarySection />
            <DependencyGraphSection />
          </div>
        </div>
      </div>
    </div>
  );
}
