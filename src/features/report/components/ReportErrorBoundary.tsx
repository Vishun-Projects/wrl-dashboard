'use client';

import React from 'react';

type Props = {
  label: string;
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class ReportErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : 'Something went wrong';
    return { hasError: true, message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          <p className="font-medium">{this.props.label} failed to load</p>
          <p className="mt-1 text-red-700">{this.state.message}</p>
          <button
            type="button"
            className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white"
            onClick={() => this.setState({ hasError: false, message: '' })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
