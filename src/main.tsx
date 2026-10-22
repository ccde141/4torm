import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { DesktopDropLayer } from './components/desktop/DesktopDropLayer.tsx';
import { LocaleProvider } from './i18n/LocaleContext.tsx';
import ErrorBoundary from './components/layout/ErrorBoundary.tsx';
import { ConnectionGate } from './components/connection/ConnectionGate.tsx';
import './components/common/tool-result-images.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <LocaleProvider>
        <ConnectionGate>
          <App />
          <DesktopDropLayer />
        </ConnectionGate>
      </LocaleProvider>
    </ErrorBoundary>
  </StrictMode>,
);
