import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { SimpleTooltip } from "../ui/tooltip";
import { CopyErrorButton } from "./CopyErrorButton";

interface ExcalidrawDiagramProps {
  sceneJson: string;
  onRetry?: () => void;
}

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

export function ExcalidrawDiagram({
  sceneJson,
  onRetry,
}: ExcalidrawDiagramProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const zoomIn = () => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM));
  const zoomOut = () => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM));
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
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

  const stopPanning = useCallback(() => {
    setIsPanning(false);
  }, []);

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
        const parsed = JSON.parse(sceneJson);
        const elements = parsed.elements;
        if (!Array.isArray(elements)) {
          throw new Error("Missing elements array in diagram JSON");
        }

        // Sanitize: arrows/lines need a valid points array
        const sanitized = elements.filter((el: Record<string, unknown>) => {
          if (el.type === "arrow" || el.type === "line") {
            return Array.isArray(el.points);
          }
          return true;
        });

        const { exportToSvg } = await import("@excalidraw/excalidraw");

        if (cancelled) return;

        const svg = await exportToSvg({
          elements: sanitized,
          files: null,
          appState: {
            viewBackgroundColor: "transparent",
          },
        });

        if (cancelled || !containerRef.current) return;

        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(svg);
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
  }, [sceneJson]);

  if (error) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">
        <div className="mb-2 flex items-center gap-2 text-rose-400">
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
        <p className="text-xs text-rose-300/80">{error}</p>
        <div className="mt-2 flex items-center gap-3">
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-xxs text-stone-400 hover:text-stone-200 transition-colors"
            >
              Regenerate
            </button>
          )}
          <CopyErrorButton error={error} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative my-4 group">
      {!loading && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded bg-stone-800/90 p-1 opacity-0 transition-opacity group-hover:opacity-100">
          <SimpleTooltip content="Zoom out">
            <button
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              className="rounded p-1 text-stone-400 hover:bg-stone-700 hover:text-stone-200 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-400"
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
              className="min-w-[3rem] rounded px-1 py-0.5 text-xs tabular-nums text-stone-400 hover:bg-stone-700 hover:text-stone-200"
            >
              {Math.round(zoom * 100)}%
            </button>
          </SimpleTooltip>
          <SimpleTooltip content="Zoom in">
            <button
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="rounded p-1 text-stone-400 hover:bg-stone-700 hover:text-stone-200 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-400"
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
        <div className="absolute inset-0 flex items-center justify-center bg-stone-900/50">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-700 border-t-amber-500" />
        </div>
      )}
      <div
        ref={viewportRef}
        className={`overflow-hidden rounded-lg bg-stone-900/50 ${
          isPanning ? "cursor-grabbing" : "cursor-grab"
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopPanning}
        onMouseLeave={stopPanning}
        onWheel={handleWheel}
      >
        <div
          ref={containerRef}
          className="flex min-h-[200px] items-center justify-center p-4"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        />
      </div>
    </div>
  );
}
