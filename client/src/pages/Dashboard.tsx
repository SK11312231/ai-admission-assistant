import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Institute {
  id: number;
  name: string;
  email: string;
  phone: string;
  whatsapp_number: string;
  plan: string;
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
        const res = await fetch(`/api/leads/${inst.id}`);
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

  const updateStatus = async (leadId: number, status: string) => {
    try {
      const res = await fetch(`/api/leads/${leadId}/status`, {
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

  const handleLogout = () => {
    localStorage.removeItem('institute');
    navigate('/login');
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
        <button
          onClick={handleLogout}
          className="text-sm text-gray-500 hover:text-red-600 transition-colors"
        >
          Logout
        </button>
      </div>

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
