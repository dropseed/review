import { type ReactNode, useMemo } from "react";
import {
  ReactFlow,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { CopyErrorButton } from "./CopyErrorButton";

interface StructuredDiagramProps {
  sceneJson: string;
  onRetry?: () => void;
}

interface DiagramNode {
  id: string;
  label: string;
  files: string[];
  role: "new" | "modified" | "deleted" | "unchanged";
}

interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

interface DiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

/** Read a CSS custom property from :root. */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function getRoleStyles(): Record<
  DiagramNode["role"],
  { background: string; border: string }
> {
  const approved = cssVar("--color-status-approved");
  const modified = cssVar("--color-status-modified");
  const deleted = cssVar("--color-status-rejected");
  const muted = cssVar("--color-fg-faint");
  const inset = cssVar("--color-surface-inset");
  return {
    new: {
      background: `color-mix(in srgb, ${approved} 15%, ${inset})`,
      border: approved,
    },
    modified: {
      background: `color-mix(in srgb, ${modified} 15%, ${inset})`,
      border: modified,
    },
    deleted: {
      background: `color-mix(in srgb, ${deleted} 15%, ${inset})`,
      border: deleted,
    },
    unchanged: { background: inset, border: muted },
  };
}

type RoleNodeData = {
  label: string;
  files: string[];
  role: DiagramNode["role"];
};

type RoleNode = Node<RoleNodeData, "role">;

function RoleNodeComponent({ data }: NodeProps<RoleNode>): ReactNode {
  const styles = getRoleStyles();
  const style = styles[data.role] ?? styles.unchanged;
  return (
    <div
      className="rounded-md px-3 py-2"
      style={{
        background: style.background,
        border: `1.5px solid ${style.border}`,
      }}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="text-sm font-semibold text-fg">{data.label}</div>
      {data.files.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {data.files.map((file) => (
            <div key={file} className="text-[11px] text-fg-muted leading-snug">
              {file}
            </div>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}

const nodeTypes = { role: RoleNodeComponent };

const LABEL_CHAR_WIDTH = 8.4;
const FILE_CHAR_WIDTH = 6.6;
const NODE_PADDING_X = 24;
const NODE_PADDING_Y = 16;
const FILE_LINE_HEIGHT = 18;
const LABEL_LINE_HEIGHT = 22;

function estimateNodeSize(node: DiagramNode): {
  width: number;
  height: number;
} {
  const labelWidth = node.label.length * LABEL_CHAR_WIDTH;
  const maxFileWidth =
    node.files.length > 0
      ? Math.max(...node.files.map((f) => f.length * FILE_CHAR_WIDTH))
      : 0;
  const width = Math.max(labelWidth, maxFileWidth) + NODE_PADDING_X * 2;
  const height =
    NODE_PADDING_Y +
    LABEL_LINE_HEIGHT +
    (node.files.length > 0 ? 4 : 0) +
    node.files.length * FILE_LINE_HEIGHT +
    NODE_PADDING_Y;
  return { width, height };
}

function buildFlowGraph(data: DiagramData): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of data.nodes) {
    const size = estimateNodeSize(node);
    g.setNode(node.id, { width: size.width, height: size.height });
  }

  for (const edge of data.edges) {
    g.setEdge(edge.from, edge.to);
  }

  dagre.layout(g);

  const nodes: Node[] = data.nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      id: node.id,
      type: "role",
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
      data: { label: node.label, files: node.files, role: node.role },
    };
  });

  const edges: Edge[] = data.edges.map((edge) => ({
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    animated: false,
    style: { stroke: cssVar("--color-fg-faint"), strokeWidth: 1.5 },
    labelStyle: { fill: cssVar("--color-fg-muted"), fontSize: 10 },
    labelBgStyle: { fill: cssVar("--color-surface-inset"), opacity: 0.8 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 3,
  }));

  return { nodes, edges };
}

export function StructuredDiagram({
  sceneJson,
  onRetry,
}: StructuredDiagramProps): ReactNode {
  const parsed = useMemo<{
    nodes: Node[];
    edges: Edge[];
    error: string | null;
  }>(() => {
    try {
      const json = JSON.parse(sceneJson) as DiagramData;
      if (!Array.isArray(json.nodes)) {
        return { nodes: [], edges: [], error: "Missing nodes array" };
      }
      if (!json.edges) {
        json.edges = [];
      }
      const result = buildFlowGraph(json);
      return { ...result, error: null };
    } catch (err) {
      return {
        nodes: [],
        edges: [],
        error: err instanceof Error ? err.message : "Failed to parse diagram",
      };
    }
  }, [sceneJson]);

  if (parsed.error) {
    return (
      <div className="rounded-lg border border-status-rejected/30 bg-status-rejected/10 p-4">
        <div className="mb-2 flex items-center gap-2 text-status-rejected">
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span className="text-sm font-medium">Diagram render error</span>
        </div>
        <p className="text-xs text-status-rejected/80">{parsed.error}</p>
        <div className="mt-2 flex items-center gap-3">
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
            >
              Regenerate
            </button>
          )}
          <CopyErrorButton error={parsed.error} />
        </div>
      </div>
    );
  }

  return (
    <div className="my-4 h-[300px] rounded-lg bg-surface-panel/50">
      <ReactFlow
        nodes={parsed.nodes}
        edges={parsed.edges}
        nodeTypes={nodeTypes}
        colorMode="dark"
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.5}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
