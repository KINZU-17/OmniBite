import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Events } from '@omnibite/shared';
import { api } from '../lib/api';
import { connectGuest } from '../lib/socket';
import { loadCtx, saveCtx } from '../lib/storage';
import type { MenuItem, Round, Session } from '../types';

const kes = (v: string | number) => `KES ${Number(v).toLocaleString('en-KE')}`;

const TRACK_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: 'Waiting for payment',
  PARTIALLY_PAID: 'Waiting for the rest of the table to pay',
  PAID: 'Sent to the kitchen',
  FIRED: 'Received by the kitchen',
};
const TICKET_LABEL: Record<string, string> = {
  QUEUED: 'Received',
  IN_PREP: 'Preparing your food',
  READY: 'Ready — on its way',
  SERVED: 'Served. Enjoy!',
};

export function SessionPage() {
  const { sessionId } = useParams();
  const queryClient = useQueryClient();
  const [ctx, setCtx] = useState(() => (sessionId ? loadCtx(sessionId) : null));
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api<Session>(`/sessions/${sessionId}`),
    enabled: !!sessionId,
    refetchInterval: 4000,
  });
  const session = sessionQuery.data;
  const locationId = ctx?.locationId ?? session?.locationId;

  const menuQuery = useQuery({
    queryKey: ['menu', locationId],
    queryFn: () => api<MenuItem[]>(`/locations/${locationId}/menu`),
    enabled: !!locationId,
  });

  useEffect(() => {
    if (!locationId) return;
    const socket = connectGuest(locationId);
    socket.on(Events.ITEM_86, () => queryClient.invalidateQueries({ queryKey: ['menu', locationId] }));
    socket.on(Events.TICKET_STATUS, () => sessionQuery.refetch());
    socket.on(Events.TICKET_SERVED, () => sessionQuery.refetch());
    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  const buildingRound = session?.rounds.find((r) => r.status === 'BUILDING');
  const trackRound: Round | undefined = useMemo(() => {
    if (!session) return undefined;
    return (
      session.rounds.find((r) =>
        ['AWAITING_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'FIRED'].includes(r.status),
      ) ?? [...session.rounds].reverse().find((r) => r.status === 'SERVED')
    );
  }, [session]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await sessionQuery.refetch();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addItem(item: MenuItem, modifierIds: string[]) {
    if (!ctx) return;
    await run(async () => {
      let roundId = buildingRound?.id;
      if (!roundId) {
        const r = await api<{ id: string }>(`/sessions/${sessionId}/round`, { method: 'POST' });
        roundId = r.id;
      }
      await api(`/rounds/${roundId}/items`, {
        method: 'POST',
        body: JSON.stringify({ menuItemId: item.id, participantId: ctx.participantId, quantity: 1, modifierIds }),
      });
    });
  }

  async function removeItem(itemId: string) {
    if (!buildingRound) return;
    await run(() => api(`/rounds/${buildingRound.id}/items/${itemId}`, { method: 'DELETE' }).then(() => undefined));
  }

  async function submit() {
    if (!buildingRound || !ctx) return;
    if (!phone) {
      setError('Enter your M-Pesa phone number to pay.');
      return;
    }
    await run(() =>
      api(`/rounds/${buildingRound.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          settlementMode: 'SINGLE_PAYER',
          payments: [{ participantId: ctx.participantId, method: 'MPESA', phone }],
        }),
      }).then(() => undefined),
    );
  }

  async function retry(paymentId: string) {
    await run(() => api(`/payments/${paymentId}/retry`, {
      method: 'POST',
      body: JSON.stringify({ phone: phone || undefined }),
    }).then(() => undefined));
  }

  if (!sessionId) return <div className="p-6">Missing session.</div>;
  if (!ctx) return <JoinPrompt sessionId={sessionId} onJoined={(c) => setCtx(c)} />;

  return (
    <div className="mx-auto max-w-md p-4 pb-28">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-teal-700">OmniBite</h1>
        <p className="text-sm text-slate-500">Order from your table · pay before the kitchen cooks</p>
      </header>

      {trackRound && <Tracking round={trackRound} phone={phone} onRetry={retry} busy={busy} />}

      {menuQuery.isLoading && <p>Loading menu…</p>}
      {menuQuery.data && (
        <section className="space-y-3">
          {menuQuery.data.map((item) => (
            <MenuCard key={item.id} item={item} onAdd={addItem} disabled={busy} />
          ))}
        </section>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {buildingRound && buildingRound.items.length > 0 && (
        <CartBar
          round={buildingRound}
          phone={phone}
          setPhone={setPhone}
          onRemove={removeItem}
          onSubmit={submit}
          busy={busy}
        />
      )}
    </div>
  );
}

function JoinPrompt({ sessionId, onJoined }: { sessionId: string; onJoined: (c: { participantId: string; locationId: string }) => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function join() {
    try {
      const res = await api<{ participant: { id: string }; locationId: string }>(`/sessions/${sessionId}/join`, {
        method: 'POST',
        body: JSON.stringify({ displayName: name || undefined }),
      });
      const ctx = { participantId: res.participant.id, locationId: res.locationId };
      saveCtx(sessionId, ctx);
      onJoined(ctx);
    } catch (e) {
      setErr(String(e));
    }
  }
  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-bold text-teal-700">Join this table</h1>
      <input
        className="mt-4 w-full rounded-lg border border-slate-300 p-3"
        placeholder="Your name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button className="mt-3 w-full rounded-lg bg-teal-600 p-3 font-semibold text-white" onClick={join}>
        Join
      </button>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}

function MenuCard({ item, onAdd, disabled }: { item: MenuItem; onAdd: (i: MenuItem, m: string[]) => void; disabled: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${item.is86 ? 'opacity-40' : ''}`}>
      <div className="flex justify-between">
        <div>
          <h3 className="font-semibold">{item.name}</h3>
          {item.description && <p className="text-sm text-slate-500">{item.description}</p>}
          {item.allergens.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">Allergens: {item.allergens.map((a) => a.allergen).join(', ')}</p>
          )}
        </div>
        <div className="text-right font-semibold text-teal-700">{kes(item.basePrice)}</div>
      </div>

      {item.modifierGroups.map(({ modifierGroup }) => (
        <div key={modifierGroup.id} className="mt-2">
          <p className="text-xs font-medium text-slate-500">{modifierGroup.name}</p>
          <div className="flex flex-wrap gap-2">
            {modifierGroup.modifiers.map((m) => (
              <label key={m.id} className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
                {m.name}
                {Number(m.priceDelta) !== 0 && <span className="text-slate-400">(+{kes(m.priceDelta)})</span>}
              </label>
            ))}
          </div>
        </div>
      ))}

      <button
        className="mt-3 rounded-lg bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 disabled:opacity-50"
        disabled={item.is86 || disabled}
        onClick={() => onAdd(item, selected)}
      >
        {item.is86 ? 'Out of stock' : 'Add to order'}
      </button>
    </div>
  );
}

function CartBar({
  round,
  phone,
  setPhone,
  onRemove,
  onSubmit,
  busy,
}: {
  round: Round;
  phone: string;
  setPhone: (v: string) => void;
  onRemove: (id: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const total = round.items.reduce((acc, i) => acc + Number(i.lineTotal), 0);
  return (
    <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t bg-white p-4 shadow-2xl">
      <div className="mb-2 max-h-28 space-y-1 overflow-auto">
        {round.items.map((i) => (
          <div key={i.id} className="flex justify-between text-sm">
            <span>
              {i.quantity}× {i.menuItem.name}
            </span>
            <span className="flex items-center gap-2">
              {kes(i.lineTotal)}
              <button className="text-red-500" onClick={() => onRemove(i.id)}>
                ✕
              </button>
            </span>
          </div>
        ))}
      </div>
      <input
        className="mb-2 w-full rounded-lg border border-slate-300 p-2 text-sm"
        placeholder="M-Pesa phone e.g. 2547…"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <button
        className="w-full rounded-lg bg-teal-600 p-3 font-semibold text-white disabled:opacity-50"
        disabled={busy}
        onClick={onSubmit}
      >
        Pay {kes(total)} with M-Pesa
      </button>
    </div>
  );
}

function Tracking({
  round,
  phone,
  onRetry,
  busy,
}: {
  round: Round;
  phone: string;
  onRetry: (paymentId: string) => void;
  busy: boolean;
}) {
  const ticketStatus = round.kitchenTicket?.status;
  const label = ticketStatus ? TICKET_LABEL[ticketStatus] : TRACK_LABEL[round.status] ?? round.status;
  const failed = round.payments.filter((p) => p.status === 'FAILED');
  const pending = round.payments.some((p) => ['INITIATED', 'PENDING'].includes(p.status));

  return (
    <section className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-4">
      <p className="text-sm font-medium text-teal-800">Your order</p>
      <p className="mt-1 text-lg font-bold text-teal-900">{label}</p>
      {pending && <p className="mt-1 text-sm text-teal-700">Check your phone for the M-Pesa PIN prompt…</p>}
      {failed.length > 0 && (
        <div className="mt-2">
          <p className="text-sm text-red-600">Payment failed.</p>
          {failed.map((p) => (
            <button
              key={p.id}
              disabled={busy || !phone}
              className="mt-1 rounded bg-teal-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50"
              onClick={() => onRetry(p.id)}
            >
              Retry {Number(p.amount).toLocaleString('en-KE')}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
