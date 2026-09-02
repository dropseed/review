import { useState, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSpurStore } from "../../stores";
import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_STEP,
  CODE_FONT_FAMILY_DEFAULT,
  TERMINAL_FONT_FAMILY_DEFAULT,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_STEP,
  TERMINAL_LINE_HEIGHT_MIN,
  TERMINAL_LINE_HEIGHT_MAX,
  TERMINAL_LINE_HEIGHT_STEP,
  TERMINAL_LETTER_SPACING_MIN,
  TERMINAL_LETTER_SPACING_MAX,
  TERMINAL_LETTER_SPACING_STEP,
} from "../../utils/preferences";
import type { FontWeight } from "@xterm/xterm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { SimpleTooltip } from "../ui/tooltip";
import { Switch } from "../ui/switch";
import { PushNotificationsSection } from "./PushNotificationsSection";
import { RemoteAccessSection } from "./RemoteAccessSection";
import { getAllUiThemes } from "../../lib/ui-themes";
import { getApiClient } from "../../api";
import { phaseDotClass } from "../Sidebar/terminal-status-format";
import {
  toBackgroundSessionRow,
  type BackgroundSessionRow,
} from "./background-sessions";
import type { TerminalSessionInfo } from "../../types";

import { XIcon } from "../ui/icons";
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SectionHeaderProps {
  icon: ReactNode;
  label: string;
}

