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
  const [errors, setErrors] = useState<Record<string, string>>({});

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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(apiUrl('/api/plans'))
      .then(r => r.json())
      .then((data: Plan[]) => { if (Array.isArray(data) && data.length) setPlans(data); })
      .catch(() => {
        // Fallback static plans if API fails
        setPlans([
          { id: 1, slug: 'starter', name: 'Starter', price_monthly: 2499, badge: '14-Day Free Trial' },
          { id: 2, slug: 'growth', name: 'Growth', price_monthly: 3999, badge: 'Most Popular' },
          { id: 3, slug: 'pro', name: 'Pro', price_monthly: 8999, badge: 'Full Power' },
        ]);
      });
  }, []);

  const validate = () => {
    const newErrors: Record<string, string> = {};

    // Name
    if (!form.name.trim()) {
      newErrors.name = 'Institute name is required';
    } else if (form.name.length < 3) {
      newErrors.name = 'Minimum 3 characters required';
    }

    // Email
    if (!form.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = 'Invalid email format';
    }

    // Phone
    if (!form.phone.trim()) {
      newErrors.phone = 'Phone is required';
    } else if (!/^[6-9]\d{9}$/.test(form.phone.replace(/\D/g, ''))) {
      newErrors.phone = 'Enter valid 10-digit Indian number';
    }

    // WhatsApp
    if (!form.whatsapp_number.trim()) {
      newErrors.whatsapp_number = 'WhatsApp number is required';
    } else if (!/^[6-9]\d{9}$/.test(form.whatsapp_number.replace(/\D/g, ''))) {
      newErrors.whatsapp_number = 'Enter valid WhatsApp number';
    }

    // Website (optional)
    if (form.website && !/^https?:\/\/.+\..+/.test(form.website)) {
      newErrors.website = 'Enter valid URL (https://example.com)';
    }

    // Password
    if (!form.password) {
      newErrors.password = 'Password is required';
    } else if (form.password.length < 6) {
      newErrors.password = 'Minimum 6 characters required';
    } else if (!/[A-Z]/.test(form.password)) {
      newErrors.password = 'At least 1 uppercase letter required';
    } else if (!/[0-9]/.test(form.password)) {
      newErrors.password = 'At least 1 number required';
    }

    // Confirm Password
    if (!form.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm password';
    } else if (form.password !== form.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validate()) return;

    setLoading(true);
    try {
      const { confirmPassword: _, ...payload } = form;
      const res = await fetch(apiUrl('/api/institutes/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { id?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Registration failed.');

      localStorage.setItem('institute', JSON.stringify(data));
      // Growth/Pro: go to complete-payment page for Razorpay checkout
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

            {/* NAME */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Institute Name
              </label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="e.g. ABC Coaching Center"
                className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2
        ${errors.name
                    ? 'border-red-400 bg-red-50 focus:ring-red-400'
                    : 'border-gray-300 focus:ring-indigo-500'
                  }`}
              />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
            </div>

            {/* EMAIL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Official Email
              </label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                placeholder="contact@institute.com"
                className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2
        ${errors.email
                    ? 'border-red-400 bg-red-50 focus:ring-red-400'
                    : 'border-gray-300 focus:ring-indigo-500'
                  }`}
              />
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
            </div>

            {/* PHONE + WHATSAPP */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="9876543210"
                  className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2
          ${errors.phone
                      ? 'border-red-400 bg-red-50 focus:ring-red-400'
                      : 'border-gray-300 focus:ring-indigo-500'
                    }`}
                />
                {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp</label>
                <input
                  name="whatsapp_number"
                  type="tel"
                  value={form.whatsapp_number}
                  onChange={handleChange}
                  placeholder="9876543210"
                  className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2
          ${errors.whatsapp_number
                      ? 'border-red-400 bg-red-50 focus:ring-red-400'
                      : 'border-gray-300 focus:ring-indigo-500'
                    }`}
                />
                {errors.whatsapp_number && (
                  <p className="text-xs text-red-500 mt-1">{errors.whatsapp_number}</p>
                )}
              </div>
            </div>

            {/* WEBSITE */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Institute Website <span className="text-gray-400">(optional)</span>
              </label>
              <input
                name="website"
                value={form.website}
                onChange={handleChange}
                placeholder="https://www.yourinstitute.com"
                className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2
        ${errors.website
                    ? 'border-red-400 bg-red-50 focus:ring-red-400'
                    : 'border-gray-300 focus:ring-indigo-500'
                  }`}
              />
              {errors.website ? (
                <p className="text-xs text-red-500 mt-1">{errors.website}</p>
              ) : (
                <p className="text-xs text-gray-400 mt-1">
                  We'll auto-generate your AI assistant's knowledge base from this.
                </p>
              )}
            </div>

            {/* PLAN */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Choose Your Plan
              </label>
              <select
                name="plan"
                value={form.plan}
                onChange={handleChange}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {plans.map(plan => (
                  <option key={plan.slug} value={plan.slug}>
                    {plan.name} — ₹{plan.price_monthly.toLocaleString('en-IN')}/month
                  </option>
                ))}
              </select>

              {selectedPlan && (
                <p className="text-xs text-indigo-600 mt-1 font-medium">
                  {form.plan === 'starter'
                    ? '✓ 14-day free trial included'
                    : `✓ Payment required for ${selectedPlan.name}`}
                </p>
              )}
            </div>

            {/* PASSWORD */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                name="password"
                type="password"
                value={form.password}
                onChange={handleChange}
                placeholder="Min 6 chars, 1 uppercase, 1 number"
                className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2
        ${errors.password
                    ? 'border-red-400 bg-red-50 focus:ring-red-400'
                    : 'border-gray-300 focus:ring-indigo-500'
                  }`}
              />
              {errors.password && (
                <p className="text-xs text-red-500 mt-1">{errors.password}</p>
              )}
            </div>

            {/* CONFIRM PASSWORD */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password
              </label>
              <input
                name="confirmPassword"
                type="password"
                value={form.confirmPassword}
                onChange={handleChange}
                placeholder="Re-enter password"
                className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2
        ${errors.confirmPassword
                    ? 'border-red-400 bg-red-50 focus:ring-red-400'
                    : 'border-gray-300 focus:ring-indigo-500'
                  }`}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-red-500 mt-1">{errors.confirmPassword}</p>
              )}
            </div>

            {/* SUBMIT */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors text-sm mt-2"
            >
              {loading ? 'Registering…' :
                form.plan === 'starter'
                  ? 'Start Free Trial →'
                  : 'Create Account & Pay →'}
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