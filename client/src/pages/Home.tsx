import { Link } from 'react-router-dom';

const features = [
  {
    icon: '📲',
    title: 'WhatsApp Lead Capture',
    description: 'Automatically capture every student inquiry that arrives on your institute\'s WhatsApp number.',
  },
  {
    icon: '⚡',
    title: 'Instant Auto-Reply',
    description: 'Send instant responses to students as soon as they message — no manual work needed.',
  },
  {
    icon: '📊',
    title: 'Lead Dashboard',
    description: 'View, filter, and manage all your leads in one place. Never miss a follow-up again.',
  },
  {
    icon: '🎯',
    title: 'Status Tracking',
    description: 'Track each lead from inquiry to conversion. Know exactly where every student stands.',
  },
];

const plans = [
  {
    name: 'Free',
    price: '₹0',
    features: ['Up to 50 leads/month', 'Basic dashboard', 'WhatsApp auto-reply'],
  },
  {
    name: 'Advance',
    price: '₹999',
    features: ['Up to 500 leads/month', 'Advanced analytics', 'Priority support', 'WhatsApp auto-reply'],
    popular: true,
  },
  {
    name: 'Pro',
    price: '₹2,499',
    features: ['Unlimited leads', 'Custom auto-replies', 'API access', 'Dedicated support', 'Team accounts'],
  },
];

export default function Home() {
  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-indigo-600 to-purple-700 text-white py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight mb-6">
            Capture Leads.
            <br />
            Respond Instantly.
          </h1>
          <p className="text-lg sm:text-xl text-indigo-100 mb-10 max-w-xl mx-auto">
            Help your institute, coaching center, or university capture WhatsApp inquiries
            automatically — respond instantly and never miss a lead again.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/register"
              className="bg-white text-indigo-700 font-semibold px-8 py-3 rounded-xl hover:bg-indigo-50 transition-colors text-base"
            >
              Register Your Institute →
            </Link>
            <Link
              to="/login"
              className="border border-white/50 text-white font-semibold px-8 py-3 rounded-xl hover:bg-white/10 transition-colors text-base"
            >
              Login to Dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
            How It Works
          </h2>
          <p className="text-center text-gray-500 mb-12 max-w-lg mx-auto">
            Three simple steps to automate your lead capture and never miss an inquiry.
          </p>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              { step: '1', title: 'Register', desc: 'Sign up with your institute details and WhatsApp number.' },
              { step: '2', title: 'Connect WhatsApp', desc: 'Link your WhatsApp Business number to start receiving leads.' },
              { step: '3', title: 'Capture & Respond', desc: 'Every student inquiry creates a lead and gets an instant reply.' },
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

      {/* Features Section */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
            Everything You Need to Manage Leads
          </h2>
          <p className="text-center text-gray-500 mb-12 max-w-lg mx-auto">
            From capture to conversion — manage your student inquiries efficiently.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="flex flex-col items-center text-center p-6 rounded-2xl bg-white hover:bg-indigo-50 transition-colors border border-gray-200"
              >
                <span className="text-4xl mb-4">{f.icon}</span>
                <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-600">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Plans Section */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
            Choose Your Plan
          </h2>
          <p className="text-center text-gray-500 mb-12 max-w-lg mx-auto">
            Start free, upgrade as you grow.
          </p>
          <div className="grid sm:grid-cols-3 gap-6">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl p-6 border ${
                  plan.popular
                    ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200'
                    : 'border-gray-200 bg-white'
                } flex flex-col`}
              >
                {plan.popular && (
                  <span className="text-xs font-bold text-indigo-600 uppercase tracking-wide mb-2">
                    Most Popular
                  </span>
                )}
                <h3 className="text-xl font-bold text-gray-900">{plan.name}</h3>
                <p className="text-3xl font-extrabold text-gray-900 mt-2 mb-4">
                  {plan.price}
                  <span className="text-sm font-normal text-gray-500">/month</span>
                </p>
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="text-sm text-gray-600 flex items-center gap-2">
                      <span className="text-green-500">✓</span> {f}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/register"
                  className={`text-center py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                    plan.popular
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Get Started
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4 bg-indigo-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Ready to Stop Missing Leads?
          </h2>
          <p className="text-gray-600 mb-8">
            Register your institute today and start capturing every WhatsApp inquiry automatically.
          </p>
          <Link
            to="/register"
            className="bg-indigo-600 text-white font-semibold px-8 py-3 rounded-xl hover:bg-indigo-700 transition-colors inline-block text-base"
          >
            Register Now →
          </Link>
        </div>
      </section>
    </div>
  );
}
