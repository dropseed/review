import {
  type ReactNode,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useReviewStore } from "../../stores";
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { SidebarResizeHandle } from "../ui/sidebar-resize-handle";
import type { AgentMessage, AgentMessagePart } from "../../types";

// ---------------------------------------------------------------------------
// Part renderers
// ---------------------------------------------------------------------------

function TextPart({ text }: { text: string }): ReactNode {
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
      {text}
    </pre>
  );
}

function ToolUsePart({
  part,
  result,
}: {
  part: Extract<AgentMessagePart, { type: "tool_use" }>;
  result?: Extract<AgentMessagePart, { type: "tool_result" }>;
}): ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <div className="my-1.5 rounded border border-edge/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left
                   text-fg-muted hover:bg-fg/[0.03] transition-colors"
      >
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="font-medium text-fg-secondary">{part.toolName}</span>
        {result?.isError && (
          <span className="text-status-rejected ml-auto">error</span>
        )}
      </button>
      {open && result && (
        <div className="border-t border-edge/40 px-2 py-1.5 bg-fg/[0.02]">
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-fg-muted leading-relaxed max-h-48 overflow-y-auto scrollbar-thin">
            {result.content}
          </pre>
        </div>
      )}
    </div>
  );
}

function TaskPart({
  part,
}: {
  part: Extract<AgentMessagePart, { type: "task" }>;
}): ReactNode {
  return (
    <div className="flex items-center gap-1.5 my-1 text-xs text-fg-faint">
      {part.status === "running" ? (
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-status-approved" />
      )}
      <span>{part.description}</span>
    </div>
  );
}

function StatusPart({
  part,
}: {
  part: Extract<AgentMessagePart, { type: "status" }>;
}): ReactNode {
  return (
    <div className="text-xs text-fg-faint italic my-0.5">{part.message}</div>
  );
}

// ---------------------------------------------------------------------------
// Message renderer
// ---------------------------------------------------------------------------

function AgentMessageView({ message }: { message: AgentMessage }): ReactNode {
  const isUser = message.role === "user";

  return (
    <div
      className={`px-3 py-2 ${
        isUser ? "bg-fg/[0.04] rounded-lg ml-8" : "text-fg-secondary"
      }`}
    >
      {message.parts.map((part, i) => {
        switch (part.type) {
          case "text":
            return <TextPart key={i} text={part.text} />;
          case "tool_use": {
            // Find the matching tool_result
            const result = message.parts.find(
              (p): p is Extract<AgentMessagePart, { type: "tool_result" }> =>
                p.type === "tool_result" && p.toolUseId === part.toolUseId,
            );
            return <ToolUsePart key={i} part={part} result={result} />;
          }
          case "tool_result":
            // Rendered inline with tool_use — skip standalone
            return null;
          case "task":
            return <TaskPart key={i} part={part} />;
          case "status":
            return <StatusPart key={i} part={part} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

/** Render streaming parts (same as a message but in-progress). */
function StreamingParts({ parts }: { parts: AgentMessagePart[] }): ReactNode {
  if (parts.length === 0) {
    return (
      <div className="px-3 py-2">
        <span className="text-xs text-fg-faint animate-pulse">Thinking...</span>
      </div>
    );
  }

  return (
    <AgentMessageView
      message={{
        role: "assistant",
        parts,
        timestamp: "",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function AgentPanel(): ReactNode {
  const entry = useReviewStore((s) => s.getActiveAgentEntry());
  const sendMessage = useReviewStore((s) => s.agentSendMessage);
  const cancel = useReviewStore((s) => s.agentCancel);
  const clear = useReviewStore((s) => s.agentClear);
  const togglePanel = useReviewStore((s) => s.toggleAgentPanel);

  const { messages, loading, error, partialParts } = entry;

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { sidebarWidth, handleResizeStart } = useSidebarResize({
    sidebarPosition: "left",
    initialWidth: 20,
    minWidth: 14,
    maxWidth: 32,
  });

  // Auto-scroll to bottom on new messages or streaming
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, partialParts]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput("");
    sendMessage(trimmed);
  }, [input, loading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div
      className="relative flex shrink-0 flex-col overflow-hidden"
      style={{ width: `${sidebarWidth}rem` }}
    >
      <div
        className="flex flex-col flex-1 overflow-hidden bg-surface border-r border-edge"
        style={{ width: `${sidebarWidth}rem` }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-edge">
          <span className="text-xs font-semibold text-fg-muted uppercase tracking-wider">
            Agent
          </span>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clear}
                className="text-[10px] font-medium text-fg-faint hover:text-fg-muted
                           transition-colors px-1.5 py-0.5 rounded hover:bg-fg/[0.06]"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={togglePanel}
              className="p-1 rounded text-fg-faint hover:text-fg-muted hover:bg-fg/[0.06]
                         transition-colors"
              aria-label="Close agent panel"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto scrollbar-thin space-y-3 py-3"
        >
          {messages.length === 0 && !loading && (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-fg-faint text-center px-4">
                Ask a question about the code in this repo
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <AgentMessageView key={i} message={msg} />
          ))}

          {/* Streaming in-progress */}
          {loading && <StreamingParts parts={partialParts} />}

          {/* Error */}
          {error && (
            <div className="px-3 py-1.5">
              <p className="text-xs text-status-rejected">{error}</p>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-edge p-2">
          {loading ? (
            <button
              type="button"
              onClick={cancel}
              className="w-full py-1.5 text-xs font-medium text-fg-muted
                         bg-fg/[0.04] hover:bg-fg/[0.08] rounded-lg
                         transition-colors"
            >
              Cancel
            </button>
          ) : (
            <div className="flex gap-1.5">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about the code..."
                rows={1}
                className="flex-1 resize-none rounded-lg border border-edge bg-surface-raised
                           px-3 py-1.5 text-sm text-fg-secondary
                           placeholder:text-fg-faint
                           focus:outline-none focus:ring-1 focus:ring-focus-ring/50
                           scrollbar-thin"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!input.trim()}
                className="shrink-0 px-2 py-1.5 rounded-lg
                           bg-fg/[0.06] hover:bg-fg/[0.10]
                           text-fg-muted hover:text-fg-secondary
                           disabled:opacity-30 disabled:cursor-not-allowed
                           transition-colors"
                aria-label="Send message"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      <SidebarResizeHandle position="right" onMouseDown={handleResizeStart} />
    </div>
  );
}
