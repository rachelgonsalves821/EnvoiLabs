"use client";

import { Component, type ReactNode } from "react";

export class ProbeRenderBoundary extends Component<{
  children: ReactNode; onError: () => void;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed
      ? <p role="alert">This follow-up could not be shown. Loading the next question.</p>
      : this.props.children;
  }
}
