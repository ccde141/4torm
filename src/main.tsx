import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { DesktopDropLayer } from './components/desktop/DesktopDropLayer.tsx';
import { LocaleProvider } from './i18n/LocaleContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <App />
      <DesktopDropLayer />
    </LocaleProvider>
  </StrictMode>,
);
