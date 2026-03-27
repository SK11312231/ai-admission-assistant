import { useEffect, useRef, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiUrl } from '../lib/api';
import TrainingSection from '../components/TrainingSection';
import PremiumSection from '../components/PremiumSection';
				

// ── Razorpay global type declaration ─────────────────────────────────────────
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open(): void };
  }
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; email: string };
  theme: { color: string };
  handler: (response: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => void;
  modal: { ondismiss: () => void };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Institute {
  id: number;
  name: string;
  email: string;
  phone: string;
  whatsapp_number: string;
  website: string | null;
  plan: string;
  is_paid: boolean;
  is_premium_accessible: boolean;
  email_verified: boolean;
  phone_verified: boolean;
  whatsapp_connected: boolean;
  whatsapp_waba_id?: string | null;
  whatsapp_phone_number_id?: string | null;
  created_at: string;
  subscription_billing_cycle?: string | null;
  subscription_expires_at?: string | null;
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

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface BlockedNumber {
  id: number;
  institute_id: number;
  phone: string;
  reason: string | null;
  created_at: string;
}

interface AnalyticsOverview {
  totalLeads: number;
  conversionRate: number;
  thisWeekLeads: number;
  weekGrowth: number | null;
  byStatus: Record<string, number>;
}

interface LeadsOverTime { label: string; count: number; }
interface PeakHour { hour: number; label: string; count: number; }
interface StatusBreakdown { name: string; value: number; color: string; }

type WAStatus = 'idle' | 'initializing' | 'qr' | 'connected' | 'disconnected';
type Tab = 'leads' | 'analytics' | 'profile' | 'blocklist' | 'widget' | 'training' | 'premium' | 'whatsapp' | 'broadcast';

// ── Trial helper ──────────────────────────────────────────────────────────────

function getTrialDaysLeft(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  const daysUsed = Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24));
  return Math.max(0, 14 - daysUsed);
}

function isTrialExpired(createdAt: string): boolean {
  return getTrialDaysLeft(createdAt) === 0;
}

// Format phone number for display — strips @lid/@c.us, formats nicely
function formatPhone(raw: string): string {
  const isLid = raw.endsWith('@lid');
  const clean = raw.replace(/@c\.us$/, '').replace(/@lid$/, '').replace(/\D/g, '');
  if (!clean) return raw;

  // @lid numbers are WhatsApp internal IDs (14+ digits), not real phone numbers
  // Display them as shortened WhatsApp IDs
  if (isLid || clean.length > 13) {
    return `WA #${clean.slice(-6)}`;
  }

  // Indian numbers: 10 digits or 12 digits starting with 91
  if (clean.length === 12 && clean.startsWith('91')) return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
  if (clean.length === 10 && /^[6-9]/.test(clean)) return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
  // Other international numbers
  return `+${clean}`;
}

// Format timestamp in IST
function formatIST(raw: string): string {
  const d = new Date(raw);
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
    hour12: true,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  converted: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
};


