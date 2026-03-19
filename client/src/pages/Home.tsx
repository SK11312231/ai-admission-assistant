import { Link } from 'react-router-dom';

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

const plans = [
  {
    name: 'Free',
    badge: '30 Days Free',
    price: '₹0',
    originalPrice: null,
    duration: '30 days, no credit card',
    description: 'Full access to all core features. No limits during trial.',
    features: [
      { text: 'Unlimited leads for 30 days', core: true },
      { text: 'WhatsApp AI auto-reply (24/7)', core: true },
      { text: 'Lead dashboard & status tracking', core: true },
      { text: 'Conversation history per lead', core: true },
      { text: 'Notes & follow-up management', core: true },
      { text: 'Email notifications', core: true },
      { text: 'Blocklist management', core: true },
      { text: 'AI knowledge base (website enrichment)', core: true },
    ],
  },
  {
    name: 'Advanced',
    badge: 'Most Popular',
    price: '₹1,499',
    originalPrice: '₹2,999',
    duration: 'per month',
    description: 'Everything in Free, plus powerful analytics and chat widget.',
    popular: true,
    features: [
      { text: 'Everything in Free — unlimited leads', core: true },
      { text: 'Analytics dashboard', core: false },
      { text: 'Leads over time & peak hour charts', core: false },
      { text: 'Conversion rate tracking', core: false },
      { text: 'Embeddable website chat widget', core: false },
      { text: 'Priority email support', core: true },
    ],
  },
  {
    name: 'Pro',
    badge: 'Full Power',
    price: '₹3,499',
    originalPrice: '₹4,599',
    duration: 'per month',
    description: 'For growing institutes managing multiple campuses or admins.',
    features: [
      { text: 'Everything in Advanced', core: true },
      { text: 'Multi-institute admin panel', core: false },
      { text: 'Team accounts & role management', core: false },
      { text: 'Custom AI prompt configuration', core: false },
      { text: 'API access', core: false },
      { text: 'Dedicated support & onboarding', core: true },
    ],
  },
];

export default function Home() {
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
              Register Your Institute →
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
          <p className="text-center text-gray-500 mb-3 max-w-lg mx-auto">Start free for 30 days. No credit card required.</p>
          <p className="text-center mb-12">
            <span className="inline-block bg-green-50 border border-green-200 text-green-700 text-xs font-semibold px-3 py-1 rounded-full">
              🎉 Launch offer — prices shown are discounted from original
            </span>
          </p>
          <div className="grid sm:grid-cols-3 gap-6 items-start">
            {plans.map((plan) => (
              <div key={plan.name}
                className={`rounded-2xl border flex flex-col overflow-hidden ${
                  plan.popular
                    ? 'border-indigo-400 ring-2 ring-indigo-200 shadow-lg shadow-indigo-100'
                    : 'border-gray-200'
                }`}>

                {/* Card header */}
                <div className={`px-6 pt-6 pb-5 ${plan.popular ? 'bg-indigo-600' : 'bg-gray-50'}`}>
                  <span className={`text-xs font-bold uppercase tracking-widest ${plan.popular ? 'text-indigo-200' : 'text-indigo-500'}`}>
                    {plan.badge}
                  </span>
                  <h3 className={`text-xl font-bold mt-1 ${plan.popular ? 'text-white' : 'text-gray-900'}`}>{plan.name}</h3>
                  <p className={`text-xs mt-1 mb-4 ${plan.popular ? 'text-indigo-200' : 'text-gray-500'}`}>{plan.description}</p>

                  {/* Price */}
                  <div className="flex items-end gap-2">
                    <span className={`text-4xl font-extrabold leading-none ${plan.popular ? 'text-white' : 'text-gray-900'}`}>
                      {plan.price}
                    </span>
                    {plan.originalPrice && (
                      <span className={`text-sm line-through mb-1 ${plan.popular ? 'text-indigo-300' : 'text-gray-400'}`}>
                        {plan.originalPrice}
                      </span>
                    )}
                  </div>
                  <p className={`text-xs mt-1 ${plan.popular ? 'text-indigo-200' : 'text-gray-400'}`}>{plan.duration}</p>
                </div>

                {/* Features */}
                <div className="px-6 py-5 bg-white flex-1">
                  <ul className="space-y-2.5">
                    {plan.features.map((f) => (
                      <li key={f.text} className="flex items-start gap-2 text-sm">
                        <span className={`mt-0.5 flex-shrink-0 font-bold ${f.core ? 'text-green-500' : 'text-indigo-500'}`}>✓</span>
                        <span className={f.core ? 'text-gray-700' : 'text-gray-700'}>
                          {f.text}
                          {!f.core && (
                            <span className="ml-1.5 text-xs bg-indigo-50 text-indigo-600 font-semibold px-1.5 py-0.5 rounded-full">
                              New
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* CTA */}
                <div className="px-6 pb-6 bg-white">
                  {plan.name === 'Free' ? (
                    <Link to="/register"
                      className="block text-center py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
                      Start Free Trial →
                    </Link>
                  ) : (
                    <div className="block text-center py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-400 cursor-not-allowed select-none">
                      🚀 Launching Soon
                    </div>
                  )}
                  {plan.originalPrice && (
                    <p className="text-center text-xs text-gray-400 mt-2">
                      Save {plan.name === 'Advanced' ? '₹1,500' : '₹1,100'}/month vs original price
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-4 bg-indigo-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Ready to Stop Missing Leads?</h2>
          <p className="text-gray-600 mb-8">
            Register your institute today and start capturing every WhatsApp enquiry automatically.
          </p>
          <Link to="/register"
            className="bg-indigo-600 text-white font-semibold px-8 py-3 rounded-xl hover:bg-indigo-700 transition-colors inline-block text-base">
            Register Now — It's Free →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-8 px-4 text-center text-sm">
        <p className="font-semibold text-white mb-1">InquiAI</p>
        <p>AI-powered admission assistant for institutes, coaching centers & universities.</p>
        <div className="mt-3 flex justify-center gap-4 text-xs text-gray-500">
          <Link to="/privacy-policy.html" className="hover:text-indigo-400 transition-colors">Privacy Policy</Link>
          <span>·</span>
          <Link to="/terms-of-service.html" className="hover:text-indigo-400 transition-colors">Terms of Service</Link>
        </div>
        <p className="mt-2 text-xs text-gray-600">© {new Date().getFullYear()} InquiAI. All rights reserved.</p>
      </footer>
    </div>
  );
}