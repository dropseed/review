import { query } from "@anthropic-ai/claude-agent-sdk";
import * as readline from "readline";

// Active requests for cancellation
const activeRequests = new Map<string, AbortController>();

// Write a JSON line to stdout
function emit(event: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

// Handle a "send" message: run a query and stream events
async function handleSend(msg: {
  requestId: string;
  message: string;
  cwd: string;
  sessionId?: string | null;
}): Promise<void> {
  const ac = new AbortController();
  activeRequests.set(msg.requestId, ac);

  const startMs = Date.now();

  try {
    const q = query({
      prompt: msg.message,
      options: {
        cwd: msg.cwd,
        resume: msg.sessionId ?? undefined,
        abortController: ac,
        permissionMode: "bypassPermissions",
      },
    });

    for await (const sdkMsg of q) {
      switch (sdkMsg.type) {
        case "assistant": {
          for (const block of sdkMsg.message.content) {
            if (block.type === "text" && block.text) {
              emit({
                type: "text_delta",
                requestId: msg.requestId,
                text: block.text,
              });
            } else if (block.type === "tool_use") {
              emit({
                type: "tool_use",
                requestId: msg.requestId,
                toolName: block.name,
                toolUseId: block.id,
                input: block.input,
              });
            }
          }
          break;
        }

        case "user": {
          // Tool results — the SDK yields these after tool execution
          for (const block of sdkMsg.message.content) {
            if (block.type === "tool_result") {
              let content = "";
              if (typeof block.content === "string") {
                content = block.content;
              } else if (Array.isArray(block.content)) {
                content = block.content
                  .map((c: { type: string; text?: string }) =>
                    c.type === "text" ? c.text ?? "" : "",
                  )
                  .join("");
              }
              emit({
                type: "tool_result",
                requestId: msg.requestId,
                toolUseId: block.tool_use_id,
                content:
                  content.length > 2000
                    ? content.slice(0, 2000) + "\n... (truncated)"
                    : content,
                isError: block.is_error ?? false,
              });
            }
          }
          break;
        }

        case "tool_use_summary": {
          emit({
            type: "tool_summary",
            requestId: msg.requestId,
            toolName: "",
            summary: sdkMsg.summary,
          });
          break;
        }

        case "tool_progress": {
          emit({
            type: "status",
            requestId: msg.requestId,
            message: `${sdkMsg.tool_name}...`,
          });
          break;
        }

        case "system": {
          // System messages have subtypes for tasks and status
          if (sdkMsg.subtype === "task_started") {
            emit({
              type: "task_started",
              requestId: msg.requestId,
              taskId: sdkMsg.task_id,
              description: sdkMsg.description,
            });
          } else if (sdkMsg.subtype === "task_progress") {
            emit({
              type: "task_progress",
              requestId: msg.requestId,
              taskId: sdkMsg.task_id,
              description: sdkMsg.description,
            });
          }
          break;
        }

        case "result": {
          emit({
            type: "result",
            requestId: msg.requestId,
            sessionId: sdkMsg.session_id,
            text: sdkMsg.subtype === "success" ? sdkMsg.result : "",
            costUsd: sdkMsg.total_cost_usd,
            durationMs: Date.now() - startMs,
            inputTokens: sdkMsg.usage.input_tokens,
            outputTokens: sdkMsg.usage.output_tokens,
          });
          break;
        }

        // Skip: stream_event, compact_boundary, auth_status, rate_limit_event, etc.
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emit({
      type: "error",
      requestId: msg.requestId,
      error: message,
    });
  } finally {
    activeRequests.delete(msg.requestId);
  }
}

// Handle a "cancel" message
function handleCancel(msg: { requestId: string }): void {
  const ac = activeRequests.get(msg.requestId);
  if (ac) {
    ac.abort();
  }
}

interface SendMessage {
  type: "send";
  requestId: string;
  message: string;
  cwd: string;
  sessionId?: string | null;
}

interface CancelMessage {
  type: "cancel";
  requestId: string;
}

type IncomingMessage = SendMessage | CancelMessage;

// Main loop: read JSON lines from stdin
const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line: string) => {
  let msg: IncomingMessage;
  try {
    msg = JSON.parse(line) as IncomingMessage;
  } catch {
    process.stderr.write(`[agent] Failed to parse stdin: ${line}\n`);
    return;
  }

  switch (msg.type) {
    case "send":
      handleSend(msg);
      break;
    case "cancel":
      handleCancel(msg);
      break;
    default:
      process.stderr.write(
        `[agent] Unknown message type: ${(msg as { type: string }).type}\n`,
      );
  }
});

rl.on("close", () => {
  process.exit(0);
});