function SectionHeader({ icon, label }: SectionHeaderProps): ReactNode {
  return (
    <div className="mb-3 flex items-center gap-2">
      <svg
        className="h-4 w-4 text-fg-muted"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icon}
      </svg>
      <span className="text-xs font-medium text-fg-secondary">{label}</span>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: ToggleRowProps): ReactNode {
  return (
    <label className="flex items-center justify-between rounded-lg bg-surface-raised/30 px-3 py-2.5 hover:bg-surface-raised/50 transition-colors">
      <span className="text-xs text-fg-secondary">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

interface ErrorBannerProps {
  message: string;
  preserveWhitespace?: boolean;
}

function ErrorBanner({
  message,
  preserveWhitespace,
}: ErrorBannerProps): ReactNode {
  return (
    <div className="mt-2 rounded-lg bg-status-rejected/5 px-3 py-2 ring-1 ring-status-rejected/30">
      <p
        className={`text-xxs text-status-rejected/90${preserveWhitespace ? " whitespace-pre-wrap" : ""}`}
      >
        {message}
      </p>
    </div>
  );
}

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

/** Labeled -/+ stepper for a bounded numeric preference. */
function Stepper({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: StepperProps): ReactNode {
  // Round to the step grid so float steps (e.g. 0.05) don't accumulate error.
  const clamp = (n: number) =>
    Math.min(max, Math.max(min, Math.round(n / step) * step));
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-fg-secondary">{label}</span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onChange(clamp(value - step))}
          disabled={value <= min}
          className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-hover/50 text-fg-secondary transition-colors hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
          </svg>
        </button>
        <span className="font-mono text-xs font-semibold text-fg tabular-nums w-12 text-center">
          {format(value)}
        </span>
        <button
          onClick={() => onChange(clamp(value + step))}
          disabled={value >= max}
          className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-hover/50 text-fg-secondary transition-colors hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg
            className="h-3 w-3"
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
      </div>
    </div>
  );
}

interface SegmentedProps<T extends string | number> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** Compact segmented button group for a small set of choices. */
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: SegmentedProps<T>): ReactNode {
  return (
    <div className="flex gap-1 rounded-lg bg-surface-raised/30 p-1">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          onClick={() => onChange(opt.value)}
          className={`flex-1 rounded-md px-2.5 py-1.5 text-xxs font-medium transition-colors ${
            value === opt.value
              ? "bg-surface-raised text-fg ring-1 ring-focus-ring/50"
              : "text-fg-muted hover:text-fg-secondary"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Every live terminal session the daemon holds, across all repos and windows.
 *
 * Its own component because it is a small session manager that happens to live
 * in a settings dialog — four pieces of state, two async handlers and a
 * refresh, none of which any other section reads.
 */
function BackgroundSessionsSection({ isOpen }: { isOpen: boolean }): ReactNode {
  const terminalsSupported = useSpurStore((s) => s.terminalsSupported);
  // Background sessions (governance) — every live terminal session across
  // every repo/window, so forgotten sessions in the daemon don't accumulate
  // invisibly.
  const [backgroundSessions, setBackgroundSessions] = useState<
    TerminalSessionInfo[]
  >([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [confirmShutdownAll, setConfirmShutdownAll] = useState(false);

  const refreshBackgroundSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      setBackgroundSessions(await getApiClient().terminalList());
    } catch (e) {
      setSessionsError(String(e));
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && terminalsSupported) {
      refreshBackgroundSessions();
    }
  }, [isOpen, terminalsSupported, refreshBackgroundSessions]);

  // A closed modal shouldn't leave a stale "click again to confirm" armed for
  // next time it opens.
  useEffect(() => {
    if (!isOpen) setConfirmShutdownAll(false);
  }, [isOpen]);

  // Both handlers resync the list inside the `try`, before the catch: the
  // refresh clears `sessionsError` on entry, so setting the error first would
  // wipe it again immediately.
  async function handleKillSession(id: string) {
    try {
      await getApiClient().terminalKill(id);
      await refreshBackgroundSessions();
    } catch (e) {
      setSessionsError(String(e));
    }
  }

  async function handleShutdownAllSessions() {
    if (!confirmShutdownAll) {
      setConfirmShutdownAll(true);
      return;
    }
    setConfirmShutdownAll(false);
    try {
      await getApiClient().terminalShutdownAllBackground();
      await refreshBackgroundSessions();
    } catch (e) {
      setSessionsError(String(e));
    }
  }

  if (!terminalsSupported) return null;

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 text-fg-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          <span className="text-xs font-medium text-fg-secondary">
            Background Sessions
          </span>
        </div>
        <button
          onClick={refreshBackgroundSessions}
          disabled={sessionsLoading}
          className="text-xxs text-fg-muted transition-colors hover:text-fg-secondary disabled:opacity-50"
        >
          {sessionsLoading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {sessionsError && <ErrorBanner message={sessionsError} />}

      {backgroundSessions.length === 0 ? (
        <div className="flex items-center justify-between rounded-lg bg-surface-raised/30 px-3 py-2.5">
          <span className="text-xs text-fg-muted">No background sessions.</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {backgroundSessions
            .map(toBackgroundSessionRow)
            .map((row: BackgroundSessionRow) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-raised/30 px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${phaseDotClass(row.phase)}`}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-xs text-fg-secondary">
                      {row.label}
                    </div>
                    <div className="truncate text-xxs text-fg-faint">
                      {row.repoName}
                      {row.cwdLabel ? ` · ${row.cwdLabel}` : ""}
                      {row.lastExitCode != null && (
                        <span
                          className={
                            row.lastExitCode === 0
                              ? "text-status-approved"
                              : "text-status-rejected"
                          }
                        >
                          {" "}
                          · exit {row.lastExitCode}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleKillSession(row.id)}
                  className="shrink-0 rounded-md px-2.5 py-1.5 text-xxs text-fg-muted transition-colors hover:bg-status-rejected/15 hover:text-status-rejected"
                >
                  Kill
                </button>
              </div>
            ))}
        </div>
      )}

      <button
        onClick={handleShutdownAllSessions}
        disabled={backgroundSessions.length === 0}
        className={`mt-3 w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          confirmShutdownAll
            ? "bg-status-rejected/25 text-status-rejected"
            : "bg-status-rejected/15 text-status-rejected hover:bg-status-rejected/25"
        }`}
      >
        {confirmShutdownAll
          ? "Click again to confirm"
          : "Shut down all background sessions"}
      </button>
    </div>
  );
}

