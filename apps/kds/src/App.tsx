import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Events } from '@omnibite/shared';
import { api } from './lib/api';
import { connectKitchen } from './lib/socket';
import type { AggRow, KdsConfig, Ticket } from './types';

const CONFIG_KEY = 'omnibite-kds-config';
const BOARD_KEY = 'omnibite-kds-board';

function loadConfig(): KdsConfig | null {
  const v = localStorage.getItem(CONFIG_KEY);
  return v ? (JSON.parse(v) as KdsConfig) : null;
}
function loadBoardCache(): Ticket[] | undefined {
  const v = localStorage.getItem(BOARD_KEY);
  return v ? (JSON.parse(v) as Ticket[]) : undefined;
}

export function App() {
  const [config, setConfig] = useState<KdsConfig | null>(loadConfig);
  if (!config) return <Setup onSave={setConfig} />;
  return <Board config={config} onSignOut={() => setConfig(null)} />;
}

function Setup({ onSave }: { onSave: (c: KdsConfig) => void }) {
  const [locationId, setLocationId] = useState('');
  const [staffId, setStaffId] = useState('');
  function save() {
    const c = { locationId: locationId.trim(), staffId: staffId.trim() };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
    onSave(c);
  }
  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-bold text-teal-300">OmniBite KDS</h1>
      <p className="mt-2 text-slate-400">Enter the location and kitchen staff id (from the seed output).</p>
      <input
        className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-800 p-3"
        placeholder="Location ID"
        value={locationId}
        onChange={(e) => setLocationId(e.target.value)}
      />
      <input
        className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 p-3"
        placeholder="Staff ID (KITCHEN)"
        value={staffId}
        onChange={(e) => setStaffId(e.target.value)}
      />
      <button
        className="mt-4 w-full rounded-lg bg-teal-500 p-3 font-semibold text-slate-900 disabled:opacity-50"
        disabled={!locationId || !staffId}
        onClick={save}
      >
        Open board
      </button>
    </div>
  );
}

function ageClasses(firedAt: string): string {
  const mins = (Date.now() - new Date(firedAt).getTime()) / 60000;
  if (mins < 5) return 'border-emerald-500';
  if (mins < 10) return 'border-amber-400';
  return 'border-red-500';
}

