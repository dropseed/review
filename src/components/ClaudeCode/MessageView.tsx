import { useEffect, useRef } from "react";
import { useReviewStore } from "../../stores/reviewStore";
import type { ClaudeCodeChainMessage } from "../../api";
import {
  ChatIcon,
  StatusDot,
  MessageTurnView,
  groupMessagesIntoTurns,
  groupChainMessagesIntoTurns,
  SessionDivider,
  formatRelativeTime,
} from "./shared";

export function MessageView() {
  const {
    claudeCodeSelectedSessionId,
    claudeCodeSessions,
    claudeCodeMessages,
    claudeCodeChainMessages,
    fetchClaudeCodeMessages,
    fetchClaudeCodeChainMessages,
  } = useReviewStore();

  const scrollRef = useRef<HTMLDivElement>(null);

  // Find the selected session object
  const selectedSession = claudeCodeSessions.find(
    (s) => s.session_id === claudeCodeSelectedSessionId,
  );

  const isChain = !!selectedSession?.chain_id;

  // Poll for messages every 5s when viewing an active session
  useEffect(() => {
    if (!claudeCodeSelectedSessionId) return;

    if (isChain) {
      fetchClaudeCodeChainMessages(claudeCodeSelectedSessionId);
    } else {
      fetchClaudeCodeMessages(claudeCodeSelectedSessionId);
    }

    const isActive = selectedSession?.status === "active";
    if (!isActive) return;

    const interval = setInterval(() => {
      if (isChain) {
        fetchClaudeCodeChainMessages(claudeCodeSelectedSessionId);
      } else {
        fetchClaudeCodeMessages(claudeCodeSelectedSessionId);
      }
    }, 5_000);
    return () => clearInterval(interval);
  }, [
    claudeCodeSelectedSessionId,
    selectedSession?.status,
    isChain,
    fetchClaudeCodeMessages,
    fetchClaudeCodeChainMessages,
  ]);

  // No session selected — empty state
  if (!claudeCodeSelectedSessionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-stone-500">
        <ChatIcon className="h-8 w-8 mb-3 text-stone-600" />
        <p className="text-sm text-stone-400">Select a session</p>
        <p className="text-2xs text-stone-600 mt-1">
          Choose a session from the sidebar to view activity
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Session info bar */}
      {selectedSession && (
        <div className="flex-shrink-0 border-b border-stone-800 px-4 py-2.5">
          <p className="text-2xs text-stone-300 leading-relaxed truncate">
            {selectedSession.summary}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <StatusDot status={selectedSession.status} />
            <span className="text-xxs text-stone-500">
              {formatRelativeTime(selectedSession.last_activity)}
            </span>
            {selectedSession.git_branch && (
              <span className="text-xxs text-stone-500 font-mono">
                {selectedSession.git_branch}
              </span>
            )}
            {isChain && <span className="text-xxs text-stone-600">chain</span>}
          </div>
        </div>
      )}

      {/* Message timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
        {isChain ? (
          <ChainTimeline messages={claudeCodeChainMessages} />
        ) : claudeCodeMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-stone-500">
            <ChatIcon className="h-5 w-5 mb-2 text-stone-600" />
            <p className="text-2xs">No messages in this session</p>
          </div>
        ) : (
          <div className="pb-4">
            {groupMessagesIntoTurns(claudeCodeMessages).map((turn, i) => (
              <MessageTurnView key={i} turn={turn} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Renders a merged chain timeline with session dividers between sessions. */
function ChainTimeline({ messages }: { messages: ClaudeCodeChainMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-stone-500">
        <ChatIcon className="h-5 w-5 mb-2 text-stone-600" />
        <p className="text-2xs">No messages in this chain</p>
      </div>
    );
  }

  // Group into turns, inserting session dividers when session_id changes
  const turns = groupChainMessagesIntoTurns(messages);
  let lastSessionId = "";

  return (
    <div className="pb-4">
      {turns.map((turn, i) => {
        const turnSessionId =
          turn.userMessage?.session_id ?? turn.responses[0]?.session_id ?? "";
        const turnSessionSummary =
          turn.userMessage?.session_summary ??
          turn.responses[0]?.session_summary ??
          "";
        const turnTimestamp =
          turn.userMessage?.timestamp ?? turn.responses[0]?.timestamp ?? "";

        const showDivider =
          turnSessionId !== lastSessionId && turnSessionId !== "";
        lastSessionId = turnSessionId;

        return (
          <div key={i}>
            {showDivider && (
              <SessionDivider
                sessionSummary={turnSessionSummary}
                timestamp={turnTimestamp}
              />
            )}
            <MessageTurnView
              turn={{
                userMessage: turn.userMessage
                  ? {
                      timestamp: turn.userMessage.timestamp,
                      message_type: turn.userMessage.message_type,
                      summary: turn.userMessage.summary,
                    }
                  : null,
                responses: turn.responses.map((r) => ({
                  timestamp: r.timestamp,
                  message_type: r.message_type,
                  summary: r.summary,
                })),
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
