import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Institute {
  id: number;
  name: string;
  email: string;
  phone: string;
  whatsapp_number: string;
  website: string | null;
  plan: string;
  whatsapp_connected: boolean;
}

interface Lead {
  id: number;
  institute_id: number;
  student_name: string | null;
  student_phone: string;
  message: string;
  status: string;
  notes: string | null;
  follow_up_date: string | null;
  last_activity_at: string;
  created_at: string;
}

type WAStatus = 'idle' | 'initializing' | 'qr' | 'connected' | 'disconnected';
type Tab = 'leads' | 'profile';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  converted: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
};

function isOverdue(date: string | null): boolean {
  if (!date) return false;
  return new Date(date) < new Date();
}

function formatFollowUp(date: string | null): string {
  if (!date) return '';
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `Overdue by ${Math.abs(diff)}d`;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const [institute, setInstitute] = useState<Institute | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<Tab>('leads');

  // WhatsApp
  const [showQRModal, setShowQRModal] = useState(false);
  const [waStatus, setWaStatus] = useState<WAStatus>('idle');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [waError, setWaError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Institute Profile
  const [profileData, setProfileData] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [reEnriching, setReEnriching] = useState(false);

  // Lead detail / notes drawer
  const [expandedLead, setExpandedLead] = useState<number | null>(null);
  const [editingNotes, setEditingNotes] = useState<Record<number, string>>({});
  const [savingNotes, setSavingNotes] = useState<Record<number, boolean>>({});
  const [savingFollowUp, setSavingFollowUp] = useState<Record<number, boolean>>({});
  const [editingFollowUp, setEditingFollowUp] = useState<Record<number, string>>({});
  const [sendingFollowUp, setSendingFollowUp] = useState<Record<number, boolean>>({});
  const [followUpResult, setFollowUpResult] = useState<Record<number, { ok: boolean; msg: string }>>({});

  // Add lead modal
  const [showAddLead, setShowAddLead] = useState(false);
  const [addForm, setAddForm] = useState({
    student_name: '',
    student_phone: '',
    message: '',
    notes: '',
    follow_up_date: '',
  });
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem('institute');
    if (!stored) { navigate('/login'); return; }
    const inst = JSON.parse(stored) as Institute;
    setInstitute(inst);

    void (async () => {
      // Always verify actual WA status from server — never trust localStorage alone
      try {
        const waRes = await fetch(apiUrl(`/api/institutes/${inst.id}/whatsapp-status`));
        if (waRes.ok) {
          const waData = await waRes.json() as { status: WAStatus; qr: string | null };
          if (waData.status === 'connected') {
            const updated = { ...inst, whatsapp_connected: true };
            setInstitute(updated);
            localStorage.setItem('institute', JSON.stringify(updated));
          } else if (waData.status === 'qr') {
            // Session lost after redeploy — show QR modal automatically
            const updated = { ...inst, whatsapp_connected: false };
            setInstitute(updated);
            localStorage.setItem('institute', JSON.stringify(updated));
            setWaStatus('qr');
            if (waData.qr) setQrDataUrl(waData.qr);
            setShowQRModal(true);
            startPolling(updated);
          } else {
            // disconnected — update localStorage
            const updated = { ...inst, whatsapp_connected: false };
            setInstitute(updated);
            localStorage.setItem('institute', JSON.stringify(updated));
          }
        }
      } catch { /* use localStorage as fallback */ }

      // Fetch leads
      try {
        const res = await fetch(apiUrl(`/api/leads/${inst.id}`));
        if (!res.ok) throw new Error();
        setLeads(await res.json() as Lead[]);
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, [navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Profile tab load ────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'profile' || !institute) return;
    void (async () => {
      setProfileLoading(true);
      try {
        const res = await fetch(apiUrl(`/api/institutes/${institute.id}/details`));
        const data = await res.json() as { institute_data: string | null };
        setProfileData(data.institute_data ?? '');
      } catch { setProfileData(''); }
      finally { setProfileLoading(false); }
    })();
  }, [activeTab, institute]);

  // ── WhatsApp ────────────────────────────────────────────────────────────────
  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };
  useEffect(() => () => stopPolling(), []);

  const startPolling = (inst: Institute) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(apiUrl(`/api/institutes/${inst.id}/whatsapp-status`));
        if (!res.ok) return;
        const data = await res.json() as { status: WAStatus; qr: string | null };
        setWaStatus(data.status);
        if (data.status === 'qr' && data.qr) setQrDataUrl(data.qr);
        if (data.status === 'connected') {
          stopPolling();
          setQrDataUrl(null);
          const updated = { ...inst, whatsapp_connected: true };
          setInstitute(updated);
          localStorage.setItem('institute', JSON.stringify(updated));
          setTimeout(() => setShowQRModal(false), 2000);
        }
        if (data.status === 'disconnected') { stopPolling(); setWaError('Connection lost. Please try again.'); }
      } catch { /* silent */ }
    }, 3000);
  };

  const handleConnectWhatsApp = async () => {
    if (!institute) return;
    setWaError(null); setQrDataUrl(null); setWaStatus('initializing'); setShowQRModal(true);
    try {
      const res = await fetch(apiUrl(`/api/institutes/${institute.id}/connect-whatsapp`), { method: 'POST' });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error); }
      startPolling(institute);
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'Something went wrong.');
      setWaStatus('idle');
    }
  };

  const handleDisconnect = async () => {
    if (!institute) return;
    await fetch(apiUrl(`/api/institutes/${institute.id}/disconnect-whatsapp`), { method: 'DELETE' });
    const updated = { ...institute, whatsapp_connected: false };
    setInstitute(updated);
    localStorage.setItem('institute', JSON.stringify(updated));
  };

  // ── Profile ─────────────────────────────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (!institute) return;
    setProfileSaving(true); setProfileMsg(null);
    try {
      const res = await fetch(apiUrl(`/api/institutes/${institute.id}/details`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institute_data: profileData }),
      });
      if (!res.ok) throw new Error();
      setProfileMsg('Profile saved successfully.');
    } catch { setProfileMsg('Failed to save profile. Please try again.'); }
    finally { setProfileSaving(false); }
  };

  const handleReEnrich = async () => {
    if (!institute) return;
    setReEnriching(true); setProfileMsg(null);
    try {
      await fetch(apiUrl(`/api/institutes/${institute.id}/re-enrich`), { method: 'POST' });
      setProfileMsg('Re-enrichment started. Refresh this tab in ~15 seconds.');
    } catch { setProfileMsg('Failed to start re-enrichment.'); }
    finally { setReEnriching(false); }
  };

  // ── Lead actions ────────────────────────────────────────────────────────────
  const updateStatus = async (leadId: number, status: string) => {
    await fetch(apiUrl(`/api/leads/${leadId}/status`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l));
  };

  const saveNotes = async (lead: Lead) => {
    const notes = editingNotes[lead.id] ?? lead.notes ?? '';
    setSavingNotes(prev => ({ ...prev, [lead.id]: true }));
    await fetch(apiUrl(`/api/leads/${lead.id}/notes`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, notes } : l));
    setSavingNotes(prev => ({ ...prev, [lead.id]: false }));
  };

  const saveFollowUp = async (lead: Lead) => {
    const follow_up_date = editingFollowUp[lead.id] ?? lead.follow_up_date ?? '';
    setSavingFollowUp(prev => ({ ...prev, [lead.id]: true }));
    await fetch(apiUrl(`/api/leads/${lead.id}/followup`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ follow_up_date: follow_up_date || null }),
    });
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, follow_up_date: follow_up_date || null } : l));
    setSavingFollowUp(prev => ({ ...prev, [lead.id]: false }));
  };

  const sendFollowUp = async (lead: Lead) => {
    setSendingFollowUp(prev => ({ ...prev, [lead.id]: true }));
    setFollowUpResult(prev => ({ ...prev, [lead.id]: { ok: false, msg: '' } }));
    try {
      const res = await fetch(apiUrl(`/api/leads/${lead.id}/send-followup`), { method: 'POST' });
      const data = await res.json() as { success?: boolean; message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to send.');
      setFollowUpResult(prev => ({ ...prev, [lead.id]: { ok: true, msg: data.message ?? '' } }));
      // Clear follow-up date after sending
      await fetch(apiUrl(`/api/leads/${lead.id}/followup`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ follow_up_date: null }),
      });
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, follow_up_date: null } : l));
    } catch (err) {
      setFollowUpResult(prev => ({ ...prev, [lead.id]: { ok: false, msg: err instanceof Error ? err.message : 'Failed to send.' } }));
    } finally {
      setSendingFollowUp(prev => ({ ...prev, [lead.id]: false }));
    }
  };

  // ── Add lead ────────────────────────────────────────────────────────────────
  const handleAddLead = async () => {
    if (!institute) return;
    setAddError(null);
    if (!addForm.student_phone.trim()) { setAddError('Phone number is required.'); return; }
    setAddLoading(true);
    try {
      const res = await fetch(apiUrl('/api/leads'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...addForm, institute_id: institute.id }),
      });
      const data = await res.json() as Lead & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to add lead.');
      setLeads(prev => [data, ...prev]);
      setShowAddLead(false);
      setAddForm({ student_name: '', student_phone: '', message: '', notes: '', follow_up_date: '' });
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add lead.');
    } finally { setAddLoading(false); }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  const filteredLeads = filter === 'all' ? leads : leads.filter(l => l.status === filter);
  const overdueCount = leads.filter(l => isOverdue(l.follow_up_date) && l.status !== 'converted' && l.status !== 'lost').length;
  const stats = {
    total: leads.length,
    new: leads.filter(l => l.status === 'new').length,
    contacted: leads.filter(l => l.status === 'contacted').length,
    converted: leads.filter(l => l.status === 'converted').length,
  };

  if (!institute) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">

      {/* ── QR Modal ─────────────────────────────────────────────────────────── */}
      {showQRModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Connect WhatsApp</h2>
            <p className="text-sm text-gray-500 mb-4">Scan this QR code with your WhatsApp app.</p>
            {waStatus === 'initializing' && (
              <div className="py-10 flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-500">Generating QR code…</p>
              </div>
            )}
            {waStatus === 'qr' && qrDataUrl && (
              <div className="flex flex-col items-center gap-3">
                <img src={qrDataUrl} alt="QR Code" className="w-64 h-64 rounded-xl border border-gray-200" />
                <p className="text-xs text-gray-400">Open WhatsApp → Linked Devices → Link a Device</p>
                <p className="text-xs text-amber-600">QR expires in ~60s. A new one loads automatically.</p>
              </div>
            )}
            {waStatus === 'connected' && (
              <div className="py-8 flex flex-col items-center gap-3">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-3xl">✅</div>
                <p className="text-green-700 font-semibold">WhatsApp Connected!</p>
              </div>
            )}
            {waError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{waError}</div>}
            {waStatus !== 'connected' && (
              <button onClick={() => { stopPolling(); setShowQRModal(false); setWaStatus('idle'); setWaError(null); }}
                className="mt-4 w-full border border-gray-300 text-gray-600 text-sm font-medium py-2 rounded-xl hover:bg-gray-50">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Add Lead Modal ───────────────────────────────────────────────────── */}
      {showAddLead && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">Add Lead Manually</h2>
              <button onClick={() => setShowAddLead(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            {addError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{addError}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Student Name <span className="text-gray-400">(optional)</span></label>
                <input type="text" value={addForm.student_name} onChange={e => setAddForm(f => ({ ...f, student_name: e.target.value }))}
                  placeholder="e.g. Rahul Sharma"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Phone Number <span className="text-red-500">*</span></label>
                <input type="tel" value={addForm.student_phone} onChange={e => setAddForm(f => ({ ...f, student_phone: e.target.value }))}
                  placeholder="+91 9876543210"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Initial Message <span className="text-gray-400">(optional)</span></label>
                <input type="text" value={addForm.message} onChange={e => setAddForm(f => ({ ...f, message: e.target.value }))}
                  placeholder="e.g. Interested in B.Tech admissions"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes <span className="text-gray-400">(optional)</span></label>
                <textarea value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} placeholder="Any additional notes…"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Follow-up Date <span className="text-gray-400">(optional)</span></label>
                <input type="date" value={addForm.follow_up_date} onChange={e => setAddForm(f => ({ ...f, follow_up_date: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowAddLead(false)}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => void handleAddLead()} disabled={addLoading}
                className="flex-1 bg-indigo-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                {addLoading ? 'Adding…' : 'Add Lead'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{institute.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {institute.email} · {institute.whatsapp_number}
            {institute.website && <> · <a href={institute.website} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">{institute.website}</a></>}
            {' '}· <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full uppercase">{institute.plan}</span>
          </p>
        </div>
        {institute.whatsapp_connected && (
          <button onClick={() => void handleDisconnect()} className="text-xs text-red-500 hover:text-red-700 underline">
            Disconnect WhatsApp
          </button>
        )}
      </div>

      {/* ── WhatsApp Banner ──────────────────────────────────────────────────── */}
      {!institute.whatsapp_connected ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="font-semibold text-amber-800 text-sm">📱 Connect your WhatsApp number</p>
            <p className="text-amber-700 text-xs mt-1">Scan a QR code. Students will receive AI replies automatically.</p>
          </div>
          <button onClick={() => void handleConnectWhatsApp()}
            className="flex-shrink-0 bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-green-700">
            🔗 Connect WhatsApp
          </button>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <span className="text-xl">✅</span>
          <div>
            <p className="font-semibold text-green-800 text-sm">WhatsApp Connected</p>
            <p className="text-green-700 text-xs mt-0.5">AI replies are active on {institute.whatsapp_number}.</p>
          </div>
        </div>
      )}

      {/* ── Overdue banner ───────────────────────────────────────────────────── */}
      {overdueCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-6 flex items-center gap-3">
          <span className="text-lg">⚠️</span>
          <p className="text-sm text-red-700 font-medium">
            {overdueCount} follow-up{overdueCount > 1 ? 's are' : ' is'} overdue.
          </p>
          <button onClick={() => { setActiveTab('leads'); setFilter('all'); }}
            className="ml-auto text-xs text-red-600 underline hover:text-red-800">View leads</button>
        </div>
      )}

      {/* ── Stats ────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Leads', value: stats.total, color: 'bg-gray-50' },
          { label: 'New', value: stats.new, color: 'bg-blue-50' },
          { label: 'Contacted', value: stats.contacted, color: 'bg-yellow-50' },
          { label: 'Converted', value: stats.converted, color: 'bg-green-50' },
        ].map(s => (
          <div key={s.label} className={`${s.color} rounded-xl p-4 text-center border border-gray-200`}>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['leads', 'profile'] as Tab[]).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {tab === 'leads' ? '📋 Leads' : '🏫 Institute Profile'}
          </button>
        ))}
      </div>

      {/* ── Leads Tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'leads' && (
        <>
          {/* Filter + Add button row */}
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            <span className="text-sm text-gray-500">Filter:</span>
            {['all', 'new', 'contacted', 'converted', 'lost'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors capitalize ${filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {f}
              </button>
            ))}
            <button onClick={() => setShowAddLead(true)}
              className="ml-auto bg-indigo-600 text-white text-xs font-semibold px-4 py-1.5 rounded-full hover:bg-indigo-700 transition-colors">
              + Add Lead
            </button>
          </div>

          {loading ? (
            <div className="text-center py-20 text-gray-400">
              <div className="text-4xl mb-4 animate-spin inline-block">⏳</div>
              <p>Loading leads…</p>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="text-center py-20">
              <span className="text-5xl block mb-4">📭</span>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">No leads yet</h3>
              <p className="text-gray-500 text-sm">When students message {institute.whatsapp_number}, they'll appear here. Or add one manually.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredLeads.map(lead => {
                const isExpanded = expandedLead === lead.id;
                const overdue = isOverdue(lead.follow_up_date) && lead.status !== 'converted' && lead.status !== 'lost';
                const followUpLabel = formatFollowUp(lead.follow_up_date);

                return (
                  <div key={lead.id}
                    className={`bg-white rounded-xl border transition-shadow ${overdue ? 'border-red-200' : 'border-gray-200'} ${isExpanded ? 'shadow-md' : 'hover:shadow-sm'}`}>

                    {/* Lead row */}
                    <div className="p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedLead(isExpanded ? null : lead.id)}>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-gray-900 text-sm">{lead.student_name ?? 'Unknown Student'}</h3>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[lead.status] ?? 'bg-gray-100 text-gray-600'}`}>{lead.status}</span>
                          {followUpLabel && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${overdue ? 'bg-red-100 text-red-600' : 'bg-purple-100 text-purple-700'}`}>
                              📅 {followUpLabel}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mb-1 truncate">{lead.message || <span className="italic text-gray-400">No message</span>}</p>
                        <div className="flex items-center gap-4 text-xs text-gray-400">
                          <span>📱 {lead.student_phone}</span>
                          <span>🕐 {new Date(lead.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        {lead.notes && !isExpanded && (
                          <p className="text-xs text-gray-400 mt-1 italic truncate">📝 {lead.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <select value={lead.status} onChange={e => void updateStatus(lead.id, e.target.value)}
                          className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                          <option value="new">New</option>
                          <option value="contacted">Contacted</option>
                          <option value="converted">Converted</option>
                          <option value="lost">Lost</option>
                        </select>
                        <button onClick={() => setExpandedLead(isExpanded ? null : lead.id)}
                          className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">
                          {isExpanded ? '▲' : '▼'}
                        </button>
                      </div>
                    </div>

                    {/* Expanded drawer */}
                    {isExpanded && (
                      <div className="border-t border-gray-100 px-4 py-4 grid sm:grid-cols-2 gap-4 bg-gray-50 rounded-b-xl">

                        {/* Notes */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">📝 Notes</label>
                          <textarea
                            defaultValue={lead.notes ?? ''}
                            onChange={e => setEditingNotes(prev => ({ ...prev, [lead.id]: e.target.value }))}
                            rows={3}
                            placeholder="Add notes about this lead…"
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none bg-white"
                          />
                          <button
                            onClick={() => void saveNotes(lead)}
                            disabled={savingNotes[lead.id]}
                            className="mt-1.5 text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                            {savingNotes[lead.id] ? 'Saving…' : 'Save Notes'}
                          </button>
                        </div>

                        {/* Follow-up date + Send button */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">📅 Follow-up Date</label>
                          <input
                            type="date"
                            defaultValue={lead.follow_up_date ? lead.follow_up_date.slice(0, 10) : ''}
                            onChange={e => setEditingFollowUp(prev => ({ ...prev, [lead.id]: e.target.value }))}
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                          />
                          {lead.follow_up_date && (
                            <p className={`text-xs mt-1 ${overdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                              {overdue ? '⚠️ ' : ''}{followUpLabel}
                            </p>
                          )}
                          <div className="flex gap-2 mt-1.5 flex-wrap">
                            <button
                              onClick={() => void saveFollowUp(lead)}
                              disabled={savingFollowUp[lead.id]}
                              className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                              {savingFollowUp[lead.id] ? 'Saving…' : 'Set Date'}
                            </button>
                            {lead.follow_up_date && (
                              <button
                                onClick={() => {
                                  setEditingFollowUp(prev => ({ ...prev, [lead.id]: '' }));
                                  void (async () => {
                                    await fetch(apiUrl(`/api/leads/${lead.id}/followup`), {
                                      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ follow_up_date: null }),
                                    });
                                    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, follow_up_date: null } : l));
                                  })();
                                }}
                                className="text-xs border border-gray-300 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100">
                                Clear
                              </button>
                            )}
                          </div>

                          {/* Send Follow-up via WhatsApp */}
                          <div className="mt-4 pt-3 border-t border-gray-200">
                            <label className="block text-xs font-medium text-gray-700 mb-1">💬 Send AI Follow-up</label>
                            <p className="text-xs text-gray-400 mb-2">
                              AI will generate a personalised follow-up message and send it to the student via WhatsApp instantly.
                            </p>
                            <button
                              onClick={() => void sendFollowUp(lead)}
                              disabled={sendingFollowUp[lead.id] || !institute?.whatsapp_connected}
                              className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5">
                              {sendingFollowUp[lead.id] ? (
                                <><span className="animate-spin">⏳</span> Sending…</>
                              ) : (
                                <>📲 Send Follow-up on WhatsApp</>
                              )}
                            </button>
                            {!institute?.whatsapp_connected && (
                              <p className="text-xs text-amber-600 mt-1">Connect WhatsApp first to send follow-ups.</p>
                            )}
                            {followUpResult[lead.id]?.msg && (
                              <div className={`mt-2 text-xs rounded-lg px-3 py-2 ${followUpResult[lead.id].ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                {followUpResult[lead.id].ok ? (
                                  <><span className="font-medium">Sent!</span> "{followUpResult[lead.id].msg.slice(0, 100)}{followUpResult[lead.id].msg.length > 100 ? '…' : ''}"</>
                                ) : (
                                  followUpResult[lead.id].msg
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Profile Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'profile' && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Institute Profile</h2>
              <p className="text-xs text-gray-500 mt-0.5">This data is used by the AI to answer student queries accurately.</p>
            </div>
            <button onClick={() => void handleReEnrich()} disabled={reEnriching}
              className="flex-shrink-0 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-100 disabled:opacity-50 whitespace-nowrap">
              {reEnriching ? 'Re-fetching…' : '🔄 Re-fetch from website'}
            </button>
          </div>
          {profileMsg && (
            <div className={`text-sm rounded-lg px-4 py-3 mb-4 ${profileMsg.includes('success') ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
              {profileMsg}
            </div>
          )}
          {profileLoading ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-3xl mb-3 animate-spin inline-block">⏳</div>
              <p className="text-sm">Loading profile…</p>
            </div>
          ) : (
            <>
              <textarea value={profileData} onChange={e => setProfileData(e.target.value)} rows={20}
                placeholder="No profile data yet. Click 'Re-fetch from website' to auto-generate, or type your institute's information here."
                className="w-full text-sm border border-gray-300 rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y font-mono" />
              <div className="flex justify-end mt-3">
                <button onClick={() => void handleSaveProfile()} disabled={profileSaving}
                  className="bg-indigo-600 text-white text-sm font-semibold px-5 py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                  {profileSaving ? 'Saving…' : 'Save Profile'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
