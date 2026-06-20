import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { saveCtx } from '../lib/storage';

interface ScanResult {
  sessionId: string;
  participant: { id: string };
  locationId: string;
  tableId: string;
}

export function ScanPage() {
  const { qrToken } = useParams();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (!qrToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<ScanResult>('/sessions/scan', {
        method: 'POST',
        body: JSON.stringify({ qrToken, displayName: name || undefined, phone: phone || undefined }),
      });
      saveCtx(res.sessionId, {
        participantId: res.participant.id,
        locationId: res.locationId,
        tableId: res.tableId,
      });
      navigate(`/session/${res.sessionId}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold text-teal-700">Welcome to your table</h1>
      <p className="mt-2 text-slate-600">Add your name and join — everyone at the table shares one order.</p>
      <div className="mt-6 space-y-3">
        <input
          className="w-full rounded-lg border border-slate-300 p-3"
          placeholder="Your name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-slate-300 p-3"
          placeholder="M-Pesa phone e.g. 2547… (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <button
          className="w-full rounded-lg bg-teal-600 p-3 font-semibold text-white disabled:opacity-50"
          onClick={join}
          disabled={loading}
        >
          {loading ? 'Joining…' : 'Join table'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
