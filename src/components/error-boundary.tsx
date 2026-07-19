'use client';

import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 mb-4">
            <AlertTriangle className="h-7 w-7 text-amber-400" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">Something went wrong</h2>
          <p className="text-sm text-muted-foreground max-w-md mb-1">
            This tab failed to load. This usually happens when the backend server is not running.
          </p>
          <p className="text-xs text-muted-foreground/60 mb-6 max-w-md font-mono break-all">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); }}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Wrapper component for each tab
export function TabGuard({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary fallback={
      <div className="flex flex-col items-center justify-center min-h-[40vh] p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-400/50 mb-3" />
        <p className="text-sm text-muted-foreground">Tab failed to load. Switch tabs or try again.</p>
      </div>
    }>
      {children}
    </ErrorBoundary>
  );
}