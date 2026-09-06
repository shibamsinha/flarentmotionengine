import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
// Tokens before the stylesheet that consumes them. Custom properties resolve at
// use time so the order is not strictly required, but reading it in this order
// is how the cascade is meant to be understood.
import './styles/tokens.css';
import './index.css';
import { App } from './App';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
