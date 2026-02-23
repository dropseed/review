import { Component, type ErrorInfo, type ReactNode } from "react";
import { getPlatformServices } from "../platform";

const GITHUB_ISSUES_URL = "https://github.com/dropseed/review/issues/new";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
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

  handleCopy = () => {
    navigator.clipboard.writeText(this.getErrorText()).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

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
                  {this.state.copied ? "Copied!" : "Copy"}
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
