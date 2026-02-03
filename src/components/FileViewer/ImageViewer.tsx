import { useState, useRef, useEffect, useCallback } from "react";

interface ImageViewerProps {
  imageDataUrl: string;
  oldImageDataUrl?: string;
  filePath: string;
  hasChanges: boolean;
}

type DiffMode = "single" | "side-by-side" | "overlay";
type ZoomLevel = "fit" | "100" | "200" | "50";

interface ImageMetadata {
  width: number;
  height: number;
  size?: string;
}

export function ImageViewer({
  imageDataUrl,
  oldImageDataUrl,
  filePath,
  hasChanges,
}: ImageViewerProps) {
  const [diffMode, setDiffMode] = useState<DiffMode>(
    hasChanges && oldImageDataUrl ? "side-by-side" : "single",
  );
  const [zoom, setZoom] = useState<ZoomLevel>("fit");
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [newMetadata, setNewMetadata] = useState<ImageMetadata | null>(null);
  const [oldMetadata, setOldMetadata] = useState<ImageMetadata | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  // Load image metadata
  useEffect(() => {
    if (imageDataUrl) {
      const img = new Image();
      img.onload = () => {
        setNewMetadata({
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.src = imageDataUrl;
    }
  }, [imageDataUrl]);

  useEffect(() => {
    if (oldImageDataUrl) {
      const img = new Image();
      img.onload = () => {
        setOldMetadata({
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.src = oldImageDataUrl;
    }
  }, [oldImageDataUrl]);

  // Handle slider dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSliderPosition(percentage);
    },
    [isDragging],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const getZoomScale = () => {
    switch (zoom) {
      case "50":
        return 0.5;
      case "100":
        return 1;
      case "200":
        return 2;
      default:
        return undefined; // fit
    }
  };

  const getImageStyle = (scale?: number) => {
    if (scale) {
      return {
        width: "auto",
        height: "auto",
        maxWidth: "none",
        maxHeight: "none",
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      };
    }
    return {
      maxWidth: "100%",
      maxHeight: "100%",
      width: "auto",
      height: "auto",
    };
  };

  const scale = getZoomScale();
  const imageStyle = getImageStyle(scale);

  const canShowDiff = hasChanges && oldImageDataUrl;

  // Determine what metadata to show
  const dimensionsChanged =
    oldMetadata &&
    newMetadata &&
    (oldMetadata.width !== newMetadata.width ||
      oldMetadata.height !== newMetadata.height);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-stone-800/50 bg-stone-900/50 px-3 py-1.5">
        <div className="flex items-center gap-2">
          {/* Diff mode toggle */}
          {canShowDiff && (
            <div className="flex items-center rounded bg-stone-800/30 p-0.5">
              <button
                onClick={() => setDiffMode("side-by-side")}
                className={`rounded px-2 py-0.5 text-xxs font-medium transition-all ${
                  diffMode === "side-by-side"
                    ? "bg-stone-700/50 text-stone-200"
                    : "text-stone-500 hover:text-stone-300"
                }`}
              >
                Side by Side
              </button>
              <button
                onClick={() => setDiffMode("overlay")}
                className={`rounded px-2 py-0.5 text-xxs font-medium transition-all ${
                  diffMode === "overlay"
                    ? "bg-stone-700/50 text-stone-200"
                    : "text-stone-500 hover:text-stone-300"
                }`}
              >
                Overlay
              </button>
              <button
                onClick={() => setDiffMode("single")}
                className={`rounded px-2 py-0.5 text-xxs font-medium transition-all ${
                  diffMode === "single"
                    ? "bg-stone-700/50 text-stone-200"
                    : "text-stone-500 hover:text-stone-300"
                }`}
              >
                New Only
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Image metadata */}
          {newMetadata && (
            <div className="flex items-center gap-2 text-xxs text-stone-500">
              <span>
                {newMetadata.width} x {newMetadata.height}
              </span>
              {dimensionsChanged && oldMetadata && (
                <span className="text-amber-500">
                  (was {oldMetadata.width} x {oldMetadata.height})
                </span>
              )}
            </div>
          )}

          {/* Zoom controls */}
          <div className="flex items-center rounded bg-stone-800/30 p-0.5">
            <button
              onClick={() => setZoom("fit")}
              className={`rounded px-2 py-0.5 text-xxs font-medium transition-all ${
                zoom === "fit"
                  ? "bg-stone-700/50 text-stone-200"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              Fit
            </button>
            <button
              onClick={() => setZoom("50")}
              className={`rounded px-2 py-0.5 text-xxs font-medium transition-all ${
                zoom === "50"
                  ? "bg-stone-700/50 text-stone-200"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              50%
            </button>
            <button
              onClick={() => setZoom("100")}
              className={`rounded px-2 py-0.5 text-xxs font-medium transition-all ${
                zoom === "100"
                  ? "bg-stone-700/50 text-stone-200"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              100%
            </button>
            <button
              onClick={() => setZoom("200")}
              className={`rounded px-2 py-0.5 text-xxs font-medium transition-all ${
                zoom === "200"
                  ? "bg-stone-700/50 text-stone-200"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              200%
            </button>
          </div>
        </div>
      </div>

      {/* Image content */}
      <div className="flex-1 overflow-auto" ref={containerRef}>
        {diffMode === "single" && (
          <div className="image-viewer-checkerboard flex h-full items-center justify-center p-4">
            <img
              src={imageDataUrl}
              alt={filePath}
              style={imageStyle}
              className="image-viewer-shadow"
            />
          </div>
        )}

        {diffMode === "side-by-side" && oldImageDataUrl && (
          <div className="flex h-full">
            {/* Old image */}
            <div className="image-viewer-checkerboard flex flex-1 flex-col border-r border-stone-800">
              <div className="bg-stone-900/80 px-3 py-1 text-xxs font-medium text-rose-400">
                Before
              </div>
              <div className="flex flex-1 items-center justify-center overflow-auto p-4">
                <img
                  src={oldImageDataUrl}
                  alt={`${filePath} (old)`}
                  style={imageStyle}
                  className="image-viewer-shadow"
                />
              </div>
            </div>
            {/* New image */}
            <div className="image-viewer-checkerboard flex flex-1 flex-col">
              <div className="bg-stone-900/80 px-3 py-1 text-xxs font-medium text-emerald-400">
                After
              </div>
              <div className="flex flex-1 items-center justify-center overflow-auto p-4">
                <img
                  src={imageDataUrl}
                  alt={`${filePath} (new)`}
                  style={imageStyle}
                  className="image-viewer-shadow"
                />
              </div>
            </div>
          </div>
        )}

        {diffMode === "overlay" && oldImageDataUrl && (
          <div className="image-viewer-checkerboard relative flex h-full items-center justify-center p-4">
            {/* Container for both images */}
            <div className="relative">
              {/* Old image (full) */}
              <img
                src={oldImageDataUrl}
                alt={`${filePath} (old)`}
                style={imageStyle}
                className="image-viewer-shadow"
              />
              {/* New image (clipped) */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${sliderPosition}%` }}
              >
                <img
                  src={imageDataUrl}
                  alt={`${filePath} (new)`}
                  style={imageStyle}
                  className="image-viewer-shadow"
                />
              </div>
              {/* Slider handle */}
              <div
                ref={sliderRef}
                className="image-diff-slider"
                style={{ left: `${sliderPosition}%` }}
                onMouseDown={handleMouseDown}
              >
                <div className="image-diff-slider-handle">
                  <svg
                    className="h-4 w-4 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 9l4-4 4 4m0 6l-4 4-4-4"
                    />
                  </svg>
                </div>
              </div>
            </div>
            {/* Labels */}
            <div className="absolute bottom-4 left-4 rounded bg-rose-500/80 px-2 py-0.5 text-xxs font-medium text-white">
              Before
            </div>
            <div className="absolute bottom-4 right-4 rounded bg-emerald-500/80 px-2 py-0.5 text-xxs font-medium text-white">
              After
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
