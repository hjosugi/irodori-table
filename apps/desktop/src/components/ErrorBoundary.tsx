import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Optional label so nested boundaries can identify which region failed. */
  region?: string;
  /** Optional custom fallback renderer. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

/**
 * Catches render-time errors so a single failing subtree can't take the whole
 * workbench down. The default fallback offers a recover (reset) and a hard
 * reload escape hatch.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface the component stack in dev tooling; the boundary itself renders
    // the user-facing message.
    console.error(
      `[irodori] render error${this.props.region ? ` in ${this.props.region}` : ""}:`,
      error,
      info.componentStack,
    );
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <strong>Something went wrong</strong>
          <p className="error-boundary-region">
            {this.props.region
              ? `The ${this.props.region} hit an unexpected error.`
              : "The interface hit an unexpected error."}
          </p>
          <pre className="error-boundary-detail">{error.message}</pre>
          <div className="error-boundary-actions">
            <button type="button" className="text-button" onClick={this.reset}>
              Try again
            </button>
            <button
              type="button"
              className="primary-action"
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
