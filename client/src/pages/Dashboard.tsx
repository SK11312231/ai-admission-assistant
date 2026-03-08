import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from '../lib/api';

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
  created_at: string;
}

type WAStatus = 'idle' | 'initializing' | 'qr' | 'connected' | 'disconnected';
type Tab = 'leads' | 'profile';

const statusColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  converted: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
};

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
  const [profileData, setProfileData] = useState<string>('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [reEnriching, setReEnriching] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('institute');
    if (!stored) { navigate('/login'); return; }
    const inst = JSON.parse(stored) as Institute;
    setInstitute(inst);

    const fetchLeads = async () => {
      try {
        const res = await fetch(apiUrl(`/api/leads/${inst.id}`));
        if (!res.ok) throw new Error('Failed to fetch leads.');
        setLeads((await res.json()) as Lead[]);
      } catch (err) {
        console.error('Error fetching leads:', err);
      } finally {
        setLoading(false);
      }
    };
    void fetchLeads();
  }, [navigate]);

  // Fetch profile when Profile tab is opened
  useEffect(() => {
    if (activeTab !== 'profile' || !institute) return;
    const fetchProfile = async () => {
      setProfileLoading(true);
      try {
        const res = await fetch(apiUrl(`/api/institutes/${institute.id}/details`));
        const data = await res.json() as { institute_data: string | null };
        setProfileData(data.institute_data ?? '');
      } catch {
        setProfileData('');
      } finally {
        setProfileLoading(false);
      }
    };
    void fetchProfile();
  }, [activeTab, institute]);

  // ── WhatsApp helpers ──────────────────────────────────────────────────────
  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

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
        if (data.status === 'disconnected') {
          stopPolling();
          setWaError('Connection was lost. Please try again.');
        }
      } catch (err) { console.error('Polling error:', err); }
    }, 3000);
  };

  const handleConnectWhatsApp = async () => {
    if (!institute) return;
    setWaError(null); setQrDataUrl(null);
    setWaStatus('initializing'); setShowQRModal(true);
    try {
      const res = await fetch(apiUrl(`/api/institutes/${institute.id}/connect-whatsapp`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Failed to start WhatsApp session.');
      }
      startPolling(institute);
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'Something went wrong.');
      setWaStatus('idle');
    }
  };

  const handleCloseModal = () => {
    stopPolling(); setShowQRModal(false);
    setQrDataUrl(null); setWaStatus('idle'); setWaError(null);
  };

  const handleDisconnect = async () => {
    if (!institute) return;
    await fetch(apiUrl(`/api/institutes/${institute.id}/disconnect-whatsapp`), { method: 'DELETE' });
    const updated = { ...institute, whatsapp_connected: false };
    setInstitute(updated);
    localStorage.setItem('institute', JSON.stringify(updated));
  };

  useEffect(() => () => stopPolling(), []);

  // ── Profile helpers ───────────────────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (!institute) return;
    setProfileSaving(true); setProfileMsg(null);
    try {
      const res = await fetch(apiUrl(`/api/institutes/${institute.id}/details`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institute_data: profileData }),
      });
      if (!res.ok) throw new Error('Failed to save.');
      setProfileMsg('Profile saved successfully.');
    } catch {
      setProfileMsg('Failed to save profile. Please try again.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleReEnrich = async () => {
    if (!institute) return;
    setReEnriching(true); setProfileMsg(null);
    try {
      await fetch(apiUrl(`/api/institutes/${institute.id}/re-enrich`), { method: 'POST' });
      setProfileMsg('Re-enrichment started. Refresh this tab in about 15 seconds to see updated data.');
    } catch {
      setProfileMsg('Failed to start re-enrichment.');
    } finally {
      setReEnriching(false);
    }
  };

  // ── Lead status update ────────────────────────────────────────────────────
  const updateStatus = async (leadId: number, status: string) => {
    try {
      const res = await fetch(apiUrl(`/api/leads/${leadId}/status`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, status } : l)));
    } catch (err) { console.error('Error updating lead status:', err); }
  };

  const filteredLeads = filter === 'all' ? leads : leads.filter((l) => l.status === filter);
  const stats = {
    total: leads.length,
    new: leads.filter((l) => l.status === 'new').length,
    contacted: leads.filter((l) => l.status === 'contacted').length,
    converted: leads.filter((l) => l.status === 'converted').length,
  };

  if (!institute) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">

      {/* QR Modal */}
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
                <img src={qrDataUrl} alt="WhatsApp QR Code" className="w-64 h-64 rounded-xl border border-gray-200" />
                <p className="text-xs text-gray-400">Open WhatsApp → Linked Devices → Link a Device</p>
                <p className="text-xs text-amber-600">QR expires in ~60s. A new one loads automatically.</p>
              </div>
            )}
            {waStatus === 'connected' && (
              <div className="py-8 flex flex-col items-center gap-3">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-3xl">✅</div>
                <p className="text-green-700 font-semibold">WhatsApp Connected!</p>
                <p className="text-sm text-gray-500">Students will now receive AI-powered replies.</p>
              </div>
            )}
            {waError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{waError}</div>
            )}
            {waStatus !== 'connected' && (
              <button onClick={handleCloseModal} className="mt-4 w-full border border-gray-300 text-gray-600 text-sm font-medium py-2 rounded-xl hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{institute.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {institute.email} · WhatsApp: {institute.whatsapp_number}
            {institute.website && <> · <a href={institute.website} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">{institute.website}</a></>}
            {' '}·{' '}
            <span className="inline-block bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full uppercase">{institute.plan}</span>
          </p>
        </div>
        {institute.whatsapp_connected && (
          <button onClick={() => void handleDisconnect()} className="text-xs text-red-500 hover:text-red-700 underline">
            Disconnect WhatsApp
          </button>
        )}
      </div>

      {/* WhatsApp Banner */}
      {!institute.whatsapp_connected ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="font-semibold text-amber-800 text-sm">📱 Connect your WhatsApp number</p>
            <p className="text-amber-700 text-xs mt-1">Scan a QR code to connect. Students will receive AI replies automatically.</p>
          </div>
          <button onClick={() => void handleConnectWhatsApp()} className="flex-shrink-0 bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-green-700 transition-colors whitespace-nowrap">
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

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Leads', value: stats.total, color: 'bg-gray-50' },
          { label: 'New', value: stats.new, color: 'bg-blue-50' },
          { label: 'Contacted', value: stats.contacted, color: 'bg-yellow-50' },
          { label: 'Converted', value: stats.converted, color: 'bg-green-50' },
        ].map((s) => (
          <div key={s.label} className={`${s.color} rounded-xl p-4 text-center border border-gray-200`}>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['leads', 'profile'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'leads' ? '📋 Leads' : '🏫 Institute Profile'}
          </button>
        ))}
      </div>

      {/* ── Leads Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'leads' && (
        <>
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <span className="text-sm text-gray-500 mr-2">Filter:</span>
            {['all', 'new', 'contacted', 'converted', 'lost'].map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors capitalize ${filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {f}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="text-center py-20 text-gray-500">
              <div className="text-4xl mb-4 animate-spin inline-block">⏳</div>
              <p>Loading leads…</p>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="text-center py-20">
              <span className="text-5xl block mb-4">📭</span>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">No leads yet</h3>
              <p className="text-gray-500 text-sm max-w-md mx-auto">
                When students message {institute.whatsapp_number}, they will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLeads.map((lead) => (
                <div key={lead.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900 text-sm">{lead.student_name ?? 'Unknown Student'}</h3>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${statusColors[lead.status] ?? 'bg-gray-100 text-gray-600'}`}>{lead.status}</span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{lead.message}</p>
                      <div className="flex items-center gap-4 text-xs text-gray-400">
                        <span>📱 {lead.student_phone}</span>
                        <span>🕐 {new Date(lead.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <select value={lead.status} onChange={(e) => void updateStatus(lead.id, e.target.value)}
                        className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="new">New</option>
                        <option value="contacted">Contacted</option>
                        <option value="converted">Converted</option>
                        <option value="lost">Lost</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Profile Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'profile' && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Institute Profile</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                This data is used by the AI to answer student queries accurately. It was auto-generated from your website at registration. You can edit it below.
              </p>
            </div>
            <button
              onClick={() => void handleReEnrich()}
              disabled={reEnriching}
              className="flex-shrink-0 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
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
              <textarea
                value={profileData}
                onChange={(e) => setProfileData(e.target.value)}
                rows={20}
                placeholder="No profile data yet. Click 'Re-fetch from website' to auto-generate, or type your institute's information here."
                className="w-full text-sm border border-gray-300 rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y font-mono"
              />
              <div className="flex justify-end mt-3">
                <button
                  onClick={() => void handleSaveProfile()}
                  disabled={profileSaving}
                  className="bg-indigo-600 text-white text-sm font-semibold px-5 py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
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
