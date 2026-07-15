import { Component, type ErrorInfo, type ReactNode } from 'react'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  failed: boolean
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Portal interface error.', {
      componentStack: info.componentStack,
      message: error.message,
    })
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="error-boundary">
          <section>
            <p>Secure refund operations</p>
            <h1>The portal could not finish loading</h1>
            <span>Your session is unchanged. Reload the page to try again.</span>
            <button onClick={() => window.location.reload()} type="button">
              Reload portal
            </button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
