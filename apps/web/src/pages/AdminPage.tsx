import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
          <h1 className="text-xl font-bold text-teal-700">Menu admin</h1>
          <p className="text-xs text-slate-400">location {auth.locationId.slice(0, 8)}…</p>
        </div>
        <button className="text-sm text-slate-500 underline" onClick={onSignOut}>
          Sign out
        </button>
      </header>

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
