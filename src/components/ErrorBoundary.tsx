import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center bg-stone-950 p-8">
          <div className="max-w-lg text-center">
            <div className="mb-4 text-4xl">⚠️</div>
            <h1 className="mb-2 text-xl font-semibold text-stone-200">
              Something went wrong
            </h1>
            <p className="mb-6 text-stone-400">
              An unexpected error occurred. You can try reloading the
              application.
            </p>

            <button
              onClick={this.handleReload}
              className="rounded-md bg-lime-600 px-4 py-2 text-sm font-medium text-white hover:bg-lime-500 transition-colors"
            >
              Reload Application
            </button>

            {this.state.error && (
              <details className="mt-6 text-left">
                <summary className="cursor-pointer text-sm text-stone-500 hover:text-stone-400">
                  Error details
                </summary>
                <pre className="mt-2 overflow-auto rounded bg-stone-900 p-3 text-xs text-red-400">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack && (
                    <>
                      {"\n\nComponent Stack:"}
                      {this.state.errorInfo.componentStack}
                    </>
                  )}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
