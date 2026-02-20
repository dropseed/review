import { useState, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { hostname as getHostname } from "@tauri-apps/plugin-os";
import { useReviewStore } from "../../stores";
import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_STEP,
} from "../../utils/preferences";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { SimpleTooltip } from "../ui/tooltip";
import { Switch } from "../ui/switch";
import { getAllUiThemes } from "../../lib/ui-themes";
import { getApiClient } from "../../api";

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
    <label className="flex items-center justify-between rounded-lg bg-surface-raised/30 px-3 py-2.5 cursor-pointer hover:bg-surface-raised/50 transition-colors">
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

interface CopyableFieldProps {
  label: string;
  value: string;
  copiedLabel: string | null;
  copyId: string;
  onCopy: (text: string, label: string) => void;
  truncate?: boolean;
  onRegenerate?: () => void;
}

const FIELD_ACTION_CLASS =
  "rounded-md px-2 py-1 text-xxs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary";

function CopyableField({
  label,
  value,
  copiedLabel,
  copyId,
  onCopy,
  truncate,
  onRegenerate,
}: CopyableFieldProps): ReactNode {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-raised/30 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-xxs text-fg-muted mb-0.5">{label}</div>
        <code
          className={`text-xs text-fg-muted${truncate ? " block truncate" : ""}`}
        >
          {value}
        </code>
      </div>
      <div className="ml-2 flex shrink-0 gap-1">
        {onRegenerate && (
          <button onClick={onRegenerate} className={FIELD_ACTION_CLASS}>
            Regenerate
          </button>
        )}
        <button
          onClick={() => onCopy(value, copyId)}
          className={FIELD_ACTION_CLASS}
        >
          {copiedLabel === copyId ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function SettingsModal({
  isOpen,
  onClose,
}: SettingsModalProps): ReactNode {
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const setCodeFontSize = useReviewStore((s) => s.setCodeFontSize);
  const uiTheme = useReviewStore((s) => s.uiTheme);
  const setUiTheme = useReviewStore((s) => s.setUiTheme);
  const matchVscodeTheme = useReviewStore((s) => s.matchVscodeTheme);
  const setMatchVscodeTheme = useReviewStore((s) => s.setMatchVscodeTheme);
  const resolvedVscodeTheme = useReviewStore((s) => s.resolvedVscodeTheme);
  const sentryEnabled = useReviewStore((s) => s.sentryEnabled);
  const setSentryEnabled = useReviewStore((s) => s.setSentryEnabled);
  const soundEffectsEnabled = useReviewStore((s) => s.soundEffectsEnabled);
  const setSoundEffectsEnabled = useReviewStore(
    (s) => s.setSoundEffectsEnabled,
  );
  const companionServerEnabled = useReviewStore(
    (s) => s.companionServerEnabled,
  );
  const setCompanionServerEnabled = useReviewStore(
    (s) => s.setCompanionServerEnabled,
  );
  const companionServerToken = useReviewStore((s) => s.companionServerToken);
  const companionServerPort = useReviewStore((s) => s.companionServerPort);
  const setCompanionServerPort = useReviewStore(
    (s) => s.setCompanionServerPort,
  );
  const generateCompanionServerToken = useReviewStore(
    (s) => s.generateCompanionServerToken,
  );
  const companionServerFingerprint = useReviewStore(
    (s) => s.companionServerFingerprint,
  );
  const regenerateCompanionCertificate = useReviewStore(
    (s) => s.regenerateCompanionCertificate,
  );
  const companionServerError = useReviewStore((s) => s.companionServerError);

  const [machineHostname, setMachineHostname] = useState<string>("");
  const [tailscaleIp, setTailscaleIp] = useState<string | null>(null);
  const [companionCopied, setCompanionCopied] = useState<string | null>(null);
  const [companionQrSvg, setCompanionQrSvg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      getHostname()
        .then((h) => setMachineHostname(h ?? "localhost"))
        .catch(() => setMachineHostname("localhost"));
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && companionServerEnabled) {
      invoke<string | null>("get_tailscale_ip")
        .then(setTailscaleIp)
        .catch(() => setTailscaleIp(null));
    } else {
      setTailscaleIp(null);
    }
  }, [isOpen, companionServerEnabled]);

  // Auto-generate token if enabled but no token exists
  useEffect(() => {
    if (isOpen && companionServerEnabled && !companionServerToken) {
      generateCompanionServerToken();
    }
  }, [
    isOpen,
    companionServerEnabled,
    companionServerToken,
    generateCompanionServerToken,
  ]);

  const serverUrl = `https://${machineHostname || "localhost"}:${companionServerPort}`;
  const tailscaleUrl = tailscaleIp
    ? `https://${tailscaleIp}:${companionServerPort}`
    : null;

  useEffect(() => {
    if (
      !isOpen ||
      !companionServerEnabled ||
      !companionServerToken ||
      !companionServerFingerprint ||
      !machineHostname
    ) {
      setCompanionQrSvg(null);
      return;
    }
    const qrUrl = tailscaleUrl ?? serverUrl;
    invoke<string>("generate_companion_qr", { url: qrUrl })
      .then(setCompanionQrSvg)
      .catch(() => setCompanionQrSvg(null));
  }, [
    isOpen,
    companionServerEnabled,
    companionServerToken,
    companionServerFingerprint,
    serverUrl,
    tailscaleUrl,
    machineHostname,
  ]);

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await writeText(text);
      setCompanionCopied(label);
      setTimeout(() => setCompanionCopied(null), 2000);
    } catch {
      // Ignore clipboard errors
    }
  }, []);

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
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
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
          </div>

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

          {/* Command Line */}
          {!devMode && (
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
                          /usr/local/bin/review
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
                      <code className="text-xxs">review</code> command not
                      installed
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
                    <code className="text-fg-muted">/usr/local/bin/review</code>{" "}
                    so you can run <code className="text-fg-muted">review</code>{" "}
                    from any terminal.
                  </p>
                </>
              )}

              {cliError && (
                <ErrorBanner message={cliError} preserveWhitespace />
              )}
            </div>
          )}

          {/* iOS Companion */}
          <div className="px-5 py-4">
            <SectionHeader
              label="iOS Companion"
              icon={
                <>
                  <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                  <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                  <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                  <line x1="12" y1="20" x2="12.01" y2="20" />
                </>
              }
            />

            <ToggleRow
              label="Enable companion server"
              checked={companionServerEnabled}
              onCheckedChange={setCompanionServerEnabled}
            />

            {companionServerError && (
              <ErrorBanner message={companionServerError} />
            )}

            <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-raised/30 px-3 py-2">
              <label className="text-xxs text-fg-muted">Port</label>
              <Input
                type="number"
                min={1024}
                max={65535}
                value={companionServerPort}
                disabled={companionServerEnabled}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (val >= 1024 && val <= 65535) {
                    setCompanionServerPort(val);
                  }
                }}
                className="w-24 text-xs text-right"
              />
            </div>

            {companionServerEnabled && (
              <div className="mt-2 space-y-2">
                {companionQrSvg && (
                  <div className="flex justify-center">
                    <div className="rounded-lg bg-white p-2">
                      <img
                        src={`data:image/svg+xml;utf8,${encodeURIComponent(companionQrSvg)}`}
                        alt="QR code for iOS pairing"
                        className="block h-auto w-full"
                      />
                    </div>
                  </div>
                )}
                <CopyableField
                  label="Server URL"
                  value={serverUrl}
                  copiedLabel={companionCopied}
                  copyId="url"
                  onCopy={copyToClipboard}
                />
                {tailscaleUrl && (
                  <CopyableField
                    label="Tailscale URL"
                    value={tailscaleUrl}
                    copiedLabel={companionCopied}
                    copyId="tailscale-url"
                    onCopy={copyToClipboard}
                  />
                )}
                {companionServerToken && (
                  <CopyableField
                    label="Auth Token"
                    value={companionServerToken}
                    copiedLabel={companionCopied}
                    copyId="token"
                    onCopy={copyToClipboard}
                    onRegenerate={generateCompanionServerToken}
                    truncate
                  />
                )}
                {companionServerFingerprint && (
                  <CopyableField
                    label="Certificate Fingerprint"
                    value={companionServerFingerprint}
                    copiedLabel={companionCopied}
                    copyId="fingerprint"
                    onCopy={copyToClipboard}
                    onRegenerate={regenerateCompanionCertificate}
                    truncate
                  />
                )}
              </div>
            )}

            <p className="mt-2 text-xxs text-fg-faint leading-relaxed">
              Allows the Review mobile app to connect over your local network.
            </p>
          </div>
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
