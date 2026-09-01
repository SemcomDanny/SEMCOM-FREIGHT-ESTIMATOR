import { useEffect, useState } from 'react';
import { containerCbm } from '@semcom/engine';
import { api } from '../api';
import type { AppSettings, ContainerTypeRow, Lane, PalletTypeRow } from '../api';
import { useAuth } from '../state/AuthContext';
import { NumInput } from '../components/NumInput';
import { Banner, Card, fmt } from '../components/ui';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'estimator' | 'admin';
  active: number;
}

interface AuditRow {
  id: number;
  entity: string;
  entity_id: string;
  action: string;
  changed_by_name: string | null;
  changed_at: string;
  detail_json: string | null;
}

export function Admin() {
  const { isAdmin } = useAuth();
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [containers, setContainers] = useState<ContainerTypeRow[]>([]);
  const [pallets, setPallets] = useState<PalletTypeRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [newLane, setNewLane] = useState({ originPort: '', destinationPort: '' });
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'estimator', password: '' });

  const reload = () => {
    void Promise.all([
      api.get<Lane[]>('/master/lanes'),
      api.get<ContainerTypeRow[]>('/master/container-types'),
      api.get<PalletTypeRow[]>('/master/pallet-types'),
      api.get<AppSettings>('/master/settings'),
    ]).then(([l, c, p, s]) => {
      setLanes(l);
      setContainers(c);
      setPallets(p);
      setSettings(s);
    });
    if (isAdmin) {
      void api.get<UserRow[]>('/auth/users').then(setUsers).catch(() => undefined);
      void api.get<AuditRow[]>('/master/audit?limit=60').then(setAudit).catch(() => undefined);
    }
  };

  useEffect(reload, [isAdmin]);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 5000);
  };

  if (!isAdmin) {
    return (
      <Banner tone="info">
        Master data and rate cards are admin-only. Ask an administrator if something needs changing.
      </Banner>
    );
  }

  return (
    <div className="space-y-3">
      {message && <Banner tone="success">{message}</Banner>}

      <Card
        title="Container types"
        subtitle="Internal dimensions vary by carrier and build — edit these to match what you actually get"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Name</th>
                <th className="th text-right">Internal L</th>
                <th className="th text-right">W</th>
                <th className="th text-right">H</th>
                <th className="th text-right">Max payload</th>
                <th className="th text-right">Capacity</th>
                <th className="th w-24">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {containers.map((c) => (
                <tr key={c.id}>
                  <td className="td font-medium">{c.name}</td>
                  {(['int_l_mm', 'int_w_mm', 'int_h_mm', 'max_payload_kg'] as const).map((field) => (
                    <td className="td" key={field}>
                      <NumInput
                        dp={0}
                        value={c[field]}
                        onChange={(v) =>
                          setContainers((prev) => prev.map((x) => (x.id === c.id ? { ...x, [field]: v } : x)))
                        }
                      />
                    </td>
                  ))}
                  <td className="td tabular text-right text-slate-600">
                    {fmt.cbm(
                      containerCbm({
                        id: c.id,
                        name: c.name,
                        intLMm: c.int_l_mm,
                        intWMm: c.int_w_mm,
                        intHMm: c.int_h_mm,
                        maxPayloadKg: c.max_payload_kg,
                      }),
                      1,
                    )}{' '}
                    CBM
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={c.active === 1}
                        onChange={(e) => {
                          void api
                            .patch(`/master/container-types/${c.id}`, { active: e.target.checked })
                            .then(reload);
                        }}
                      />
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => {
                          void api
                            .post('/master/container-types', {
                              id: c.id,
                              name: c.name,
                              intLMm: c.int_l_mm,
                              intWMm: c.int_w_mm,
                              intHMm: c.int_h_mm,
                              maxPayloadKg: c.max_payload_kg,
                            })
                            .then(() => flash(`${c.name} saved.`));
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Pallet types">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Name</th>
                <th className="th text-right">L</th>
                <th className="th text-right">W</th>
                <th className="th text-right">Deck h</th>
                <th className="th text-right">Max load h</th>
                <th className="th text-right">Max load kg</th>
                <th className="th text-right">Overhang</th>
                <th className="th w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pallets.map((p) => (
                <tr key={p.id}>
                  <td className="td font-medium">{p.name}</td>
                  {(['l_mm', 'w_mm', 'deck_h_mm', 'max_load_h_mm', 'max_load_kg', 'overhang_mm'] as const).map(
                    (field) => (
                      <td className="td" key={field}>
                        <NumInput
                          dp={0}
                          value={p[field]}
                          onChange={(v) =>
                            setPallets((prev) => prev.map((x) => (x.id === p.id ? { ...x, [field]: v } : x)))
                          }
                        />
                      </td>
                    ),
                  )}
                  <td className="td">
                    <button
                      className="btn-ghost text-xs"
                      onClick={() => {
                        void api
                          .post('/master/pallet-types', {
                            id: p.id,
                            name: p.name,
                            lMm: p.l_mm,
                            wMm: p.w_mm,
                            deckHMm: p.deck_h_mm,
                            maxLoadHMm: p.max_load_h_mm,
                            maxLoadKg: p.max_load_kg,
                            overhangMm: p.overhang_mm,
                          })
                          .then(() => flash(`${p.name} saved.`));
                      }}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 py-2.5">
          <button
            className="btn-ghost"
            onClick={() => {
              const name = window.prompt('New pallet type name (e.g. Custom 1100 x 1100)');
              if (!name) return;
              void api
                .post('/master/pallet-types', {
                  name,
                  lMm: 1100,
                  wMm: 1100,
                  deckHMm: 150,
                  maxLoadHMm: 1150,
                  maxLoadKg: 1000,
                  overhangMm: 0,
                })
                .then(reload);
            }}
          >
            + Add custom pallet
          </button>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Lanes">
          <table className="w-full">
            <tbody className="divide-y divide-slate-100">
              {lanes.map((l) => (
                <tr key={l.id}>
                  <td className="td">
                    {l.origin_port} → {l.destination_port}
                  </td>
                  <td className="td w-24 text-right">
                    <label className="inline-flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={l.active === 1}
                        onChange={(e) => {
                          void api.patch(`/master/lanes/${l.id}`, { active: e.target.checked }).then(reload);
                        }}
                      />
                      Active
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 px-4 py-2.5">
            <input
              className="field w-40"
              placeholder="Origin port"
              value={newLane.originPort}
              onChange={(e) => setNewLane({ ...newLane, originPort: e.target.value })}
            />
            <input
              className="field w-40"
              placeholder="Destination port"
              value={newLane.destinationPort}
              onChange={(e) => setNewLane({ ...newLane, destinationPort: e.target.value })}
            />
            <button
              className="btn-primary"
              onClick={() => {
                void api
                  .post('/master/lanes', newLane)
                  .then(() => {
                    setNewLane({ originPort: '', destinationPort: '' });
                    reload();
                  })
                  .catch((e: Error) => flash(e.message));
              }}
            >
              Add lane
            </button>
          </div>
        </Card>

        <Card title="Settings">
          {settings && (
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <label className="block">
                <span className="label">Default stow efficiency</span>
                <NumInput
                  dp={2}
                  value={settings.stowEfficiency}
                  onChange={(v) => setSettings({ ...settings, stowEfficiency: v })}
                />
              </label>
              <label className="block">
                <span className="label">Stale rate threshold (days)</span>
                <NumInput
                  dp={0}
                  value={settings.staleRateDays}
                  onChange={(v) => setSettings({ ...settings, staleRateDays: v })}
                />
              </label>
              <label className="block">
                <span className="label">Default duty %</span>
                <NumInput
                  value={settings.defaultDutyPct}
                  onChange={(v) => setSettings({ ...settings, defaultDutyPct: v })}
                />
              </label>
              <label className="block">
                <span className="label">Default GST %</span>
                <NumInput
                  value={settings.defaultGstPct}
                  onChange={(v) => setSettings({ ...settings, defaultGstPct: v })}
                />
              </label>
              <label className="block">
                <span className="label">Pallet tare (kg)</span>
                <NumInput
                  value={settings.palletTareKg}
                  onChange={(v) => setSettings({ ...settings, palletTareKg: v })}
                />
              </label>
              <div className="flex items-end">
                <button
                  className="btn-primary"
                  onClick={() => {
                    void api.put('/master/settings', settings).then(() => flash('Settings saved.'));
                  }}
                >
                  Save settings
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Users">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Email</th>
              <th className="th">Role</th>
              <th className="th w-24">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="td">{u.name}</td>
                <td className="td text-slate-600">{u.email}</td>
                <td className="td">
                  <select
                    className="field w-32 py-1"
                    value={u.role}
                    onChange={(e) => {
                      void api.patch(`/auth/users/${u.id}`, { role: e.target.value }).then(reload);
                    }}
                  >
                    <option value="estimator">Estimator</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="td">
                  <input
                    type="checkbox"
                    checked={u.active === 1}
                    onChange={(e) => {
                      void api.patch(`/auth/users/${u.id}`, { active: e.target.checked }).then(reload);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 px-4 py-2.5">
          <input
            className="field w-40"
            placeholder="Name"
            value={newUser.name}
            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
          />
          <input
            className="field w-52"
            placeholder="Email"
            value={newUser.email}
            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
          />
          <select
            className="field w-32"
            value={newUser.role}
            onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
          >
            <option value="estimator">Estimator</option>
            <option value="admin">Admin</option>
          </select>
          <input
            className="field w-40"
            type="password"
            placeholder="Password (8+ chars)"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
          />
          <button
            className="btn-primary"
            onClick={() => {
              void api
                .post('/auth/users', newUser)
                .then(() => {
                  setNewUser({ email: '', name: '', role: 'estimator', password: '' });
                  reload();
                  flash('User created.');
                })
                .catch((e: Error) => flash(e.message));
            }}
          >
            Add user
          </button>
        </div>
      </Card>

      <Card title="Audit trail" subtitle="Append-only record of every rate and master data change">
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="th">When</th>
                <th className="th">Who</th>
                <th className="th">Entity</th>
                <th className="th">Action</th>
                <th className="th">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="td tabular text-xs">{a.changed_at.slice(0, 16).replace('T', ' ')}</td>
                  <td className="td text-xs">{a.changed_by_name ?? '—'}</td>
                  <td className="td text-xs">
                    {a.entity}
                    <span className="ml-1 text-slate-400">{a.entity_id}</span>
                  </td>
                  <td className="td text-xs">{a.action}</td>
                  <td className="td font-mono text-[11px] text-slate-600">
                    {a.detail_json?.slice(0, 90) ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
