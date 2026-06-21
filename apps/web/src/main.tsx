import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { ScanPage } from './pages/ScanPage';
import { SessionPage } from './pages/SessionPage';
import { CardReturnPage } from './pages/CardReturnPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Landing() {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-2xl font-bold text-teal-700">OmniBite</h1>
      <p className="mt-3 text-slate-600">Scan the QR code on your table to see the menu and order.</p>
      <p className="mt-6 text-sm text-slate-400">
        Demo: open <Link className="text-teal-700 underline" to="/t/demo-qr-1">/t/&lt;qrToken&gt;</Link>
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/t/:qrToken" element={<ScanPage />} />
          <Route path="/session/:sessionId" element={<SessionPage />} />
          <Route path="/card/return" element={<CardReturnPage />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
