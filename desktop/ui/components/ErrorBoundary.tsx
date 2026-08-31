import { Component, type ErrorInfo, type ReactNode } from "react";
import { getPlatformServices } from "../platform";

const GITHUB_ISSUES_URL = "https://github.com/dropseed/spur/issues/new";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
  copyFailed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
      copyFailed: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    this.setState({ errorInfo });

    import("../utils/sentry").then(({ captureException }) => {
      captureException(error, {
        componentStack: errorInfo.componentStack ?? undefined,
      });
    });
  }

  handleReload = () => {
    window.location.href = "/";
  };

  getErrorText(): string {
    let text = this.state.error?.toString() ?? "";
    if (this.state.errorInfo?.componentStack) {
      text += `\n\nComponent Stack:${this.state.errorInfo.componentStack}`;
    }
    return text;
  }

  /**
   * Through the platform service, not `navigator.clipboard`.
   *
   * The desktop app is served from `tauri://localhost`, which WKWebView does
   * not treat as a secure context — so `navigator.clipboard` is `undefined`
   * there and this threw on the property access, inside a click handler with
   * nowhere to report it. The button did nothing, silently, on the one screen
   * whose entire job is handing the error to someone who can act on it.
   * `getPlatformServices()` picks the Tauri clipboard plugin (or the web
   * fallback), which is what every other copy in the app already uses.
   *
   * A failure says so on the button rather than resolving to "Copied!": the
   * text is on screen to select by hand, and a lie about it being on the
   * clipboard is what loses a stack trace.
   */
  handleCopy = () => {
    getPlatformServices()
      .clipboard.writeText(this.getErrorText())
      .then(() => this.flash("copied"))
      .catch((err: unknown) => {
        console.error("[ErrorBoundary] Failed to copy error text:", err);
        this.flash("copyFailed");
      });
  };

  /** Show a transient result on the copy button, then go back to "Copy". */
  private flash(result: "copied" | "copyFailed") {
    this.setState({
      copied: result === "copied",
      copyFailed: result === "copyFailed",
    });
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null;
      this.setState({ copied: false, copyFailed: false });
    }, 2000);
  }

  componentWillUnmount() {
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
  }

  handleReportIssue = () => {
    const errorText = this.getErrorText();
    const title = this.state.error?.message ?? "Unexpected error";
    const body = `**Error**\n\n\`\`\`\n${errorText}\n\`\`\`\n\n**Steps to reproduce**\n\n1. \n`;
    const params = new URLSearchParams({
      title,
      body,
      labels: "bug",
    });
    getPlatformServices().opener.openUrl(`${GITHUB_ISSUES_URL}?${params}`);
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-surface p-8">
          <div className="flex w-full max-w-xl flex-col gap-5">
            <div>
              <h1 className="mb-1 text-lg font-semibold text-fg-secondary">
                Something went wrong
              </h1>
              <p className="text-sm text-fg-muted">
                An unexpected error occurred. You can try reloading, or report
                this as an issue on GitHub.
              </p>
            </div>

            {this.state.error && (
              <div className="relative">
                <button
                  onClick={this.handleCopy}
                  className="absolute right-2 top-2 rounded bg-surface-hover px-2 py-1 text-xs text-fg-muted hover:text-fg-secondary transition-colors"
                >
                  {this.state.copied
                    ? "Copied!"
                    : this.state.copyFailed
                      ? "Copy failed"
                      : "Copy"}
                </button>
                <pre className="max-h-64 overflow-auto rounded-md bg-surface-panel p-3 text-xs text-status-rejected">
                  {this.getErrorText()}
                </pre>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={this.handleReportIssue}
                className="rounded-md bg-fg-secondary px-3 py-1.5 text-sm font-medium text-surface transition-colors hover:bg-fg-primary"
              >
                Report Issue
              </button>
              <button
                onClick={this.handleReload}
                className="rounded-md bg-surface-hover px-3 py-1.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-surface-panel"
              >
                Reload Application
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
