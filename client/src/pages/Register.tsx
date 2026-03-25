import { useState, useEffect } from 'react';
import Logo from '../components/Logo';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { apiUrl } from '../lib/api';

interface Plan {
  id: number;
  slug: string;
  name: string;
  price_monthly: number;
  badge: string;
}

export default function Register() {
  const navigate = useNavigate();
  useEffect(() => {
    const stored = localStorage.getItem('institute');
    if (stored) {
      navigate('/dashboard');
    }
  }, [navigate]);
  const location = useLocation();
  const [plans, setPlans] = useState<Plan[]>([]);

  // Read ?plan=xxx from URL — pre-selects the plan the user clicked on Home page
  const urlPlan = new URLSearchParams(location.search).get('plan') ?? 'starter';
  const validSlugs = ['starter', 'growth', 'pro'];
  const defaultPlan = validSlugs.includes(urlPlan) ? urlPlan : 'starter';

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    whatsapp_number: '',
    website: '',
    plan: defaultPlan,
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Clear field error as user types
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setFieldErrors(prev => ({ ...prev, [e.target.name]: '' }));
    setError(null);
  };

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};

    // Institute Name
    if (!form.name.trim()) {
      errs.name = 'Institute name is required.';
    } else if (form.name.trim().length < 3) {
      errs.name = 'Must be at least 3 characters.';
    } else if (form.name.trim().length > 100) {
      errs.name = 'Must be under 100 characters.';
    }

    // Email
    if (!form.email.trim()) {
      errs.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errs.email = 'Enter a valid email address.';
    }

    // Phone
    const phoneDigits = form.phone.replace(/[\s\-\+\(\)]/g, '');
    if (!form.phone.trim()) {
      errs.phone = 'Phone number is required.';
    } else if (!/^\d+$/.test(phoneDigits)) {
      errs.phone = 'Only digits allowed (spaces, +, - are fine).';
    } else if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      errs.phone = 'Must be between 7 and 15 digits.';
    }

    // WhatsApp
    const waDigits = form.whatsapp_number.replace(/[\s\-\+\(\)]/g, '');
    if (!form.whatsapp_number.trim()) {
      errs.whatsapp_number = 'WhatsApp number is required.';
    } else if (!/^\d+$/.test(waDigits)) {
      errs.whatsapp_number = 'Only digits allowed (spaces, +, - are fine).';
    } else if (waDigits.length < 7 || waDigits.length > 15) {
      errs.whatsapp_number = 'Must be between 7 and 15 digits.';
    }

    // Website (optional but must be valid if provided)
    if (form.website.trim()) {
      try {
        const url = new URL(form.website.trim().startsWith('http') ? form.website.trim() : `https://${form.website.trim()}`);
        if (!['http:', 'https:'].includes(url.protocol)) {
          errs.website = 'Must be a valid URL (e.g. https://yourinstitute.com).';
        }
      } catch {
        errs.website = 'Must be a valid URL (e.g. https://yourinstitute.com).';
      }
    }

    // Password
    if (!form.password) {
      errs.password = 'Password is required.';
    } else if (form.password.length < 8) {
      errs.password = 'Must be at least 8 characters.';
    } else if (!/[A-Z]/.test(form.password) && !/[0-9]/.test(form.password) && !/[^a-zA-Z]/.test(form.password)) {
      errs.password = 'Include at least one number or special character.';
    }

    // Confirm Password
    if (!form.confirmPassword) {
      errs.confirmPassword = 'Please confirm your password.';
    } else if (form.password !== form.confirmPassword) {
      errs.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  useEffect(() => {
    fetch(apiUrl('/api/plans'))
      .then(r => r.json())
      .then((data: Plan[]) => { if (Array.isArray(data) && data.length) setPlans(data); })
      .catch(() => {
        // Fallback static plans if API fails
        setPlans([
          { id: 1, slug: 'starter', name: 'Starter', price_monthly: 2499, badge: '14-Day Free Trial' },
          { id: 2, slug: 'growth',  name: 'Growth',  price_monthly: 3999, badge: 'Most Popular' },
          { id: 3, slug: 'pro',     name: 'Pro',     price_monthly: 8999, badge: 'Full Power' },
        ]);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateForm()) return;

    setLoading(true);
    try {
      const { confirmPassword: _, ...payload } = form;
      // Auto-prefix website with https:// if missing
      if (payload.website && !payload.website.startsWith('http')) {
        payload.website = `https://${payload.website}`;
      }
      const res = await fetch(apiUrl('/api/institutes/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { id?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Registration failed.');

      localStorage.setItem('institute', JSON.stringify(data));
      if (form.plan === 'growth' || form.plan === 'pro') {
        navigate('/complete-payment');
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const selectedPlan = plans.find(p => p.slug === form.plan);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

          <div className="text-center mb-8">
            <div className="flex justify-center mb-2">
              <Logo size="md" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Register Your Institute</h1>
            <p className="text-gray-500 text-sm mt-1">Start capturing and managing leads efficiently</p>
          </div>

          {/* Trial / payment banner — dynamic per selected plan */}
          {form.plan === 'starter' ? (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 mb-6 text-center">
              <p className="text-sm font-semibold text-indigo-800">🎉 14-Day Free Trial — No Credit Card Required</p>
              <p className="text-xs text-indigo-600 mt-0.5">Try all Starter features free for 14 days.</p>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-center">
              <p className="text-sm font-semibold text-amber-800">💳 Paid Plan — Payment Required After Registration</p>
              <p className="text-xs text-amber-700 mt-0.5">You'll be taken to payment immediately after creating your account.</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-6">
              {error}
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Institute Name <span className="text-red-500">*</span>
              </label>
              <input id="name" name="name" type="text"
                value={form.name} onChange={handleChange}
                className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${fieldErrors.name ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                placeholder="e.g. ABC Coaching Center" />
              {fieldErrors.name && <p className="text-xs text-red-500 mt-1">⚠ {fieldErrors.name}</p>}
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Official Email <span className="text-red-500">*</span>
              </label>
              <input id="email" name="email" type="text"
                value={form.email} onChange={handleChange}
                className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${fieldErrors.email ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                placeholder="contact@institute.com" />
              {fieldErrors.email && <p className="text-xs text-red-500 mt-1">⚠ {fieldErrors.email}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Phone <span className="text-red-500">*</span>
                </label>
                <input id="phone" name="phone" type="tel"
                  value={form.phone} onChange={handleChange}
                  className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${fieldErrors.phone ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                  placeholder="+91 9876543210" />
                {fieldErrors.phone && <p className="text-xs text-red-500 mt-1">⚠ {fieldErrors.phone}</p>}
              </div>
              <div>
                <label htmlFor="whatsapp_number" className="block text-sm font-medium text-gray-700 mb-1">
                  WhatsApp <span className="text-red-500">*</span>
                </label>
                <input id="whatsapp_number" name="whatsapp_number" type="tel"
                  value={form.whatsapp_number} onChange={handleChange}
                  className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${fieldErrors.whatsapp_number ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                  placeholder="+91 9876543210" />
                {fieldErrors.whatsapp_number && <p className="text-xs text-red-500 mt-1">⚠ {fieldErrors.whatsapp_number}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="website" className="block text-sm font-medium text-gray-700 mb-1">
                Institute Website <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input id="website" name="website" type="text"
                value={form.website} onChange={handleChange}
                className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${fieldErrors.website ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                placeholder="https://www.yourinstitute.com" />
              {fieldErrors.website
                ? <p className="text-xs text-red-500 mt-1">⚠ {fieldErrors.website}</p>
                : <p className="text-xs text-gray-400 mt-1">We'll auto-generate your AI assistant's knowledge base from this.</p>
              }
            </div>

            {/* Plan selector */}
            <div>
              <label htmlFor="plan" className="block text-sm font-medium text-gray-700 mb-1">
                Choose Your Plan
              </label>
              <select id="plan" name="plan" value={form.plan} onChange={handleChange}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white">
                {plans.length === 0 ? (
                  <option value="starter">Starter — ₹2,499/month</option>
                ) : (
                  plans.map(plan => (
                    <option key={plan.slug} value={plan.slug}>
                      {plan.name} — ₹{plan.price_monthly.toLocaleString('en-IN')}/month
                      {plan.slug === 'growth' ? ' ⭐ Most Popular' : ''}
                    </option>
                  ))
                )}
              </select>
              {selectedPlan && (
                <p className="text-xs text-indigo-600 mt-1 font-medium">
                  {form.plan === 'starter'
                    ? '✓ 14-day free trial included — no credit card needed.'
                    : `✓ Payment for ${selectedPlan.name} plan required after account creation.`}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password <span className="text-red-500">*</span>
              </label>
              <input id="password" name="password" type="password"
                value={form.password} onChange={handleChange}
                className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${fieldErrors.password ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                placeholder="Min 8 characters" />
              {fieldErrors.password
                ? <p className="text-xs text-red-500 mt-1">⚠ {fieldErrors.password}</p>
                : form.password && form.password.length >= 8
                  ? <p className="text-xs text-green-600 mt-1">✓ Password looks good.</p>
                  : <p className="text-xs text-gray-400 mt-1">Min 8 characters with at least one number or special character.</p>
              }
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <input id="confirmPassword" name="confirmPassword" type="password"
                value={form.confirmPassword} onChange={handleChange}
                className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${fieldErrors.confirmPassword ? 'border-red-400 bg-red-50' : form.confirmPassword && form.password === form.confirmPassword ? 'border-green-400' : 'border-gray-300'}`}
                placeholder="Re-enter your password" />
              {fieldErrors.confirmPassword
                ? <p className="text-xs text-red-500 mt-1">⚠ {fieldErrors.confirmPassword}</p>
                : form.confirmPassword && form.password === form.confirmPassword
                  ? <p className="text-xs text-green-600 mt-1">✓ Passwords match.</p>
                  : null
              }
            </div>

            <button type="submit" disabled={loading}
              className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm mt-2">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Registering…
                </span>
              ) : form.plan === 'starter' ? 'Start Free Trial →' : 'Create Account & Pay →'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already registered?{' '}
            <Link to="/login" className="text-indigo-600 hover:text-indigo-700 font-medium">Login here</Link>
          </p>
        </div>
      </div>
    </div>
  );
}