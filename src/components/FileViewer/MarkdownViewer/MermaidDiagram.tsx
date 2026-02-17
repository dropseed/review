import { useEffect, useRef, useState, useId, useCallback } from "react";
import { SimpleTooltip } from "../../ui/tooltip";

interface MermaidDiagramProps {
  code: string;
}

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const uniqueId = useId().replace(/:/g, "-");

  const zoomIn = () => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM));
  const zoomOut = () => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM));
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only pan with left mouse button
      if (e.button !== 0) return;
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    },
    [isPanning, panStart],
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Handle wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom((z) => Math.min(Math.max(z + delta, MIN_ZOOM), MAX_ZOOM));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      if (!containerRef.current) return;

      setLoading(true);
      setError(null);

      try {
        // Lazy load mermaid
        const mermaid = (await import("mermaid")).default;

        // Initialize with dark theme
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            primaryColor: "#44403c",
            primaryTextColor: "#fafaf9",
            primaryBorderColor: "#57534e",
            lineColor: "#78716c",
            secondaryColor: "#292524",
            tertiaryColor: "#1c1917",
            background: "#0c0a09",
            mainBkg: "#292524",
            nodeBorder: "#57534e",
            clusterBkg: "#1c1917",
            clusterBorder: "#44403c",
            titleColor: "#fafaf9",
            edgeLabelBackground: "#292524",
          },
          securityLevel: "strict",
          fontFamily:
            "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
        });

        if (cancelled) return;

        // Render the diagram
        const { svg } = await mermaid.render(`mermaid-${uniqueId}`, code);

        if (cancelled || !containerRef.current) return;

        containerRef.current.innerHTML = svg;
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to render diagram",
        );
        setLoading(false);
      }
    }

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [code, uniqueId]);

  if (error) {
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
          <span className="text-sm font-medium">Mermaid syntax error</span>
        </div>
        <p className="mb-3 text-xs text-status-rejected/80">{error}</p>
        <pre className="overflow-x-auto rounded bg-surface-panel p-3 text-xs text-fg-secondary">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="relative my-4 group">
      {/* Zoom controls - visible on hover */}
      {!loading && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded bg-surface-raised/90 p-1 opacity-0 transition-opacity group-hover:opacity-100">
          <SimpleTooltip content="Zoom out">
            <button
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg-secondary disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
            >
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
                  d="M20 12H4"
                />
              </svg>
            </button>
          </SimpleTooltip>
          <SimpleTooltip content="Reset view">
            <button
              onClick={resetView}
              className="min-w-[3rem] rounded px-1 py-0.5 text-xs tabular-nums text-fg-muted hover:bg-surface-hover hover:text-fg-secondary"
            >
              {Math.round(zoom * 100)}%
            </button>
          </SimpleTooltip>
          <SimpleTooltip content="Zoom in">
            <button
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg-secondary disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
            >
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
          </SimpleTooltip>
        </div>
      )}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-panel/50">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-edge-default border-t-status-modified" />
        </div>
      )}
      <div
        ref={viewportRef}
        className={`overflow-hidden rounded-lg bg-surface-panel/50 ${
          isPanning ? "cursor-grabbing" : "cursor-grab"
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      >
        <div
          ref={containerRef}
          className="mermaid-container flex min-h-[200px] items-center justify-center p-4"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        />
      </div>
    </div>
  );
}
