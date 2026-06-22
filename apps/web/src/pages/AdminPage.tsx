import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { api } from '../lib/api';
import type { MenuItem } from '../types';

const kes = (v: string | number) => `KES ${Number(v).toLocaleString('en-KE')}`;

interface AdminAuth {
  locationId: string;
  staffId: string;
}
const AUTH_KEY = 'omnibite:admin';
const loadAuth = (): AdminAuth | null => {
  const v = localStorage.getItem(AUTH_KEY);
  return v ? (JSON.parse(v) as AdminAuth) : null;
};

/** Read a chosen image file, downscale it, and return a compact data: URL. */
function fileToDataUrl(file: File, max = 700): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('could not decode image'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas unavailable'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function AdminPage() {
  const [auth, setAuth] = useState<AdminAuth | null>(() => loadAuth());
  if (!auth) return <AdminGate onReady={setAuth} />;
  return (
    <AdminMenu
      auth={auth}
      onSignOut={() => {
        localStorage.removeItem(AUTH_KEY);
        setAuth(null);
      }}
    />
  );
}

function AdminGate({ onReady }: { onReady: (a: AdminAuth) => void }) {
  const [locationId, setLocationId] = useState('');
  const [staffId, setStaffId] = useState('');
  const submit = () => {
    if (!locationId.trim() || !staffId.trim()) return;
    const auth = { locationId: locationId.trim(), staffId: staffId.trim() };
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    onReady(auth);
  };
  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-bold text-teal-700">OmniBite — Menu admin</h1>
      <p className="mt-1 text-sm text-slate-500">
        Sign in with an admin or manager staff id to manage this location’s menu.
      </p>
      <input
        className="mt-4 w-full rounded-lg border border-slate-300 p-3 text-sm"
        placeholder="Location id"
        value={locationId}
        onChange={(e) => setLocationId(e.target.value)}
      />
      <input
        className="mt-3 w-full rounded-lg border border-slate-300 p-3 text-sm"
        placeholder="Staff id (ADMIN or MANAGER)"
        value={staffId}
        onChange={(e) => setStaffId(e.target.value)}
      />
      <button
        className="mt-3 w-full rounded-lg bg-teal-600 p-3 font-semibold text-white"
        onClick={submit}
      >
        Continue
      </button>
    </div>
  );
}