/**
 * The `spur` CLI's install state, and the button that changes it.
 *
 * Hidden entirely in a dev build, where the binary on PATH is whatever the
 * developer built rather than something this dialog should be managing.
 */
function CommandLineSection({ isOpen }: { isOpen: boolean }): ReactNode {
  // CLI install status (hidden in dev mode)
  const [devMode, setDevMode] = useState(false);
  const [cliInstalled, setCliInstalled] = useState(false);
  const [cliSymlinkTarget, setCliSymlinkTarget] = useState<string | null>(null);
  const [cliError, setCliError] = useState<string | null>(null);
  const [cliLoading, setCliLoading] = useState(false);

  const refreshCliStatus = useCallback(async () => {
    try {
      const isDev = await invoke<boolean>("is_dev_mode");
      setDevMode(isDev);
      if (isDev) return;

      const status = await invoke<{
        installed: boolean;
        symlink_target: string | null;
      }>("get_cli_install_status");
      setCliInstalled(status.installed);
      setCliSymlinkTarget(status.symlink_target);
    } catch {
      // Ignore errors checking status
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      refreshCliStatus();
    }
  }, [isOpen, refreshCliStatus]);

  async function handleCliAction(command: "install_cli" | "uninstall_cli") {
    setCliLoading(true);
    setCliError(null);
    try {
      await invoke(command);
      await refreshCliStatus();
    } catch (e) {
      setCliError(String(e));
    } finally {
      setCliLoading(false);
    }
  }

  if (devMode) return null;

  return (
    <div className="px-5 py-4">
      <SectionHeader
        label="Command Line"
        icon={
          <>
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </>
        }
      />

      {cliInstalled ? (
        <div className="flex items-center justify-between rounded-lg bg-surface-raised/30 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-status-approved" />
              <span className="text-xs text-fg-secondary">
                Installed at{" "}
                <code className="text-xxs text-fg-muted">
                  /usr/local/bin/spur
                </code>
              </span>
            </div>
            {cliSymlinkTarget && (
              <p className="mt-1 truncate pl-3.5 text-xxs text-fg-faint">
                {cliSymlinkTarget}
              </p>
            )}
          </div>
          <button
            onClick={() => handleCliAction("uninstall_cli")}
            disabled={cliLoading}
            className="ml-3 shrink-0 rounded-md px-2.5 py-1.5 text-xxs text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg-secondary disabled:opacity-50"
          >
            Uninstall
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-lg bg-surface-raised/30 px-3 py-2.5">
            <span className="text-xs text-fg-muted">
              <code className="text-xxs">spur</code> command not installed
            </span>
            <button
              onClick={() => handleCliAction("install_cli")}
              disabled={cliLoading}
              className="ml-3 shrink-0 rounded-md bg-surface-hover/50 px-2.5 py-1.5 text-xxs text-fg-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              {cliLoading ? "Installing..." : "Install"}
            </button>
          </div>
          <p className="mt-2 text-xxs text-fg-faint leading-relaxed">
            Creates a symlink at{" "}
            <code className="text-fg-muted">/usr/local/bin/spur</code> so you
            can run <code className="text-fg-muted">spur</code> from any
            terminal.
          </p>
        </>
      )}

      {cliError && <ErrorBanner message={cliError} preserveWhitespace />}
    </div>
  );
}

