import { useEffect } from "react";
import { useReviewStore } from "../../stores/reviewStore";
import { ChatIcon, ChainRow, SectionHeader, groupSessions } from "./shared";

export function SessionList() {
  const {
    claudeCodeSessions,
    claudeCodeSelectedSessionId,
    setClaudeCodeSelectedSessionId,
    fetchClaudeCodeSessions,
  } = useReviewStore();

  // Poll for sessions every 5s while mounted
  useEffect(() => {
    fetchClaudeCodeSessions();
    const interval = setInterval(fetchClaudeCodeSessions, 5_000);
    return () => clearInterval(interval);
  }, [fetchClaudeCodeSessions]);

  const groups = groupSessions(claudeCodeSessions);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center border-b border-stone-800 px-4">
        <span className="text-xs font-medium text-stone-400">Sessions</span>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-stone-500">
            <ChatIcon className="h-5 w-5 mb-2 text-stone-600" />
            <p className="text-2xs">No sessions found</p>
          </div>
        ) : (
          <div className="py-1">
            {groups.map((group) => (
              <div key={group.label}>
                <SectionHeader label={group.label} />
                {group.chains.map((chain) => (
                  <ChainRow
                    key={chain.id}
                    chain={chain}
                    selectedSessionId={claudeCodeSelectedSessionId ?? undefined}
                    onSelectSession={setClaudeCodeSelectedSessionId}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