function AdminMenu({ auth, onSignOut }: { auth: AdminAuth; onSignOut: () => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'menu' | 'tables'>('menu');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const menuQuery = useQuery({
    queryKey: ['admin-menu', auth.locationId],
    queryFn: () => api<MenuItem[]>(`/locations/${auth.locationId}/menu`),
  });

  const staffApi = <T,>(path: string, opts: RequestInit = {}) =>
    api<T>(path, { ...opts, headers: { 'x-staff-id': auth.staffId, ...(opts.headers ?? {}) } });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-menu', auth.locationId] });

  async function run(fn: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-teal-700">Restaurant admin</h1>
          <p className="text-xs text-slate-400">location {auth.locationId.slice(0, 8)}…</p>
        </div>
        <button className="text-sm text-slate-500 underline" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <div className="mb-4 flex gap-2">
        {(['menu', 'tables'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize ${
              tab === t ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'tables' ? (
        <TablesManager auth={auth} />
      ) : (
        <>
          {error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

          <NewItemForm
            disabled={busy}
            onCreate={(body) =>
              run(async () => {
                await staffApi('/menu-items', {
                  method: 'POST',
                  body: JSON.stringify({ ...body, locationId: auth.locationId }),
                });
              })
            }
          />

          <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {menuQuery.data?.length ?? 0} items
          </h2>
          {menuQuery.isLoading && <p>Loading…</p>}
          <div className="space-y-3">
            {menuQuery.data?.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                disabled={busy}
                onSave={(body) =>
                  run(async () => {
                    await staffApi(`/menu-items/${item.id}`, { method: 'PATCH', body: JSON.stringify(body) });
                  })
                }
                onToggle86={(is86) =>
                  run(async () => {
                    await staffApi(`/menu-items/${item.id}/availability`, {
                      method: 'PATCH',
                      body: JSON.stringify({ is86 }),
                    });
                  })
                }
                onDelete={() =>
                  run(async () => {
                    await staffApi(`/menu-items/${item.id}`, { method: 'DELETE' });
                  })
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface TableRow {
  id: string;
  tableNumber: string;
  qrToken: string;
  floorState: string;
}

function TablesManager({ auth }: { auth: AdminAuth }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newNumber, setNewNumber] = useState('');

  const tablesQuery = useQuery({
    queryKey: ['admin-tables', auth.locationId],
    queryFn: () =>
      api<TableRow[]>(`/locations/${auth.locationId}/tables`, {
        headers: { 'x-staff-id': auth.staffId },
      }),
  });

  const staffApi = <T,>(path: string, opts: RequestInit = {}) =>
    api<T>(path, { ...opts, headers: { 'x-staff-id': auth.staffId, ...(opts.headers ?? {}) } });

  async function run(fn: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['admin-tables', auth.locationId] });
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-semibold">Add a table</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-slate-300 p-2 text-sm"
            placeholder="Table number / name (e.g. 12 or Patio 3)"
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value)}
          />
          <button
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={busy || !newNumber.trim()}
            onClick={async () => {
              const ok = await run(async () => {
                await staffApi('/tables', {
                  method: 'POST',
                  body: JSON.stringify({ locationId: auth.locationId, tableNumber: newNumber.trim() }),
                });
              });
              if (ok) setNewNumber('');
            }}
          >
            Add table
          </button>
        </div>
      </section>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {tablesQuery.data?.length ?? 0} tables
      </h2>
      {tablesQuery.isLoading && <p>Loading…</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tablesQuery.data?.map((t) => (
          <TableCard
            key={t.id}
            table={t}
            disabled={busy}
            onRename={(tableNumber) =>
              run(async () => {
                await staffApi(`/tables/${t.id}`, { method: 'PATCH', body: JSON.stringify({ tableNumber }) });
              })
            }
            onRotate={() =>
              run(async () => {
                await staffApi(`/tables/${t.id}/rotate-token`, { method: 'POST' });
              })
            }
            onDelete={() =>
              run(async () => {
                await staffApi(`/tables/${t.id}`, { method: 'DELETE' });
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function TableCard({
  table,
  disabled,
  onRename,
  onRotate,
  onDelete,
}: {
  table: TableRow;
  disabled: boolean;
  onRename: (tableNumber: string) => void;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const [number, setNumber] = useState(table.tableNumber);
  const url = `${window.location.origin}/t/${table.qrToken}`;

  const download = () => {
    const canvas = document.getElementById(`qr-${table.id}`) as HTMLCanvasElement | null;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `omnibite-table-${table.tableNumber}.png`;
    a.click();
  };

  return (
    <div className="rounded-xl border bg-white p-4 text-center shadow-sm">
      <QRCodeCanvas id={`qr-${table.id}`} value={url} size={148} marginSize={2} className="mx-auto" />
      <div className="mt-2 flex items-center justify-center gap-2">
        <input
          className="w-24 rounded border border-slate-300 p-1 text-center text-sm"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
        <button
          className="rounded bg-teal-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
          disabled={disabled || !number.trim() || number === table.tableNumber}
          onClick={() => onRename(number.trim())}
        >
          Rename
        </button>
      </div>
      <p className="mt-1 break-all text-[10px] text-slate-400">{url}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <button className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600" onClick={download}>
          Download
        </button>
        <button
          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 disabled:opacity-40"
          disabled={disabled}
          onClick={onRotate}
          title="Generate a new code; the old printed one stops working"
        >
          Rotate
        </button>
        <button
          className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 disabled:opacity-40"
          disabled={disabled}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

interface ItemForm {
  name: string;
  basePrice: number;
  category?: string;
  description?: string;
  photoUrl?: string;
  allergens?: string[];
}

function PhotoPicker({
  value,
  onChange,
  onError,
}: {
  value?: string;
  onChange: (dataUrl: string) => void;
  onError: (msg: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-16 w-16 overflow-hidden rounded-md border bg-slate-100">
        {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="flex-1">
        <input
          type="file"
          accept="image/*"
          className="block w-full text-xs text-slate-500 file:mr-2 file:rounded file:border-0 file:bg-teal-50 file:px-2 file:py-1 file:text-teal-700"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              onChange(await fileToDataUrl(file));
            } catch (err) {
              onError(String(err));
            }
          }}
        />
        <input
          className="mt-1 w-full rounded border border-slate-200 p-1 text-xs"
          placeholder="…or paste an image URL"
          value={value && value.startsWith('http') ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function NewItemForm({ disabled, onCreate }: { disabled: boolean; onCreate: (b: ItemForm) => Promise<boolean> }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [allergens, setAllergens] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!name.trim() || !price.trim() || Number.isNaN(Number(price))) {
      setErr('Name and a numeric price are required.');
      return;
    }
    const ok = await onCreate({
      name: name.trim(),
      basePrice: Number(price),
      category: category.trim() || undefined,
      description: description.trim() || undefined,
      photoUrl: photoUrl || undefined,
      allergens: allergens.split(',').map((a) => a.trim()).filter(Boolean),
    });
    if (!ok) return; // keep the user's input so they can fix and retry
    setName('');
    setPrice('');
    setCategory('');
    setDescription('');
    setAllergens('');
    setPhotoUrl('');
  };

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="mb-3 font-semibold">Add an item</h2>
      <div className="grid grid-cols-2 gap-2">
        <input className="rounded border border-slate-300 p-2 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="rounded border border-slate-300 p-2 text-sm" placeholder="Price (KES)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        <input className="rounded border border-slate-300 p-2 text-sm" placeholder="Category (e.g. Grill)" value={category} onChange={(e) => setCategory(e.target.value)} />
        <input className="rounded border border-slate-300 p-2 text-sm" placeholder="Allergens (comma separated)" value={allergens} onChange={(e) => setAllergens(e.target.value)} />
      </div>
      <input className="mt-2 w-full rounded border border-slate-300 p-2 text-sm" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="mt-2">
        <PhotoPicker value={photoUrl} onChange={setPhotoUrl} onError={setErr} />
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <button className="mt-3 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={disabled} onClick={submit}>
        Add to menu
      </button>
    </section>
  );
}

function ItemRow({
  item,
  disabled,
  onSave,
  onToggle86,
  onDelete,
}: {
  item: MenuItem;
  disabled: boolean;
  onSave: (b: Partial<ItemForm>) => void;
  onToggle86: (is86: boolean) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(item.basePrice));
  const [photoUrl, setPhotoUrl] = useState(item.photoUrl ?? '');
  const [err, setErr] = useState<string | null>(null);
  const dirty = name !== item.name || price !== String(item.basePrice) || photoUrl !== (item.photoUrl ?? '');

  return (
    <div className={`rounded-xl border bg-white p-3 shadow-sm ${item.is86 ? 'opacity-60' : ''}`}>
      <div className="mb-2">
        <PhotoPicker value={photoUrl} onChange={setPhotoUrl} onError={setErr} />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input className="rounded border border-slate-300 p-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="w-28 rounded border border-slate-300 p-2 text-sm" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <p className="mt-1 text-xs text-slate-400">
        {item.category ?? 'Uncategorised'} · {kes(item.basePrice)}
        {item.is86 && <span className="ml-2 font-semibold text-amber-700">86’d</span>}
      </p>
      {err && <p className="mt-1 text-sm text-red-600">{err}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className="rounded bg-teal-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-40"
          disabled={disabled || !dirty || !price.trim() || Number.isNaN(Number(price))}
          onClick={() => onSave({ name: name.trim(), basePrice: Number(price), photoUrl: photoUrl || undefined })}
        >
          Save
        </button>
        <button className="rounded border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-600 disabled:opacity-40" disabled={disabled} onClick={() => onToggle86(!item.is86)}>
          {item.is86 ? 'Mark available' : 'Mark 86'}
        </button>
        <button className="rounded border border-red-200 px-3 py-1 text-sm font-semibold text-red-600 disabled:opacity-40" disabled={disabled} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