/** Language servers discovered for the open repo, each toggleable. */
function LanguageServersSection({ isOpen }: { isOpen: boolean }): ReactNode {
  const repoPath = useSpurStore((s) => s.repoPath);
  const lspDisabledLanguages = useSpurStore((s) => s.lspDisabledLanguages);
  const setLspDisabledLanguages = useSpurStore(
    (s) => s.setLspDisabledLanguages,
  );
  const [discoveredServers, setDiscoveredServers] = useState<
    { name: string; language: string }[]
  >([]);

  useEffect(() => {
    if (isOpen && repoPath) {
      getApiClient()
        .discoverLspServers(repoPath)
        .then(setDiscoveredServers)
        .catch(() => {});
    }
  }, [isOpen, repoPath]);

  if (discoveredServers.length === 0) return null;

  return (
    <div className="px-5 py-4">
      <SectionHeader
        label="Language Servers"
        icon={
          <>
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </>
        }
      />
      <div className="space-y-2">
        {discoveredServers.map((server) => {
          const enabled = !lspDisabledLanguages.includes(server.language);
          return (
            <ToggleRow
              key={server.language}
              label={`${server.name} (${server.language})`}
              checked={enabled}
              onCheckedChange={(checked) => {
                const updated = checked
                  ? lspDisabledLanguages.filter((l) => l !== server.language)
                  : [...lspDisabledLanguages, server.language];
                setLspDisabledLanguages(updated);
              }}
            />
          );
        })}
      </div>
      <p className="mt-2 text-xxs text-fg-faint leading-relaxed">
        Disabled servers will not start automatically. Restart the app for
        changes to take effect.
      </p>
    </div>
  );
}

