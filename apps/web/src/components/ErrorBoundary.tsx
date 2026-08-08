import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

interface ErrorBoundaryState { failed: boolean }

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Intentionally avoid logging potentially sensitive route state in production.
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <main className="shell page-section"><div className="state-card state-card--error"><div className="state-icon"><AlertCircle size={20} /></div><h1>We lost the picture.</h1><p>CinemaSeat hit an unexpected display error. Reloading is safe; no payment action will be repeated.</p><button type="button" className="button button--primary" onClick={() => window.location.reload()}>Reload CinemaSeat</button></div></main>;
    }
    return this.props.children;
  }
}
