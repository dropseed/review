import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";
import type { AgentMessage, AgentMessagePart, AgentResult } from "../../types";
import { makeReviewKey } from "./groupingSlice";

/** Per-review agent conversation state. */
export interface AgentEntry {
  messages: AgentMessage[];
  sessionId: string | null;
  loading: boolean;
  error: string | null;
  /** Parts accumulated during streaming (becomes the next assistant message). */
  partialParts: AgentMessagePart[];
  requestId: string | null;
}

/** Frozen default for stable selector references. */
const EMPTY_ENTRY: AgentEntry = Object.freeze({
  messages: [],
  sessionId: null,
  loading: false,
  error: null,
  partialParts: [],
  requestId: null,
});

export interface AgentSlice {
  agentPanelOpen: boolean;
  agentStates: Map<string, AgentEntry>;

  toggleAgentPanel: () => void;
  getActiveAgentEntry: () => AgentEntry;
  agentSendMessage: (message: string) => Promise<void>;
  agentCancel: () => void;
  agentClear: () => void;
}

/** Immutable Map update helper. */
function updateAgentEntry(
  map: Map<string, AgentEntry>,
  key: string,
  updater: (entry: AgentEntry) => AgentEntry,
): Map<string, AgentEntry> {
  const existing = map.get(key) ?? EMPTY_ENTRY;
  const updated = updater(existing);
  const next = new Map(map);
  next.set(key, updated);
  return next;
}

let agentNonce = 0;

export const createAgentSlice: SliceCreatorWithClient<AgentSlice> =
  (client: ApiClient) => (set, get) => ({
    agentPanelOpen: false,
    agentStates: new Map(),

    toggleAgentPanel: () => {
      set((prev) => ({ agentPanelOpen: !prev.agentPanelOpen }));
    },

    getActiveAgentEntry: () => {
      const { repoPath, comparison, agentStates } = get();
      if (!repoPath || !comparison) return EMPTY_ENTRY;
      const key = makeReviewKey(repoPath, comparison.key);
      return agentStates.get(key) ?? EMPTY_ENTRY;
    },

    agentSendMessage: async (message: string) => {
      const { repoPath, comparison } = get();
      if (!repoPath || !comparison) return;

      const reviewKey = makeReviewKey(repoPath, comparison.key);
      const entry = get().agentStates.get(reviewKey) ?? EMPTY_ENTRY;
      const sessionId = entry.sessionId;

      const requestId = `agent-${++agentNonce}`;
      const userMessage: AgentMessage = {
        role: "user",
        parts: [{ type: "text", text: message }],
        timestamp: new Date().toISOString(),
      };

      set((prev) => ({
        agentStates: updateAgentEntry(prev.agentStates, reviewKey, (e) => ({
          ...e,
          messages: [...e.messages, userMessage],
          loading: true,
          error: null,
          partialParts: [],
          requestId,
        })),
      }));

      const unlisten = client.onAgentEvent(requestId, (event) => {
        set((prev) => ({
          agentStates: updateAgentEntry(prev.agentStates, reviewKey, (e) => {
            const parts = [...e.partialParts];

            switch (event.type) {
              case "text_delta": {
                // Append to last text part or create new one
                const last = parts[parts.length - 1];
                if (last?.type === "text") {
                  parts[parts.length - 1] = {
                    ...last,
                    text: last.text + event.text,
                  };
                } else {
                  parts.push({ type: "text", text: event.text });
                }
                break;
              }
              case "tool_use":
                parts.push({
                  type: "tool_use",
                  toolName: event.toolName,
                  toolUseId: event.toolUseId,
                  input: event.input,
                });
                break;
              case "tool_result":
                parts.push({
                  type: "tool_result",
                  toolUseId: event.toolUseId,
                  content: event.content,
                  isError: event.isError,
                });
                break;
              case "task_started":
                parts.push({
                  type: "task",
                  taskId: event.taskId,
                  description: event.description,
                  status: "running",
                });
                break;
              case "task_progress": {
                // Update existing task part
                const idx = parts.findIndex(
                  (p) => p.type === "task" && p.taskId === event.taskId,
                );
                if (idx >= 0) {
                  parts[idx] = {
                    ...(parts[idx] as Extract<
                      AgentMessagePart,
                      { type: "task" }
                    >),
                    description: event.content,
                  };
                }
                break;
              }
              case "status":
                // Replace any existing status part
                {
                  const sIdx = parts.findIndex((p) => p.type === "status");
                  if (sIdx >= 0) {
                    parts[sIdx] = {
                      type: "status",
                      message: event.message,
                    };
                  } else {
                    parts.push({
                      type: "status",
                      message: event.message,
                    });
                  }
                }
                break;
              case "tool_summary":
                // Could render inline — for now skip
                break;
            }

            return { ...e, partialParts: parts };
          }),
        }));
      });

      try {
        const result: AgentResult = await client.agentSendMessage(
          repoPath,
          message,
          requestId,
          sessionId ?? undefined,
        );

        const assistantMessage: AgentMessage = {
          role: "assistant",
          // Use the accumulated parts if we have them, otherwise fall back to result text
          parts: get().agentStates.get(reviewKey)?.partialParts.length
            ? get()
                .agentStates.get(reviewKey)!
                .partialParts.filter((p) => p.type !== "status")
            : [{ type: "text", text: result.text }],
          timestamp: new Date().toISOString(),
        };

        set((prev) => ({
          agentStates: updateAgentEntry(prev.agentStates, reviewKey, (e) => ({
            ...e,
            messages: [...e.messages, assistantMessage],
            sessionId: result.sessionId,
            loading: false,
            partialParts: [],
            requestId: null,
          })),
        }));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const partial = get().agentStates.get(reviewKey)?.partialParts ?? [];

        set((prev) => ({
          agentStates: updateAgentEntry(prev.agentStates, reviewKey, (e) => {
            const updates: Partial<AgentEntry> = {
              loading: false,
              partialParts: [],
              requestId: null,
              error: errMsg,
            };
            // Save partial content as a message if we have any
            if (partial.length > 0) {
              const partialMessage: AgentMessage = {
                role: "assistant",
                parts: partial.filter((p) => p.type !== "status"),
                timestamp: new Date().toISOString(),
              };
              return {
                ...e,
                ...updates,
                messages: [...e.messages, partialMessage],
              };
            }
            return { ...e, ...updates };
          }),
        }));
      } finally {
        unlisten();
      }
    },

    agentCancel: () => {
      const { repoPath, comparison } = get();
      if (!repoPath || !comparison) return;
      const reviewKey = makeReviewKey(repoPath, comparison.key);
      const entry = get().agentStates.get(reviewKey);
      if (entry?.requestId) {
        client.agentCancel(entry.requestId);
      }
      set((prev) => ({
        agentStates: updateAgentEntry(prev.agentStates, reviewKey, (e) => ({
          ...e,
          loading: false,
        })),
      }));
    },

    agentClear: () => {
      const { repoPath, comparison } = get();
      if (!repoPath || !comparison) return;
      const reviewKey = makeReviewKey(repoPath, comparison.key);
      set((prev) => {
        const next = new Map(prev.agentStates);
        next.delete(reviewKey);
        return { agentStates: next };
      });
    },
  });
