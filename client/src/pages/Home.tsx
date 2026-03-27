import { useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { apiUrl } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────
interface PlanFeature { text: string; core: boolean; }
interface Plan {
  id: number;
  slug: string;
  name: string;
  badge: string;
  price_monthly: number;
  price_annual: number;
  description: string;
  features: PlanFeature[];
  is_popular: boolean;
}

// ── Static content ────────────────────────────────────────────────────────────
const features = [
  {
    icon: '📲',
    title: 'WhatsApp InquiAI',
    description: 'Automatically capture every student inquiry that arrives on your institute\'s WhatsApp number.',
  },
  {
    icon: '⚡',
    title: 'Instant AI Replies',
    description: 'AI replies instantly to students using your institute\'s own course and fee information.',
  },
  {
    icon: '💬',
    title: 'Conversation History',
    description: 'View the full WhatsApp chat thread for every lead directly in your dashboard.',
  },
  {
    icon: '📅',
    title: 'Follow-up Management',
    description: 'Set follow-up dates, get email reminders, and send AI-generated follow-up messages in one click.',
  },
  {
    icon: '📊',
    title: 'Lead Dashboard',
    description: 'View, filter, and manage all your leads in one place. Track every student from enquiry to conversion.',
  },
  {
    icon: '📧',
    title: 'Email Notifications',
    description: 'Get notified instantly when a new lead arrives, and receive daily follow-up reminders.',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatPrice(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

function annualSaving(monthly: number, annual: number): string {
  const saving = monthly * 12 - annual;
  return '₹' + saving.toLocaleString('en-IN');
}

// ── Fallback plans (shown while loading) ──────────────────────────────────────
const FALLBACK_PLANS: Plan[] = [
  {
    id: 1, slug: 'starter', name: 'Starter', badge: '14-Day Free Trial',
    price_monthly: 2499, price_annual: 24990, is_popular: false,
    description: 'Perfect for single-location coaching institutes starting with AI-powered admissions.',
    features: [
      { text: '1 WhatsApp number', core: true },
      { text: '500 AI responses / month', core: true },
      { text: 'Up to 75 active leads tracked', core: true },
      { text: 'Auto-reply & lead capture', core: true },
      { text: 'Basic dashboard & analytics', core: true },
      { text: 'Email support', core: true },
    ],
  },
  {
    id: 2, slug: 'growth', name: 'Growth', badge: 'Most Popular',
    price_monthly: 3999, price_annual: 39990, is_popular: true,
    description: 'For growing institutes that are converting well and need more capacity.',
    features: [
      { text: 'Up to 2 WhatsApp numbers', core: true },
      { text: '2,000 AI responses / month', core: true },
      { text: 'Unlimited active leads', core: true },
      { text: 'AI Training (upload chat history)', core: false },
      { text: 'Advanced analytics & conversion reports', core: false },
      { text: 'Follow-up sequences (auto 2nd & 3rd message)', core: false },
      { text: 'Priority email support', core: true },
    ],
  },
  {
    id: 3, slug: 'pro', name: 'Pro', badge: 'Full Power',
    price_monthly: 8999, price_annual: 89990, is_popular: false,
    description: 'For large institutes and multi-branch chains that need unlimited scale.',
    features: [
      { text: 'Unlimited WhatsApp numbers', core: true },
      { text: 'Unlimited AI responses', core: true },
      { text: 'Multi-branch management (single dashboard)', core: false },
      { text: 'Custom AI persona & tone training', core: false },
      { text: 'Bulk broadcast messaging', core: false },
      { text: 'Dedicated support + onboarding call', core: true },
    ],
  },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function Home() {
  const navigate = useNavigate();
  useEffect(() => {
    const stored = localStorage.getItem('institute');
    if (stored) {
      navigate('/dashboard');
    }
  }, [navigate]);
  const [plans, setPlans] = useState<Plan[]>(FALLBACK_PLANS);
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedForm, setSchedForm] = useState({ name: '', institute: '', size: '', mobile: '', pilot: true });
  const [schedError, setSchedError] = useState('');
  const [schedSuccess, setSchedSuccess] = useState(false);
  const [schedLoading, setSchedLoading] = useState(false);

  useEffect(() => {
    fetch(apiUrl('/api/plans'))
      .then(r => r.json())
      .then((data: Plan[]) => { if (Array.isArray(data) && data.length) setPlans(data); })
      .catch(() => { /* silently use fallback */ });
  }, []);

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSchedError('');
    const digits = schedForm.mobile.replace(/\s/g, '');
    if (!schedForm.name.trim()) { setSchedError('Please enter your name.'); return; }
    if (!schedForm.institute.trim()) { setSchedError('Please enter your institute name.'); return; }
    if (!schedForm.size) { setSchedError('Please select institute size.'); return; }
    if (!/^[6-9]\d{9}$/.test(digits)) { setSchedError('Please enter a valid 10-digit Indian mobile number.'); return; }

    setSchedLoading(true);
    try {
      await fetch(apiUrl('/api/institutes/demo-request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...schedForm, mobile: digits }),
      });
      setSchedSuccess(true);
    } catch { /* non-fatal */ }
    finally { setSchedLoading(false); }
  };

  return (
    <div className="flex flex-col">

      {/* Hero */}
      <section className="bg-gradient-to-br from-indigo-600 to-purple-700 text-white py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <span className="inline-block bg-white/20 text-white text-xs font-semibold px-3 py-1 rounded-full mb-6 tracking-wide uppercase">
            AI-Powered WhatsApp Admission Assistant
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight mb-6">
            Capture Leads.<br />Respond Instantly.
          </h1>
          <p className="text-lg sm:text-xl text-indigo-100 mb-10 max-w-xl mx-auto">
            Help your institute capture WhatsApp enquiries automatically — AI replies instantly
            using your own course and fee information. Never miss a lead again.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register"
              className="bg-white text-indigo-700 font-semibold px-8 py-3 rounded-xl hover:bg-indigo-50 transition-colors text-base">
              Start Free Trial →
            </Link>
            <Link to="/login"
              className="border border-white/50 text-white font-semibold px-8 py-3 rounded-xl hover:bg-white/10 transition-colors text-base">
              Login to Dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">How It Works</h2>
          <p className="text-center text-gray-500 mb-12 max-w-lg mx-auto">
            Three simple steps to automate your admission enquiries.
          </p>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              { step: '1', title: 'Register', desc: 'Sign up with your institute details and optional website URL. Our AI auto-generates your knowledge base.' },
              { step: '2', title: 'Connect WhatsApp', desc: 'Scan a QR code to link your WhatsApp number. Takes less than a minute.' },
              { step: '3', title: 'Sit Back & Capture', desc: 'Every student enquiry creates a lead and gets an instant AI reply — 24/7, no manual work.' },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-12 h-12 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  {item.step}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{item.title}</h3>
                <p className="text-sm text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">Everything You Need</h2>
          <p className="text-center text-gray-500 mb-12 max-w-lg mx-auto">
            From capture to conversion — manage your student enquiries efficiently.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div key={f.title}
                className="flex flex-col items-start p-6 rounded-2xl bg-white border border-gray-200 hover:border-indigo-200 hover:shadow-sm transition-all">
                <span className="text-3xl mb-3">{f.icon}</span>
                <h3 className="font-semibold text-gray-900 mb-1">{f.title}</h3>
                <p className="text-sm text-gray-600">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Plans */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-3">Simple, Transparent Pricing</h2>
          <p className="text-center text-gray-500 mb-3 max-w-lg mx-auto">
            Starter plan includes a 14-day free trial. Growth & Pro are paid plans.
          </p>
          <p className="text-center mb-12">
            <span className="inline-block bg-green-50 border border-green-200 text-green-700 text-xs font-semibold px-3 py-1 rounded-full">
              🎉 Annual plans save 2 months — pay for 10, get 12
            </span>
          </p>

          <div className="grid sm:grid-cols-3 gap-6 items-start">
            {plans.map((plan) => (
              <div key={plan.slug}
                className={`rounded-2xl border flex flex-col overflow-hidden ${
                  plan.is_popular
                    ? 'border-indigo-400 ring-2 ring-indigo-200 shadow-lg shadow-indigo-100'
                    : 'border-gray-200'
                }`}>

                {/* Card header */}
                <div className={`px-6 pt-6 pb-5 ${plan.is_popular ? 'bg-indigo-600' : 'bg-gray-50'}`}>
                  <span className={`text-xs font-bold uppercase tracking-widest ${plan.is_popular ? 'text-indigo-200' : 'text-indigo-500'}`}>
                    {plan.badge}
                  </span>
                  <h3 className={`text-xl font-bold mt-1 ${plan.is_popular ? 'text-white' : 'text-gray-900'}`}>
                    {plan.name}
                  </h3>
                  <p className={`text-xs mt-1 mb-4 ${plan.is_popular ? 'text-indigo-200' : 'text-gray-500'}`}>
                    {plan.description}
                  </p>

                  {/* Price */}
                  <div className="flex items-end gap-2">
                    <span className={`text-4xl font-extrabold leading-none ${plan.is_popular ? 'text-white' : 'text-gray-900'}`}>
                      {formatPrice(plan.price_monthly)}
                    </span>
                  </div>
                  <p className={`text-xs mt-1 ${plan.is_popular ? 'text-indigo-200' : 'text-gray-400'}`}>
                    per month &nbsp;·&nbsp;
                    <span className={plan.is_popular ? 'text-indigo-100 font-semibold' : 'text-gray-500 font-semibold'}>
                      {formatPrice(plan.price_annual)}/year
                    </span>
                  </p>
                  <p className={`text-xs mt-0.5 ${plan.is_popular ? 'text-green-300' : 'text-green-600'}`}>
                    Save {annualSaving(plan.price_monthly, plan.price_annual)} on annual plan
                  </p>
                </div>

                {/* Features */}
                <div className="px-6 py-5 bg-white flex-1">
                  <ul className="space-y-2.5">
                    {plan.features.map((f) => (
                      <li key={f.text} className="flex items-start gap-2 text-sm">
                        <span className={`mt-0.5 flex-shrink-0 font-bold ${f.core ? 'text-green-500' : 'text-indigo-500'}`}>✓</span>
                        <span className="text-gray-700">
                          {f.text}
                          {!f.core && (
                            <span className="ml-1.5 text-xs bg-indigo-50 text-indigo-600 font-semibold px-1.5 py-0.5 rounded-full">
                              Premium
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* CTA */}
                <div className="px-6 pb-6 bg-white">
                  {plan.slug === 'starter' ? (
                    <>
                      <Link to={`/register?plan=${plan.slug}`}
                        className="block text-center py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
                        Start 14-Day Free Trial →
                      </Link>
                      <p className="text-center text-xs text-gray-400 mt-2">
                        Trial includes Growth features — no credit card
                      </p>
                    </>
                  ) : (
                    <>
                      <Link to={`/register?plan=${plan.slug}`}
                        className={`block text-center py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                          plan.is_popular
                            ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}>
                        Get Started →
                      </Link>
                      <p className="text-center text-xs text-gray-400 mt-2">
                        💳 One-time setup · Pay after registration
                      </p>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Schedule a Call CTA */}
          <div className="mt-12 text-center">
            <p className="text-gray-500 text-sm mb-4">Not sure which plan is right for you?</p>
            <button
              onClick={() => { setShowSchedule(true); setSchedSuccess(false); setSchedError(''); setSchedForm({ name: '', institute: '', size: '', mobile: '', pilot: true }); }}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold px-8 py-3.5 rounded-xl hover:from-indigo-700 hover:to-violet-700 transition-all shadow-lg hover:shadow-indigo-200 text-sm">
              📞 Schedule a Free Call — We'll Set It Up For You
            </button>
            <p className="text-xs text-gray-400 mt-3">We'll call within 2 hours · Takes just 15 minutes</p>
          </div>
        </div>
      </section>

      {/* ── Schedule a Call Modal ─────────────────────────────────────────────── */}
      {showSchedule && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setShowSchedule(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Modal header */}
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5 flex items-start justify-between">
              <div>
                <h3 className="text-white font-bold text-xl">📞 Schedule a Free Call</h3>
                <p className="text-indigo-100 text-sm mt-1">We'll set up InquiAI for your institute live on the call — takes just 15 minutes.</p>
              </div>
              <button onClick={() => setShowSchedule(false)} className="text-white/70 hover:text-white text-xl leading-none ml-4 mt-0.5 flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">✕</button>
            </div>

            <div className="p-6">
              {schedSuccess ? (
                <div className="py-8 text-center">
                  <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">✅</div>
                  <h4 className="font-bold text-gray-900 text-lg mb-2">Details Received!</h4>
                  <p className="text-gray-500 text-sm">We'll call you within 2 hours on <strong>{schedForm.mobile}</strong> to set everything up.</p>
                  <button onClick={() => setShowSchedule(false)} className="mt-6 bg-indigo-600 text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-indigo-700 transition-colors">Close</button>
                </div>
              ) : (
                <form onSubmit={(e) => void handleScheduleSubmit(e)} className="space-y-4">
                  {schedError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">⚠ {schedError}</div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Your Name <span className="text-red-500">*</span></label>
                    <input type="text" value={schedForm.name}
                      onChange={e => { setSchedForm(f => ({ ...f, name: e.target.value })); setSchedError(''); }}
                      placeholder="e.g. Rajesh Sharma"
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Institute Name <span className="text-red-500">*</span></label>
                    <input type="text" value={schedForm.institute}
                      onChange={e => { setSchedForm(f => ({ ...f, institute: e.target.value })); setSchedError(''); }}
                      placeholder="e.g. ABC Coaching Center"
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Approx. Number of Students <span className="text-red-500">*</span></label>
                    <select value={schedForm.size}
                      onChange={e => { setSchedForm(f => ({ ...f, size: e.target.value })); setSchedError(''); }}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                      <option value="">Select institute size</option>
                      <option value="1–50 students">1–50 students</option>
                      <option value="51–200 students">51–200 students</option>
                      <option value="201–500 students">201–500 students</option>
                      <option value="500+ students">500+ students</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Number <span className="text-red-500">*</span></label>
                    <input type="tel" value={schedForm.mobile}
                      onChange={e => { setSchedForm(f => ({ ...f, mobile: e.target.value })); setSchedError(''); }}
                      placeholder="e.g. 9876543210"
                      maxLength={10}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>

                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={schedForm.pilot}
                      onChange={e => setSchedForm(f => ({ ...f, pilot: e.target.checked }))}
                      className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500" />
                    <span className="text-sm text-gray-600">Yes, I'm interested in a <strong>free pilot trial</strong> for my institute</span>
                  </label>

                  <button type="submit" disabled={schedLoading}
                    className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold py-3 rounded-xl hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 transition-all text-sm mt-2">
                    {schedLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Sending…
                      </span>
                    ) : '📲 Send My Details →'}
                  </button>
                  <p className="text-center text-xs text-gray-400">We'll reach out within 2 hours on WhatsApp</p>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
      <section className="py-16 px-4 bg-indigo-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Ready to Stop Missing Leads?</h2>
          <p className="text-gray-600 mb-8">
            Register your institute today and start capturing every WhatsApp enquiry automatically.
          </p>
          <Link to="/register"
            className="bg-indigo-600 text-white font-semibold px-8 py-3 rounded-xl hover:bg-indigo-700 transition-colors inline-block text-base">
            Start Free Trial — No Credit Card →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-8 px-4 text-center text-sm">
        <p className="font-semibold text-white mb-1">InquiAI</p>
        <p>AI-powered admission assistant for institutes, coaching centers & universities.</p>
        {/* Social media */}
        <div className="mt-4 flex justify-center gap-4">
          <a href="https://www.linkedin.com/company/inquiai/" target="_blank" rel="noopener noreferrer"
            className="w-9 h-9 rounded-full bg-gray-800 hover:bg-[#0077B5] flex items-center justify-center transition-colors group"
            aria-label="InquiAI on LinkedIn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-gray-400 group-hover:text-white transition-colors">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
          </a>
        </div>
        <div className="mt-4 flex justify-center gap-4 text-xs text-gray-500">
          <Link to="/privacy-policy" className="hover:text-indigo-400 transition-colors">Privacy Policy</Link>
          <span>·</span>
          <Link to="/terms-of-service" className="hover:text-indigo-400 transition-colors">Terms of Service</Link>
        </div>
        <p className="mt-2 text-xs text-gray-600">© {new Date().getFullYear()} InquiAI. All rights reserved.</p>
      </footer>
    </div>
  );
}