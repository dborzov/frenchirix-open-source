// Error boundaries (docs/app-architecture.md, "Errors"): one around the routes (« Oups », the detail
// line, back Home) and one around the running puzzle (« Réessayer » remounts it). Both log the crash
// with console.error, one recognisable line first, and to the activity log as a 'crash'.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { errorDetail } from '../api/errors';
import { crashData, log } from '../log';

export interface ErrorBoundaryProps {
  children?: ReactNode;
  /** What to show instead; `reset` renders the children again. */
  fallback: (error: unknown, reset: () => void) => ReactNode;
  /** A change of this value clears a caught error (the route's path, the puzzle's id). */
  resetKey?: unknown;
  /** Names the screen in the detail line. */
  where?: string;
}

interface State {
  caught: boolean;
  error: unknown;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { caught: false, error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { caught: true, error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[frx] crash ${errorDetail(error, this.props.where)}`, error, info.componentStack ?? '');
    log('crash', { source: 'boundary', where: this.props.where ?? null, ...crashData(error) });
  }

  override componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.caught && prev.resetKey !== this.props.resetKey) this.reset();
  }

  reset = (): void => this.setState({ caught: false, error: null });

  override render(): ReactNode {
    return this.state.caught ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}