export function SettingsModal({
  isOpen,
  onClose,
}: SettingsModalProps): ReactNode {
  const codeFontSize = useSpurStore((s) => s.codeFontSize);
  const setCodeFontSize = useSpurStore((s) => s.setCodeFontSize);
  const codeFontFamily = useSpurStore((s) => s.codeFontFamily);
  const setCodeFontFamily = useSpurStore((s) => s.setCodeFontFamily);
  const terminalFontFamily = useSpurStore((s) => s.terminalFontFamily);
  const setTerminalFontFamily = useSpurStore((s) => s.setTerminalFontFamily);
  const terminalFontSize = useSpurStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useSpurStore((s) => s.setTerminalFontSize);
  const terminalFontWeight = useSpurStore((s) => s.terminalFontWeight);
  const setTerminalFontWeight = useSpurStore((s) => s.setTerminalFontWeight);
  const terminalLineHeight = useSpurStore((s) => s.terminalLineHeight);
  const setTerminalLineHeight = useSpurStore((s) => s.setTerminalLineHeight);
  const terminalLetterSpacing = useSpurStore((s) => s.terminalLetterSpacing);
  const setTerminalLetterSpacing = useSpurStore(
    (s) => s.setTerminalLetterSpacing,
  );
  const terminalLaunchCommand = useSpurStore((s) => s.terminalLaunchCommand);
  const setTerminalLaunchCommand = useSpurStore(
    (s) => s.setTerminalLaunchCommand,
  );
  const uiTheme = useSpurStore((s) => s.uiTheme);
  const setUiTheme = useSpurStore((s) => s.setUiTheme);
  const matchVscodeTheme = useSpurStore((s) => s.matchVscodeTheme);
  const setMatchVscodeTheme = useSpurStore((s) => s.setMatchVscodeTheme);
  const resolvedVscodeTheme = useSpurStore((s) => s.resolvedVscodeTheme);
  const sentryEnabled = useSpurStore((s) => s.sentryEnabled);
  const setSentryEnabled = useSpurStore((s) => s.setSentryEnabled);
  const soundEffectsEnabled = useSpurStore((s) => s.soundEffectsEnabled);
  const setSoundEffectsEnabled = useSpurStore((s) => s.setSoundEffectsEnabled);
  const terminalNotificationsEnabled = useSpurStore(
    (s) => s.terminalNotificationsEnabled,
  );
  const setTerminalNotificationsEnabled = useSpurStore(
    (s) => s.setTerminalNotificationsEnabled,
  );

  const [fontFamilyDraft, setFontFamilyDraft] = useState(codeFontFamily);
  const [terminalFontDraft, setTerminalFontDraft] =
    useState(terminalFontFamily);
  const [launchCommandDraft, setLaunchCommandDraft] = useState(
    terminalLaunchCommand,
  );

  useEffect(() => {
    if (isOpen) setFontFamilyDraft(codeFontFamily);
  }, [isOpen, codeFontFamily]);

  useEffect(() => {
    if (isOpen) setTerminalFontDraft(terminalFontFamily);
  }, [isOpen, terminalFontFamily]);

  useEffect(() => {
    if (isOpen) setLaunchCommandDraft(terminalLaunchCommand);
  }, [isOpen, terminalLaunchCommand]);

  function decreaseFontSize() {
    setCodeFontSize(
      Math.max(codeFontSize - CODE_FONT_SIZE_STEP, CODE_FONT_SIZE_MIN),
    );
  }

  function increaseFontSize() {
    setCodeFontSize(
      Math.min(codeFontSize + CODE_FONT_SIZE_STEP, CODE_FONT_SIZE_MAX),
    );
  }

  function resetFontSize() {
    setCodeFontSize(CODE_FONT_SIZE_DEFAULT);
  }

  function commitFontFamily() {
    const trimmed = fontFamilyDraft.trim();
    if (trimmed && trimmed !== codeFontFamily) {
      setCodeFontFamily(trimmed);
    } else {
      setFontFamilyDraft(codeFontFamily);
    }
  }

  function commitLaunchCommand() {
    // Unlike the font fields, an empty value is meaningful here — it means
    // "just a shell" — so it commits rather than reverting the draft.
    const trimmed = launchCommandDraft.trim();
    if (trimmed !== terminalLaunchCommand) setTerminalLaunchCommand(trimmed);
  }

  function commitTerminalFontFamily() {
    const trimmed = terminalFontDraft.trim();
    if (trimmed && trimmed !== terminalFontFamily) {
      setTerminalFontFamily(trimmed);
    } else {
      setTerminalFontDraft(terminalFontFamily);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex w-full max-w-md max-h-[85vh] flex-col rounded-xl overflow-hidden">
        <DialogHeader className="relative px-5 py-4">
          <div className="absolute inset-0 bg-gradient-to-r from-status-modified/5 via-transparent to-status-trusted/5" />
          <div className="relative flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-raised ring-1 ring-edge-default">
              <svg
                className="h-4 w-4 text-fg-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <DialogTitle>Settings</DialogTitle>
          </div>
          <button
            onClick={onClose}
            className="relative rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg-secondary"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 min-h-0 divide-y divide-edge/60">
          {/* Theme */}
          <div className="px-5 py-4">
            <SectionHeader
              label="Theme"
              icon={
                <>
                  <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
                  <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
                  <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
                  <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z" />
                </>
              }
            />
            <div className="grid grid-cols-2 gap-2">
              {getAllUiThemes().map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => setUiTheme(theme.id)}
                  className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 ${
                    uiTheme === theme.id
                      ? "bg-surface-raised ring-1 ring-focus-ring/50"
                      : "bg-surface-raised/30 hover:bg-surface-raised/60"
                  }`}
                >
                  <div className="flex gap-0.5">
                    {theme.preview.map((color, i) => (
                      <div
                        key={i}
                        className="h-4 w-2 first:rounded-l last:rounded-r"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <span
                    className={`text-xs font-medium transition-colors ${
                      uiTheme === theme.id
                        ? "text-fg"
                        : "text-fg-muted group-hover:text-fg-secondary"
                    }`}
                  >
                    {theme.label}
                  </span>
                  {uiTheme === theme.id && (
                    <svg
                      className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-focus-ring"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xxs text-fg-faint">
              Controls the entire UI — backgrounds, text, borders, and syntax
              highlighting.
            </p>

            <div className="mt-3">
              <ToggleRow
                label="Match VS Code theme"
                checked={matchVscodeTheme}
                onCheckedChange={setMatchVscodeTheme}
              />
            </div>

            {matchVscodeTheme && resolvedVscodeTheme && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-surface-raised/30 px-3 py-2">
                <div className="flex gap-0.5">
                  {resolvedVscodeTheme.preview.map((color, i) => (
                    <div
                      key={i}
                      className="h-3 w-1.5 first:rounded-l last:rounded-r"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <span className="text-xs text-fg-secondary">
                  {resolvedVscodeTheme.label}
                </span>
                <span className="text-xxs text-fg-faint">
                  ({resolvedVscodeTheme.colorScheme})
                </span>
              </div>
            )}

            {matchVscodeTheme && !resolvedVscodeTheme && (
              <p className="mt-2 text-xxs text-status-warning">
                Could not detect VS Code theme. Make sure VS Code is installed.
              </p>
            )}
          </div>

          {/* Code Font Size */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-fg-secondary">Code font size</span>
              <div className="flex items-center gap-1.5">
                <SimpleTooltip content="Decrease font size (Cmd+-)">
                  <button
                    onClick={decreaseFontSize}
                    disabled={codeFontSize <= CODE_FONT_SIZE_MIN}
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-hover/50 text-fg-secondary transition-colors hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <svg
                      className="h-3 w-3"
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

                <span className="font-mono text-xs font-semibold text-fg tabular-nums w-10 text-center">
                  {codeFontSize}px
                </span>

                <SimpleTooltip content="Increase font size (Cmd++)">
                  <button
                    onClick={increaseFontSize}
                    disabled={codeFontSize >= CODE_FONT_SIZE_MAX}
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-hover/50 text-fg-secondary transition-colors hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <svg
                      className="h-3 w-3"
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

                {codeFontSize !== CODE_FONT_SIZE_DEFAULT && (
                  <SimpleTooltip content="Reset to default (Cmd+0)">
                    <button
                      onClick={resetFontSize}
                      className="ml-1 text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
                    >
                      Reset
                    </button>
                  </SimpleTooltip>
                )}
              </div>
            </div>
            <p className="mt-1.5 text-xxs text-fg-faint">
              Cmd +/- to adjust, 0 to reset
            </p>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-fg-secondary">
                Code font family
              </span>
              {codeFontFamily !== CODE_FONT_FAMILY_DEFAULT && (
                <button
                  onClick={() => setCodeFontFamily(CODE_FONT_FAMILY_DEFAULT)}
                  className="text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
            <Input
              value={fontFamilyDraft}
              onChange={(e) => setFontFamilyDraft(e.target.value)}
              onBlur={commitFontFamily}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitFontFamily();
              }}
              className="mt-1.5 w-full text-xs font-mono"
              placeholder={CODE_FONT_FAMILY_DEFAULT}
            />
            <p className="mt-1.5 text-xxs text-fg-faint">
              Comma-separated font names
            </p>
          </div>

          {/* Terminal */}
          <div className="px-5 py-4 space-y-3">
            <SectionHeader
              label="Terminal"
              icon={
                <>
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </>
              }
            />

            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-secondary">Font family</span>
                {terminalFontFamily !== TERMINAL_FONT_FAMILY_DEFAULT && (
                  <button
                    onClick={() =>
                      setTerminalFontFamily(TERMINAL_FONT_FAMILY_DEFAULT)
                    }
                    className="text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
                  >
                    Reset
                  </button>
                )}
              </div>
              <Input
                value={terminalFontDraft}
                onChange={(e) => setTerminalFontDraft(e.target.value)}
                onBlur={commitTerminalFontFamily}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTerminalFontFamily();
                }}
                className="mt-1.5 w-full text-xs font-mono"
                placeholder={TERMINAL_FONT_FAMILY_DEFAULT}
              />
              <p className="mt-1.5 text-xxs text-fg-faint">
                Separate from the code font. Try a font like{" "}
                <code className="text-fg-muted">JetBrains Mono</code>.
              </p>
            </div>

            <Stepper
              label="Font size"
              value={terminalFontSize}
              min={TERMINAL_FONT_SIZE_MIN}
              max={TERMINAL_FONT_SIZE_MAX}
              step={TERMINAL_FONT_SIZE_STEP}
              format={(v) => `${v}px`}
              onChange={setTerminalFontSize}
            />

            <div>
              <span className="text-xs text-fg-secondary">Font weight</span>
              <div className="mt-1.5">
                <Segmented<FontWeight>
                  value={terminalFontWeight}
                  options={[
                    { value: 300, label: "Light" },
                    { value: 400, label: "Normal" },
                    { value: 500, label: "Medium" },
                    { value: 700, label: "Bold" },
                  ]}
                  onChange={setTerminalFontWeight}
                />
              </div>
            </div>

            <Stepper
              label="Line height"
              value={terminalLineHeight}
              min={TERMINAL_LINE_HEIGHT_MIN}
              max={TERMINAL_LINE_HEIGHT_MAX}
              step={TERMINAL_LINE_HEIGHT_STEP}
              format={(v) => v.toFixed(2)}
              onChange={setTerminalLineHeight}
            />

            <Stepper
              label="Letter spacing"
              value={terminalLetterSpacing}
              min={TERMINAL_LETTER_SPACING_MIN}
              max={TERMINAL_LETTER_SPACING_MAX}
              step={TERMINAL_LETTER_SPACING_STEP}
              format={(v) => `${v}px`}
              onChange={setTerminalLetterSpacing}
            />

            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-secondary">
                  Launch command
                </span>
                {terminalLaunchCommand !== "" && (
                  <button
                    onClick={() => {
                      setLaunchCommandDraft("");
                      setTerminalLaunchCommand("");
                    }}
                    className="text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              <Input
                value={launchCommandDraft}
                onChange={(e) => setLaunchCommandDraft(e.target.value)}
                onBlur={commitLaunchCommand}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitLaunchCommand();
                }}
                className="mt-1.5 w-full text-xs font-mono"
                placeholder="claude"
              />
              <p className="mt-1.5 text-xxs text-fg-faint">
                Typed at the prompt of every new terminal and split pane. Leave
                empty for a plain shell.
              </p>
            </div>
          </div>

          <BackgroundSessionsSection isOpen={isOpen} />

          {/* Sound Effects + Crash Reporting */}
          <div className="px-5 py-4 space-y-3">
            <div>
              <ToggleRow
                label="Sound effects"
                checked={soundEffectsEnabled}
                onCheckedChange={setSoundEffectsEnabled}
              />
              <p className="mt-1.5 text-xxs text-fg-faint leading-relaxed">
                Play sounds when approving, rejecting, and completing reviews.
              </p>
            </div>

            <div>
              <ToggleRow
                label="Terminal notifications"
                checked={terminalNotificationsEnabled}
                onCheckedChange={setTerminalNotificationsEnabled}
              />
              <p className="mt-1.5 text-xxs text-fg-faint leading-relaxed">
                Send a system notification when a terminal needs your attention
                and Spur is in the background.
              </p>
            </div>

            <div>
              <ToggleRow
                label="Crash reporting"
                checked={sentryEnabled}
                onCheckedChange={setSentryEnabled}
              />
              <p className="mt-1.5 text-xxs text-fg-faint leading-relaxed">
                When enabled, anonymous crash reports are sent to help improve
                Review. No repository data or file contents are ever sent.
              </p>
            </div>
          </div>

          <PushNotificationsSection />

          <RemoteAccessSection />

          <CommandLineSection isOpen={isOpen} />

          <LanguageServersSection isOpen={isOpen} />
        </div>

        <div className="border-t border-edge bg-surface-panel/50 px-5 py-3 flex items-center justify-between">
          <button
            onClick={() => getApiClient().openSettingsFile()}
            className="text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
          >
            Open settings file
          </button>
          <p className="text-xxs text-fg-faint">
            Settings are saved automatically
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