function isOverdue(date: string | null): boolean {
  if (!date) return false;
  const followUp = new Date(date);
  followUp.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return followUp < today;
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
  const [searchParams] = useSearchParams();
  const [institute, setInstitute] = useState<Institute | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile sidebar drawer
  const [profileCompleteness, setProfileCompleteness] = useState<{
    complete: boolean; score: number; missing: string[]; present: string[];
  } | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<Tab>('leads');

  // Verification state (Basic Info tab)
  const [emailVerifySending, setEmailVerifySending] = useState(false);
  const [emailVerifyMsg, setEmailVerifyMsg] = useState<string | null>(null);
  // PHONE VERIFICATION — commented until DLT registration is complete
  // const [showOtpModal, setShowOtpModal] = useState(false);
  // const [otpSending, setOtpSending] = useState(false);
  // const [otpValue, setOtpValue] = useState(['', '', '', '', '', '']);
  // const [otpVerifying, setOtpVerifying] = useState(false);
  // const [otpError, setOtpError] = useState<string | null>(null);
  // const [otpCooldown, setOtpCooldown] = useState(0);

  // WhatsApp
  const [showQRModal, setShowQRModal] = useState(false);
  const [waStatus, setWaStatus] = useState<WAStatus>('idle');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [waError, setWaError] = useState<string | null>(null);
  // Multi-number state
  const [waNumbers, setWaNumbers] = useState<Array<{
    id: number; slot: number; phone_number: string | null;
    label: string; is_connected: boolean; status: string;
  }>>([]);
  const [waNumbersLoading, setWaNumbersLoading] = useState(false);
					   
  const [addingNumber, setAddingNumber] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Institute Profile
  const [profileData, setProfileData] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [reEnriching, setReEnriching] = useState(false);
  // Profile section sub-tab
  const [profileSection, setProfileSection] = useState<'basic' | 'details' | 'hours' | 'password' | 'notifications'>('basic');
  // Basic info form
  const [basicForm, setBasicForm] = useState({ name: '', phone: '', website: '' });
  const [basicSaving, setBasicSaving] = useState(false);
  const [basicMsg, setBasicMsg] = useState<string | null>(null);
  // Business hours
  const DEFAULT_HOURS = { mon: { open: '09:00', close: '18:00', closed: false }, tue: { open: '09:00', close: '18:00', closed: false }, wed: { open: '09:00', close: '18:00', closed: false }, thu: { open: '09:00', close: '18:00', closed: false }, fri: { open: '09:00', close: '18:00', closed: false }, sat: { open: '09:00', close: '14:00', closed: false }, sun: { open: '09:00', close: '14:00', closed: true } };
  const [businessHours, setBusinessHours] = useState<Record<string, { open: string; close: string; closed: boolean }>>(DEFAULT_HOURS);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursMsg, setHoursMsg] = useState<string | null>(null);
  // Notifications
  const [notifPrefs, setNotifPrefs] = useState({ notify_new_lead: true, notify_followup_due: true, notify_weekly_summary: false });
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifMsg, setNotifMsg] = useState<string | null>(null);
  // Password change
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Analytics state ─────────────────────────────────────────────────────────
  const [analyticsOverview, setAnalyticsOverview] = useState<AnalyticsOverview | null>(null);
  const [leadsOverTime, setLeadsOverTime] = useState<LeadsOverTime[]>([]);
  const [peakHours, setPeakHours] = useState<PeakHour[]>([]);
  const [statusBreakdown, setStatusBreakdown] = useState<StatusBreakdown[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<number>(7);

  // ── Blocklist state ──────────────────────────────────────────────────────────
  const [blocklist, setBlocklist] = useState<BlockedNumber[]>([]);
  const [blocklistLoading, setBlocklistLoading] = useState(false);
  const [blocklistError, setBlocklistError] = useState<string | null>(null);
  const [newBlockPhone, setNewBlockPhone] = useState('');
  const [newBlockReason, setNewBlockReason] = useState('');
  const [addingBlock, setAddingBlock] = useState(false);
  const [addBlockError, setAddBlockError] = useState<string | null>(null);

  // Lead detail / notes drawer
  const [expandedLead, setExpandedLead] = useState<number | null>(null);
  const [editingNotes, setEditingNotes] = useState<Record<number, string>>({});
  const [savingNotes, setSavingNotes] = useState<Record<number, boolean>>({});
  const [savedNotes, setSavedNotes] = useState<Record<number, boolean>>({});
  const [editingName, setEditingName] = useState<Record<number, string | null>>({}); // null = not editing, string = editing value
  const [savingName, setSavingName] = useState<Record<number, boolean>>({});
  const [savingFollowUp, setSavingFollowUp] = useState<Record<number, boolean>>({});
  const [editingFollowUp, setEditingFollowUp] = useState<Record<number, string>>({});
  const [sendingFollowUp, setSendingFollowUp] = useState<Record<number, boolean>>({});
  const [followUpResult, setFollowUpResult] = useState<Record<number, { ok: boolean; msg: string }>>({});
  const [conversations, setConversations] = useState<Record<number, ChatMessage[]>>({});
  const [convLoading, setConvLoading] = useState<Record<number, boolean>>({});
  const [drawerTab, setDrawerTab] = useState<Record<number, 'chat' | 'notes' | 'followup'>>({});

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
  const [addFieldErrors, setAddFieldErrors] = useState<Record<string, string>>({});
  const [addLoading, setAddLoading] = useState(false);

  // Upgrade modal
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [upgradeSuccess, setUpgradeSuccess] = useState(false);
  const [selectedBilling, setSelectedBilling] = useState<'monthly' | 'annual'>('monthly');

  // Widget tab
  const [widgetCopied, setWidgetCopied] = useState(false);

  // Broadcast tab
  const [broadcasts, setBroadcasts] = useState<Array<{
    id: number; name: string; message: string; status: string;
    target_filter: string; total_count: number; sent_count: number;
    failed_count: number; created_at: string; completed_at: string | null;
  }>>([]);
  const [broadcastsLoading, setBroadcastsLoading] = useState(false);
  const [broadcastForm, setBroadcastForm] = useState({ name: '', message: '', target_filter: 'all' });
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [broadcastPreviewCount, setBroadcastPreviewCount] = useState<number | null>(null);
  const [broadcastPollTimer, setBroadcastPollTimer] = useState<ReturnType<typeof setInterval> | null>(null);

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem('institute');
    if (!stored) { navigate('/login'); return; }
    const inst = JSON.parse(stored) as Institute;

    // Guard: Growth/Pro without payment → redirect to complete payment
    if (inst.plan !== 'starter' && inst.is_paid === false) {
      navigate('/complete-payment');
      return;
    }

    setInstitute(inst);

    // Read ?tab= from URL (e.g. after payment redirect: /dashboard?tab=profile)
    const tabParam = searchParams.get('tab') as Tab | null;
    if (tabParam) {
      setActiveTab(tabParam);
      // If redirected to profile tab, open basic section
      if (tabParam === 'profile') setProfileSection('basic');
    }

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

      // Fetch active subscription status and update is_premium_accessible if needed
      try {
        const subRes = await fetch(apiUrl(`/api/payment/subscription/${inst.id}`));
        if (subRes.ok) {
          const sub = await subRes.json() as { status: string } | null;
          // If subscription is active and institute is growth/pro, ensure is_premium_accessible is set
          if (sub?.status === 'active' && ['growth', 'pro'].includes(inst.plan) && !inst.is_premium_accessible) {
            const updated = { ...inst, is_premium_accessible: true };
            localStorage.setItem('institute', JSON.stringify(updated));
            setInstitute(updated);
          }
        }
      } catch { /* silent */ }

      // Fetch profile completeness
      try {
        const cRes = await fetch(apiUrl(`/api/institutes/${inst.id}/profile-completeness`));
        if (cRes.ok) setProfileCompleteness(await cRes.json());
      } catch { /* silent */ }

      finally { setLoading(false); }
    })();
  }, [navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Profile tab load ────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'profile' || !institute) return;
    // Always reset to basic section when switching to profile tab
    setProfileSection('basic');
    setBasicForm({ name: institute.name, phone: institute.phone, website: institute.website ?? '' });
    setBasicMsg(null); setHoursMsg(null); setNotifMsg(null); setPwMsg(null);
    // Pre-load AI details data in background
    void (async () => {
      setProfileLoading(true);
      try {
        const res = await fetch(apiUrl(`/api/institutes/${institute.id}/details`));
        const data = await res.json() as { institute_data: string | null };
        setProfileData(data.institute_data ?? '');
      } catch { setProfileData(''); }
      finally { setProfileLoading(false); }
    })();
  }, [activeTab, institute]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab !== 'analytics' || !institute) return;
    setAnalyticsLoading(true);
    const id = institute.id;
    Promise.all([
      fetch(apiUrl(`/api/analytics/${id}/overview`)).then(r => r.json()) as Promise<AnalyticsOverview>,
      fetch(apiUrl(`/api/analytics/${id}/leads-over-time?days=${analyticsPeriod}`)).then(r => r.json()) as Promise<LeadsOverTime[]>,
      fetch(apiUrl(`/api/analytics/${id}/peak-hours`)).then(r => r.json()) as Promise<PeakHour[]>,
      fetch(apiUrl(`/api/analytics/${id}/status-breakdown`)).then(r => r.json()) as Promise<StatusBreakdown[]>,
    ])
      .then(([overview, lot, peak, status]) => {
        setAnalyticsOverview(overview);
        setLeadsOverTime(lot);
        setPeakHours(peak);
        setStatusBreakdown(status);
      })
      .catch(err => console.error('Analytics fetch error:', err))
      .finally(() => setAnalyticsLoading(false));
  }, [activeTab, institute, analyticsPeriod]);

  useEffect(() => {
    if (activeTab !== 'blocklist' || !institute) return;
    setBlocklistLoading(true);
    setBlocklistError(null);
    fetch(apiUrl(`/api/blocklist/${institute.id}`))
      .then(r => r.json())
      .then((data: BlockedNumber[]) => setBlocklist(data))
      .catch(() => setBlocklistError('Failed to load blocklist.'))
      .finally(() => setBlocklistLoading(false));
  }, [activeTab, institute]);

  // ── WhatsApp ────────────────────────────────────────────────────────────────
  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };
  useEffect(() => () => stopPolling(), []);

  const loadWaNumbers = async (inst: Institute) => {
    setWaNumbersLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/institutes/${inst.id}/whatsapp-numbers`));
      if (res.ok) {
        setWaNumbers(await res.json() as typeof waNumbers);
      } else {
        // Multi-number route not deployed yet — create a synthetic slot 1 from institute data
        setWaNumbers([{
          id: 0, slot: 1,
          phone_number: inst.whatsapp_number || null,
          label: 'Main Number',
          is_connected: inst.whatsapp_connected,
          status: inst.whatsapp_connected ? 'connected' : 'disconnected',
        }]);
      }
    } catch {
      setWaNumbers([{
        id: 0, slot: 1,
        phone_number: inst.whatsapp_number || null,
        label: 'Main Number',
        is_connected: inst.whatsapp_connected,
        status: inst.whatsapp_connected ? 'connected' : 'disconnected',
      }]);
    } finally { setWaNumbersLoading(false); }
  };

  // Load whatsapp numbers when tab is opened
  useEffect(() => {
    if (activeTab === 'whatsapp' && institute) void loadWaNumbers(institute);
  }, [activeTab, institute]); // eslint-disable-line react-hooks/exhaustive-deps

  const startPolling = (inst: Institute, slot = 1) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        // Use slot-specific endpoint if available, fall back to legacy for slot 1
        const endpoint = slot === 1
          ? apiUrl(`/api/institutes/${inst.id}/whatsapp-status`)
          : apiUrl(`/api/institutes/${inst.id}/whatsapp-numbers/${slot}/status`);
        const res = await fetch(endpoint);
        if (!res.ok) return;
        const data = await res.json() as { status: WAStatus; qr: string | null };
        setWaStatus(data.status);
        if (data.status === 'qr' && data.qr) setQrDataUrl(data.qr);
        if (data.status === 'connected') {
          stopPolling();
          setQrDataUrl(null);
          if (slot === 1) {
            const updated = { ...inst, whatsapp_connected: true };
            setInstitute(updated);
            localStorage.setItem('institute', JSON.stringify(updated));
          }
          void loadWaNumbers(inst);
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
      // Use legacy endpoint for slot 1 (backward compatible)
      const res = await fetch(apiUrl(`/api/institutes/${institute.id}/connect-whatsapp`), { method: 'POST' });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error); }
      startPolling(institute, 1);
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'Something went wrong.');
      setWaStatus('idle');
    }
  };

  const handleConnectSlot = async (slot: number) => {
    if (!institute) return;
    setWaError(null); setQrDataUrl(null); setWaStatus('initializing');
setShowQRModal(true);
    try {
      const res = await fetch(apiUrl(`/api/institutes/${institute.id}/whatsapp-numbers/${slot}/connect`), { method: 'POST' });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error); }
      startPolling(institute, slot);
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'Something went wrong.');
      setWaStatus('idle'); setShowQRModal(false);
    }
  };

  const handleDisconnectSlot = async (slot: number) => {
    if (!institute) return;
    if (!window.confirm(`Disconnect WhatsApp number ${slot}? You'll need to scan a QR code again to reconnect.`)) return;
    await fetch(apiUrl(`/api/institutes/${institute.id}/whatsapp-numbers/${slot}`), { method: 'DELETE' });
    if (slot === 1) {
      const updated = { ...institute, whatsapp_connected: false };
      setInstitute(updated);
      localStorage.setItem('institute', JSON.stringify(updated));
    }
    void loadWaNumbers(institute);
  };

  const handleAddNumber = async () => {
    if (!institute) return;
    setAddingNumber(true);
    try {
      const res = await fetch(apiUrl(`/api/institutes/${institute.id}/whatsapp-numbers`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json() as { error?: string; slot?: number };
      if (!res.ok) throw new Error(data.error ?? 'Failed to add number.');
      void loadWaNumbers(institute);
      // Auto-open connect QR for the new slot
      if (data.slot) void handleConnectSlot(data.slot);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add number.');
    } finally { setAddingNumber(false); }
  };

  const handleDisconnect = async () => {
    if (!institute) return;
    if (!window.confirm('Disconnect WhatsApp? You will need to scan a QR code again to reconnect.')) return;
    await fetch(apiUrl(`/api/institutes/${institute.id}/disconnect-whatsapp`), { method: 'DELETE' });
    const updated = { ...institute, whatsapp_connected: false };
    setInstitute(updated);
    localStorage.setItem('institute', JSON.stringify(updated));
    void loadWaNumbers(institute);
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
      // Re-check completeness after save
      try {
        const cRes = await fetch(apiUrl(`/api/institutes/${institute.id}/profile-completeness`));
        if (cRes.ok) setProfileCompleteness(await cRes.json());
      } catch { /* silent */ }
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

  // ── Profile section loaders ──────────────────────────────────────────────────
  const loadProfileSectionData = async (section: typeof profileSection) => {
    if (!institute) return;
    if (section === 'basic') {
      setBasicForm({ name: institute.name, phone: institute.phone, website: institute.website ?? '' });
    }
    if (section === 'hours') {
      try {
        const res = await fetch(apiUrl(`/api/institutes/${institute.id}/business-hours`));
        if (res.ok) {
          const data = await res.json() as { business_hours: Record<string, { open: string; close: string; closed: boolean }> | null };
          if (data.business_hours) setBusinessHours(data.business_hours);
        }
      } catch { /* use defaults */ }
    }
    if (section === 'notifications') {
      try {
        const res = await fetch(apiUrl(`/api/institutes/${institute.id}/notification-preferences`));
        if (res.ok) setNotifPrefs(await res.json() as typeof notifPrefs);
      } catch { /* use defaults */ }
    }
  };

  const handleProfileSectionChange = (section: typeof profileSection) => {
    setProfileSection(section);
    void loadProfileSectionData(section);
    setBasicMsg(null); setHoursMsg(null); setNotifMsg(null); setPwMsg(null);
  };

  // ── OTP cooldown timer ───────────────────────────────────────────────────────
  // PHONE VERIFICATION — OTP cooldown timer (commented until DLT registration)
  // useEffect(() => {
  //   if (otpCooldown <= 0) return;
  //   const t = setInterval(() => setOtpCooldown(c => c - 1), 1000);
  //   return () => clearInterval(t);
  // }, [otpCooldown]);

  // ── Email verification — send magic link ─────────────────────────────────────
  const handleSendEmailVerification = async () => {
    if (!institute) return;
    setEmailVerifySending(true); setEmailVerifyMsg(null);
    try {
      const res = await fetch(apiUrl(`/api/institutes/${institute.id}/resend-verification-email`), { method: 'POST' });
      const data = await res.json() as { success?: boolean; already_verified?: boolean };
      if (data.already_verified) {
        const updated = { ...institute, email_verified: true };
        setInstitute(updated); localStorage.setItem('institute', JSON.stringify(updated));
        setEmailVerifyMsg('already_verified');
      } else {
        setEmailVerifyMsg('sent');
      }
    } catch { setEmailVerifyMsg('error'); }
    finally { setEmailVerifySending(false); }
  };

  // PHONE VERIFICATION — handlers commented until DLT registration is complete
  // const handleSendPhoneOTP = async () => { ... };
  // const handleVerifyOTP = async (code?: string) => { ... };

  // ── Basic info save ──────────────────────────────────────────────────────────
  const handleSaveBasicInfo = async () => {
    if (!institute) return;
    if (!basicForm.name.trim()) { setBasicMsg('Institute name is required.'); return; }
    setBasicSaving(true); setBasicMsg(null);
    try {
      const res = await fetch(apiUrl(`/api/institutes/${institute.id}/basic-info`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(basicForm),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error((data.error as string) ?? 'Failed to save.');
      const updated = { ...institute, ...data };
      setInstitute(updated as typeof institute);
      localStorage.setItem('institute', JSON.stringify(updated));
      setBasicMsg('✅ Basic info saved successfully.');
    } catch (err) { setBasicMsg(err instanceof Error ? err.message : 'Failed to save.'); }
    finally { setBasicSaving(false); }
  };

  // ── Business hours save ──────────────────────────────────────────────────────
  const handleSaveHours = async () => {
    if (!institute) return;
    setHoursSaving(true); setHoursMsg(null);
    try {
      const res = await fetch(apiUrl(`/api/institutes/${institute.id}/business-hours`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_hours: businessHours }),
      });
      if (!res.ok) throw new Error();
      setHoursMsg('✅ Business hours saved successfully.');
    } catch { setHoursMsg('Failed to save business hours.'); }
    finally { setHoursSaving(false); }
  };

  // ── Notifications save ───────────────────────────────────────────────────────
  const handleSaveNotifications = async () => {
    if (!institute) return;
    setNotifSaving(true); setNotifMsg(null);
    try {
      const res = await fetch(apiUrl(`/api/institutes/${institute.id}/notification-preferences`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notifPrefs),
      });
      if (!res.ok) throw new Error();
      setNotifMsg('✅ Notification preferences saved.');
    } catch { setNotifMsg('Failed to save preferences.'); }
    finally { setNotifSaving(false); }
  };

  // ── Password change ──────────────────────────────────────────────────────────
  const handleChangePassword = async () => {
    if (!institute) return;
    if (!pwForm.current || !pwForm.next) { setPwMsg({ type: 'error', text: 'All fields are required.' }); return; }
    if (pwForm.next.length < 8) { setPwMsg({ type: 'error', text: 'New password must be at least 8 characters.' }); return; }
    if (pwForm.next !== pwForm.confirm) { setPwMsg({ type: 'error', text: 'New passwords do not match.' }); return; }
    setPwSaving(true); setPwMsg(null);
    try {
      const res = await fetch(apiUrl(`/api/institutes/${institute.id}/change-password`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: pwForm.current, new_password: pwForm.next }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed.');
      setPwMsg({ type: 'success', text: '✅ Password changed successfully.' });
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (err) { setPwMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed.' }); }
    finally { setPwSaving(false); }
  };

  // ── Broadcast handlers ───────────────────────────────────────────────────────
  const loadBroadcasts = async () => {
    if (!institute) return;
    setBroadcastsLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/broadcast/${institute.id}`));
      if (res.ok) setBroadcasts(await res.json() as typeof broadcasts);
    } catch { /* silent */ }
    finally { setBroadcastsLoading(false); }
  };

  const fetchBroadcastPreview = async (filter: string) => {
    if (!institute) return;
    setBroadcastPreviewCount(null);
    try {
      const res = await fetch(apiUrl(`/api/broadcast/${institute.id}/preview?filter=${filter}`));
      if (res.ok) {
        const data = await res.json() as { count: number };
        setBroadcastPreviewCount(data.count);
      }
    } catch { /* silent */ }
  };

  const handleSendBroadcast = async () => {
    if (!institute) return;
    if (!broadcastForm.name.trim()) { setBroadcastMsg({ type: 'error', text: 'Please enter a broadcast name.' }); return; }
    if (!broadcastForm.message.trim()) { setBroadcastMsg({ type: 'error', text: 'Please enter a message.' }); return; }
    if (broadcastPreviewCount === 0) { setBroadcastMsg({ type: 'error', text: 'No leads match this filter.' }); return; }
    setBroadcastSending(true); setBroadcastMsg(null);
    try {
      const res = await fetch(apiUrl(`/api/broadcast/${institute.id}`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(broadcastForm),
      });
      const data = await res.json() as { id?: number; error?: string; total_count?: number };
      if (!res.ok) throw new Error(data.error ?? 'Failed to start broadcast.');
      setBroadcastMsg({ type: 'success', text: `✅ Broadcast started! Sending to ${data.total_count ?? 0} leads at 1 message every 3 seconds.` });
      setBroadcastForm({ name: '', message: '', target_filter: 'all' });
      setBroadcastPreviewCount(null);
      // Poll progress every 5s
      if (data.id) {
        const timer = setInterval(async () => {
          try {
            const pRes = await fetch(apiUrl(`/api/broadcast/${institute.id}/${data.id}/status`));
            if (pRes.ok) {
              const pData = await pRes.json() as { status: string; sent_count: number; total_count: number };
              setBroadcasts(prev => prev.map(b => b.id === data.id ? { ...b, ...pData } : b));
              if (pData.status === 'completed' || pData.status === 'failed') {
                clearInterval(timer); setBroadcastPollTimer(null);
              }
            }
          } catch { /* silent */ }
        }, 5000);
        setBroadcastPollTimer(timer);
        void loadBroadcasts();
      }
    } catch (err) {
      setBroadcastMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to send.' });
    } finally { setBroadcastSending(false); }
  };

  const handleDeleteBroadcast = async (broadcastId: number) => {
    if (!institute || !window.confirm('Delete this broadcast from history?')) return;
    try {
      await fetch(apiUrl(`/api/broadcast/${institute.id}/${broadcastId}`), { method: 'DELETE' });
      setBroadcasts(prev => prev.filter(b => b.id !== broadcastId));
    } catch { /* silent */ }
  };

  // Cleanup broadcast poll on unmount
  useEffect(() => () => { if (broadcastPollTimer) clearInterval(broadcastPollTimer); }, [broadcastPollTimer]);

  // Load broadcasts when tab opens
  useEffect(() => {
    if (activeTab === 'broadcast' && institute) void loadBroadcasts();
  }, [activeTab, institute]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setEditingNotes(prev => { const n = { ...prev }; delete n[lead.id]; return n; });
    setSavingNotes(prev => ({ ...prev, [lead.id]: false }));
    // Show success tick for 2s
    setSavedNotes(prev => ({ ...prev, [lead.id]: true }));
    setTimeout(() => setSavedNotes(prev => ({ ...prev, [lead.id]: false })), 2000);
  };

  const saveLeadName = async (lead: Lead) => {
    const name = editingName[lead.id];
    if (name === null || name === undefined) return;
    setSavingName(prev => ({ ...prev, [lead.id]: true }));
    try {
      await fetch(apiUrl(`/api/leads/${lead.id}/name`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || null }),
      });
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, student_name: name.trim() || null } : l));
    } catch { /* silent — name stays locally updated */ }
    finally {
      setSavingName(prev => ({ ...prev, [lead.id]: false }));
      setEditingName(prev => { const n = { ...prev }; delete n[lead.id]; return n; });
    }
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
      // Clear conversation cache so chat tab reloads with the new follow-up message
      setConversations(prev => { const n = { ...prev }; delete n[lead.id]; return n; });
    } catch (err) {
      setFollowUpResult(prev => ({ ...prev, [lead.id]: { ok: false, msg: err instanceof Error ? err.message : 'Failed to send.' } }));
    } finally {
      setSendingFollowUp(prev => ({ ...prev, [lead.id]: false }));
    }
  };

  const fetchConversation = async (lead: Lead) => {
    if (conversations[lead.id]) return; // already loaded
    setConvLoading(prev => ({ ...prev, [lead.id]: true }));
    try {
      const res = await fetch(apiUrl(`/api/leads/${lead.id}/conversation`));
      if (res.ok) {
        const data = await res.json() as ChatMessage[];
        setConversations(prev => ({ ...prev, [lead.id]: data }));
      }
    } catch { /* silent */ }
    finally { setConvLoading(prev => ({ ...prev, [lead.id]: false })); }
  };

  const getDrawerTab = (leadId: number) => drawerTab[leadId] ?? 'chat';

  // ── Add lead ────────────────────────────────────────────────────────────────
  const handleAddLead = async () => {
    if (!institute) return;
    setAddError(null);

    // ── Validation ────────────────────────────────────────────────────────────
    const fieldErrs: Record<string, string> = {};
    const phone = addForm.student_phone.trim();
    if (!phone) {
      fieldErrs.student_phone = 'Phone number is required.';
    } else {
      const digitsOnly = phone.replace(/[\s\-\+\(\)]/g, '');
      if (!/^\d+$/.test(digitsOnly)) {
        fieldErrs.student_phone = 'Only digits allowed (spaces, +, - are fine).';
      } else if (digitsOnly.length < 7 || digitsOnly.length > 15) {
        fieldErrs.student_phone = 'Must be between 7 and 15 digits.';
      }
    }
    if (addForm.student_name.trim().length > 100) {
      fieldErrs.student_name = 'Must be under 100 characters.';
    }
    if (addForm.message.trim().length > 1000) {
      fieldErrs.message = 'Must be under 1000 characters.';
    }
    if (addForm.notes.trim().length > 2000) {
      fieldErrs.notes = 'Must be under 2000 characters.';
    }
    if (addForm.follow_up_date) {
      const followUpDate = new Date(addForm.follow_up_date);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (followUpDate < today) fieldErrs.follow_up_date = 'Cannot be in the past.';
    }
    if (Object.keys(fieldErrs).length > 0) {
      setAddFieldErrors(fieldErrs);
      setAddError('Please fix the errors below.');
      return;
    }
    setAddFieldErrors({});

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
      setAddFieldErrors({});
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add lead.');
    } finally { setAddLoading(false); }
  };

  // ── Razorpay payment checkout ────────────────────────────────────────────────
  const handlePayAndUpgrade = async (plan: 'growth' | 'pro') => {
    if (!institute) return;
    setUpgrading(true);
    setUpgradeError(null);
    try {
      // Step 1: Create Razorpay order on backend
      const orderRes = await fetch(apiUrl('/api/payment/create-order'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          institute_id: institute.id,
          plan,
          billing_cycle: selectedBilling,
        }),
      });
      const orderData = await orderRes.json() as {
        order_id: string; amount: number; currency: string;
        key_id: string; institute_name: string; institute_email: string;
        error?: string;
      };
      if (!orderRes.ok) throw new Error(orderData.error ?? 'Failed to create order.');

      // Step 2: Open Razorpay checkout
      const options = {
        key:         orderData.key_id,
        amount:      orderData.amount,
        currency:    orderData.currency,
        name:        'InquiAI',
        description: `${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan — ${selectedBilling}`,
        order_id:    orderData.order_id,
        prefill: {
          name:  orderData.institute_name,
          email: orderData.institute_email,
        },
        theme: { color: '#4f46e5' },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          // Step 3: Verify payment on backend
          try {
            const verifyRes = await fetch(apiUrl('/api/payment/verify'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id:  response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                institute_id: institute.id,
              }),
            });
            const verifyData = await verifyRes.json() as {
              success: boolean; plan: string; billing_cycle?: string; expires_at: string; error?: string;
            };
            if (!verifyRes.ok) throw new Error(verifyData.error ?? 'Verification failed.');

            // Update local institute state with subscription info
            const isPremiumPlan = ['growth', 'pro'].includes(verifyData.plan);
            const updated = {
              ...institute,
              plan: verifyData.plan,
              is_paid: true,
              is_premium_accessible: isPremiumPlan,
              subscription_billing_cycle: verifyData.billing_cycle ?? null,
              subscription_expires_at: verifyData.expires_at ?? null,
            };
            localStorage.setItem('institute', JSON.stringify(updated));
            setInstitute(updated);
            setUpgradeSuccess(true);
            setTimeout(() => { setShowUpgradeModal(false); setUpgradeSuccess(false); }, 4000);
          } catch (err) {
            setUpgradeError(err instanceof Error ? err.message : 'Payment verification failed. Contact support.');
          } finally {
            setUpgrading(false);
          }
        },
        modal: {
          ondismiss: () => { setUpgrading(false); },
        },
      };

      // Load Razorpay script if not already loaded
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Razorpay.'));
          document.body.appendChild(script);
        });
      }

      const rzp = new window.Razorpay!(options);
      rzp.open();
      // Note: setUpgrading(false) is handled in handler/ondismiss
    } catch (err) {
      setUpgradeError(err instanceof Error ? err.message : 'Something went wrong.');
      setUpgrading(false);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  const filteredLeads = (filter === 'all' ? leads.filter(l => l.status !== 'lost') : leads.filter(l => l.status === filter));
  const overdueCount = leads.filter(l => isOverdue(l.follow_up_date) && l.status !== 'converted' && l.status !== 'lost').length;
  const stats = {
    total: leads.length,
    new: leads.filter(l => l.status === 'new').length,
    contacted: leads.filter(l => l.status === 'contacted').length,
    converted: leads.filter(l => l.status === 'converted').length,
  };

  if (!institute) return null;

  const isStarter = institute.plan === 'starter';
  // isPaid: Growth/Pro with confirmed payment only (Starter uses trial)
  const isPaid = isStarter ? false : (institute.is_paid ?? false);
  // premiumUnlocked: ONLY true when is_premium_accessible = true (Growth/Pro paid)
  // Starter NEVER gets premium features regardless of trial status
  const premiumUnlocked = institute.is_premium_accessible === true;
  // Trial: Starter only — controls access to basic dashboard features
  const trialLeft = isStarter && institute.created_at ? getTrialDaysLeft(institute.created_at) : 0;
  const trialExpired = isStarter && institute.created_at ? isTrialExpired(institute.created_at) : false;
  const trialPercent = isStarter && institute.created_at
    ? Math.min(100, Math.round(((14 - trialLeft) / 14) * 100))
    : 0;

  // Nav items config
  const coreNav: { id: Tab; label: string; emoji: string }[] = [
    { id: 'leads', label: 'Leads', emoji: '📋' },
    { id: 'whatsapp', label: 'WhatsApp', emoji: '📱' },
    { id: 'profile', label: 'Institute Profile', emoji: '🏫' },
    { id: 'blocklist', label: 'Blocklist', emoji: '🚫' },
  ];
  const premiumNav: { id: Tab; label: string; emoji: string }[] = [
    { id: 'analytics', label: 'Analytics', emoji: '📊' },
    { id: 'widget', label: 'Chat Widget', emoji: '💬' },
    { id: 'training', label: 'AI Training', emoji: '🧠' },
    { id: 'broadcast', label: 'Bulk Broadcast', emoji: '📣' },
  ];

  // Page title for topbar
  const pageTitles: Record<Tab, string> = {
    leads: 'Leads', analytics: 'Analytics', profile: 'Institute Profile',
    blocklist: 'Blocklist', widget: 'Chat Widget', training: 'AI Training', premium: 'Premium Features',
    whatsapp: 'WhatsApp Connect', broadcast: 'Bulk Broadcast',
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f8f7ff' }}>
      {/* Media query styles for mobile/desktop breakpoints */}
      <style>{`
        @media (min-width: 1024px) {
          .mobile-only { display: none !important; }
          .sidebar-drawer { position: relative !important; transform: none !important; height: 100vh; }
          .dashboard-main { padding: 20px 24px !important; }
        }
        @media (max-width: 1023px) {
          .desktop-only { display: none !important; }
          .sidebar-drawer { position: fixed !important; top: 0; bottom: 0; left: 0; z-index: 50; height: 100vh; }
        }
      `}</style>

      {/* ─── Mobile sidebar overlay backdrop ─────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="mobile-only fixed inset-0 bg-black/60 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* ─────────────────────── MODALS (unchanged) ──────────────────────────── */}

      {/* Phone OTP Modal — coming soon after DLT registration */}

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

      {/* Add Lead Modal */}
      {showAddLead && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">Add Lead Manually</h2>
              <button onClick={() => { setShowAddLead(false); setAddError(null); setAddFieldErrors({}); }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            {addError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{addError}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Student Name <span className="text-gray-400">(optional)</span></label>
                <input type="text" value={addForm.student_name} onChange={e => { setAddForm(f => ({ ...f, student_name: e.target.value })); setAddFieldErrors(fe => ({ ...fe, student_name: '' })); }}
                  placeholder="e.g. Rahul Sharma"
                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${addFieldErrors.student_name ? 'border-red-400 bg-red-50' : 'border-gray-300'}`} />
                {addFieldErrors.student_name && <p className="text-xs text-red-500 mt-1">⚠ {addFieldErrors.student_name}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Phone Number <span className="text-red-500">*</span></label>
                <input type="tel" value={addForm.student_phone} onChange={e => { setAddForm(f => ({ ...f, student_phone: e.target.value })); setAddFieldErrors(fe => ({ ...fe, student_phone: '' })); }}
                  placeholder="+91 9876543210"
                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${addFieldErrors.student_phone ? 'border-red-400 bg-red-50' : 'border-gray-300'}`} />
                {addFieldErrors.student_phone && <p className="text-xs text-red-500 mt-1">⚠ {addFieldErrors.student_phone}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Initial Message <span className="text-gray-400">(optional)</span></label>
                <input type="text" value={addForm.message} onChange={e => { setAddForm(f => ({ ...f, message: e.target.value })); setAddFieldErrors(fe => ({ ...fe, message: '' })); }}
                  placeholder="e.g. Interested in B.Tech admissions"
                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${addFieldErrors.message ? 'border-red-400 bg-red-50' : 'border-gray-300'}`} />
                {addFieldErrors.message && <p className="text-xs text-red-500 mt-1">⚠ {addFieldErrors.message}</p>}
                <p className="text-xs text-gray-400 mt-0.5">{addForm.message.length}/1000</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes <span className="text-gray-400">(optional)</span></label>
                <textarea value={addForm.notes} onChange={e => { setAddForm(f => ({ ...f, notes: e.target.value })); setAddFieldErrors(fe => ({ ...fe, notes: '' })); }}
                  rows={2} placeholder="Any additional notes…"
                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none ${addFieldErrors.notes ? 'border-red-400 bg-red-50' : 'border-gray-300'}`} />
                {addFieldErrors.notes && <p className="text-xs text-red-500 mt-1">⚠ {addFieldErrors.notes}</p>}
                <p className="text-xs text-gray-400 mt-0.5">{addForm.notes.length}/2000</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Follow-up Date <span className="text-gray-400">(optional)</span></label>
                <input type="date" value={addForm.follow_up_date} onChange={e => { setAddForm(f => ({ ...f, follow_up_date: e.target.value })); setAddFieldErrors(fe => ({ ...fe, follow_up_date: '' })); }}
                  min={new Date().toISOString().split('T')[0]}
                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${addFieldErrors.follow_up_date ? 'border-red-400 bg-red-50' : 'border-gray-300'}`} />
                {addFieldErrors.follow_up_date && <p className="text-xs text-red-500 mt-1">⚠ {addFieldErrors.follow_up_date}</p>}
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowAddLead(false); setAddError(null); setAddFieldErrors({}); }}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
              <button onClick={() => void handleAddLead()} disabled={addLoading}
                className="flex-1 bg-indigo-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                {addLoading ? 'Adding…' : 'Add Lead'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment / Upgrade Modal ──────────────────────────────────────────── */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 my-4" style={{ maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Upgrade Your Plan</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Currently on <span className="font-semibold capitalize text-indigo-600">{institute.plan}</span> plan
                </p>
              </div>
              <button onClick={() => { setShowUpgradeModal(false); setUpgradeError(null); setUpgradeSuccess(false); }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            {upgradeSuccess ? (
              <div className="py-10 flex flex-col items-center gap-3 text-center">
                <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center text-3xl">🎉</div>
                <p className="text-gray-900 font-bold text-lg">Payment Successful!</p>
                <p className="text-sm text-gray-500 max-w-xs">Your plan has been upgraded. A confirmation email is on its way. Enjoy your new features!</p>
              </div>
            ) : (
              <>
                {upgradeError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{upgradeError}</div>
                )}

                {/* Billing toggle */}
                <div className="flex items-center justify-center gap-1 bg-gray-100 rounded-xl p-1 mb-5">
                  <button onClick={() => setSelectedBilling('monthly')}
                    className={`flex-1 py-1.5 text-sm font-semibold rounded-lg transition-colors ${selectedBilling === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                    Monthly
                  </button>
                  <button onClick={() => setSelectedBilling('annual')}
                    className={`flex-1 py-1.5 text-sm font-semibold rounded-lg transition-colors ${selectedBilling === 'annual' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                    Annual <span className="text-green-600 text-xs font-bold ml-1">Save 2 months</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className={`rounded-xl border-2 p-4 flex flex-col ${institute.plan === 'growth' && isPaid ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-indigo-200 transition-colors'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest">Growth</span>
                      {institute.plan === 'growth' && isPaid && <span className="text-xs bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">✅ Active</span>}
                      {institute.plan === 'growth' && !isPaid && <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">⚠️ Unpaid</span>}
                    </div>
                    <div className="flex items-end gap-1 mb-0.5">
                      <span className="text-2xl font-extrabold text-gray-900">
                        ₹{selectedBilling === 'annual' ? '39,990' : '3,999'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">
                      {selectedBilling === 'annual' ? 'per year (₹3,332/mo)' : 'per month'}
                    </p>
                    <ul className="space-y-1.5 flex-1 mb-4">
                      {['2 WhatsApp numbers', '2,000 AI responses/month', 'Unlimited active leads', 'AI Training', 'Advanced analytics', 'Follow-up sequences'].map(f => (
                        <li key={f} className="flex items-start gap-1.5 text-xs text-gray-700">
                          <span className="text-green-500 font-bold mt-0.5">✓</span>{f}
                        </li>
                      ))}
                    </ul>
                    <button onClick={() => void handlePayAndUpgrade('growth')}
                      disabled={upgrading || (institute.plan === 'growth' && isPaid) || (institute.plan === 'pro' && isPaid)}
                      className="w-full bg-indigo-600 text-white text-sm font-semibold py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                      {upgrading ? <span className="flex items-center justify-center gap-2"><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"/>Processing…</span>
                        : (institute.plan === 'growth' && isPaid) ? 'Active Plan'
                        : (institute.plan === 'pro' && isPaid) ? 'Downgrade not available'
                        : '💳 Pay & Activate →'}
                    </button>
                  </div>

                  {/* Pro */}
                  <div className={`rounded-xl border-2 p-4 flex flex-col ${institute.plan === 'pro' && isPaid ? 'border-purple-400 bg-purple-50' : 'border-gray-200 hover:border-purple-200 transition-colors'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-purple-600 uppercase tracking-widest">Pro</span>
                      {institute.plan === 'pro' && isPaid && <span className="text-xs bg-purple-100 text-purple-700 font-semibold px-2 py-0.5 rounded-full">✅ Active</span>}
                      {institute.plan === 'pro' && !isPaid && <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">⚠️ Unpaid</span>}
                    </div>
                    <div className="flex items-end gap-1 mb-0.5">
                      <span className="text-2xl font-extrabold text-gray-900">
                        ₹{selectedBilling === 'annual' ? '89,990' : '8,999'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">
                      {selectedBilling === 'annual' ? 'per year (₹7,499/mo)' : 'per month'}
                    </p>
                    <ul className="space-y-1.5 flex-1 mb-4">
                      {['Unlimited WhatsApp numbers', 'Unlimited AI responses', 'Multi-branch dashboard', 'Custom AI persona training', 'Bulk broadcast messaging', 'Dedicated onboarding call'].map(f => (
                        <li key={f} className="flex items-start gap-1.5 text-xs text-gray-700">
                          <span className="text-green-500 font-bold mt-0.5">✓</span>{f}
                        </li>
                      ))}
                    </ul>
                    <button onClick={() => void handlePayAndUpgrade('pro')}
                      disabled={upgrading || (institute.plan === 'pro' && isPaid)}
                      className="w-full bg-purple-600 text-white text-sm font-semibold py-2 rounded-xl hover:bg-purple-700 disabled:opacity-50 transition-colors">
                      {upgrading ? <span className="flex items-center justify-center gap-2"><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"/>Processing…</span>
                        : (institute.plan === 'pro' && isPaid) ? 'Active Plan'
                        : '💳 Pay & Activate →'}
                    </button>
                  </div>
                </div>
                <p className="text-center text-xs text-gray-400 mt-4">🔒 Secured by Razorpay · Instant activation after payment</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────── SIDEBAR ─────────────────────────────────────── */}
      <aside
        className={`sidebar-drawer transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{
          width: '220px', flexShrink: 0, background: '#13111e',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          height: '100vh',
        }}>
        {/* Logo + mobile close button */}
        <div style={{ padding: '20px 16px 20px', borderBottom: '1px solid #1e1c2e' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '30px', height: '30px', background: '#7f77dd', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', color: '#fff' }}>⚡</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', fontWeight: 500, color: '#fff' }}>InquiAI</div>
              <div style={{ fontSize: '10px', color: '#55526e', marginTop: '1px' }}>Admission Assistant</div>
            </div>
            <button className="mobile-only" onClick={() => setSidebarOpen(false)}
              style={{ background: 'none', border: 'none', color: '#6a677e', fontSize: '20px', cursor: 'pointer', padding: '0', lineHeight: 1 }}>✕</button>
          </div>
        </div>

        {/* Core nav */}
        <div style={{ padding: '14px 10px 0' }}>
          <div style={{ fontSize: '9px', color: '#3e3c56', letterSpacing: '1.2px', padding: '0 8px', marginBottom: '5px' }}>CORE</div>
          {coreNav.map(item => (
            <button key={item.id} onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 10px',
                borderRadius: '7px', width: '100%', border: 'none', cursor: 'pointer',
                marginBottom: '1px', textAlign: 'left',
                background: activeTab === item.id ? '#1f1c30' : 'transparent',
              }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: activeTab === item.id ? '#7f77dd' : '#3a3858', flexShrink: 0, display: 'inline-block' }} />
              <span style={{ fontSize: '12px', color: activeTab === item.id ? '#d4d2e8' : '#6a677e' }}>{item.label}</span>
              {item.id === 'leads' && leads.length > 0 && (
                <span style={{ marginLeft: 'auto', background: '#2a2742', color: '#afa9ec', fontSize: '9px', padding: '2px 6px', borderRadius: '20px' }}>{leads.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div style={{ margin: '12px 16px', height: '1px', background: '#1e1c2e' }} />

        {/* Premium nav */}
        <div style={{ padding: '0 10px' }}>
          <div style={{ fontSize: '9px', color: '#3e3c56', letterSpacing: '1.2px', padding: '0 8px', marginBottom: '5px' }}>PREMIUM</div>
          {premiumNav.map(item => {
            const isActive = activeTab === item.id;
            const locked = !premiumUnlocked;
            return (
              <button key={item.id} onClick={() => {
                if (locked) { setUpgradeError(null); setUpgradeSuccess(false); setShowUpgradeModal(true); }
                else setActiveTab(item.id);
                setSidebarOpen(false);
              }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 10px',
                  borderRadius: '7px', width: '100%', border: 'none', cursor: 'pointer',
                  marginBottom: '1px', textAlign: 'left',
                  background: isActive ? '#1f1c30' : locked ? 'transparent' : 'transparent',
                }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: locked ? '#534ab7' : isActive ? '#c9a55e' : '#8a6020', flexShrink: 0, display: 'inline-block' }} />
                <span style={{ fontSize: '12px', color: locked ? '#7f77dd' : isActive ? '#d4b896' : '#c9a55e', flex: 1 }}>{item.label}</span>
                {locked
                  ? <span style={{ fontSize: '8px', background: '#1a1830', border: '1px solid #2d2a50', color: '#7f77dd', padding: '2px 5px', borderRadius: '20px', fontWeight: 600 }}>Upgrade</span>
                  : <span style={{ fontSize: '9px', background: '#231c10', border: '1px solid #3a2e10', color: '#8a6020', padding: '2px 5px', borderRadius: '20px' }}>★ Adv</span>
                }
              </button>
            );
          })}
        </div>

        {/* Upgrade card */}
        {!isPaid && (
          <div style={{ margin: '14px 10px 0', background: '#0e0d17', border: '1px solid #1e1c30', borderRadius: '10px', padding: '12px' }}>
            {isStarter ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: '#8884a0' }}>
                    {trialExpired ? 'Trial ended' : '14-day trial'}
                  </span>
                  <span style={{ fontSize: '10px', color: trialExpired ? '#a32d2d' : '#4a4768' }}>
                    {trialExpired ? 'Expired' : `${trialLeft}d left`}
                  </span>
                </div>
                <div style={{ height: '3px', background: '#1e1c2e', borderRadius: '2px', overflow: 'hidden', marginBottom: '8px' }}>
                  <div style={{ height: '100%', width: `${trialPercent}%`, background: trialExpired ? '#a32d2d' : '#534ab7', borderRadius: '2px' }} />
                </div>
                <p style={{ fontSize: '10px', color: '#4a4768', marginBottom: '9px', lineHeight: '1.4' }}>
                  {trialExpired
                    ? 'Trial ended. Upgrade to restore access.'
                    : 'Trial active. Upgrade before it ends.'}
                </p>
              </>
            ) : (
              <>
                <p style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b', marginBottom: '4px' }}>
                  💳 Payment required
                </p>
                <p style={{ fontSize: '10px', color: '#4a4768', marginBottom: '9px', lineHeight: '1.4' }}>
                  Complete payment to activate your {institute.plan} plan features.
                </p>
              </>
            )}
            <button onClick={() => { setUpgradeError(null); setUpgradeSuccess(false); setShowUpgradeModal(true); }}
              style={{ width: '100%', background: trialExpired ? '#4a2020' : '#1f1c30', border: `1px solid ${trialExpired ? '#6b2020' : '#2d2a42'}`, borderRadius: '6px', color: trialExpired ? '#f09595' : '#afa9ec', fontSize: '11px', fontWeight: 500, padding: '7px', cursor: 'pointer' }}>
              {!isStarter ? '💳 Pay & Activate →' : trialExpired ? '🔓 Unlock features →' : 'Upgrade plan →'}
            </button>
          </div>
        )}
        {isPaid && (
          <div style={{ margin: '14px 10px 0', background: '#0a1a10', border: '1px solid #1a3020', borderRadius: '10px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px' }}>✅</span>
            <div>
              <p style={{ fontSize: '11px', color: '#5dcaa5', fontWeight: 500 }}>All features unlocked</p>
              <p style={{ fontSize: '9px', color: '#1d6040', marginTop: '1px', textTransform: 'capitalize' }}>{institute.plan} plan</p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 'auto', padding: '14px 16px', borderTop: '1px solid #1a1828' }}>
          <div style={{ fontSize: '12px', color: '#8884a0', fontWeight: 500, marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{institute.name}</div>
          <div style={{ fontSize: '10px', color: '#3e3c56' }}>{institute.email}</div>
        </div>
      </aside>

      {/* ─────────────────────── MAIN AREA ───────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Topbar */}
        <header style={{ background: '#fff', borderBottom: '0.5px solid #e5e7eb', padding: '11px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Hamburger — mobile only */}
            <button className="mobile-only" onClick={() => setSidebarOpen(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px 4px 0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ width: '18px', height: '2px', background: '#374151', borderRadius: '2px', display: 'block' }} />
              <span style={{ width: '18px', height: '2px', background: '#374151', borderRadius: '2px', display: 'block' }} />
              <span style={{ width: '12px', height: '2px', background: '#374151', borderRadius: '2px', display: 'block' }} />
            </button>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#111827' }}>{pageTitles[activeTab]}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {overdueCount > 0 && (
              <button onClick={() => { setActiveTab('leads'); setFilter('all'); }}
                style={{ fontSize: '11px', color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer' }}>
                ⚠️ {overdueCount}
              </button>
            )}
            {institute.whatsapp_connected ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '4px 8px' }}>
                <span style={{ width: '6px', height: '6px', background: '#22c55e', borderRadius: '50%', display: 'inline-block', flexShrink: 0 }} />
                <span className="desktop-only" style={{ fontSize: "11px", color: "#15803d" }}>WA active · {institute.whatsapp_number}</span>
                <span className="mobile-only" style={{ fontSize: '11px', color: '#15803d' }}>WA ✓</span>
                <button onClick={() => void handleDisconnect()}
                  className="desktop-only"
                  style={{ marginLeft: '4px', fontSize: '10px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>✕</button>
              </div>
            ) : (
              <button onClick={() => void handleConnectWhatsApp()}
                style={{ fontSize: '11px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}>
                🔗 <span className="desktop-only">Connect </span>WhatsApp
              </button>
            )}
            <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: '#eeedfe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 500, color: '#534ab7', flexShrink: 0 }}>
              {institute.name.slice(0, 2).toUpperCase()}
            </div>
          </div>
        </header>

        {/* Scrollable content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 80px' }} className="dashboard-main">

          {/* ── Verification Banner ──────────────────────────────────────── */}
          {institute && (!institute.email_verified /* || !institute.phone_verified — phone verification coming soon */) && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <span style={{ fontSize: '18px', flexShrink: 0 }}>⚠️</span>
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 600, color: '#92400e', marginBottom: '4px' }}>
                    Complete your account verification
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {!institute.email_verified && (
                      <a href={`/verify-email-pending`}
                        style={{ fontSize: '11px', color: '#b45309', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '6px', padding: '3px 10px', textDecoration: 'none', fontWeight: 500 }}>
                        📧 Verify Email →
                      </a>
                    )}
                    {/* phone verification coming soon: institute.email_verified && !institute.phone_verified && (
                      <a href={`/verify-phone?id=${institute.id}`}
                        style={{ fontSize: '11px', color: '#b45309', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '6px', padding: '3px 10px', textDecoration: 'none', fontWeight: 500 }}>
                        📱 Verify WhatsApp → </a> ) */}
                    {!institute.email_verified && (
                      <span style={{ fontSize: '11px', color: '#a16207' }}>
                        Check your inbox at {institute.email}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Subscription Expiry Banner ────────────────────────────────── */}
          {institute && institute.subscription_expires_at && institute.plan !== 'starter' && (() => {
            const expiresAt = new Date(institute.subscription_expires_at);
            const now = new Date();
            const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            const isExpired = daysLeft <= 0;
            const isCritical = daysLeft <= 7 && daysLeft > 0;
            const isWarning = daysLeft <= 30 && daysLeft > 7;
            if (!isExpired && !isCritical && !isWarning) return null;
            const bg = isExpired || isCritical ? '#fef2f2' : '#fffbeb';
            const border = isExpired || isCritical ? '1px solid #fecaca' : '1px solid #fde68a';
            const color = isExpired || isCritical ? '#991b1b' : '#92400e';
            return (
              <div style={{ background: bg, border, borderRadius: '12px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>{isExpired ? '🔴' : isCritical ? '🔴' : '⚠️'}</span>
                  <p style={{ fontSize: '13px', fontWeight: 600, color, margin: 0 }}>
                    {isExpired
                      ? `Your ${institute.plan} plan has expired. Renew to keep AI replies active.`
                      : `Your ${institute.plan} plan expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — ${expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                    }
                  </p>
                </div>
                <button
                  onClick={() => { setUpgradeError(null); setUpgradeSuccess(false); setShowUpgradeModal(true); }}
                  style={{ flexShrink: 0, fontSize: '12px', fontWeight: 600, background: isExpired || isCritical ? '#dc2626' : '#d97706', color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {isExpired ? 'Renew Now' : 'Renew Plan'}
                </button>
              </div>
            );
          })()}

          {/* ── Profile Completeness Banner ───────────────────────────────── */}
          {profileCompleteness && !profileCompleteness.complete && (
            <div style={{
              background: '#fffbeb', border: '1px solid #fcd34d',
              borderRadius: '12px', padding: '14px 18px',
              marginBottom: '20px', display: 'flex',
              alignItems: 'flex-start', gap: '12px',
            }}>
              <span style={{ fontSize: '20px', flexShrink: 0 }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#92400e', marginBottom: '4px' }}>
                  Your AI assistant is missing key details — students may get incomplete answers
                </p>
                <p style={{ fontSize: '12px', color: '#b45309', marginBottom: '8px' }}>
                  Missing: {profileCompleteness.missing.slice(0, 3).join(', ')}
                  {profileCompleteness.missing.length > 3 && ` +${profileCompleteness.missing.length - 3} more`}
                </p>
                {/* Progress bar */}
                <div style={{ height: '4px', background: '#fde68a', borderRadius: '2px', marginBottom: '10px', maxWidth: '200px' }}>
                  <div style={{ height: '100%', width: `${profileCompleteness.score}%`, background: '#f59e0b', borderRadius: '2px' }} />
                </div>
                <button
                  onClick={() => setActiveTab('profile')}
                  style={{
                    fontSize: '12px', fontWeight: 600, color: '#fff',
                    background: '#f59e0b', border: 'none', borderRadius: '7px',
                    padding: '6px 14px', cursor: 'pointer',
                  }}
                >
                  Complete Your Profile →
                </button>
              </div>
              <button
                onClick={() => setProfileCompleteness(prev => prev ? { ...prev, complete: true } : null)}
                style={{ background: 'none', border: 'none', color: '#b45309', cursor: 'pointer', fontSize: '16px', flexShrink: 0 }}
              >✕</button>
            </div>
          )}

          {/* Stats row — always visible */}
          {activeTab === 'leads' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '20px' }}>
              {[
                { label: 'Total Leads', value: stats.total, color: '#7f77dd' },
                { label: 'New', value: stats.new, color: '#1d9e75' },
                { label: 'Contacted', value: stats.contacted, color: '#ef9f27' },
                { label: 'Converted', value: stats.converted, color: '#639922' },
              ].map(s => (
                <div key={s.label} style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
                    <span style={{ width: '3px', height: '18px', background: s.color, borderRadius: '2px', display: 'inline-block' }} />
                    <span style={{ fontSize: '10px', color: '#6b7280' }}>{s.label}</span>
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 500, color: '#111827' }}>{s.value}</div>
                </div>
              ))}
            </div>
          )}


      {/* ── Upgrade Modal is rendered once above near the QR modal ─────────── */}

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
              <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
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
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {
                        const next = isExpanded ? null : lead.id;
                        setExpandedLead(next);
                        if (next !== null) void fetchConversation(lead);
                      }}>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {/* Student name — double-click to edit */}
                          {editingName[lead.id] !== undefined && editingName[lead.id] !== null ? (
                            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                              <input
                                autoFocus
                                type="text"
                                value={editingName[lead.id] as string}
                                onChange={e => setEditingName(prev => ({ ...prev, [lead.id]: e.target.value }))}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') void saveLeadName(lead);
                                  if (e.key === 'Escape') setEditingName(prev => { const n = { ...prev }; delete n[lead.id]; return n; });
                                }}
                                onBlur={() => void saveLeadName(lead)}
                                placeholder="Enter name…"
                                className="text-sm font-semibold text-gray-900 border-b-2 border-indigo-400 bg-transparent focus:outline-none px-0.5 w-36"
                              />
                              {savingName[lead.id] && <span className="text-xs text-gray-400">Saving…</span>}
                            </div>
                          ) : (
                            <h3
                              className="font-semibold text-gray-900 text-sm cursor-pointer hover:text-indigo-600 transition-colors"
                              title="Double-click to edit name"
                              onDoubleClick={e => {
                                e.stopPropagation();
                                setEditingName(prev => ({ ...prev, [lead.id]: lead.student_name ?? '' }));
                              }}>
                              {lead.student_name ?? <span className="text-gray-400 italic font-normal">Unknown Student</span>}
                            </h3>
                          )}
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[lead.status] ?? 'bg-gray-100 text-gray-600'}`}>{lead.status}</span>
                          {followUpLabel && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${overdue ? 'bg-red-100 text-red-600' : 'bg-purple-100 text-purple-700'}`}>
                              📅 {followUpLabel}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mb-1 truncate">{lead.message || <span className="italic text-gray-400">No message</span>}</p>
                        <div className="flex items-center gap-4 text-xs text-gray-400">
                          <span>📱 {formatPhone(lead.student_phone)}</span>
                          <span>🕐 {formatIST(lead.last_activity_at || lead.created_at)}</span>
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
                        <button onClick={() => {
                          const next = isExpanded ? null : lead.id;
                          setExpandedLead(next);
                          if (next !== null) void fetchConversation(lead);
                        }}
                          className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">
                          {isExpanded ? '▲' : '▼'}
                        </button>
                      </div>
                    </div>

                    {/* Expanded drawer */}
                    {isExpanded && (
                      <div className="border-t border-gray-100 bg-gray-50 rounded-b-xl">

                        {/* Drawer tabs */}
                        <div className="flex border-b border-gray-200 px-4">
                          {(['chat', 'notes', 'followup'] as const).map(tab => (
                            <button key={tab} onClick={() => setDrawerTab(prev => ({ ...prev, [lead.id]: tab }))}
                              className={`px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${getDrawerTab(lead.id) === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                              {tab === 'chat' ? '💬 Conversation' : tab === 'notes' ? '📝 Notes' : '📅 Follow-up'}
                            </button>
                          ))}
                        </div>

                        <div className="p-4">

                          {/* ── Chat tab ── */}
                          {getDrawerTab(lead.id) === 'chat' && (
                            <div>
                              {convLoading[lead.id] ? (
                                <div className="text-center py-8 text-gray-400 text-sm">Loading conversation…</div>
                              ) : !conversations[lead.id] || conversations[lead.id].length === 0 ? (
                                <div className="text-center py-8 text-gray-400 text-sm">No messages yet.</div>
                              ) : (
                                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                                  {conversations[lead.id].map((msg, i) => (
                                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                                        msg.role === 'user'
                                          ? 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm'
                                          : 'bg-indigo-600 text-white rounded-tr-sm'
                                      }`}>
                                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                                        <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-gray-400' : 'text-indigo-200'}`}>
                                          {new Date(msg.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <button
                                onClick={() => {
                                  setConversations(prev => { const n = {...prev}; delete n[lead.id]; return n; });
                                  void fetchConversation(lead);
                                }}
                                className="mt-2 text-xs text-indigo-500 hover:text-indigo-700 underline">
                                Refresh
                              </button>
                            </div>
                          )}

                          {/* ── Notes tab ── */}
                          {getDrawerTab(lead.id) === 'notes' && (
                            <div>
                              <textarea
                                defaultValue={lead.notes ?? ''}
                                onChange={e => setEditingNotes(prev => ({ ...prev, [lead.id]: e.target.value }))}
                                rows={4}
                                placeholder="Add notes about this lead…"
                                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none bg-white"
                              />
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  onClick={() => void saveNotes(lead)}
                                  disabled={savingNotes[lead.id]}
                                  className={`text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors font-medium ${savedNotes[lead.id] ? 'bg-green-600 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                                  {savingNotes[lead.id] ? 'Saving…' : savedNotes[lead.id] ? '✅ Saved!' : 'Save Notes'}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* ── Follow-up tab ── */}
                          {getDrawerTab(lead.id) === 'followup' && (
                            <div className="grid sm:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Set Follow-up Date</label>
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
                                <div className="flex gap-2 mt-2">
                                  <button onClick={() => void saveFollowUp(lead)} disabled={savingFollowUp[lead.id]}
                                    className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                                    {savingFollowUp[lead.id] ? 'Saving…' : 'Set Date'}
                                  </button>
                                  {lead.follow_up_date && (
                                    <button onClick={() => {
                                      setEditingFollowUp(prev => ({ ...prev, [lead.id]: '' }));
                                      void (async () => {
                                        await fetch(apiUrl(`/api/leads/${lead.id}/followup`), {
                                          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ follow_up_date: null }),
                                        });
                                        setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, follow_up_date: null } : l));
                                      })();
                                    }} className="text-xs border border-gray-300 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100">
                                      Clear
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">💬 Send AI Follow-up on WhatsApp</label>
                                <p className="text-xs text-gray-400 mb-2">AI generates a personalised message and sends it instantly.</p>
                                <button
                                  onClick={() => void sendFollowUp(lead)}
                                  disabled={sendingFollowUp[lead.id] || !institute?.whatsapp_connected}
                                  className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5">
                                  {sendingFollowUp[lead.id] ? <><span className="animate-spin inline-block">⏳</span> Sending…</> : <>📲 Send Follow-up</>}
                                </button>
                                {!institute?.whatsapp_connected && (
                                  <p className="text-xs text-amber-600 mt-1">Connect WhatsApp first.</p>
                                )}
                                {followUpResult[lead.id]?.msg && (
                                  <div className={`mt-2 text-xs rounded-lg px-3 py-2 ${followUpResult[lead.id].ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                    {followUpResult[lead.id].ok
                                      ? <><span className="font-medium">Sent!</span> "{followUpResult[lead.id].msg.slice(0, 100)}{followUpResult[lead.id].msg.length > 100 ? '…' : ''}"</>
                                      : followUpResult[lead.id].msg}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

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

      {/* ── Analytics Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'analytics' && (
        <div>
          {!premiumUnlocked ? (
            /* ── Upgrade gate ── */
            <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
              <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-3xl mb-5">📊</div>
              <span className="inline-block bg-indigo-100 text-indigo-700 text-xs font-bold px-3 py-1 rounded-full mb-3 uppercase tracking-widest">Growth Plan Feature</span>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Unlock Advanced Analytics</h3>
              <p className="text-gray-500 text-sm max-w-sm mb-6">
                See exactly where your leads are coming from, when students are most active, and how your conversions are trending — all in one place.
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6 text-left w-full max-w-sm">
                <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-3">What you'll get</p>
                {[
                  'Leads over time chart (7d / 30d)',
                  'Peak inquiry hours analysis',
                  'Status breakdown donut chart',
                  'Week-on-week growth tracking',
                  'Conversion rate monitoring',
                ].map(f => (
                  <div key={f} className="flex items-center gap-2 mb-2">
                    <span className="text-indigo-500 font-bold text-xs">✓</span>
                    <span className="text-sm text-gray-700">{f}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => { setUpgradeError(null); setUpgradeSuccess(false); setShowUpgradeModal(true); }}
                className="bg-indigo-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-indigo-700 transition-colors text-sm">
                ⬆️ Upgrade to Growth — ₹3,999/month →
              </button>
              <p className="text-xs text-gray-400 mt-3">Annual plan at ₹39,990/year — save 2 months</p>
            </div>
          ) : analyticsLoading ? (
            <div className="text-center py-20">
              <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-gray-400">Loading analytics…</p>
            </div>
          ) : (
            <>
              {/* Period toggle */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Analytics</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Performance overview for your institute.</p>
                </div>
                <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                  {([7, 30] as number[]).map(d => (
                    <button key={d} onClick={() => setAnalyticsPeriod(d)}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${analyticsPeriod === d ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                      {d === 7 ? '7 Days' : '30 Days'}
                    </button>
                  ))}
                </div>
              </div>

              {/* KPI Cards */}
              {analyticsOverview && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  {[
                    {
                      label: 'Total Leads',
                      value: analyticsOverview.totalLeads,
                      sub: 'All time',
                      color: 'text-indigo-600',
                      bg: 'bg-indigo-50',
                    },
                    {
                      label: 'This Week',
                      value: analyticsOverview.thisWeekLeads,
                      sub: analyticsOverview.weekGrowth !== null
                        ? `${analyticsOverview.weekGrowth >= 0 ? '+' : ''}${analyticsOverview.weekGrowth}% vs last week`
                        : 'vs last week',
                      color: 'text-amber-600',
                      bg: 'bg-amber-50',
                    },
                    {
                      label: 'Converted',
                      value: analyticsOverview.byStatus['converted'] ?? 0,
                      sub: 'Total conversions',
                      color: 'text-green-600',
                      bg: 'bg-green-50',
                    },
                    {
                      label: 'Conversion Rate',
                      value: `${analyticsOverview.conversionRate}%`,
                      sub: 'Inquiries → admissions',
                      color: 'text-purple-600',
                      bg: 'bg-purple-50',
                    },
                  ].map(card => (
                    <div key={card.label} className={`${card.bg} rounded-xl p-4 border border-white`}>
                      <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                      <p className="text-xs font-semibold text-gray-700 mt-1">{card.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Leads Over Time */}
              <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-4">
                  Leads Over Time <span className="text-gray-400 font-normal">— last {analyticsPeriod} days</span>
                </h3>
                {leadsOverTime.length === 0 || leadsOverTime.every(d => d.count === 0) ? (
                  <div className="text-center py-10 text-gray-400 text-sm">No lead data yet for this period.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={leadsOverTime} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                        labelStyle={{ fontWeight: 600 }}
                      />
                      <Line type="monotone" dataKey="count" name="Leads" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3, fill: '#6366f1' }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Peak Hours + Status Breakdown — side by side */}
              <div className="grid sm:grid-cols-2 gap-5">

                {/* Peak Hours */}
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-1">Peak Inquiry Hours</h3>
                  <p className="text-xs text-gray-400 mb-4">When students message most (IST)</p>
                  {peakHours.every(h => h.count === 0) ? (
                    <div className="text-center py-10 text-gray-400 text-sm">No data yet.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={peakHours} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                          interval={2} />
                        <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                          formatter={(v) => [v as number, 'Leads'] as [number, string]}
                        />
                        <Bar dataKey="count" name="Leads" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Status Breakdown */}
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-1">Status Breakdown</h3>
                  <p className="text-xs text-gray-400 mb-4">Distribution of all leads by status</p>
                  {statusBreakdown.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 text-sm">No leads yet.</div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <ResponsiveContainer width="55%" height={160}>
                        <PieChart>
                          <Pie
                            data={statusBreakdown} cx="50%" cy="50%"
                            innerRadius={45} outerRadius={70}
                            dataKey="value" strokeWidth={2} stroke="#fff"
                          >
                            {statusBreakdown.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex flex-col gap-2 flex-1">
                        {statusBreakdown.map(entry => (
                          <div key={entry.name} className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: entry.color }} />
                            <span className="text-xs text-gray-600 flex-1">{entry.name}</span>
                            <span className="text-xs font-semibold text-gray-800">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Blocklist Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'blocklist' && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Blocklist</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Numbers on this list will not receive AI replies and won't create new leads. Lost leads are added automatically.
              </p>
            </div>
          </div>

          {/* Add number form */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-5">
            <p className="text-sm font-medium text-gray-700 mb-3">Add a number manually</p>
            {addBlockError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2 mb-3">⚠ {addBlockError}</div>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="tel"
                value={newBlockPhone}
                onChange={e => { setNewBlockPhone(e.target.value); setAddBlockError(null); }}
                placeholder="Phone e.g. 919876543210"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="text"
                value={newBlockReason}
                onChange={e => { setNewBlockReason(e.target.value); setAddBlockError(null); }}
                placeholder="Reason (optional)"
                maxLength={500}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={() => {
                  if (!institute) return;
                  setAddBlockError(null);
                  const phone = newBlockPhone.trim();
                  if (!phone) { setAddBlockError('Phone number is required.'); return; }
                  const digits = phone.replace(/[\s\-\+\(\)]/g, '');
                  if (!/^\d+$/.test(digits)) { setAddBlockError('Phone must contain only digits.'); return; }
                  if (digits.length < 7 || digits.length > 15) { setAddBlockError('Phone must be 7–15 digits.'); return; }
                  if (newBlockReason.trim().length > 500) { setAddBlockError('Reason must be under 500 characters.'); return; }
                  setAddingBlock(true);
                  fetch(apiUrl('/api/blocklist'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ institute_id: institute.id, phone: phone, reason: newBlockReason.trim() || null }),
                  })
                    .then(async r => {
                      const d = await r.json() as BlockedNumber & { error?: string };
                      if (!r.ok) throw new Error(d.error ?? 'Failed to add.');
                      setBlocklist(prev => [d, ...prev]);
                      setNewBlockPhone(''); setNewBlockReason('');
                    })
                    .catch(err => setAddBlockError(err instanceof Error ? err.message : 'Failed to add.'))
                    .finally(() => setAddingBlock(false));
                }}
                disabled={addingBlock}
                className="flex-shrink-0 bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {addingBlock ? 'Adding…' : '+ Add'}
              </button>
            </div>
          </div>

          {/* Blocklist table */}
          {blocklistLoading ? (
            <div className="text-center py-16">
              <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-gray-400">Loading blocklist…</p>
            </div>
          ) : blocklistError ? (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{blocklistError}</div>
          ) : blocklist.length === 0 ? (
            <div className="text-center py-16">
              <span className="text-5xl block mb-4">✅</span>
              <h3 className="text-base font-semibold text-gray-700 mb-1">Blocklist is empty</h3>
              <p className="text-sm text-gray-500">Numbers marked as Lost will appear here automatically.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {blocklist.map(entry => (
                <div key={entry.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{entry.phone}</p>
                    {entry.reason && <p className="text-xs text-gray-500 mt-0.5">{entry.reason}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(entry.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  </div>
                  <button
                    onClick={() => {
                      if (!window.confirm(`Remove ${entry.phone} from blocklist?`)) return;
                      fetch(apiUrl(`/api/blocklist/${entry.id}`), { method: 'DELETE' })
                        .then(() => setBlocklist(prev => prev.filter(b => b.id !== entry.id)))
                        .catch(() => alert('Failed to remove. Try again.'));
                    }}
                    className="flex-shrink-0 text-xs text-red-500 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Widget Tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'widget' && (
        <div>
          {!premiumUnlocked ? (
            /* ── Upgrade gate ── */
            <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
              <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-3xl mb-5">💬</div>
              <span className="inline-block bg-indigo-100 text-indigo-700 text-xs font-bold px-3 py-1 rounded-full mb-3 uppercase tracking-widest">Growth Plan Feature</span>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Add a Chat Widget to Your Website</h3>
              <p className="text-gray-500 text-sm max-w-sm mb-6">
                Let students ask questions directly on your website — AI replies instantly using your institute's information, 24/7.
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6 text-left w-full max-w-sm">
                <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-3">What you'll get</p>
                {[
                  'Floating chat bubble on your website',
                  'AI replies using your institute profile',
                  'Student conversations saved as leads',
                  'Typing indicator & mobile responsive',
                  'One-line embed — no coding needed',
                ].map(f => (
                  <div key={f} className="flex items-center gap-2 mb-2">
                    <span className="text-indigo-500 font-bold text-xs">✓</span>
                    <span className="text-sm text-gray-700">{f}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => { setUpgradeError(null); setUpgradeSuccess(false); setShowUpgradeModal(true); }}
                className="bg-indigo-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-indigo-700 transition-colors text-sm">
                ⬆️ Upgrade to Growth — ₹3,999/month →
              </button>
              <p className="text-xs text-gray-400 mt-3">Annual plan at ₹39,990/year — save 2 months</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Chat Widget</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Embed an AI chat assistant on your institute's website. Students can ask questions instantly.</p>
                </div>
                <span className="flex-shrink-0 text-xs bg-green-50 border border-green-200 text-green-700 font-semibold px-3 py-1.5 rounded-full">
                  ✅ Active on your plan
                </span>
              </div>

              {/* Embed code */}
              <div className="bg-gray-900 rounded-2xl p-5 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Embed Code</p>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        `<script src="${apiUrl(`/api/widget/${institute.id}/widget.js`)}" defer><\/script>`
                      ).then(() => {
                        setWidgetCopied(true);
                        setTimeout(() => setWidgetCopied(false), 2500);
                      });
                    }}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${widgetCopied ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}>
                    {widgetCopied ? '✅ Copied!' : '📋 Copy'}
                  </button>
                </div>
                <code className="text-sm text-green-400 font-mono break-all">
                  {`<script src="${apiUrl(`/api/widget/${institute.id}/widget.js`)}" defer></script>`}
                </code>
              </div>

              {/* Installation steps */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">How to install</h3>
                <div className="space-y-4">
                  {[
                    { step: '1', title: 'Copy the embed code above', desc: 'Click the "Copy" button to copy the single-line script tag.' },
                    { step: '2', title: 'Paste before </body> on your website', desc: 'Open your website\'s HTML and paste the code just before the closing </body> tag on every page where you want the widget.' },
                    { step: '3', title: 'Save and publish', desc: 'That\'s it! The chat bubble will appear on the bottom-right of your site. Students can start chatting immediately.' },
                  ].map(item => (
                    <div key={item.step} className="flex gap-4">
                      <div className="w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">{item.step}</div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Widget preview */}
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Widget Preview</h3>
                <div className="flex items-end gap-4 flex-wrap">
                  {/* Bubble preview */}
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl shadow-lg"
                      style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
                      💬
                    </div>
                    <p className="text-xs text-gray-500">Chat bubble</p>
                  </div>

                  {/* Panel preview */}
                  <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden w-52">
                    <div className="px-3 py-2.5 flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
                      <span className="text-base">🎓</span>
                      <div>
                        <p className="text-white text-xs font-bold truncate">{institute.name}</p>
                        <p className="text-indigo-200 text-[10px]">AI Assistant · Replies instantly</p>
                      </div>
                    </div>
                    <div className="p-3 bg-gray-50 space-y-2">
                      <div className="bg-white border border-gray-100 rounded-xl rounded-tl-sm px-3 py-2 text-[11px] text-gray-700 shadow-sm">
                        Hi! 👋 How can I help you with admissions today?
                      </div>
                      <div className="bg-indigo-600 rounded-xl rounded-tr-sm px-3 py-2 text-[11px] text-white ml-6">
                        What courses do you offer?
                      </div>
                    </div>
                    <div className="px-3 py-2 border-t border-gray-100 flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-6 text-[10px] text-gray-400 flex items-center px-3">Ask a question…</div>
                      <div className="w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center text-white text-[10px]">➤</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-white/70 rounded-xl border border-indigo-100">
                  <p className="text-xs text-gray-600">
                    <span className="font-semibold">💡 Tip:</span> Make sure your <span className="font-medium">Institute Profile</span> is filled in — the AI uses it to answer student questions accurately.
                    <button onClick={() => setActiveTab('profile')} className="text-indigo-600 hover:underline ml-1 font-medium">Go to Profile →</button>
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Profile Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'profile' && institute && (
        <div>
          {/* Section header */}
          <div className="mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Institute Profile</h2>
            {/* Sub-tab nav */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-full overflow-x-auto">
              {([
                { key: 'basic', label: '🏫 Basic Info' },
                { key: 'details', label: '🤖 AI Details' },
                { key: 'hours', label: '🕐 Hours' },
                { key: 'notifications', label: '🔔 Notifications' },
                { key: 'password', label: '🔒 Password' },
              ] as const).map(s => (
                <button key={s.key}
                  onClick={() => handleProfileSectionChange(s.key)}
                  className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                    profileSection === s.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Basic Info ── */}
          {profileSection === 'basic' && (
            <div className="max-w-lg">
              <p className="text-xs text-gray-500 mb-5">Update your institute's basic information. Email and WhatsApp number can only be changed by contacting support.</p>
              {basicMsg && (
                <div className={`text-sm rounded-lg px-4 py-3 mb-4 ${basicMsg.startsWith('✅') ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
                  {basicMsg}
                </div>
              )}
              <div className="space-y-4">
                {[
                  { label: 'Institute Name', key: 'name' as const, type: 'text', placeholder: 'e.g. ABC Coaching Center' },
                  { label: 'Phone Number', key: 'phone' as const, type: 'tel', placeholder: 'e.g. 9876543210' },
                  { label: 'Website', key: 'website' as const, type: 'url', placeholder: 'e.g. https://yoursite.com' },
                ].map(field => (
                  <div key={field.key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                    <input type={field.type} value={basicForm[field.key]}
                      onChange={e => setBasicForm(f => ({ ...f, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full text-sm border border-gray-300 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                ))}
                {/* Read-only fields with verify buttons */}
                {[
                  {
                    label: 'Email Address',
                    value: institute.email,
                    verified: institute.email_verified,
                    onVerify: handleSendEmailVerification,
                    verifying: emailVerifySending,
                    type: 'email',
                  },
                  // PHONE VERIFICATION — commented until DLT registration
                  // { label: 'WhatsApp Number', value: institute.whatsapp_number, verified: institute.phone_verified, onVerify: handleSendPhoneOTP, verifying: otpSending, type: 'phone' },
                ].map(f => (
                  <div key={f.label}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                    <div className="w-full text-sm border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-gray-700 truncate">{f.value}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {f.verified ? (
                          <span className="flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            Verified
                          </span>
                        ) : (
                          <button
                            onClick={() => void f.onVerify()}
                            disabled={f.verifying}
                            className="text-xs font-semibold text-indigo-600 border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 px-3 py-1 rounded-lg transition-colors disabled:opacity-50">
                            {f.verifying ? 'Sending…' : f.type === 'email' ? '📧 Verify Email' : '📱 Verify via SMS'}
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Email verify feedback */}
                    {f.type === 'email' && emailVerifyMsg === 'sent' && (
                      <p className="text-xs text-green-600 mt-1">✅ Verification link sent to {f.value}. Check your inbox.</p>
                    )}
                    {f.type === 'email' && emailVerifyMsg === 'error' && (
                      <p className="text-xs text-red-500 mt-1">Failed to send. Please try again.</p>
                    )}
                    {/* Phone OTP error */}
{/* phone OTP error — coming soon */}
                  </div>
                ))}
                {/* WhatsApp Number — read-only, verification coming soon */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number</label>
                  <div className="w-full text-sm border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 flex items-center justify-between">
                    <span className="text-gray-700">{institute.whatsapp_number}</span>
                    <span className="text-xs text-gray-400">Verification coming soon</span>
                  </div>
                </div>

                {/* Subscription Info Card */}
                {institute.plan !== 'starter' && (
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                    <p className="text-xs font-bold text-indigo-700 uppercase tracking-widest mb-3">Subscription</p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">Plan</p>
                        <p className="font-semibold text-gray-900 capitalize">{institute.plan}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">Billing</p>
                        <p className="font-semibold text-gray-900 capitalize">
                          {institute.subscription_billing_cycle ?? '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">Status</p>
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${institute.is_paid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${institute.is_paid ? 'bg-green-500' : 'bg-red-500'}`} />
                          {institute.is_paid ? 'Active' : 'Expired'}
                        </span>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">{institute.is_paid ? 'Renews / Expires' : 'Expired on'}</p>
                        <p className="font-semibold text-gray-900">
                          {institute.subscription_expires_at
                            ? new Date(institute.subscription_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                            : '—'}
                        </p>
                      </div>
                    </div>
                    {!institute.is_paid && (
                      <button
                        onClick={() => { setUpgradeError(null); setUpgradeSuccess(false); setShowUpgradeModal(true); }}
                        className="mt-3 w-full bg-indigo-600 text-white text-xs font-semibold py-2 rounded-lg hover:bg-indigo-700 transition-colors">
                        🔄 Renew Plan →
                      </button>
                    )}
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button onClick={() => void handleSaveBasicInfo()} disabled={basicSaving}
                    className="bg-indigo-600 text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                    {basicSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── AI Details ── */}
          {profileSection === 'details' && (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                <p className="text-xs text-gray-500">This data is used by the AI to answer student queries accurately. The more detail you add, the better the AI replies.</p>
                <button onClick={() => void handleReEnrich()} disabled={reEnriching}
                  className="flex-shrink-0 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-100 disabled:opacity-50 whitespace-nowrap">
                  {reEnriching ? 'Re-fetching…' : '🔄 Re-fetch from website'}
                </button>
              </div>
              {profileMsg && (
                <div className={`text-sm rounded-lg px-4 py-3 mb-4 ${profileMsg.startsWith('✅') || profileMsg.toLowerCase().includes('success') ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
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

          {/* ── Business Hours ── */}
          {profileSection === 'hours' && (
            <div className="max-w-lg">
              <p className="text-xs text-gray-500 mb-5">The AI uses this to tell students when your office is open. You're available 24/7 on WhatsApp regardless.</p>
              {hoursMsg && (
                <div className={`text-sm rounded-lg px-4 py-3 mb-4 ${hoursMsg.startsWith('✅') ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
                  {hoursMsg}
                </div>
              )}
              <div className="space-y-2">
                {(['mon','tue','wed','thu','fri','sat','sun'] as const).map(day => {
                  const labels: Record<string, string> = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' };
                  const h = businessHours[day] ?? { open: '09:00', close: '18:00', closed: false };
                  return (
                    <div key={day} className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
                      <div className="w-24 flex-shrink-0">
                        <span className="text-sm font-medium text-gray-700">{labels[day]}</span>
                      </div>
                      <label className="flex items-center gap-1.5 flex-shrink-0">
                        <input type="checkbox" checked={!h.closed}
                          onChange={e => setBusinessHours(prev => ({ ...prev, [day]: { ...h, closed: !e.target.checked } }))}
                          className="w-4 h-4 accent-indigo-600" />
                        <span className="text-xs text-gray-500">Open</span>
                      </label>
                      {!h.closed ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input type="time" value={h.open}
                            onChange={e => setBusinessHours(prev => ({ ...prev, [day]: { ...h, open: e.target.value } }))}
                            className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                          <span className="text-xs text-gray-400">to</span>
                          <input type="time" value={h.close}
                            onChange={e => setBusinessHours(prev => ({ ...prev, [day]: { ...h, close: e.target.value } }))}
                            className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Closed</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end pt-4">
                <button onClick={() => void handleSaveHours()} disabled={hoursSaving}
                  className="bg-indigo-600 text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {hoursSaving ? 'Saving…' : 'Save Hours'}
                </button>
              </div>
            </div>
          )}

          {/* ── Notifications ── */}
          {profileSection === 'notifications' && (
            <div className="max-w-lg">
              <p className="text-xs text-gray-500 mb-5">Choose which email notifications you receive. Emails go to <strong>{institute.email}</strong>.</p>
              {notifMsg && (
                <div className={`text-sm rounded-lg px-4 py-3 mb-4 ${notifMsg.startsWith('✅') ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
                  {notifMsg}
                </div>
              )}
              <div className="space-y-3">
                {([
                  { key: 'notify_new_lead' as const, title: 'New Lead Alert', desc: 'Get notified instantly when a new student messages your WhatsApp.' },
                  { key: 'notify_followup_due' as const, title: 'Follow-up Reminders', desc: 'Daily email listing leads whose follow-up date is today.' },
                  { key: 'notify_weekly_summary' as const, title: 'Weekly Summary', desc: 'Weekly digest with total leads, conversions, and top performing days.' },
                ]).map(pref => (
                  <div key={pref.key} className="flex items-start justify-between gap-4 bg-white border border-gray-200 rounded-xl p-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{pref.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{pref.desc}</p>
                    </div>
                    <button
                      onClick={() => setNotifPrefs(p => ({ ...p, [pref.key]: !p[pref.key] }))}
                      className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors relative ${notifPrefs[pref.key] ? 'bg-indigo-600' : 'bg-gray-300'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notifPrefs[pref.key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex justify-end pt-4">
                <button onClick={() => void handleSaveNotifications()} disabled={notifSaving}
                  className="bg-indigo-600 text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {notifSaving ? 'Saving…' : 'Save Preferences'}
                </button>
              </div>
            </div>
          )}

          {/* ── Password ── */}
          {profileSection === 'password' && (
            <div className="max-w-sm">
              <p className="text-xs text-gray-500 mb-5">Choose a strong password with at least 8 characters.</p>
              {pwMsg && (
                <div className={`text-sm rounded-lg px-4 py-3 mb-4 ${pwMsg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
                  {pwMsg.text}
                </div>
              )}
              <div className="space-y-4">
                {[
                  { label: 'Current Password', key: 'current' as const },
                  { label: 'New Password', key: 'next' as const },
                  { label: 'Confirm New Password', key: 'confirm' as const },
                ].map(field => (
                  <div key={field.key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                    <input type="password" value={pwForm[field.key]}
                      onChange={e => { setPwForm(f => ({ ...f, [field.key]: e.target.value })); setPwMsg(null); }}
                      className="w-full text-sm border border-gray-300 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                ))}
                <button onClick={() => void handleChangePassword()} disabled={pwSaving}
                  className="w-full bg-indigo-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {pwSaving ? 'Changing…' : 'Change Password'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── WhatsApp Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'whatsapp' && institute && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#25D366,#128C7E)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📱</div>
   
   
              <div>
                <h2 className="text-base font-semibold text-gray-900">WhatsApp Numbers</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {institute.plan === 'starter' ? '1 number on Starter plan' : institute.plan === 'growth' ? 'Up to 2 numbers on Growth plan' : 'Unlimited numbers on Pro plan'}
                </p>
              </div>
            </div>
            {/* Add Number button — Growth/Pro only */}
            {institute.plan !== 'starter' && (
              <button onClick={() => void handleAddNumber()} disabled={addingNumber}
                className="flex items-center gap-2 bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors">
                {addingNumber ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : '➕'}
                Add Number
              </button>
            )}
          </div>

          {/* Number list */}
          {waNumbersLoading ? (
            <div className="text-center py-12"><div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" /><p className="text-sm text-gray-400">Loading…</p></div>
          ) : waNumbers.length === 0 ? (
            /* No numbers yet — show connect prompt */
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center max-w-sm mx-auto">
              <div className="text-4xl mb-4">📱</div>
              <h3 className="font-semibold text-gray-900 mb-2">Connect your first WhatsApp number</h3>
              <p className="text-sm text-gray-500 mb-5">Scan a QR code to link your institute's WhatsApp — takes under 60 seconds.</p>
              <button onClick={() => void handleConnectWhatsApp()}
                className="w-full bg-green-600 text-white font-semibold py-2.5 rounded-xl hover:bg-green-700 transition-colors text-sm">
                🔗 Connect WhatsApp
              </button>
            </div>
          ) : (
            <div className="space-y-3 max-w-xl">
              {waNumbers.map(num => (
                <div key={num.slot} className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Status indicator */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${num.status === 'connected' ? 'bg-green-50' : 'bg-gray-100'}`}>
                      📱
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{num.label}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${num.status === 'connected' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full inline-block ${num.status === 'connected' ? 'bg-green-500' : 'bg-gray-400'}`} />
                          {num.status === 'connected' ? 'Connected' : 'Not connected'}
                        </span>
                        {num.phone_number && <span className="text-xs text-gray-400">{num.phone_number}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {num.status === 'connected' ? (
                      <button onClick={() => void handleDisconnectSlot(num.slot)}
                        className="text-xs text-red-500 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors">
                        Disconnect
                      </button>
                    ) : (
                      <button onClick={() => void handleConnectSlot(num.slot)}
                        className="text-xs bg-green-600 text-white font-semibold px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors">
                        Connect →
                      </button>
                    )}
                    {num.slot > 1 && num.status !== 'connected' && (
                      <button onClick={() => void handleDisconnectSlot(num.slot)}
                        className="text-xs text-gray-400 hover:text-red-500 transition-colors px-1">✕</button>
                    )}
                  </div>
                </div>
              ))}

              {/* Starter upsell if only 1 number and on starter */}
              {institute.plan === 'starter' && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 text-center">
                  <p className="text-sm font-semibold text-indigo-800 mb-1">Need more WhatsApp numbers?</p>
                  <p className="text-xs text-indigo-600 mb-3">Upgrade to Growth to connect 2 numbers, or Pro for unlimited.</p>
                  <button onClick={() => { setUpgradeError(null); setUpgradeSuccess(false); setShowUpgradeModal(true); }}
                    className="text-xs bg-indigo-600 text-white font-semibold px-4 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">
                    ⬆️ Upgrade Plan
                  </button>
                </div>
              )}
            </div>
          )}

          {/* How to connect guide */}
          <div className="mt-8 bg-gray-50 rounded-2xl p-5 max-w-xl">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-widest mb-3">How to connect</p>
            <div className="space-y-2">
              {['Open WhatsApp on your phone', 'Tap ⋮ Menu → Linked Devices → Link a Device', 'Scan the QR code shown on screen', 'Done — AI starts replying automatically'].map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full bg-green-600 text-white text-xs flex items-center justify-center flex-shrink-0 font-bold">{i + 1}</span>
                  <span className="text-sm text-gray-600">{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Training Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'training' && institute && (
        !premiumUnlocked ? (
          <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-3xl mb-5">🧠</div>
            <span className="inline-block bg-indigo-100 text-indigo-700 text-xs font-bold px-3 py-1 rounded-full mb-3 uppercase tracking-widest">Growth Plan Feature</span>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Train Your AI on Your Own Conversations</h3>
            <p className="text-gray-500 text-sm max-w-sm mb-6">
              Upload your past WhatsApp chats and the AI learns your institute's tone, FAQs, and style — giving students more accurate, personalised replies.
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6 text-left w-full max-w-sm">
              <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-3">What you'll get</p>
              {[
                'Upload WhatsApp chat exports (.txt)',
                'AI learns from real student conversations',
                'Custom tone & language style (Hindi/Hinglish)',
                'Improves reply quality over time',
                'Review & approve training examples',
              ].map(f => (
                <div key={f} className="flex items-center gap-2 mb-2">
                  <span className="text-indigo-500 font-bold text-xs">✓</span>
                  <span className="text-sm text-gray-700">{f}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setUpgradeError(null); setUpgradeSuccess(false); setShowUpgradeModal(true); }}
              className="bg-indigo-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-indigo-700 transition-colors text-sm">
              ⬆️ Upgrade to Growth — ₹3,999/month →
            </button>
            <p className="text-xs text-gray-400 mt-3">Annual plan at ₹39,990/year — save 2 months</p>
          </div>
        ) : (
          <TrainingSection instituteId={institute.id} />
        )
      )}

      {/* ── Broadcast Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'broadcast' && institute && (
        !premiumUnlocked || institute.plan !== 'pro' ? (
          <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-3xl mb-5">📣</div>
            <span className="inline-block bg-indigo-100 text-indigo-700 text-xs font-bold px-3 py-1 rounded-full mb-3 uppercase tracking-widest">Pro Plan Feature</span>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Bulk Broadcast Messaging</h3>
            <p className="text-gray-500 text-sm max-w-sm mb-6">
              Send a personalised WhatsApp message to hundreds of leads at once — filtered by status. Perfect for batch announcements, fee reminders, and re-engagement.
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6 text-left w-full max-w-sm">
              <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-3">What you can do</p>
              {['Send to all leads or filter by status', 'Staggered delivery (3s apart) to stay safe', 'Real-time progress tracking', 'Full broadcast history'].map(f => (
                <div key={f} className="flex items-center gap-2 mb-2">
                  <span className="text-indigo-500 font-bold text-xs">✓</span>
                  <span className="text-sm text-gray-700">{f}</span>
                </div>
              ))}
            </div>
            <button onClick={() => { setUpgradeError(null); setUpgradeSuccess(false); setShowUpgradeModal(true); }}
              className="bg-indigo-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-indigo-700 transition-colors text-sm">
              ⬆️ Upgrade to Pro — ₹8,999/month →
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📣</div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Bulk Broadcast</h2>
                <p className="text-xs text-gray-500 mt-0.5">Send a WhatsApp message to multiple leads at once. Messages are sent 3 seconds apart.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Compose form */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-gray-900 mb-4">New Broadcast</h3>

                {broadcastMsg && (
                  <div className={`text-sm rounded-xl px-4 py-3 mb-4 ${broadcastMsg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
                    {broadcastMsg.text}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Broadcast Name <span className="text-red-400">*</span></label>
                    <input type="text" value={broadcastForm.name} placeholder="e.g. April Admission Reminder"
                      onChange={e => setBroadcastForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full text-sm border border-gray-300 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Target Audience</label>
                    <select value={broadcastForm.target_filter}
                      onChange={e => {
                        setBroadcastForm(f => ({ ...f, target_filter: e.target.value }));
                        void fetchBroadcastPreview(e.target.value);
                      }}
                      className="w-full text-sm border border-gray-300 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                      <option value="all">All active leads (excludes lost)</option>
                      <option value="new">New leads only</option>
                      <option value="contacted">Contacted leads only</option>
                      <option value="converted">Converted leads only</option>
                    </select>
                    {broadcastPreviewCount !== null && (
                      <p className="text-xs text-indigo-600 mt-1 font-medium">
                        📊 {broadcastPreviewCount} lead{broadcastPreviewCount !== 1 ? 's' : ''} will receive this message
                        {broadcastPreviewCount > 0 && ` · Est. time: ~${Math.ceil(broadcastPreviewCount * 3 / 60)} min`}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                      Message <span className="text-red-400">*</span>
                      <span className="text-gray-400 font-normal ml-2">{broadcastForm.message.length}/1000</span>
                    </label>
                    <textarea value={broadcastForm.message} rows={6}
                      placeholder="Hi! We wanted to share an update about our upcoming batch starting April 1st. Seats are limited — reply to know more or call us at 98765-43210."
                      onChange={e => setBroadcastForm(f => ({ ...f, message: e.target.value.slice(0, 1000) }))}
                      className="w-full text-sm border border-gray-300 rounded-xl px-3 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
                    <p className="text-xs text-gray-400 mt-1">Keep it short and personal. Long messages have lower read rates.</p>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <p className="text-xs text-amber-700 font-medium">⚠️ Broadcast responsibly</p>
                    <p className="text-xs text-amber-600 mt-0.5">Only send to leads who expect to hear from you. Spam reports can get your WhatsApp number flagged.</p>
                  </div>

                  <button onClick={() => void handleSendBroadcast()} disabled={broadcastSending || !broadcastForm.name || !broadcastForm.message}
                    className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors text-sm flex items-center justify-center gap-2">
                    {broadcastSending
                      ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Starting…</>
                      : '📣 Send Broadcast'}
                  </button>
                </div>
              </div>

              {/* Broadcast history */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 mb-4">Broadcast History</h3>
                {broadcastsLoading ? (
                  <div className="text-center py-12"><div className="w-7 h-7 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-2" /><p className="text-xs text-gray-400">Loading…</p></div>
                ) : broadcasts.length === 0 ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 text-center">
                    <div className="text-3xl mb-2">📭</div>
                    <p className="text-sm text-gray-500">No broadcasts yet. Send your first one!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {broadcasts.map(b => {
                      const isRunning = b.status === 'sending';
                      const progress = b.total_count > 0 ? Math.round(((b.sent_count + b.failed_count) / b.total_count) * 100) : 0;
                      return (
                        <div key={b.id} className="bg-white border border-gray-200 rounded-2xl p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{b.name}</p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {new Date(b.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                {' · '}
                                {b.target_filter === 'all' ? 'All active' : b.target_filter} leads
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                b.status === 'completed' ? 'bg-green-100 text-green-700' :
                                b.status === 'sending' ? 'bg-blue-100 text-blue-700' :
                                b.status === 'failed' ? 'bg-red-100 text-red-600' :
                                'bg-gray-100 text-gray-500'
                              }`}>
                                {b.status === 'sending' ? '⏳ Sending' :
                                 b.status === 'completed' ? '✅ Done' :
                                 b.status === 'failed' ? '❌ Failed' : b.status}
                              </span>
                              {b.status !== 'sending' && (
                                <button onClick={() => void handleDeleteBroadcast(b.id)}
                                  className="text-gray-300 hover:text-red-400 transition-colors text-sm">✕</button>
                              )}
                            </div>
                          </div>

                          {/* Progress bar for running broadcasts */}
                          {isRunning && (
                            <div className="mb-2">
                              <div className="flex justify-between text-xs text-gray-500 mb-1">
                                <span>Sending…</span>
                                <span>{b.sent_count + b.failed_count}/{b.total_count}</span>
                              </div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
                              </div>
                            </div>
                          )}

                          {/* Stats */}
                          <div className="flex gap-3 text-xs text-gray-500">
                            <span>📤 {b.sent_count} sent</span>
                            {b.failed_count > 0 && <span className="text-red-400">❌ {b.failed_count} failed</span>}
                            <span className="text-gray-400">/ {b.total_count} total</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      )}

      {/* ── Premium Tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'premium' && institute && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>⭐</div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Premium Features</h2>
              <p className="text-xs text-gray-500 mt-0.5">Everything InquiAI offers — unlock the full power of AI-driven admissions.</p>
            </div>
          </div>
          <PremiumSection
            plan={institute.plan}
            createdAt={institute.created_at ?? new Date().toISOString()}
            onUpgradeClick={() => { setUpgradeError(null); setUpgradeSuccess(false); setShowUpgradeModal(true); }}
          />
        </div>
      )}

        </main>

        {/* ── Mobile Bottom Tab Bar ─────────────────────────────────────────── */}
        <nav style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#13111e', borderTop: '1px solid #1e1c2e',
          display: 'flex', alignItems: 'stretch', zIndex: 40, height: '60px',
        }}
          className="mobile-only"
        >
          {[
            { id: 'leads' as Tab, label: 'Leads', icon: '📋' },
            { id: 'whatsapp' as Tab, label: 'WhatsApp', icon: '📱' },
            { id: 'profile' as Tab, label: 'Profile', icon: '🏫' },
            { id: 'blocklist' as Tab, label: 'Blocklist', icon: '🚫' },
          ].map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: '3px', background: 'none', border: 'none',
              cursor: 'pointer', padding: '6px 0',
              borderTop: activeTab === item.id ? '2px solid #7f77dd' : '2px solid transparent',
            }}>
              <span style={{ fontSize: '18px', lineHeight: 1 }}>{item.icon}</span>
              <span style={{ fontSize: '9px', color: activeTab === item.id ? '#7f77dd' : '#4a4768', fontWeight: activeTab === item.id ? 600 : 400 }}>{item.label}</span>
            </button>
          ))}
          {/* "More" button opens sidebar drawer for premium items */}
          <button onClick={() => setSidebarOpen(true)} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: '3px', background: 'none', border: 'none',
            cursor: 'pointer', padding: '6px 0',
            borderTop: ['analytics','widget','training'].includes(activeTab) ? '2px solid #c9a55e' : '2px solid transparent',
          }}>
            <span style={{ fontSize: '18px', lineHeight: 1 }}>⭐</span>
            <span style={{ fontSize: '9px', color: ['analytics','widget','training'].includes(activeTab) ? '#c9a55e' : '#4a4768', fontWeight: 400 }}>More</span>
          </button>
        </nav>

      </div>
    </div>
  );
}