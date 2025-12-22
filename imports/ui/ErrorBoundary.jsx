import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to console for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Store error details in state
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      // Render fallback UI if provided, otherwise render default error message
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI - simple and non-intrusive
      if (this.props.silent) {
        // Silent mode - just render nothing to prevent crash
        return null;
      }

      // Minimal error display
      return (
        <div style={{
          padding: '1rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          color: 'var(--text-secondary)',
          fontSize: '0.9rem',
          textAlign: 'center'
        }}>
          {this.props.errorMessage || 'Something went wrong. Please refresh the page.'}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
