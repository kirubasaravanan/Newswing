'use client';

import { GlobalErrorBoundary } from '@/components/global-error-boundary';
import Home from './page';

export default function SafeHome() {
  return (
    <GlobalErrorBoundary>
      <Home />
    </GlobalErrorBoundary>
  );
}