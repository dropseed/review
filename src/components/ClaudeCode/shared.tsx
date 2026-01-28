import type {
  ClaudeCodeMessage,
  ClaudeCodeSession,
  ClaudeCodeChainMessage,
} from "../../api";

/** Format an ISO timestamp as a relative time string. */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// --- Icon components ---

export function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

export function ChatIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function UserIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

// --- Status dot ---

export function StatusDot({ status }: { status: string }) {
  if (status === "active") {
    return (
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
      </span>
    );
  }
  if (status === "recent") {
    return (
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
      </span>
    );
  }
  return (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      <span className="relative inline-flex h-2 w-2 rounded-full bg-stone-600" />
    </span>
  );
}

// --- Session row ---

export function SessionRow({
  session,
  selected,
  onClick,
}: {
  session: ClaudeCodeSession;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
        selected ? "bg-stone-800/60" : "hover:bg-stone-800/40"
      }`}
    >
      <StatusDot status={session.status} />
      <div className="min-w-0 flex-1">
        <p className="text-2xs leading-relaxed text-stone-300 truncate">
          {session.summary}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {session.git_branch && (
            <span className="text-xxs text-stone-500 font-mono truncate max-w-[120px]">
              {session.git_branch}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <span className="text-xxs tabular-nums text-stone-500">
          {formatRelativeTime(session.last_activity)}
        </span>
        <span className="text-xxs text-stone-600">
          {session.message_count} msgs
        </span>
      </div>
    </button>
  );
}

// --- Message components ---

function ToolUseRow({ message }: { message: ClaudeCodeMessage }) {
  let toolName = "";
  let toolDetail = "";
  const colonIdx = message.summary.indexOf(": ");
  if (colonIdx !== -1) {
    toolName = message.summary.slice(0, colonIdx);
    toolDetail = message.summary.slice(colonIdx + 2);
  } else {
    toolName = message.summary;
  }

  return (
    <div className="flex items-start gap-2 px-5 py-1">
      <WrenchIcon className="h-3 w-3 mt-px flex-shrink-0 text-stone-600" />
      <span className="font-mono text-xxs text-stone-500 flex-shrink-0">
        {toolName}
      </span>
      {toolDetail && (
        <span className="text-xxs text-stone-600 break-all min-w-0">
          {toolDetail}
        </span>
      )}
    </div>
  );
}

function UserMessageRow({ message }: { message: ClaudeCodeMessage }) {
  return (
    <div className="mx-5 rounded-lg bg-stone-800 px-4 py-3">
      <p className="text-2xs leading-relaxed text-stone-200 whitespace-pre-wrap">
        {message.summary}
      </p>
    </div>
  );
}

function AssistantMessageRow({ message }: { message: ClaudeCodeMessage }) {
  return (
    <div className="px-5 py-1">
      <p className="text-2xs leading-relaxed text-stone-400 whitespace-pre-wrap">
        {message.summary}
      </p>
    </div>
  );
}

/** A group of messages forming one conversational turn. */
export interface MessageTurn {
  userMessage: ClaudeCodeMessage | null;
  responses: ClaudeCodeMessage[];
}

/** Group a flat message list into conversational turns. Each user message starts a new turn. */
export function groupMessagesIntoTurns(
  messages: ClaudeCodeMessage[],
): MessageTurn[] {
  const turns: MessageTurn[] = [];
  let current: MessageTurn = { userMessage: null, responses: [] };

  for (const msg of messages) {
    if (msg.message_type === "user") {
      // Push previous turn if it has content
      if (current.userMessage || current.responses.length > 0) {
        turns.push(current);
      }
      current = { userMessage: msg, responses: [] };
    } else {
      current.responses.push(msg);
    }
  }

  // Push final turn
  if (current.userMessage || current.responses.length > 0) {
    turns.push(current);
  }

  return turns;
}

export function MessageTurnView({ turn }: { turn: MessageTurn }) {
  return (
    <div>
      {turn.userMessage && (
        <div className="pt-3 pb-2">
          <UserMessageRow message={turn.userMessage} />
        </div>
      )}
      {turn.responses.map((msg, i) =>
        msg.message_type === "tool_use" ? (
          <ToolUseRow key={`${msg.timestamp}-${i}`} message={msg} />
        ) : (
          <AssistantMessageRow key={`${msg.timestamp}-${i}`} message={msg} />
        ),
      )}
    </div>
  );
}

/** @deprecated Use MessageTurnView + groupMessagesIntoTurns instead */
export function MessageRow({ message }: { message: ClaudeCodeMessage }) {
  if (message.message_type === "tool_use")
    return <ToolUseRow message={message} />;
  if (message.message_type === "user")
    return <UserMessageRow message={message} />;
  return <AssistantMessageRow message={message} />;
}

// --- Section header for grouped sessions ---

export function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 pt-3 pb-1">
      <span className="text-xxs font-medium uppercase tracking-wider text-stone-500">
        {label}
      </span>
    </div>
  );
}

// --- Session chains ---

export interface SessionChain {
  /** The chain_id (root session ID), or the session_id for standalone sessions. */
  id: string;
  /** All sessions in the chain, ordered by chain_position. */
  sessions: ClaudeCodeSession[];
  /** Most recent activity across all sessions in the chain. */
  lastActivity: string;
  /** Status of the most recent session (determines time grouping). */
  status: string;
}

/** Group sessions into chains. Standalone sessions become single-session chains. */
export function groupSessionsIntoChains(
  sessions: ClaudeCodeSession[],
): SessionChain[] {
  const chainMap = new Map<string, ClaudeCodeSession[]>();

  for (const session of sessions) {
    const key = session.chain_id ?? session.session_id;
    if (!chainMap.has(key)) {
      chainMap.set(key, []);
    }
    chainMap.get(key)!.push(session);
  }

  const chains: SessionChain[] = [];
  for (const [id, chainSessions] of chainMap) {
    // Sort by chain_position
    chainSessions.sort((a, b) => a.chain_position - b.chain_position);

    // Most recent activity is the max last_activity in the chain
    const lastActivity = chainSessions.reduce(
      (latest, s) => (s.last_activity > latest ? s.last_activity : latest),
      chainSessions[0].last_activity,
    );

    // Status is determined by most active session
    const statusPriority: Record<string, number> = {
      active: 0,
      recent: 1,
      today: 2,
      older: 3,
    };
    const status = chainSessions.reduce(
      (best, s) =>
        (statusPriority[s.status] ?? 3) < (statusPriority[best] ?? 3)
          ? s.status
          : best,
      chainSessions[0].status,
    );

    chains.push({ id, sessions: chainSessions, lastActivity, status });
  }

  // Sort chains by most recent activity descending
  chains.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));

  return chains;
}

// --- Group sessions by status ---

export interface SessionGroup {
  label: string;
  chains: SessionChain[];
}

export function groupSessions(sessions: ClaudeCodeSession[]): SessionGroup[] {
  const chains = groupSessionsIntoChains(sessions);

  const groups: Record<string, { label: string; chains: SessionChain[] }> = {
    active: { label: "Active", chains: [] },
    recent: { label: "Recent", chains: [] },
    today: { label: "Earlier Today", chains: [] },
    older: { label: "Older", chains: [] },
  };

  for (const chain of chains) {
    const group = groups[chain.status];
    if (group) {
      group.chains.push(chain);
    } else {
      groups.older.chains.push(chain);
    }
  }

  return Object.values(groups).filter((g) => g.chains.length > 0);
}

// --- Chain row ---

export function ChainRow({
  chain,
  selectedSessionId,
  onSelectSession,
}: {
  chain: SessionChain;
  selectedSessionId?: string;
  onSelectSession: (sessionId: string) => void;
}) {
  // Single-session chains render as a normal SessionRow
  if (chain.sessions.length === 1) {
    return (
      <SessionRow
        session={chain.sessions[0]}
        selected={selectedSessionId === chain.sessions[0].session_id}
        onClick={() => onSelectSession(chain.sessions[0].session_id)}
      />
    );
  }

  const root = chain.sessions[0];
  const children = chain.sessions.slice(1);

  return (
    <div>
      {/* Root session */}
      <button
        onClick={() => onSelectSession(root.session_id)}
        className={`group flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
          selectedSessionId === root.session_id
            ? "bg-stone-800/60"
            : "hover:bg-stone-800/40"
        }`}
      >
        <StatusDot status={root.status} />
        <div className="min-w-0 flex-1">
          <p className="text-2xs leading-relaxed text-stone-300 truncate">
            {root.summary}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            {root.git_branch && (
              <span className="text-xxs text-stone-500 font-mono truncate max-w-[120px]">
                {root.git_branch}
              </span>
            )}
            <span className="text-xxs text-stone-600">
              {chain.sessions.length} sessions
            </span>
          </div>
        </div>
        <span className="text-xxs tabular-nums text-stone-500 flex-shrink-0">
          {formatRelativeTime(root.last_activity)}
        </span>
      </button>

      {/* Child sessions */}
      {children.map((child, i) => (
        <button
          key={child.session_id}
          onClick={() => onSelectSession(child.session_id)}
          className={`group flex w-full items-center gap-2.5 pl-6 pr-4 py-1.5 text-left transition-colors ${
            selectedSessionId === child.session_id
              ? "bg-stone-800/60"
              : "hover:bg-stone-800/40"
          }`}
        >
          {/* Vertical connector line + small dot */}
          <div className="flex flex-col items-center w-2 flex-shrink-0">
            <div className="w-px h-1.5 bg-stone-700" />
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-stone-600 flex-shrink-0" />
            {i < children.length - 1 && (
              <div className="w-px flex-1 bg-stone-700" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-2xs leading-relaxed text-stone-400 truncate">
              {child.summary}
            </p>
          </div>
          <span className="text-xxs tabular-nums text-stone-600 flex-shrink-0">
            {formatRelativeTime(child.last_activity)}
          </span>
        </button>
      ))}
    </div>
  );
}

// --- Session divider for merged chain timeline ---

export function SessionDivider({
  sessionSummary,
  timestamp,
}: {
  sessionSummary: string;
  timestamp: string;
}) {
  return (
    <div className="flex items-center gap-2 px-5 py-3">
      <div className="flex-1 h-px bg-stone-800" />
      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-violet-500/60 flex-shrink-0" />
      <span className="text-xxs text-stone-500 truncate max-w-[200px]">
        {sessionSummary}
      </span>
      <span className="text-xxs tabular-nums text-stone-600 flex-shrink-0">
        {formatRelativeTime(timestamp)}
      </span>
      <div className="flex-1 h-px bg-stone-800" />
    </div>
  );
}

// --- Chain message turn grouping ---

export interface ChainMessageTurn {
  userMessage: ClaudeCodeChainMessage | null;
  responses: ClaudeCodeChainMessage[];
}

export function groupChainMessagesIntoTurns(
  messages: ClaudeCodeChainMessage[],
): ChainMessageTurn[] {
  const turns: ChainMessageTurn[] = [];
  let current: ChainMessageTurn = { userMessage: null, responses: [] };

  for (const msg of messages) {
    if (msg.message_type === "user") {
      if (current.userMessage || current.responses.length > 0) {
        turns.push(current);
      }
      current = { userMessage: msg, responses: [] };
    } else {
      current.responses.push(msg);
    }
  }

  if (current.userMessage || current.responses.length > 0) {
    turns.push(current);
  }

  return turns;
}
