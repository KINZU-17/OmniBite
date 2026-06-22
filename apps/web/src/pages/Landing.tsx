import { Link } from 'react-router-dom';

export function Landing() {
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
