import { Component, type ErrorInfo, type ReactNode } from "react";

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

  handleDismiss = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    });
  };

  getErrorText(): string {
    const parts = [this.state.error?.toString() ?? ""];
    if (this.state.errorInfo?.componentStack) {
      parts.push(`\n\nComponent Stack:${this.state.errorInfo.componentStack}`);
    }
    return parts.join("");
  }

  handleCopy = () => {
    navigator.clipboard.writeText(this.getErrorText()).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-surface p-8">
          <div className="max-w-lg text-center">
            <div className="mb-4 text-4xl">⚠️</div>
            <h1 className="mb-2 text-xl font-semibold text-fg-secondary">
              Something went wrong
            </h1>
            <p className="mb-6 text-fg-muted">
              An unexpected error occurred. You can try reloading the
              application.
            </p>

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleDismiss}
                className="rounded-md bg-surface-hover px-4 py-2 text-sm font-medium text-fg-secondary hover:bg-surface-active transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={this.handleReload}
                className="rounded-md bg-status-modified px-4 py-2 text-sm font-medium text-surface hover:bg-status-modified transition-colors"
              >
                Reload Application
              </button>
            </div>

            {this.state.error && (
              <details className="mt-6 text-left">
                <summary className="cursor-pointer text-sm text-fg-muted hover:text-fg-muted">
                  Error details
                </summary>
                <div className="relative mt-2">
                  <button
                    onClick={this.handleCopy}
                    className="absolute right-2 top-2 rounded bg-surface-hover px-2 py-1 text-xs text-fg-muted hover:text-fg-secondary transition-colors"
                  >
                    {this.state.copied ? "Copied!" : "Copy"}
                  </button>
                  <pre className="overflow-auto rounded bg-surface-panel p-3 text-xs text-status-rejected">
                    {this.getErrorText()}
                  </pre>
                </div>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
