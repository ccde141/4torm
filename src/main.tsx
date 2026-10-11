import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { DesktopDropLayer } from './components/desktop/DesktopDropLayer.tsx';
import { LocaleProvider } from './i18n/LocaleContext.tsx';
import ErrorBoundary from './components/layout/ErrorBoundary.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <LocaleProvider>
        <App />
        <DesktopDropLayer />
      </LocaleProvider>
    </ErrorBoundary>
  </StrictMode>,
);
