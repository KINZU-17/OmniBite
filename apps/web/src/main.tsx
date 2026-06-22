import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { ScanPage } from './pages/ScanPage';
import { SessionPage } from './pages/SessionPage';
import { CardReturnPage } from './pages/CardReturnPage';
import { AdminPage } from './pages/AdminPage';
import { Landing } from './pages/Landing';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/t/:qrToken" element={<ScanPage />} />
          <Route path="/session/:sessionId" element={<SessionPage />} />
          <Route path="/card/return" element={<CardReturnPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

// Register the app-shell service worker only in production. In dev it fights
// Vite's module server (stale shells, double execution), so keep it off.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
