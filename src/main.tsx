import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { DesktopDropLayer } from './components/desktop/DesktopDropLayer.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <DesktopDropLayer />
  </StrictMode>,
);
