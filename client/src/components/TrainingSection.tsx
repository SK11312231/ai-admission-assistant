import { useState, useCallback, useRef } from 'react';
import { apiUrl } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrainingStatus {
  totalExamples: number;
  categoryBreakdown: Record<string, number>;
  hasProfile: boolean;
  profile: string | null;
  languageStyle: string | null;
  profileGeneratedAt: string | null;
  readyToUse: boolean;
}

interface ChatExample {
  id: number;
  student_message: string;
  owner_reply: string;
  category: string;
  is_approved: boolean;
  created_at: string;
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  fee_objection:  { label: 'Fee / Pricing',    color: 'bg-red-100 text-red-700' },
  booking:        { label: 'Booking',           color: 'bg-indigo-100 text-indigo-700' },
  placement:      { label: 'Placements',        color: 'bg-green-100 text-green-700' },
  course_details: { label: 'Course Details',    color: 'bg-blue-100 text-blue-700' },
  eligibility:    { label: 'Eligibility',       color: 'bg-yellow-100 text-yellow-700' },
  hesitation:     { label: 'Hesitation',        color: 'bg-orange-100 text-orange-700' },
  greeting:       { label: 'Greeting',          color: 'bg-teal-100 text-teal-700' },
  general:        { label: 'General',           color: 'bg-gray-100 text-gray-600' },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function TrainingSection({ instituteId }: { instituteId: number }) {
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [examples, setExamples] = useState<ChatExample[]>([]);
  const [totalExamples, setTotalExamples] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [activeTab, setActiveTab] = useState<'upload' | 'examples' | 'profile'>('upload');
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [generatingProfile, setGeneratingProfile] = useState(false);
  const [parseResult, setParseResult] = useState<{ extracted: number; stored: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedProfile, setExpandedProfile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // ── Load status ─────────────────────────────────────────────────────────────

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/training/${instituteId}/status`));
      const data = await res.json() as TrainingStatus;
      setStatus(data);
    } catch {
      setError('Failed to load training status.');
    } finally {
      setLoading(false);
    }
  }, [instituteId]);

  // Load status on first render when upload tab is active
  useState(() => { void loadStatus(); });

  // ── Load examples ───────────────────────────────────────────────────────────

  const loadExamples = useCallback(async (pg = 1, cat = 'all') => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), category: cat });
      const res = await fetch(apiUrl(`/api/training/${instituteId}/examples?${params}`));
      const data = await res.json() as {
        examples: ChatExample[];
        total: number;
        totalPages: number;
      };
      setExamples(data.examples);
      setTotalExamples(data.total);
      setTotalPages(data.totalPages);
    } catch {
      setError('Failed to load examples.');
    } finally {
      setLoading(false);
    }
  }, [instituteId]);

  // ── Parse uploaded text ─────────────────────────────────────────────────────

  const handleParse = async (text: string) => {
    if (!text.trim()) return;
    setParsing(true);
    setError(null);
    setParseResult(null);
    try {
      const res = await fetch(apiUrl(`/api/training/${instituteId}/parse`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatText: text }),
      });
      const data = await res.json() as { extracted?: number; stored?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Parse failed.');
      setParseResult({ extracted: data.extracted ?? 0, stored: data.stored ?? 0 });
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse chat.');
    } finally {
      setParsing(false);
    }
  };

  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.txt')) {
      setError('Please upload a .txt file. Export from WhatsApp using "Export Chat → Without Media".');
      return;
    }
    const text = await file.text();
    await handleParse(text);
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) await handleFile(file);
  }, []);

  // ── Generate personality profile ────────────────────────────────────────────

  const handleGenerateProfile = async () => {
    setGeneratingProfile(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/training/${instituteId}/generate-profile`), {
        method: 'POST',
      });
      const data = await res.json() as { profile?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Profile generation failed.');
      await loadStatus();
      setActiveTab('profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate profile.');
    } finally {
      setGeneratingProfile(false);
    }
  };

  // ── Delete / approve example ────────────────────────────────────────────────

  const handleDeleteExample = async (id: number) => {
    try {
      await fetch(apiUrl(`/api/training/${instituteId}/examples/${id}`), { method: 'DELETE' });
      setExamples(prev => prev.filter(e => e.id !== id));
      setTotalExamples(prev => prev - 1);
      await loadStatus();
    } catch {
      setError('Failed to delete example.');
    }
  };

  const handleToggleApproval = async (id: number, current: boolean) => {
    try {
      await fetch(apiUrl(`/api/training/${instituteId}/examples/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_approved: !current }),
      });
      setExamples(prev => prev.map(e => e.id === id ? { ...e, is_approved: !current } : e));
      await loadStatus();
    } catch {
      setError('Failed to update example.');
    }
  };

  // ── Reset all training data ─────────────────────────────────────────────────

  const handleReset = async () => {
    if (!confirm('This will delete ALL training examples and the personality profile. Are you sure?')) return;
    try {
      await fetch(apiUrl(`/api/training/${instituteId}/reset`), { method: 'DELETE' });
      setStatus(null);
      setExamples([]);
      setParseResult(null);
      await loadStatus();
    } catch {
      setError('Failed to reset training data.');
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const categoryBadge = (cat: string) => {
    const c = CATEGORY_LABELS[cat] ?? CATEGORY_LABELS.general;
    return (
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.color}`}>
        {c.label}
      </span>
    );
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">AI Training</h2>
          <p className="text-sm text-gray-500 mt-1">
            Train your AI to reply the way <em>you</em> do — using your own real WhatsApp conversations.
          </p>
        </div>
        {status && status.totalExamples > 0 && (
          <button
            onClick={handleReset}
            className="text-xs text-red-500 hover:text-red-700 font-medium"
          >
            Reset All Training Data
          </button>
        )}
      </div>

      {/* Status bar */}
      {status && (
        <div className={`rounded-xl border p-4 flex items-center gap-4 ${
          status.readyToUse
            ? 'bg-green-50 border-green-200'
            : 'bg-amber-50 border-amber-200'
        }`}>
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${status.readyToUse ? 'bg-green-500' : 'bg-amber-400'}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${status.readyToUse ? 'text-green-800' : 'text-amber-800'}`}>
              {status.readyToUse
                ? `✅ AI personalisation active — ${status.totalExamples} examples loaded`
                : status.totalExamples === 0
                ? 'No training data yet. Upload a WhatsApp chat export to get started.'
                : !status.hasProfile
                ? `${status.totalExamples} examples uploaded — generate your personality profile to activate AI personalisation.`
                : `${status.totalExamples} examples — need at least 5 to generate a profile.`}
            </p>
            {status.totalExamples > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.entries(status.categoryBreakdown).map(([cat, count]) => (
                  <span key={cat} className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_LABELS[cat]?.color ?? 'bg-gray-100 text-gray-600'}`}>
                    {CATEGORY_LABELS[cat]?.label ?? cat}: {count}
                  </span>
                ))}
              </div>
            )}
          </div>
          {status.totalExamples >= 5 && (
            <button
              onClick={() => void handleGenerateProfile()}
              disabled={generatingProfile}
              className="flex-shrink-0 bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {generatingProfile
                ? <span className="flex items-center gap-2"><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Analysing…</span>
                : status.hasProfile ? '🔄 Regenerate Profile' : '✨ Generate Profile'}
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {(['upload', 'examples', 'profile'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                if (tab === 'examples') void loadExamples(1, selectedCategory);
              }}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                activeTab === tab
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'examples' ? `Examples ${status?.totalExamples ? `(${status.totalExamples})` : ''}` : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Upload Tab ── */}
      {activeTab === 'upload' && (
        <div className="space-y-6">

          {/* Instructions */}
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-5">
            <h3 className="font-semibold text-indigo-900 mb-3">How to export your WhatsApp chats</h3>
            <ol className="space-y-2 text-sm text-indigo-800">
              <li className="flex gap-2"><span className="font-bold text-indigo-600 flex-shrink-0">1.</span>Open WhatsApp and go to a conversation with a student you successfully converted.</li>
              <li className="flex gap-2"><span className="font-bold text-indigo-600 flex-shrink-0">2.</span>Tap the three dots (⋮) → <strong>More</strong> → <strong>Export Chat</strong> → <strong>Without Media</strong></li>
              <li className="flex gap-2"><span className="font-bold text-indigo-600 flex-shrink-0">3.</span>Save or share the <code className="bg-indigo-100 px-1 rounded">.txt</code> file to yourself.</li>
              <li className="flex gap-2"><span className="font-bold text-indigo-600 flex-shrink-0">4.</span>Upload it here. Upload 10–30 chats for the best results.</li>
            </ol>
            <p className="text-xs text-indigo-600 mt-3 font-medium">
              💡 Tip: Choose chats where you successfully convinced a student — those contain your best objection handling and persuasion patterns.
            </p>
          </div>

          {/* Drop zone */}
          <div
            onDrop={e => { void handleDrop(e); }}
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-indigo-400 bg-indigo-50'
                : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50'
            }`}
          >
            <div className="text-4xl mb-3">📁</div>
            <p className="font-semibold text-gray-700">Drop your .txt file here</p>
            <p className="text-sm text-gray-500 mt-1">or click to browse</p>
            <p className="text-xs text-gray-400 mt-2">Only WhatsApp .txt exports are supported</p>
            <input
              ref={fileRef}
              type="file"
              accept=".txt"
              className="hidden"
              onChange={async e => {
                const file = e.target.files?.[0];
                if (file) await handleFile(file);
                e.target.value = '';
              }}
            />
          </div>

          {/* Parse result */}
          {parsing && (
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <span className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              Parsing your WhatsApp export and extracting conversation pairs…
            </div>
          )}

          {parseResult && !parsing && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="font-semibold text-green-800">✅ Chat uploaded successfully!</p>
              <p className="text-sm text-green-700 mt-1">
                Extracted <strong>{parseResult.extracted}</strong> conversation pairs and stored <strong>{parseResult.stored}</strong> examples.
              </p>
              <p className="text-xs text-green-600 mt-2">
                {(status?.totalExamples ?? 0) >= 5
                  ? 'You now have enough examples. Click "Generate Profile" above to activate AI personalisation.'
                  : `Upload ${5 - (status?.totalExamples ?? 0)} more examples to unlock profile generation.`}
              </p>
            </div>
          )}

          {/* Quick tips for what makes a good training chat */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: '✅', title: 'Best chats to upload', items: ['Conversations where student enrolled', 'Chats with fee objections you handled well', 'Booking conversations', 'Long multi-message conversations'] },
              { icon: '❌', title: 'Avoid uploading', items: ['Very short 2-3 message chats', 'Spam or irrelevant conversations', 'Chats with wrong information', 'Personal/non-admission conversations'] },
            ].map(tip => (
              <div key={tip.title} className="bg-gray-50 rounded-xl p-4">
                <h4 className="font-semibold text-gray-800 mb-2">{tip.icon} {tip.title}</h4>
                <ul className="space-y-1">
                  {tip.items.map(item => (
                    <li key={item} className="text-xs text-gray-600 flex gap-1.5">
                      <span className="flex-shrink-0 mt-0.5">•</span>{item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Examples Tab ── */}
      {activeTab === 'examples' && (
        <div className="space-y-4">
          {/* Category filter */}
          <div className="flex flex-wrap gap-2">
            {['all', ...Object.keys(CATEGORY_LABELS)].map(cat => (
              <button
                key={cat}
                onClick={() => {
                  setSelectedCategory(cat);
                  setPage(1);
                  void loadExamples(1, cat);
                }}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  selectedCategory === cat
                    ? 'bg-indigo-600 text-white'
                    : `${CATEGORY_LABELS[cat]?.color ?? 'bg-gray-100 text-gray-600'} opacity-80 hover:opacity-100`
                }`}
              >
                {cat === 'all' ? 'All' : CATEGORY_LABELS[cat]?.label ?? cat}
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex justify-center py-8">
              <span className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && examples.length === 0 && (
            <div className="text-center py-12 text-gray-500 text-sm">
              No examples yet. Upload a WhatsApp chat export from the Upload tab.
            </div>
          )}

          {/* Example cards */}
          <div className="space-y-3">
            {examples.map(ex => (
              <div
                key={ex.id}
                className={`rounded-xl border p-4 transition-opacity ${ex.is_approved ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-60'}`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {categoryBadge(ex.category)}
                    {!ex.is_approved && (
                      <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">Excluded</span>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => void handleToggleApproval(ex.id, ex.is_approved)}
                      className={`text-xs font-medium px-2 py-1 rounded-lg transition-colors ${
                        ex.is_approved
                          ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          : 'bg-green-100 text-green-700 hover:bg-green-200'
                      }`}
                    >
                      {ex.is_approved ? 'Exclude' : 'Include'}
                    </button>
                    <button
                      onClick={() => void handleDeleteExample(ex.id)}
                      className="text-xs font-medium px-2 py-1 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <span className="text-xs font-semibold text-gray-400 flex-shrink-0 w-16 pt-0.5">Student</span>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 flex-1">{ex.student_message}</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-xs font-semibold text-indigo-400 flex-shrink-0 w-16 pt-0.5">You</span>
                    <p className="text-sm text-gray-800 bg-indigo-50 rounded-lg px-3 py-2 flex-1">{ex.owner_reply}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-gray-500">{totalExamples} total examples</p>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => { const p = page - 1; setPage(p); void loadExamples(p, selectedCategory); }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                >← Prev</button>
                <span className="text-xs text-gray-600 px-2 py-1.5">Page {page} / {totalPages}</span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => { const p = page + 1; setPage(p); void loadExamples(p, selectedCategory); }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                >Next →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Profile Tab ── */}
      {activeTab === 'profile' && (
        <div className="space-y-4">
          {!status?.hasProfile ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">🧠</div>
              <p className="text-gray-700 font-semibold mb-2">No personality profile yet</p>
              <p className="text-sm text-gray-500 mb-6">
                {(status?.totalExamples ?? 0) < 5
                  ? `Upload at least ${5 - (status?.totalExamples ?? 0)} more conversation examples first.`
                  : 'You have enough examples. Click the button below to generate your profile.'}
              </p>
              {(status?.totalExamples ?? 0) >= 5 && (
                <button
                  onClick={() => void handleGenerateProfile()}
                  disabled={generatingProfile}
                  className="bg-indigo-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {generatingProfile
                    ? <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Analysing your chats…</span>
                    : '✨ Generate My Personality Profile'}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">Your Communication Profile</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Generated from {status.totalExamples} examples ·{' '}
                    Language: <span className="font-medium capitalize">{status.languageStyle ?? 'English'}</span>
                    {status.profileGeneratedAt && ` · ${new Date(status.profileGeneratedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                  </p>
                </div>
                <button
                  onClick={() => void handleGenerateProfile()}
                  disabled={generatingProfile}
                  className="text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {generatingProfile ? 'Regenerating…' : '🔄 Regenerate'}
                </button>
              </div>

              <div className={`bg-indigo-50 border border-indigo-100 rounded-xl p-5 ${!expandedProfile ? 'max-h-64 overflow-hidden relative' : ''}`}>
                <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans leading-relaxed">
                  {status.profile}
                </pre>
                {!expandedProfile && (
                  <div className="absolute bottom-0 inset-x-0 h-20 bg-gradient-to-t from-indigo-50 to-transparent rounded-b-xl" />
                )}
              </div>

              <button
                onClick={() => setExpandedProfile(prev => !prev)}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                {expandedProfile ? '▲ Show less' : '▼ Read full profile'}
              </button>

              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-green-800">✅ Profile active</p>
                <p className="text-xs text-green-700 mt-1">
                  Your AI is now using this profile on every reply. It will communicate in your tone,
                  handle objections the way you do, and speak in your language style.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
