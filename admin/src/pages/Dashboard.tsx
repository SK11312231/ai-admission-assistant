import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

interface Overview {
  totalInstitutes: number; totalLeads: number; pendingUpgrades: number;
  planBreakdown: Record<string, number>; recentInstitutes: Institute[];
}
interface Institute {
  id: number; name: string; email: string; phone: string;
  whatsapp_number: string; website: string | null;
  plan: string; whatsapp_connected: boolean; is_active: boolean;
  created_at: string; lead_count?: number;
}
interface UpgradeRequest {
  id: number; requested_plan: string; status: string;
  created_at: string; resolved_at: string | null;
  institute_id: number; institute_name: string;
  institute_email: string; institute_phone: string; current_plan: string;
}
interface Lead {
  id: number; student_name: string | null; student_phone: string;
  message: string; status: string; notes: string | null;
  follow_up_date: string | null; created_at: string;
  institute_name: string; institute_id: number;
}
interface BlocklistEntry {
  id: number; phone: string; reason: string | null;
  created_at: string; institute_name: string; institute_id: number;
}
interface Settings {
  admins: { id: number; name: string; email: string; created_at: string }[];
  env: Record<string, string | null>;
}

type Tab = 'overview' | 'institutes' | 'upgrades' | 'leads' | 'blocklist' | 'remove' | 'settings';

const PLAN_COLORS: Record<string, string> = {
  starter: 'bg-gray-100 text-gray-600',
  growth:  'bg-indigo-100 text-indigo-700',
  pro:     'bg-purple-100 text-purple-700',
};
const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700', contacted: 'bg-yellow-100 text-yellow-700',
  converted: 'bg-green-100 text-green-700', lost: 'bg-red-100 text-red-700',
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className={`rounded-2xl p-5 ${color}`}>
      <p className="text-3xl font-extrabold">{value}</p>
      <p className="text-sm font-semibold mt-1">{label}</p>
    </div>
  );
}

// ── Password Confirm Modal ────────────────────────────────────────────────────

