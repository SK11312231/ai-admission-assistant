import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { apiUrl } from '../lib/api';

// ── Razorpay global type ──────────────────────────────────────────────────────
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open(): void };
  }
}
interface RazorpayOptions {
  key: string; amount: number; currency: string; name: string;
  description: string; order_id: string;
  prefill: { name: string; email: string };
  theme: { color: string };
  handler: (response: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => void;
  modal: { ondismiss: () => void };
}

const PLAN_PRICING = {
  starter: { monthly: 2499, annual: 24990 },
  growth:  { monthly: 3999, annual: 39990 },
  pro:     { monthly: 8999, annual: 89990 },
} as const;
type PlanSlug = keyof typeof PLAN_PRICING;

interface Institute {
  id: number; name: string; email: string; phone: string;
  whatsapp_number: string; website: string | null;
  plan: string; is_paid: boolean; created_at: string;
}

export default function CompletePayment() {
  const navigate = useNavigate();
  const [institute, setInstitute] = useState<Institute | null>(null);
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('institute');
    if (!stored) { navigate('/register'); return; }
    const inst = JSON.parse(stored) as Institute;

    // If already paid, go to dashboard
    if (inst.is_paid) { navigate('/dashboard'); return; }

    // If starter plan, no payment needed
    if (inst.plan === 'starter') { navigate('/dashboard'); return; }

    setInstitute(inst);
  }, [navigate]);

  const handlePay = async () => {
    if (!institute) return;
    setProcessing(true);
    setError(null);

    try {
      // Create Razorpay order
      const orderRes = await fetch(apiUrl('/api/payment/create-order'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          institute_id: institute.id,
          plan: institute.plan,
          billing_cycle: billing,
        }),
      });
      const orderData = await orderRes.json() as {
        order_id: string; amount: number; currency: string;
        key_id: string; error?: string;
      };
      if (!orderRes.ok) throw new Error(orderData.error ?? 'Failed to create order.');

      // Load Razorpay script if needed
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Razorpay.'));
          document.body.appendChild(script);
        });
      }

      const options: RazorpayOptions = {
        key:         orderData.key_id,
        amount:      orderData.amount,
        currency:    orderData.currency,
        name:        'InquiAI',
        description: `${institute.plan.charAt(0).toUpperCase() + institute.plan.slice(1)} Plan — ${billing}`,
        order_id:    orderData.order_id,
        prefill:     { name: institute.name, email: institute.email },
        theme:       { color: '#4f46e5' },
        handler: async (response) => {
          try {
            const verifyRes = await fetch(apiUrl('/api/payment/verify'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature,
                institute_id:        institute.id,
              }),
            });
            const verifyData = await verifyRes.json() as {
              success: boolean; plan: string; error?: string;
            };
            if (!verifyRes.ok) throw new Error(verifyData.error ?? 'Verification failed.');

            // Update localStorage with paid status
            const updated = { ...institute, plan: verifyData.plan, is_paid: true };
            localStorage.setItem('institute', JSON.stringify(updated));
            setSuccess(true);
            setTimeout(() => navigate('/dashboard'), 2500);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Payment verification failed. Contact support@inquiai.in');
            setProcessing(false);
          }
        },
        modal: { ondismiss: () => setProcessing(false) },
      };

      new window.Razorpay!(options).open();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setProcessing(false);
    }
  };

  if (!institute) return null;

  const plan = institute.plan as PlanSlug;
  const pricing = PLAN_PRICING[plan] ?? PLAN_PRICING.growth;
  const amount = billing === 'annual' ? pricing.annual : pricing.monthly;
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

          {/* Header */}
          <div className="text-center mb-6">
            <div className="flex justify-center mb-2">
              <Logo size="md" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Complete Your Payment</h1>
            <p className="text-gray-500 text-sm mt-1">
              One step away from activating your <span className="font-semibold text-indigo-600">{planLabel}</span> plan
            </p>
          </div>

          {success ? (
            <div className="py-10 flex flex-col items-center gap-3 text-center">
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center text-3xl">🎉</div>
              <p className="text-gray-900 font-bold text-lg">Payment Successful!</p>
              <p className="text-sm text-gray-500">Activating your dashboard…</p>
              <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mt-2" />
            </div>
          ) : (
            <>
              {/* Institute info */}
              <div className="bg-gray-50 rounded-xl px-4 py-3 mb-5">
                <p className="text-xs text-gray-500 mb-1">Registering as</p>
                <p className="font-semibold text-gray-900">{institute.name}</p>
                <p className="text-xs text-gray-500">{institute.email}</p>
              </div>

              {/* Billing toggle */}
              <div className="flex items-center justify-center gap-1 bg-gray-100 rounded-xl p-1 mb-5">
                <button onClick={() => setBilling('monthly')}
                  className={`flex-1 py-1.5 text-sm font-semibold rounded-lg transition-colors ${billing === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                  Monthly
                </button>
                <button onClick={() => setBilling('annual')}
                  className={`flex-1 py-1.5 text-sm font-semibold rounded-lg transition-colors ${billing === 'annual' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                  Annual <span className="text-green-600 text-xs font-bold ml-1">Save 2 months</span>
                </button>
              </div>

              {/* Plan summary */}
              <div className="border-2 border-indigo-200 bg-indigo-50 rounded-xl p-4 mb-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest">{planLabel} Plan</span>
                  <span className="text-xs bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full capitalize">{billing}</span>
                </div>
                <div className="text-3xl font-extrabold text-gray-900 mb-0.5">
                  ₹{amount.toLocaleString('en-IN')}
                </div>
                <p className="text-xs text-gray-500">
                  {billing === 'annual'
                    ? `per year · saves ₹${((pricing.monthly * 12) - pricing.annual).toLocaleString('en-IN')}`
                    : 'per month · cancel anytime'}
                </p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
                  {error}
                </div>
              )}

              <button onClick={() => void handlePay()} disabled={processing}
                className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors text-sm">
                {processing ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Opening payment…
                  </span>
                ) : `💳 Pay ₹${amount.toLocaleString('en-IN')} & Activate →`}
              </button>

              <p className="text-center text-xs text-gray-400 mt-3">
                🔒 Secured by Razorpay · Instant activation after payment
              </p>

              <div className="mt-4 pt-4 border-t border-gray-100 text-center">
                <button onClick={() => {
                  localStorage.removeItem('institute');
                  navigate('/register');
                }} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                  Cancel & go back to registration
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
