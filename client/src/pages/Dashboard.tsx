import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from '../lib/api';

interface Institute {
  id: number;
  name: string;
  email: string;
  phone: string;
  whatsapp_number: string;
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
  const [connectingWA, setConnectingWA] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('institute');
    if (!stored) {
      navigate('/login');
      return;
    }

    const inst = JSON.parse(stored) as Institute;
    setInstitute(inst);

    const fetchLeads = async () => {
      try {
        const res = await fetch(apiUrl(`/api/leads/${inst.id}`));
        if (!res.ok) throw new Error('Failed to fetch leads.');
        const data = (await res.json()) as Lead[];
        setLeads(data);
      } catch (err) {
        console.error('Error fetching leads:', err);
      } finally {
        setLoading(false);
      }
    };

    void fetchLeads();
  }, [navigate]);

  // Load the Meta/Facebook JS SDK for Embedded Signup
  useEffect(() => {
    const metaAppId = import.meta.env.VITE_META_APP_ID as string | undefined;
    if (!metaAppId) {
      console.warn('VITE_META_APP_ID is not set — WhatsApp Embedded Signup will not work.');
      return;
    }

    window.fbAsyncInit = function () {
      window.FB.init({
        appId: metaAppId,
        autoLogAppEvents: true,
        xfbml: true,
        version: 'v21.0',
      });
    };

    if (document.getElementById('facebook-jssdk')) return;
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    document.body.appendChild(script);
  }, []);

  const handleConnectWhatsApp = () => {
    setConnectingWA(true);
    setWaError(null);

    if (!window.FB) {
      setWaError('Facebook SDK not loaded. Please refresh the page and try again.');
      setConnectingWA(false);
      return;
    }

    const metaConfigId = import.meta.env.VITE_META_CONFIG_ID as string | undefined;
    if (!metaConfigId) {
      setWaError('WhatsApp Embedded Signup is not configured. Please contact support.');
      setConnectingWA(false);
      return;
    }

    // Safety timeout
    const timeoutId = setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      setConnectingWA(false);
    }, 2 * 60 * 1000);

    // Guard to prevent double-processing if both paths fire (FINISH + FB.login code).
    let handled = false;

    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== 'https://www.facebook.com' &&
        event.origin !== 'https://web.facebook.com'
      ) return;

      try {
        const data = typeof event.data === 'string'
          ? (JSON.parse(event.data) as Record<string, unknown>)
          : (event.data as Record<string, unknown>);

        console.log('WA Embedded Signup postMessage:', JSON.stringify(data));

        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          if (data.event === 'CANCEL') {
            clearTimeout(timeoutId);
            window.removeEventListener('message', handleMessage);
            setWaError('WhatsApp connection was cancelled.');
            setConnectingWA(false);
          } else if (data.event === 'ERROR') {
            clearTimeout(timeoutId);
            window.removeEventListener('message', handleMessage);
            setWaError('An error occurred during WhatsApp signup.');
            setConnectingWA(false);
          } else if (data.event === 'FINISH') {
            // ✅ Extract waba_id and phone_number_id directly from postMessage
            const finishData = data.data as { waba_id?: string; phone_number_id?: string } | undefined;
            console.log('FINISH data:', JSON.stringify(finishData));

            if (finishData?.waba_id && finishData?.phone_number_id) {
              if (handled) return;
              handled = true;
              clearTimeout(timeoutId);
              window.removeEventListener('message', handleMessage);

              // Secondary path: send waba_id + phone_number_id to backend
              void (async () => {
                try {
                  const res = await fetch(apiUrl(`/api/institutes/${institute!.id}/connect-whatsapp`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      wabaId: finishData.waba_id,
                      phoneNumberId: finishData.phone_number_id,
                    }),
                  });
                  const resData = await res.json() as { success?: boolean; whatsapp_number?: string; error?: string };

                  if (!res.ok || !resData.success) {
                    throw new Error(resData.error ?? 'Failed to connect WhatsApp.');
                  }

                  const updated = {
                    ...institute!,
                    whatsapp_number: resData.whatsapp_number ?? institute!.whatsapp_number,
                    whatsapp_connected: true,
                  };
                  setInstitute(updated);
                  localStorage.setItem('institute', JSON.stringify(updated));
                } catch (err) {
                  setWaError(err instanceof Error ? err.message : 'Something went wrong.');
                } finally {
                  setConnectingWA(false);
                }
              })();
            }
          }
        }
      } catch {
        // ignore parse errors from non-JSON messages
      }
    };

    window.addEventListener('message', handleMessage);

    // FB.login triggers the Embedded Signup popup.
    // Primary path: use authResponse.code from this callback.
    // Secondary path: use wabaId+phoneNumberId from the WA_EMBEDDED_SIGNUP FINISH postMessage above.
    window.FB.login(
      (response) => {
        console.log('FB.login response:', JSON.stringify(response));

        if (response.authResponse?.code) {
          // Primary path: exchange the code server-side for an access token.
          clearTimeout(timeoutId);
          window.removeEventListener('message', handleMessage);
          if (handled) return; // FINISH postMessage already handled it
          handled = true;

          void (async () => {
            try {
              const res = await fetch(apiUrl(`/api/institutes/${institute!.id}/connect-whatsapp`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: response.authResponse!.code }),
              });
              const resData = await res.json() as { success?: boolean; whatsapp_number?: string; error?: string };

              if (!res.ok || !resData.success) {
                throw new Error(resData.error ?? 'Failed to connect WhatsApp.');
              }

              const updated = {
                ...institute!,
                whatsapp_number: resData.whatsapp_number ?? institute!.whatsapp_number,
                whatsapp_connected: true,
              };
              setInstitute(updated);
              localStorage.setItem('institute', JSON.stringify(updated));
            } catch (err) {
              setWaError(err instanceof Error ? err.message : 'Something went wrong.');
            } finally {
              setConnectingWA(false);
            }
          })();
        } else {
          // No code → user cancelled or flow failed.
          clearTimeout(timeoutId);
          window.removeEventListener('message', handleMessage);
          if (!handled) {
            setWaError('WhatsApp connection was cancelled or failed. Please try again.');
            setConnectingWA(false);
          }
        }
      },
      {
        config_id: metaConfigId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: '3',
        },
      },
    );
  };

  const updateStatus = async (leadId: number, status: string) => {
    try {
      const res = await fetch(apiUrl(`/api/leads/${leadId}/status`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setLeads((prev) =>
          prev.map((l) => (l.id === leadId ? { ...l, status } : l))
        );
      }
    } catch (err) {
      console.error('Error updating lead status:', err);
    }
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{institute.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {institute.email} · WhatsApp: {institute.whatsapp_number} ·{' '}
            <span className="inline-block bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full uppercase">
              {institute.plan}
            </span>
          </p>
        </div>
      </div>

      {/* Connect WhatsApp Banner */}
      {!institute.whatsapp_connected && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="font-semibold text-amber-800 text-sm">📱 Connect your WhatsApp Business number</p>
            <p className="text-amber-700 text-xs mt-1">
              Connect your WhatsApp Business account so students can reach you and leads are captured automatically.
            </p>
          </div>
          <button
            onClick={handleConnectWhatsApp}
            disabled={connectingWA}
            className="flex-shrink-0 bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {connectingWA ? 'Connecting…' : '🔗 Connect WhatsApp'}
          </button>
        </div>
      )}
      {waError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-6">
          {waError}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
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

      {/* Filters */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <span className="text-sm text-gray-500 mr-2">Filter:</span>
        {['all', 'new', 'contacted', 'converted', 'lost'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors capitalize ${
              filter === f
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Leads */}
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
            When students send WhatsApp messages to your registered number ({institute.whatsapp_number}),
            their inquiries will appear here as leads.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLeads.map((lead) => (
            <div
              key={lead.id}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 text-sm">
                      {lead.student_name ?? 'Unknown Student'}
                    </h3>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${
                        statusColors[lead.status] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {lead.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{lead.message}</p>
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span>📱 {lead.student_phone}</span>
                    <span>🕐 {new Date(lead.created_at).toLocaleString()}</span>
                  </div>
                </div>

                <div className="flex-shrink-0">
                  <select
                    value={lead.status}
                    onChange={(e) => void updateStatus(lead.id, e.target.value)}
                    className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
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
    </div>
  );
}
