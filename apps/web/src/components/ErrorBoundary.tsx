import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Rendered instead of the crashed subtree. */
  fallback?: (reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Top-level error boundary.
 *
 * Since React 16, a render error that nobody catches UNMOUNTS THE ENTIRE TREE
 * -- the user gets a blank white page with no explanation and no way forward.
 * This turns that into a message and a working "try again" button.
 *
 * Limits, stated because they matter and are easy to forget:
 *   - Boundaries catch errors during RENDER, in lifecycle methods, and in
 *     constructors of the subtree below them.
 *   - They do NOT catch errors in event handlers, in async callbacks, or in
 *     `setTimeout`. Those are handled where they happen -- which is why the
 *     API client throws typed errors that components catch explicitly.
 *
 * Still a class component: `componentDidCatch` has no hook equivalent.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The place to call a real error reporter. Console-only here so the
    // baseplate carries no vendor SDK you would have to rip out.
    console.error('Unhandled render error', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ hasError: false });
  };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback(this.reset);

    return (
      <div className="panel panel--error" role="alert">
        <h2>Something went wrong</h2>
        {/* Never the error message: a render error's text routinely contains
            internal state and prop values. */}
        <p>The page hit an unexpected problem. You can try again without reloading.</p>
        <button type="button" onClick={this.reset}>
          Try again
        </button>
      </div>
    );
  }
}
