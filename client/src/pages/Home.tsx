import { Link } from 'react-router-dom';

const features = [
  {
    icon: '🏛️',
    title: 'Explore Universities',
    description: 'Browse top universities with rankings, programs, and acceptance rates all in one place.',
  },
  {
    icon: '🤖',
    title: 'AI Counselor',
    description: 'Get personalized advice from an AI trained on real admission data — available 24/7.',
  },
  {
    icon: '📋',
    title: 'Admission Requirements',
    description: 'Understand exactly what each program requires so you can build the strongest application.',
  },
  {
    icon: '🎯',
    title: 'Tailored Recommendations',
    description: 'Share your interests and goals, and the AI will suggest universities that fit you best.',
  },
];

export default function Home() {
  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-indigo-600 to-purple-700 text-white py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight mb-6">
            Your AI-Powered
            <br />
            Admission Counselor
          </h1>
          <p className="text-lg sm:text-xl text-indigo-100 mb-10 max-w-xl mx-auto">
            Navigate college admissions with confidence. Explore top universities, understand
            requirements, and get personalized guidance — all powered by AI.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/chat"
              className="bg-white text-indigo-700 font-semibold px-8 py-3 rounded-xl hover:bg-indigo-50 transition-colors text-base"
            >
              Chat with AI Counselor →
            </Link>
            <Link
              to="/universities"
              className="border border-white/50 text-white font-semibold px-8 py-3 rounded-xl hover:bg-white/10 transition-colors text-base"
            >
              Browse Universities
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
            Everything You Need to Get In
          </h2>
          <p className="text-center text-gray-500 mb-12 max-w-lg mx-auto">
            From research to recommendations, AdmitAI guides you through every step of the college
            application journey.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="flex flex-col items-center text-center p-6 rounded-2xl bg-gray-50 hover:bg-indigo-50 transition-colors"
              >
                <span className="text-4xl mb-4">{f.icon}</span>
                <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-600">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4 bg-indigo-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Ready to Find Your Perfect University?
          </h2>
          <p className="text-gray-600 mb-8">
            Ask our AI counselor anything — programs, requirements, deadlines, or just "where should I apply?"
          </p>
          <Link
            to="/chat"
            className="bg-indigo-600 text-white font-semibold px-8 py-3 rounded-xl hover:bg-indigo-700 transition-colors inline-block text-base"
          >
            Start Chatting →
          </Link>
        </div>
      </section>
    </div>
  );
}
