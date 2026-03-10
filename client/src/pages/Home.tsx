import { Link } from 'react-router-dom';

const features = [
  {
    icon: '📲',
    title: 'WhatsApp Lead Capture',
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
    price: '₹0',
    features: ['Up to 50 leads/month', 'Basic dashboard', 'WhatsApp AI auto-reply', 'Email notifications'],
  },
  {
    name: 'Advanced',
    price: '₹999',
    features: ['Up to 500 leads/month', 'Advanced analytics', 'Priority support', 'WhatsApp AI auto-reply', 'Conversation history'],
    popular: true,
  },
  {
    name: 'Pro',
    price: '₹2,499',
    features: ['Unlimited leads', 'Custom AI prompts', 'API access', 'Dedicated support', 'Team accounts'],
  },
];

export default function Home() {
  return (
    <div className="flex flex-col">

      {/* Hero */}
      <section className="bg-gradient-to-br from-indigo-600 to-purple-700 text-white py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <span className="inline-block bg-white/20 text-white text-xs font-semibold px-3 py-1 rounded-full mb-6 tracking-wide uppercase">
            AI-Powered Admission Assistant
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
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">Choose Your Plan</h2>
          <p className="text-center text-gray-500 mb-12 max-w-lg mx-auto">Start free, upgrade as you grow.</p>
          <div className="grid sm:grid-cols-3 gap-6">
            {plans.map((plan) => (
              <div key={plan.name}
                className={`rounded-2xl p-6 border flex flex-col ${plan.popular ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200' : 'border-gray-200 bg-white'}`}>
                {plan.popular && (
                  <span className="text-xs font-bold text-indigo-600 uppercase tracking-wide mb-2">⭐ Most Popular</span>
                )}
                <h3 className="text-xl font-bold text-gray-900">{plan.name}</h3>
                <p className="text-3xl font-extrabold text-gray-900 mt-2 mb-4">
                  {plan.price}<span className="text-sm font-normal text-gray-500">/month</span>
                </p>
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="text-sm text-gray-600 flex items-center gap-2">
                      <span className="text-green-500 font-bold">✓</span> {f}
                    </li>
                  ))}
                </ul>
                <Link to="/register"
                  className={`text-center py-2.5 rounded-xl text-sm font-semibold transition-colors ${plan.popular ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  Get Started
                </Link>
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
        <p className="font-semibold text-white mb-1">LeadCapture</p>
        <p>AI-powered admission assistant for institutes, coaching centers & universities.</p>
        <p className="mt-3 text-xs text-gray-600">© {new Date().getFullYear()} LeadCapture. All rights reserved.</p>
      </footer>
    </div>
  );
}
