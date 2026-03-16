import { useState, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PremiumFeature {
  id: string;
  icon: string;
  title: string;
  description: string;
  plan: 'advanced' | 'pro';
  badge?: string;
}

interface Props {
  plan: string;
  createdAt: string;           // ISO string from DB
  onUpgradeClick: () => void;  // opens the existing upgrade modal
}

// ── Premium features list ────────────────────────────────────────────────────

const FEATURES: PremiumFeature[] = [
  {
    id: 'analytics',
    icon: '📊',
    title: 'Analytics Dashboard',
    description: 'See exactly how many leads came in, when they peak, and your conversion rate over time.',
    plan: 'advanced',
  },
  {
    id: 'widget',
    icon: '💬',
    title: 'Website Chat Widget',
    description: 'Embed an AI-powered chat widget on your institute website. Capture leads directly from visitors.',
    plan: 'advanced',
    badge: 'Most Popular',
  },
  {
    id: 'training',
    icon: '🧠',
    title: 'AI Training (Your Style)',
    description: 'Upload your own WhatsApp chats so the AI learns to respond exactly the way you do.',
    plan: 'advanced',
    badge: 'New',
  },
  {
    id: 'followup',
    icon: '⚡',
    title: 'AI Follow-up Messages',
    description: 'Re-engage cold leads in one click. AI writes a personalised WhatsApp message based on their past conversation.',
    plan: 'advanced',
  },
  {
    id: 'multicampus',
    icon: '🏢',
    title: 'Multi-Campus Management',
    description: 'Manage multiple institute branches and campuses from a single dashboard.',
    plan: 'pro',
  },
  {
    id: 'team',
    icon: '👥',
    title: 'Team Accounts & Roles',
    description: 'Add counselors and staff with controlled access. Everyone gets their own login.',
    plan: 'pro',
  },
  {
    id: 'customprompt',
    icon: '🎛️',
    title: 'Custom AI Configuration',
    description: 'Fine-tune how the AI responds — set tone, language, restricted topics, and custom greetings.',
    plan: 'pro',
  },
  {
    id: 'api',
    icon: '🔌',
    title: 'API Access',
    description: 'Integrate InquiAI directly into your own CRM, website, or internal tools via REST API.',
    plan: 'pro',
  },
];

// ── Trial helpers ─────────────────────────────────────────────────────────────

function getTrialInfo(createdAt: string): { daysUsed: number; daysLeft: number; isExpired: boolean; percent: number } {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const daysUsed = Math.floor((now - created) / (1000 * 60 * 60 * 24));
  const daysLeft = Math.max(0, 30 - daysUsed);
  return {
    daysUsed,
    daysLeft,
    isExpired: daysUsed >= 30,
    percent: Math.min(100, Math.round((daysUsed / 30) * 100)),
  };
}

function isPaid(plan: string): boolean {
  return ['advanced', 'pro'].includes(plan.toLowerCase());
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PremiumSection({ plan, createdAt, onUpgradeClick }: Props) {
  const [selectedFeature, setSelectedFeature] = useState<PremiumFeature | null>(null);
  const trial = getTrialInfo(createdAt);
  const isUnlocked = isPaid(plan);
  const isLocked = !isUnlocked && trial.isExpired;

  const advancedFeatures = FEATURES.filter(f => f.plan === 'advanced');
  const proFeatures = FEATURES.filter(f => f.plan === 'pro');

  const handleFeatureClick = (feature: PremiumFeature) => {
    if (isLocked) {
      onUpgradeClick();
      return;
    }
    setSelectedFeature(prev => prev?.id === feature.id ? null : feature);
  };

  return (
    <div className="space-y-6 pb-6">

      {/* ── Trial / Plan Status Banner ─────────────────────────────────────── */}
      {!isUnlocked && (
        <div className={`rounded-2xl p-5 ${
          trial.isExpired
            ? 'bg-gradient-to-r from-red-50 to-orange-50 border border-red-200'
            : trial.daysLeft <= 7
            ? 'bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200'
            : 'bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100'
        }`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{trial.isExpired ? '🔒' : trial.daysLeft <= 7 ? '⚠️' : '🎁'}</span>
                <h3 className={`font-bold text-base ${
                  trial.isExpired ? 'text-red-800' : trial.daysLeft <= 7 ? 'text-amber-800' : 'text-indigo-800'
                }`}>
                  {trial.isExpired
                    ? 'Your 30-day free trial has ended'
                    : trial.daysLeft <= 7
                    ? `Only ${trial.daysLeft} day${trial.daysLeft !== 1 ? 's' : ''} left in your free trial`
                    : `Free trial — ${trial.daysLeft} days remaining`}
                </h3>
              </div>
              <p className={`text-sm ${
                trial.isExpired ? 'text-red-700' : trial.daysLeft <= 7 ? 'text-amber-700' : 'text-indigo-600'
              }`}>
                {trial.isExpired
                  ? 'Upgrade to Advanced or Pro to continue using premium features.'
                  : 'You have full access to all premium features during your trial. Upgrade anytime to keep access.'}
              </p>

              {/* Progress bar */}
              {!trial.isExpired && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Day {trial.daysUsed}</span>
                    <span>Day 30</span>
                  </div>
                  <div className="h-2 bg-white rounded-full overflow-hidden border border-gray-200">
                    <div
                      className={`h-full rounded-full transition-all ${
                        trial.daysLeft <= 7 ? 'bg-amber-400' : 'bg-indigo-500'
                      }`}
                      style={{ width: `${trial.percent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={onUpgradeClick}
              className={`flex-shrink-0 text-sm font-bold px-5 py-2.5 rounded-xl transition-colors ${
                trial.isExpired
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {trial.isExpired ? '🔓 Unlock Now' : '⭐ Upgrade'}
            </button>
          </div>
        </div>
      )}

      {/* ── Unlocked badge for paid plans ─────────────────────────────────── */}
      {isUnlocked && (
        <div className="rounded-2xl p-4 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-bold text-green-800 text-sm capitalize">
              {plan} Plan — All features unlocked
            </p>
            <p className="text-xs text-green-600 mt-0.5">
              You have full access to all features below.
            </p>
          </div>
        </div>
      )}

      {/* ── Advanced Plan Features ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-6 rounded-full bg-indigo-500" />
            <h3 className="font-bold text-gray-900 text-base">Advanced Plan Features</h3>
          </div>
          <span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1 rounded-full">
            ₹1,499/mo · Launching Soon
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {advancedFeatures.map(feature => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              isLocked={isLocked}
              isSelected={selectedFeature?.id === feature.id}
              onClick={() => handleFeatureClick(feature)}
              planColor="indigo"
            />
          ))}
        </div>
      </div>

      {/* ── Pro Plan Features ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-6 rounded-full bg-purple-500" />
            <h3 className="font-bold text-gray-900 text-base">Pro Plan Features</h3>
          </div>
          <span className="text-xs bg-purple-100 text-purple-700 font-bold px-2.5 py-1 rounded-full">
            ₹3,499/mo · Launching Soon
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {proFeatures.map(feature => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              isLocked={isLocked}
              isSelected={selectedFeature?.id === feature.id}
              onClick={() => handleFeatureClick(feature)}
              planColor="purple"
            />
          ))}
        </div>
      </div>

      {/* ── Locked overlay CTA (trial expired) ───────────────────────────── */}
      {isLocked && (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center bg-gray-50">
          <div className="text-4xl mb-3">🔒</div>
          <h3 className="font-bold text-gray-800 text-base mb-1">Premium Features Locked</h3>
          <p className="text-sm text-gray-500 mb-5 max-w-sm mx-auto">
            Your 30-day trial has ended. Upgrade to Advanced or Pro to unlock all the features above.
          </p>
          <button
            onClick={onUpgradeClick}
            className="bg-indigo-600 text-white font-bold px-8 py-3 rounded-xl hover:bg-indigo-700 transition-colors text-sm"
          >
            View Upgrade Options →
          </button>
        </div>
      )}

    </div>
  );
}

// ── Feature Card sub-component ────────────────────────────────────────────────

function FeatureCard({
  feature,
  isLocked,
  isSelected,
  onClick,
  planColor,
}: {
  feature: PremiumFeature;
  isLocked: boolean;
  isSelected: boolean;
  onClick: () => void;
  planColor: 'indigo' | 'purple';
}) {
  const colorMap = {
    indigo: {
      ring: 'ring-2 ring-indigo-300 border-indigo-300',
      bg: 'bg-indigo-50',
      badge: 'bg-indigo-100 text-indigo-700',
      lock: 'bg-indigo-50',
    },
    purple: {
      ring: 'ring-2 ring-purple-300 border-purple-300',
      bg: 'bg-purple-50',
      badge: 'bg-purple-100 text-purple-700',
      lock: 'bg-purple-50',
    },
  };
  const c = colorMap[planColor];

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border p-4 transition-all w-full ${
        isLocked
          ? `${c.lock} border-gray-200 cursor-pointer hover:border-gray-300 relative overflow-hidden`
          : isSelected
          ? `${c.bg} ${c.ring} shadow-sm`
          : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
      }`}
    >
      {/* Lock overlay */}
      {isLocked && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
          <span className="text-xs">🔒</span>
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${
          isLocked ? 'bg-gray-100 grayscale opacity-60' : isSelected ? c.bg : 'bg-gray-50'
        }`}>
          {feature.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`font-semibold text-sm ${isLocked ? 'text-gray-400' : 'text-gray-900'}`}>
              {feature.title}
            </span>
            {feature.badge && !isLocked && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${c.badge}`}>
                {feature.badge}
              </span>
            )}
          </div>
          <p className={`text-xs leading-relaxed ${isLocked ? 'text-gray-400' : 'text-gray-500'}`}>
            {feature.description}
          </p>
        </div>
      </div>
    </button>
  );
}