function Board({ config, onSignOut }: { config: KdsConfig; onSignOut: () => void }) {
  const qc = useQueryClient();
  const [view, setView] = useState<'board' | 'agg'>('board');
  const [online, setOnline] = useState(true);

  const boardQuery = useQuery({
    queryKey: ['board'],
    queryFn: () => api<Ticket[]>(`/locations/${config.locationId}/kitchen/board`, config.staffId),
    refetchInterval: 15000,
    initialData: loadBoardCache(),
  });
  const tickets = boardQuery.data ?? [];

  const aggQuery = useQuery({
    queryKey: ['agg'],
    enabled: view === 'agg',
    queryFn: () => api<AggRow[]>(`/locations/${config.locationId}/kitchen/aggregator`, config.staffId),
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (boardQuery.data) localStorage.setItem(BOARD_KEY, JSON.stringify(boardQuery.data));
  }, [boardQuery.data]);

  useEffect(() => {
    const refresh = () => qc.invalidateQueries({ queryKey: ['board'] });
    const socket = connectKitchen(config.staffId);
    socket.on('connect', () => {
      setOnline(true);
      const since = loadBoardCache()?.reduce<string>((m, t) => (t.firedAt > m ? t.firedAt : m), '1970-01-01');
      socket.emit('kds.replay', { since }, () => refresh());
    });
    socket.on('disconnect', () => setOnline(false));
    socket.on(Events.TICKET_FIRED, refresh);
    socket.on(Events.TICKET_STATUS, refresh);
    socket.on(Events.TICKET_SERVED, refresh);
    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.staffId]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['board'] });
    } catch (e) {
      alert(String(e));
    }
  }
  const setStatus = (id: string, status: string) =>
    act(() => api(`/kitchen/tickets/${id}/status`, config.staffId, { method: 'PATCH', body: JSON.stringify({ status }) }));
  const serve = (id: string) =>
    act(() => api(`/kitchen/tickets/${id}/serve`, config.staffId, { method: 'POST' }));
  const bump = (id: string) =>
    act(() => api(`/kitchen/lines/${id}/status`, config.staffId, { method: 'PATCH', body: JSON.stringify({ status: 'READY' }) }));

  return (
    <div className="min-h-screen p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-teal-300">Kitchen Display</h1>
        <div className="flex items-center gap-3">
          <span className={`text-sm ${online ? 'text-emerald-400' : 'text-red-400'}`}>
            {online ? '● live' : '○ offline'}
          </span>
          <button
            className="rounded bg-slate-800 px-3 py-1 text-sm"
            onClick={() => setView(view === 'board' ? 'agg' : 'board')}
          >
            {view === 'board' ? 'Aggregator' : 'Board'}
          </button>
          <button className="rounded bg-slate-800 px-3 py-1 text-sm" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {view === 'agg' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(aggQuery.data ?? []).map((row) => (
            <div key={row.name} className="rounded-xl bg-slate-800 p-4 text-center">
              <div className="text-4xl font-bold text-teal-300">{row.quantity}</div>
              <div className="mt-1 text-sm text-slate-300">{row.name}</div>
            </div>
          ))}
          {aggQuery.data && aggQuery.data.length === 0 && <p className="text-slate-400">Nothing in the queue.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tickets.length === 0 && <p className="text-slate-400">No paid tickets yet.</p>}
          {tickets.map((t) => (
            <TicketCard key={t.id} ticket={t} onStatus={setStatus} onServe={serve} onBump={bump} />
          ))}
        </div>
      )}
    </div>
  );
}

function TicketCard({
  ticket,
  onStatus,
  onServe,
  onBump,
}: {
  ticket: Ticket;
  onStatus: (id: string, status: string) => void;
  onServe: (id: string) => void;
  onBump: (id: string) => void;
}) {
  const mins = Math.floor((Date.now() - new Date(ticket.firedAt).getTime()) / 60000);
  return (
    <div className={`rounded-xl border-l-8 bg-slate-800 p-3 ${ageClasses(ticket.firedAt)}`}>
      <div className="mb-2 flex justify-between text-sm text-slate-400">
        <span className="font-semibold text-slate-200">#{ticket.roundId.slice(0, 6)}</span>
        <span>{mins}m · {ticket.status}</span>
      </div>
      <ul className="space-y-1">
        {ticket.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between">
            <span className={l.status === 'READY' ? 'text-slate-500 line-through' : ''}>
              <span className="font-bold">{l.roundItem.quantity}×</span> {l.roundItem.menuItem.name}
              <span className="ml-2 rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">{l.station}</span>
              {l.roundItem.notes && <span className="ml-1 text-xs text-amber-300">“{l.roundItem.notes}”</span>}
            </span>
            <button className="text-xs text-teal-300" onClick={() => onBump(l.id)}>
              bump
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        {ticket.status === 'QUEUED' && (
          <button className="flex-1 rounded bg-amber-500 py-2 text-sm font-semibold text-slate-900" onClick={() => onStatus(ticket.id, 'IN_PREP')}>
            Start
          </button>
        )}
        {ticket.status === 'IN_PREP' && (
          <button className="flex-1 rounded bg-emerald-500 py-2 text-sm font-semibold text-slate-900" onClick={() => onStatus(ticket.id, 'READY')}>
            Ready
          </button>
        )}
        {(ticket.status === 'READY' || ticket.status === 'IN_PREP') && (
          <button className="flex-1 rounded bg-teal-500 py-2 text-sm font-semibold text-slate-900" onClick={() => onServe(ticket.id)}>
            Serve
          </button>
        )}
      </div>
    </div>
  );
}
