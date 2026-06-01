'use client';

import { Component } from 'react';

/**
 * ErrorBoundary — catches unhandled render errors and shows a friendly fallback.
 * Wrap any subtree: <ErrorBoundary><YourComponent /></ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          padding: '48px 24px', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
        }}>
          <span style={{ fontSize: '2.5rem' }}>⚠️</span>
          <div>
            <p style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 6, color: 'var(--text-primary)' }}>
              Something went wrong
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 300 }}>
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
          </div>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              padding: '9px 20px', background: 'var(--accent)', color: '#000',
              border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
            }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