function DeleteConfirmModal({ institute, onConfirm, onCancel, loading, error }: {
  institute: Institute; onConfirm: (pw: string) => void;
  onCancel: () => void; loading: boolean; error: string | null;
}) {
  const [pw, setPw] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 text-lg">🗑️</div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Permanently Delete Institute</h3>
            <p className="text-sm text-slate-500 mt-0.5">This action cannot be undone.</p>
          </div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
          <p className="text-sm font-semibold text-red-800 mb-1">You are about to permanently delete:</p>
          <p className="text-sm text-red-700 font-bold">{institute.name}</p>
          <p className="text-xs text-red-500 mt-0.5">{institute.email}</p>
          <p className="text-xs text-red-600 mt-2">
            All leads, messages, blocklist entries and profile data will be <span className="font-bold">permanently erased</span>.
          </p>
        </div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
          Enter your admin password to confirm
        </label>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && pw && onConfirm(pw)}
          placeholder="Your admin password" autoFocus
          className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400 mb-3" />
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2 mb-3">⚠️ {error}</div>
        )}
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 py-2.5 border border-slate-200 text-slate-600 text-sm font-semibold rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={() => pw && onConfirm(pw)} disabled={loading || !pw}
            className="flex-1 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50">
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Deleting…
              </span>
            ) : 'Delete Permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const adminName = localStorage.getItem('admin_name') ?? 'Admin';
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const [overview, setOverview] = useState<Overview | null>(null);
  const [institutes, setInstitutes] = useState<Institute[]>([]);
  const [deactivated, setDeactivated] = useState<Institute[]>([]);
  const [upgradeRequests, setUpgradeRequests] = useState<UpgradeRequest[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [blocklist, setBlocklist] = useState<BlocklistEntry[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instSearch, setInstSearch] = useState('');
  const [leadSearch, setLeadSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<Record<string | number, boolean>>({});
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [editingPlan, setEditingPlan] = useState<number | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Institute | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [newAdmin, setNewAdmin] = useState({ name: '', email: '', password: '' });
  const [newAdminError, setNewAdminError] = useState<string | null>(null);
  const [newAdminLoading, setNewAdminLoading] = useState(false);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };
  const logout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_name');
    navigate('/login');
  };

  const fetchOverview = useCallback(async () => {
    setLoading(true); setError(null);
    try { setOverview(await apiFetch<Overview>('/api/admin/overview')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, []);

  const fetchInstitutes = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const q = instSearch ? `?search=${encodeURIComponent(instSearch)}` : '';
      setInstitutes(await apiFetch<Institute[]>(`/api/admin/institutes${q}`));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, [instSearch]);

  const fetchDeactivated = useCallback(async () => {
    setLoading(true); setError(null);
    try { setDeactivated(await apiFetch<Institute[]>('/api/admin/institutes?inactive=true')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, []);

  const fetchUpgrades = useCallback(async () => {
    setLoading(true); setError(null);
    try { setUpgradeRequests(await apiFetch<UpgradeRequest[]>('/api/admin/upgrade-requests')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, []);

  const fetchLeads = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const q = leadSearch ? `?search=${encodeURIComponent(leadSearch)}` : '';
      setLeads(await apiFetch<Lead[]>(`/api/admin/leads${q}`));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, [leadSearch]);

  const fetchBlocklist = useCallback(async () => {
    setLoading(true); setError(null);
    try { setBlocklist(await apiFetch<BlocklistEntry[]>('/api/admin/blocklist')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, []);

  const fetchSettings = useCallback(async () => {
    setLoading(true); setError(null);
    try { setSettings(await apiFetch<Settings>('/api/admin/settings')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'overview') void fetchOverview();
    else if (activeTab === 'institutes') void fetchInstitutes();
    else if (activeTab === 'remove') void fetchDeactivated();
    else if (activeTab === 'upgrades') void fetchUpgrades();
    else if (activeTab === 'leads') void fetchLeads();
    else if (activeTab === 'blocklist') void fetchBlocklist();
    else if (activeTab === 'settings') void fetchSettings();
  }, [activeTab, fetchOverview, fetchInstitutes, fetchDeactivated, fetchUpgrades, fetchLeads, fetchBlocklist, fetchSettings]);

  const updatePlan = async (instituteId: number, plan: string) => {
    setActionLoading(p => ({ ...p, [`plan-${instituteId}`]: true }));
    try {
      await apiFetch(`/api/admin/institutes/${instituteId}/plan`, { method: 'PATCH', body: JSON.stringify({ plan }) });
      setInstitutes(prev => prev.map(i => i.id === instituteId ? { ...i, plan } : i));
      setEditingPlan(null);
      showToast(`Plan updated to ${plan}`);
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false); }
    finally { setActionLoading(p => ({ ...p, [`plan-${instituteId}`]: false })); }
  };

  const deactivateInstitute = async (id: number) => {
    setActionLoading(p => ({ ...p, [`deact-${id}`]: true }));
    try {
      await apiFetch(`/api/admin/institutes/${id}/deactivate`, { method: 'PATCH', body: '{}' });
      setInstitutes(prev => prev.filter(i => i.id !== id));
      showToast('Institute deactivated. Find it under Remove Institute.');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false); }
    finally { setActionLoading(p => ({ ...p, [`deact-${id}`]: false })); }
  };

  const reactivateInstitute = async (id: number) => {
    setActionLoading(p => ({ ...p, [`react-${id}`]: true }));
    try {
      await apiFetch(`/api/admin/institutes/${id}/reactivate`, { method: 'PATCH', body: '{}' });
      setDeactivated(prev => prev.filter(i => i.id !== id));
      showToast('Institute reactivated.');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false); }
    finally { setActionLoading(p => ({ ...p, [`react-${id}`]: false })); }
  };

  const handleHardDelete = async (password: string) => {
    if (!deleteTarget) return;
    setDeleteLoading(true); setDeleteError(null);
    try {
      await apiFetch(`/api/admin/institutes/${deleteTarget.id}`, {
        method: 'DELETE', body: JSON.stringify({ adminPassword: password }),
      });
      setDeactivated(prev => prev.filter(i => i.id !== deleteTarget.id));
      setDeleteTarget(null);
      showToast('Institute permanently deleted.');
    } catch (e) { setDeleteError(e instanceof Error ? e.message : 'Failed'); }
    finally { setDeleteLoading(false); }
  };

  const handleUpgradeAction = async (reqId: number, action: 'approve' | 'reject') => {
    setActionLoading(p => ({ ...p, [reqId]: true }));
    try {
      await apiFetch(`/api/admin/upgrade-requests/${reqId}`, { method: 'PATCH', body: JSON.stringify({ action }) });
      setUpgradeRequests(prev => prev.map(r => r.id === reqId ? { ...r, status: action === 'approve' ? 'approved' : 'rejected' } : r));
      showToast(`Request ${action === 'approve' ? 'approved ✅' : 'rejected ❌'}`);
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false); }
    finally { setActionLoading(p => ({ ...p, [reqId]: false })); }
  };

  const deleteBlockEntry = async (id: number) => {
    setActionLoading(p => ({ ...p, [`bl-${id}`]: true }));
    try {
      await apiFetch(`/api/admin/blocklist/${id}`, { method: 'DELETE' });
      setBlocklist(prev => prev.filter(b => b.id !== id));
      showToast('Removed from blocklist.');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed', false); }
    finally { setActionLoading(p => ({ ...p, [`bl-${id}`]: false })); }
  };

  const createAdmin = async () => {
    setNewAdminError(null);
    if (!newAdmin.name || !newAdmin.email || !newAdmin.password) { setNewAdminError('All fields required.'); return; }
    if (newAdmin.password.length < 8) { setNewAdminError('Password must be at least 8 characters.'); return; }
    setNewAdminLoading(true);
    try {
      await apiFetch('/api/admin/admins', { method: 'POST', body: JSON.stringify(newAdmin) });
      setNewAdmin({ name: '', email: '', password: '' });
      showToast('Admin account created.');
      void fetchSettings();
    } catch (e) { setNewAdminError(e instanceof Error ? e.message : 'Failed'); }
    finally { setNewAdminLoading(false); }
  };

  const navItems: { tab: Tab; icon: string; label: string; badge?: number; danger?: boolean }[] = [
    { tab: 'overview', icon: '📊', label: 'Overview' },
    { tab: 'institutes', icon: '🏫', label: 'Institutes' },
    { tab: 'upgrades', icon: '⬆️', label: 'Upgrades', badge: upgradeRequests.filter(r => r.status === 'pending').length || undefined },
    { tab: 'leads', icon: '👤', label: 'All Leads' },
    { tab: 'blocklist', icon: '🚫', label: 'Blocklist' },
    { tab: 'remove', icon: '🗑️', label: 'Remove Institute', badge: deactivated.length || undefined, danger: true },
    { tab: 'settings', icon: '⚙️', label: 'Settings' },
  ];

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">

      {deleteTarget && (
        <DeleteConfirmModal institute={deleteTarget} onConfirm={handleHardDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteError(null); }}
          loading={deleteLoading} error={deleteError} />
      )}

      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold text-white ${toast.ok ? 'bg-green-500' : 'bg-red-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-60 bg-slate-900 flex flex-col flex-shrink-0">
        <div className="px-6 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-base">🎓</div>
            <div>
              <p className="text-white font-bold text-sm leading-none">InquiAI</p>
              <p className="text-slate-400 text-xs mt-0.5">Admin Panel</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(item => (
            <button key={item.tab} onClick={() => setActiveTab(item.tab)}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                activeTab === item.tab
                  ? item.danger ? 'bg-red-700 text-white' : 'bg-indigo-600 text-white'
                  : item.danger ? 'text-red-400 hover:text-white hover:bg-red-900/40' : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}>
              <span className="flex items-center gap-2.5"><span className="text-base">{item.icon}</span>{item.label}</span>
              {item.badge ? (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${item.danger ? 'bg-red-500 text-white' : 'bg-indigo-500 text-white'}`}>
                  {item.badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-xs font-semibold">{adminName}</p>
              <p className="text-slate-500 text-xs">Super Admin</p>
            </div>
            <button onClick={logout}
              className="text-slate-400 hover:text-red-400 text-xs border border-slate-700 hover:border-red-500 px-2 py-1 rounded-lg transition-colors">
              Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-8">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-6">⚠️ {error}</div>}
          {loading && (
            <div className="flex items-center gap-3 text-slate-400 text-sm mb-6">
              <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin inline-block" /> Loading…
            </div>
          )}

          {/* OVERVIEW */}
          {activeTab === 'overview' && overview && (
            <>
              <div className="mb-6"><h1 className="text-2xl font-bold text-slate-900">Overview</h1><p className="text-slate-500 text-sm mt-1">Platform-wide snapshot</p></div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatCard label="Total Institutes" value={overview.totalInstitutes} color="bg-white text-slate-900 border border-slate-200" />
                <StatCard label="Total Leads" value={overview.totalLeads} color="bg-indigo-600 text-white" />
                <StatCard label="Pending Upgrades" value={overview.pendingUpgrades} color={overview.pendingUpgrades > 0 ? 'bg-amber-500 text-white' : 'bg-white text-slate-900 border border-slate-200'} />
                <StatCard label="Pro Institutes" value={overview.planBreakdown['pro'] ?? 0} color="bg-purple-600 text-white" />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-800 mb-4">Plan Distribution</h3>
                  <div className="space-y-3">
                    {['starter', 'growth', 'pro'].map(plan => {
                      const count = overview.planBreakdown[plan] ?? 0;
                      const pct = Math.round((count / (overview.totalInstitutes || 1)) * 100);
                      return (
                        <div key={plan}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className={`capitalize font-semibold px-2 py-0.5 rounded-full ${PLAN_COLORS[plan]}`}>{plan}</span>
                            <span className="text-slate-500">{count} · {pct}%</span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${plan === 'starter' ? 'bg-slate-400' : plan === 'growth' ? 'bg-indigo-500' : 'bg-purple-500'}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-800 mb-4">Recently Joined</h3>
                  <div className="space-y-3">
                    {overview.recentInstitutes.map(inst => (
                      <div key={inst.id} className="flex items-center justify-between">
                        <div className="min-w-0"><p className="text-sm font-medium text-slate-900 truncate">{inst.name}</p><p className="text-xs text-slate-400">{fmtDate(inst.created_at)}</p></div>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize flex-shrink-0 ml-3 ${PLAN_COLORS[inst.plan]}`}>{inst.plan}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* INSTITUTES */}
          {activeTab === 'institutes' && (
            <>
              <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
                <div><h1 className="text-2xl font-bold text-slate-900">Institutes</h1><p className="text-slate-500 text-sm mt-1">{institutes.length} active institutes</p></div>
                <div className="flex gap-2">
                  <input type="text" placeholder="Search name or email…" value={instSearch} onChange={e => setInstSearch(e.target.value)}
                    className="px-4 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white w-60" />
                  <button onClick={() => void fetchInstitutes()} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-semibold">Search</button>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {['Institute', 'Contact', 'Plan', 'WA', 'Leads', 'Joined', 'Actions'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {institutes.map(inst => (
                        <tr key={inst.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3"><p className="font-semibold text-slate-900">{inst.name}</p><p className="text-xs text-slate-400 mt-0.5">{inst.email}</p></td>
                          <td className="px-4 py-3 text-slate-500 text-xs"><p>{inst.phone}</p><p className="mt-0.5">{inst.whatsapp_number}</p></td>
                          <td className="px-4 py-3">
                            {editingPlan === inst.id ? (
                              <div className="flex items-center gap-1.5">
                                <select defaultValue={inst.plan} id={`plan-select-${inst.id}`}
                                  className="text-xs border border-slate-300 rounded-lg px-2 py-1 focus:outline-none">
                                  {['starter', 'growth', 'pro'].map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                                <button onClick={() => { const s = document.getElementById(`plan-select-${inst.id}`) as HTMLSelectElement; void updatePlan(inst.id, s.value); }}
                                  className="text-xs bg-green-500 text-white px-2 py-1 rounded-lg">✓</button>
                                <button onClick={() => setEditingPlan(null)} className="text-xs text-slate-400 px-1">✕</button>
                              </div>
                            ) : (
                              <button onClick={() => setEditingPlan(inst.id)}
                                className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize cursor-pointer hover:opacity-80 ${PLAN_COLORS[inst.plan]}`}>
                                {inst.plan} ✎
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${inst.whatsapp_connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {inst.whatsapp_connected ? '✅ On' : '○ Off'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-700 font-semibold">{inst.lead_count ?? 0}</td>
                          <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmtDate(inst.created_at)}</td>
                          <td className="px-4 py-3">
                            <button onClick={() => void deactivateInstitute(inst.id)} disabled={actionLoading[`deact-${inst.id}`]}
                              className="text-xs text-amber-600 border border-amber-200 hover:bg-amber-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                              {actionLoading[`deact-${inst.id}`] ? '…' : 'Deactivate'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {institutes.length === 0 && !loading && <div className="text-center py-16 text-slate-400 text-sm">No institutes found.</div>}
                </div>
              </div>
            </>
          )}

          {/* REMOVE INSTITUTE */}
          {activeTab === 'remove' && (
            <>
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900">Remove Institute</h1>
                <p className="text-slate-500 text-sm mt-1">Deactivated institutes — reactivate or permanently delete</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 mb-6 flex gap-3">
                <span className="text-xl flex-shrink-0">⚠️</span>
                <div>
                  <p className="text-sm font-semibold text-red-800">Permanent deletion is irreversible</p>
                  <p className="text-xs text-red-600 mt-0.5">All leads, messages and data will be permanently erased. Your admin password is required to confirm.</p>
                </div>
              </div>
              {deactivated.length === 0 && !loading ? (
                <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
                  <span className="text-4xl block mb-3">✅</span>
                  <p className="text-slate-500 text-sm">No deactivated institutes.</p>
                  <p className="text-slate-400 text-xs mt-1">Deactivate an institute from the Institutes tab to see it here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {deactivated.map(inst => (
                    <div key={inst.id} className="bg-white rounded-2xl border border-red-100 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="font-semibold text-slate-900">{inst.name}</p>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${PLAN_COLORS[inst.plan]}`}>{inst.plan}</span>
                          <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">Deactivated</span>
                        </div>
                        <p className="text-xs text-slate-400">{inst.email} · {inst.phone}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{inst.lead_count ?? 0} leads · Joined {fmtDate(inst.created_at)}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => void reactivateInstitute(inst.id)} disabled={actionLoading[`react-${inst.id}`]}
                          className="text-sm bg-green-600 text-white font-semibold px-4 py-2 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors">
                          {actionLoading[`react-${inst.id}`] ? '…' : '↩ Reactivate'}
                        </button>
                        <button onClick={() => { setDeleteTarget(inst); setDeleteError(null); }}
                          className="text-sm bg-red-600 text-white font-semibold px-4 py-2 rounded-xl hover:bg-red-700 transition-colors">
                          🗑️ Delete Permanently
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* UPGRADES */}
          {activeTab === 'upgrades' && (
            <>
              <div className="mb-6"><h1 className="text-2xl font-bold text-slate-900">Upgrade Requests</h1><p className="text-slate-500 text-sm mt-1">{upgradeRequests.filter(r => r.status === 'pending').length} pending</p></div>
              <div className="space-y-3">
                {upgradeRequests.length === 0 && !loading && (
                  <div className="text-center py-20 bg-white rounded-2xl border border-slate-200"><span className="text-4xl block mb-3">🎉</span><p className="text-slate-500 text-sm">No upgrade requests yet.</p></div>
                )}
                {upgradeRequests.map(req => (
                  <div key={req.id} className={`bg-white rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${req.status === 'pending' ? 'border-amber-200' : 'border-slate-200'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="font-semibold text-slate-900">{req.institute_name}</p>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${PLAN_COLORS[req.current_plan]}`}>{req.current_plan}</span>
                        <span className="text-slate-400 text-xs">→</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${PLAN_COLORS[req.requested_plan]}`}>{req.requested_plan}</span>
                      </div>
                      <p className="text-xs text-slate-400">{req.institute_email} · {req.institute_phone}</p>
                      <p className="text-xs text-slate-400 mt-0.5">Requested {fmtDate(req.created_at)} · #{req.id}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {req.status === 'pending' ? (
                        <>
                          <button onClick={() => void handleUpgradeAction(req.id, 'approve')} disabled={actionLoading[req.id]}
                            className="text-sm bg-green-600 text-white font-semibold px-4 py-2 rounded-xl hover:bg-green-700 disabled:opacity-50">{actionLoading[req.id] ? '…' : '✅ Approve'}</button>
                          <button onClick={() => void handleUpgradeAction(req.id, 'reject')} disabled={actionLoading[req.id]}
                            className="text-sm border border-red-200 text-red-500 font-semibold px-4 py-2 rounded-xl hover:bg-red-50 disabled:opacity-50">{actionLoading[req.id] ? '…' : '❌ Reject'}</button>
                        </>
                      ) : (
                        <span className={`text-xs font-semibold px-3 py-1.5 rounded-full capitalize ${req.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{req.status}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* LEADS */}
          {activeTab === 'leads' && (
            <>
              <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
                <div><h1 className="text-2xl font-bold text-slate-900">All Leads</h1><p className="text-slate-500 text-sm mt-1">{leads.length} shown (max 200)</p></div>
                <div className="flex gap-2">
                  <input type="text" placeholder="Search name or phone…" value={leadSearch} onChange={e => setLeadSearch(e.target.value)}
                    className="px-4 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white w-60" />
                  <button onClick={() => void fetchLeads()} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-semibold">Search</button>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-slate-50 border-b border-slate-200">{['Student','Phone','Institute','Status','Message','Date'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {leads.map(lead => (
                        <tr key={lead.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-900">{lead.student_name ?? <span className="text-slate-400 italic">Unknown</span>}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{lead.student_phone}</td>
                          <td className="px-4 py-3 text-xs text-indigo-600 font-medium">{lead.institute_name}</td>
                          <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[lead.status] ?? 'bg-gray-100 text-gray-600'}`}>{lead.status}</span></td>
                          <td className="px-4 py-3 text-slate-500 text-xs max-w-xs truncate">{lead.message || '—'}</td>
                          <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmtDate(lead.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {leads.length === 0 && !loading && <div className="text-center py-16 text-slate-400 text-sm">No leads found.</div>}
                </div>
              </div>
            </>
          )}

          {/* BLOCKLIST */}
          {activeTab === 'blocklist' && (
            <>
              <div className="mb-6"><h1 className="text-2xl font-bold text-slate-900">Blocklist</h1><p className="text-slate-500 text-sm mt-1">{blocklist.length} numbers blocked</p></div>
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-slate-50 border-b border-slate-200">{['Phone','Institute','Reason','Blocked On','Action'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {blocklist.map(entry => (
                        <tr key={entry.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-900">{entry.phone}</td>
                          <td className="px-4 py-3 text-xs text-indigo-600 font-medium">{entry.institute_name}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{entry.reason ?? '—'}</td>
                          <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmtDate(entry.created_at)}</td>
                          <td className="px-4 py-3">
                            <button onClick={() => void deleteBlockEntry(entry.id)} disabled={actionLoading[`bl-${entry.id}`]}
                              className="text-xs text-red-500 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                              {actionLoading[`bl-${entry.id}`] ? '…' : 'Remove'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {blocklist.length === 0 && !loading && <div className="text-center py-16 text-slate-400 text-sm">Blocklist is empty.</div>}
                </div>
              </div>
            </>
          )}

          {/* SETTINGS */}
          {activeTab === 'settings' && settings && (
            <>
              <div className="mb-6"><h1 className="text-2xl font-bold text-slate-900">Settings</h1><p className="text-slate-500 text-sm mt-1">Admin accounts and environment configuration</p></div>
              <div className="grid sm:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-900 mb-4">Admin Accounts</h3>
                  <div className="space-y-2 mb-5">
                    {settings.admins.map(a => (
                      <div key={a.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                        <div><p className="text-sm font-medium text-slate-900">{a.name}</p><p className="text-xs text-slate-400">{a.email} · Added {fmtDate(a.created_at)}</p></div>
                        <span className="text-xs bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">Admin</span>
                      </div>
                    ))}
                  </div>
                  <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-widest mb-3">Add New Admin</h4>
                  {newAdminError && <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2 mb-3">{newAdminError}</div>}
                  <div className="space-y-2">
                    <input type="text" placeholder="Full name" value={newAdmin.name} onChange={e => setNewAdmin(p => ({ ...p, name: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <input type="email" placeholder="Email address" value={newAdmin.email} onChange={e => setNewAdmin(p => ({ ...p, email: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <input type="password" placeholder="Password (min 8 chars)" value={newAdmin.password} onChange={e => setNewAdmin(p => ({ ...p, password: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <button onClick={() => void createAdmin()} disabled={newAdminLoading}
                      className="w-full bg-indigo-600 text-white text-sm font-semibold py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                      {newAdminLoading ? 'Creating…' : '+ Create Admin'}
                    </button>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-900 mb-4">Environment Configuration</h3>
                  <div className="space-y-3">
                    {Object.entries(settings.env).map(([key, val]) => (
                      <div key={key} className="flex items-start justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
                        <p className="text-xs font-mono font-semibold text-slate-600">{key}</p>
                        <p className={`text-xs font-mono text-right ${val ? 'text-green-600' : 'text-red-400'}`}>{val ?? '⚠️ Not set'}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                    <p className="text-xs text-amber-700"><span className="font-semibold">Note:</span> Manage env vars in Railway. Changes require a redeploy.</p>
                  </div>
                </div>
              </div>
            </>
          )}

        </div>
      </main>
    </div>
  );
}