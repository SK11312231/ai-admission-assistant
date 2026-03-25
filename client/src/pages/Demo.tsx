import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl } from '../lib/api';

const DEMO_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&display=swap');
  :root {
    --ink: #0f0e17; --indigo: #4f46e5; --violet: #7c3aed;
    --green: #10b981; --amber: #f59e0b; --muted: #6b7280;
    --border: #e5e7eb; --light: #f9fafb;
  }
  @keyframes fadeUp { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
  @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes slideIn { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)} }
  .demo-fade-up { animation: fadeUp 0.7s ease both; }
  .demo-delay-1 { animation-delay: 0.1s; }
  .demo-delay-2 { animation-delay: 0.2s; }
  .demo-delay-3 { animation-delay: 0.3s; }
  .demo-delay-4 { animation-delay: 0.4s; }
  .demo-chat-demo { animation: float 4s ease-in-out infinite; }
  .demo-msg { animation: slideIn 0.4s ease both; }
  .demo-typing span { animation: blink 1.2s infinite; }
  .demo-typing span:nth-child(2) { animation-delay: 0.2s; }
  .demo-typing span:nth-child(3) { animation-delay: 0.4s; }
  .demo-badge-dot { animation: blink 1.5s infinite; }
  .demo-feature-card { transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s; }
  .demo-feature-card:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(0,0,0,0.08); border-color: #c7d2fe; }
  .demo-btn-primary { transition: transform 0.2s, box-shadow 0.2s; }
  .demo-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(79,70,229,0.4); }
  .demo-plan-cta-primary { transition: background 0.2s; }
  .demo-plan-cta-primary:hover { background: #eef2ff; }
  .demo-plan-cta-secondary { transition: background 0.2s; }
  .demo-plan-cta-secondary:hover { background: var(--violet); }
  @media (max-width: 768px) {
    .demo-hero-inner { grid-template-columns: 1fr !important; }
    .demo-value-grid { grid-template-columns: 1fr !important; }
    .demo-step-arrow { display: none !important; }
    .demo-hero-stats { gap: 20px !important; }
  }
`;

export default function Demo() {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', institute: '', size: '', mobile: '', pilot: true });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const openModal = () => { setShowModal(true); setSuccess(false); setError(''); setForm({ name: '', institute: '', size: '', mobile: '', pilot: true }); };
  const closeModal = () => setShowModal(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const digits = form.mobile.replace(/\s/g, '');
    if (!form.name.trim()) { setError('Please enter your name.'); return; }
    if (!form.institute.trim()) { setError('Please enter your institute name.'); return; }
    if (!form.size) { setError('Please select institute size.'); return; }
    if (!/^[6-9]\d{9}$/.test(digits)) { setError('Please enter a valid 10-digit Indian mobile number.'); return; }
    setLoading(true);
    try {
      await fetch(apiUrl('/api/institutes/demo-request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, mobile: digits }),
      });
      setSuccess(true);
    } catch { /* non-fatal */ } finally { setLoading(false); }
  };

  return (
    <>
      <style>{DEMO_STYLES}</style>
      <div style={{ fontFamily: "'Sora', sans-serif", background: '#fff', color: 'var(--ink)', overflowX: 'hidden' }}>

        {/* ── Nav ── */}
        <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(16px)', borderBottom: '1px solid var(--border)', padding: '0 5%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>
            <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🎓</div>
            InquiAI
          </Link>
          <button onClick={openModal} className="demo-btn-primary" style={{ background: 'var(--indigo)', color: '#fff', padding: '9px 22px', borderRadius: 10, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(79,70,229,0.3)' }}>
            Get Free Demo →
          </button>
        </nav>

        {/* ── Hero ── */}
        <section style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', padding: '80px 5% 60px', background: 'linear-gradient(160deg,#faf9ff 0%,#f0efff 40%,#fdf4ff 100%)', position: 'relative', overflow: 'hidden' }}>
          <div className="demo-hero-inner" style={{ maxWidth: 1200, margin: '0 auto', width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
            <div>
              <div className="demo-fade-up" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#eef2ff', border: '1px solid #c7d2fe', color: 'var(--indigo)', fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 20, marginBottom: 24 }}>
                <span className="demo-badge-dot" style={{ width: 6, height: 6, background: 'var(--green)', borderRadius: '50%', display: 'inline-block' }} />
                Now available for coaching institutes across India
              </div>
              <h1 className="demo-fade-up demo-delay-1" style={{ fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(2.4rem,4vw,3.6rem)', lineHeight: 1.15, color: 'var(--ink)', marginBottom: 20 }}>
                Your institute's<br /><em style={{ fontStyle: 'italic', color: 'var(--indigo)' }}>AI admission</em><br />assistant — on WhatsApp
              </h1>
              <p className="demo-fade-up demo-delay-2" style={{ fontSize: '1.05rem', color: 'var(--muted)', lineHeight: 1.7, marginBottom: 36, maxWidth: 480 }}>
                Every student who messages your WhatsApp gets an instant, personalised reply — 24/7. No missed leads. No manual work. Just more admissions.
              </p>
              <div className="demo-fade-up demo-delay-3" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <button onClick={openModal} className="demo-btn-primary" style={{ background: 'linear-gradient(135deg,var(--indigo),var(--violet))', color: '#fff', padding: '14px 28px', borderRadius: 12, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(79,70,229,0.3)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  🚀 Start Free 30-Day Trial
                </button>
                <a href="#how-it-works" style={{ background: '#fff', color: 'var(--ink)', border: '1.5px solid var(--border)', padding: '14px 28px', borderRadius: 12, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
                  See how it works
                </a>
              </div>
              <div className="demo-fade-up demo-delay-4 demo-hero-stats" style={{ display: 'flex', gap: 32, marginTop: 40, paddingTop: 32, borderTop: '1px solid var(--border)' }}>
                {[['24/7', 'AI replies to students'], ['30s', 'Avg response time'], ['0%', 'Leads missed']].map(([val, lbl]) => (
                  <div key={val}><div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--ink)' }}>{val}</div><div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{lbl}</div></div>
                ))}
              </div>
            </div>

            {/* Chat Demo */}
            <div className="demo-fade-up demo-delay-3">
              <div className="demo-chat-demo" style={{ background: '#e5ddd5', borderRadius: 20, overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.15)', maxWidth: 340, margin: '0 auto' }}>
                <div style={{ background: '#075e54', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 40, height: 40, background: 'linear-gradient(135deg,var(--indigo),var(--violet))', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🎓</div>
                  <div><p style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>ABC Coaching Center</p><p style={{ color: '#acf7c1', fontSize: 11 }}>AI Assistant · Online</p></div>
                </div>
                <div style={{ padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { type: 'in', delay: '0.2s', text: 'Hello, I wanted to know about your JEE coaching fees and batches' },
                    { type: 'out', delay: '0.8s', text: 'Hi! Welcome to ABC Coaching 😊 We offer JEE Main & Advanced batches starting at ₹45,000/year. Our next batch starts April 1st. Would you like to know about our study material and mock test series too?', time: '✓✓ 10:32 AM' },
                    { type: 'in', delay: '1.4s', text: 'Yes, and do you have weekend batches?' },
                  ].map((msg, i) => (
                    <div key={i} className="demo-msg" style={{ animationDelay: msg.delay, maxWidth: '80%', padding: '9px 12px', borderRadius: msg.type === 'in' ? '0 8px 8px 8px' : '8px 0 8px 8px', fontSize: 13, lineHeight: 1.5, background: msg.type === 'in' ? '#fff' : '#dcf8c6', alignSelf: msg.type === 'in' ? 'flex-start' : 'flex-end' }}>
                      {msg.text}
                      {msg.time && <div style={{ fontSize: 10, color: '#aaa', marginTop: 3, textAlign: 'right' }}>{msg.time}</div>}
                    </div>
                  ))}
                  <div className="demo-typing" style={{ background: '#fff', padding: '10px 14px', borderRadius: '0 8px 8px 8px', display: 'inline-flex', gap: 4, alignItems: 'center', alignSelf: 'flex-start', animationDelay: '2s' }}>
                    {[0,1,2].map(i => <span key={i} style={{ width: 7, height: 7, background: '#aaa', borderRadius: '50%', display: 'inline-block' }} />)}
                  </div>
                </div>
              </div>
              <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 16 }}>↑ This is your AI responding to students — automatically</p>
            </div>
          </div>
        </section>

        {/* ── Problem ── */}
        <section style={{ padding: '90px 5%', background: 'var(--ink)' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'rgba(255,255,255,0.1)', color: '#a5b4fc', padding: '5px 12px', borderRadius: 20, marginBottom: 16 }}>The Problem</div>
            <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 'clamp(1.8rem,3vw,2.6rem)', color: '#fff', marginBottom: 14 }}>Coaching institutes lose admissions<br />every single day — here's why</h2>
            <p style={{ fontSize: '1rem', color: '#9ca3af', lineHeight: 1.7, maxWidth: 600, marginBottom: 48 }}>Students enquire on WhatsApp expecting instant replies. Most institutes can't keep up — and students move on.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 20 }}>
              {[
                ['😴', 'Enquiries at odd hours', 'Students message at 11pm, on Sundays, during holidays. Your staff isn\'t there. The student moves to the next institute.'],
                ['📱', 'One WhatsApp number, many enquiries', 'Managing dozens of student chats manually is exhausting. Important leads get buried or forgotten in the chat list.'],
                ['📋', 'No system to track leads', 'You don\'t know how many students enquired, who followed up, or who converted. All that data lives in your phone.'],
                ['🔄', 'Same questions, every day', '"What are your fees?" "When does the batch start?" "Do you have weekend classes?" Your staff answers these 20 times a day.'],
              ].map(([emoji, title, desc]) => (
                <div key={title as string} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '28px 24px' }}>
                  <div style={{ fontSize: 32, marginBottom: 16 }}>{emoji}</div>
                  <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
                  <p style={{ color: '#6b7280', fontSize: 13, lineHeight: 1.6 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How It Works ── */}
        <section id="how-it-works" style={{ padding: '90px 5%' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
            <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--indigo)', background: '#eef2ff', padding: '5px 12px', borderRadius: 20, marginBottom: 16 }}>How It Works</div>
            <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 'clamp(1.8rem,3vw,2.6rem)', marginBottom: 14 }}>Up and running in under 5 minutes</h2>
            <p style={{ fontSize: '1rem', color: 'var(--muted)', lineHeight: 1.7, maxWidth: 560, margin: '0 auto 56px' }}>No technical knowledge needed. No app to install. Just scan and go.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 32, position: 'relative' }}>
              {[
                ['1', 'Register your institute', 'Sign up with your institute name, email, and website. Our AI auto-generates your knowledge base.'],
                ['2', 'Connect your WhatsApp', 'Scan a QR code with your institute\'s WhatsApp. Takes less than 60 seconds. No new number needed.'],
                ['3', 'Add your course & fee details', 'Fill in your courses, fees, batch timings, and contact info. The AI uses this to answer student questions.'],
                ['4', 'Watch the leads come in', 'Every student who messages gets an instant AI reply. Every enquiry becomes a tracked lead in your dashboard.'],
              ].map(([num, title, desc], i, arr) => (
                <div key={num as string} style={{ textAlign: 'center', position: 'relative' }}>
                  <div style={{ width: 56, height: 56, background: 'linear-gradient(135deg,var(--indigo),var(--violet))', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 auto 20px', boxShadow: '0 8px 20px rgba(79,70,229,0.3)' }}>{num}</div>
                  <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
                  <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>{desc}</p>
                  {i < arr.length - 1 && <span className="demo-step-arrow" style={{ position: 'absolute', top: 28, right: -16, fontSize: 20, color: '#c7d2fe' }}>→</span>}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <section style={{ padding: '90px 5%', background: 'var(--light)' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--indigo)', background: '#eef2ff', padding: '5px 12px', borderRadius: 20, marginBottom: 16 }}>Features</div>
            <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 'clamp(1.8rem,3vw,2.6rem)', marginBottom: 14 }}>Everything your admission team needs</h2>
            <p style={{ fontSize: '1rem', color: 'var(--muted)', lineHeight: 1.7, maxWidth: 560, marginBottom: 56 }}>Built specifically for coaching institutes — not a generic chatbot.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
              {[
                ['🤖', 'AI Auto-Reply on WhatsApp', 'The AI replies to every student enquiry instantly using your own course and fee information. Replies in English and Hinglish.', '✓ 24/7 active'],
                ['📊', 'Lead Dashboard', 'Every WhatsApp enquiry becomes a lead card. View, filter, and manage all your leads in one place. Track from enquiry to conversion.', '✓ Real-time updates'],
                ['💬', 'Full Conversation History', 'See the complete WhatsApp chat thread for every student directly in your dashboard. No need to scroll through your phone.', '✓ All chats saved'],
                ['📅', 'Follow-up Management', 'Set follow-up dates, get email reminders when they\'re due, and send AI-generated personalised follow-up messages in one click.', '✓ Never miss a follow-up'],
                ['📈', 'Analytics Dashboard', 'See leads over time, peak enquiry hours, conversion rates, and week-on-week growth. Know exactly when students are most active.', '✓ Growth plan'],
                ['🧠', 'AI Training from Your Chats', 'Upload your past WhatsApp conversations and the AI learns to reply exactly like your best counselor — same tone, same style.', '✓ Growth plan'],
                ['📧', 'Email Notifications', 'Get notified instantly when a new lead arrives. Receive daily reminders for follow-ups due today. Never miss an important lead.', '✓ All plans'],
                ['🚫', 'Spam & Blocklist Protection', 'Automatically filters spam messages. Block specific numbers. Mark leads as lost to auto-block them from the AI reply system.', '✓ Built-in'],
                ['💬', 'Website Chat Widget', 'Embed an AI chat bubble on your institute website. Students can ask questions directly on your site — leads are captured automatically.', '✓ Growth plan'],
              ].map(([icon, title, desc, badge]) => (
                <div key={title as string} className="demo-feature-card" style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 18, padding: '32px 28px' }}>
                  <div style={{ width: 52, height: 52, background: '#eef2ff', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, marginBottom: 18 }}>{icon}</div>
                  <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
                  <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>{desc}</p>
                  <span style={{ display: 'inline-block', marginTop: 14, fontSize: 11, fontWeight: 600, color: 'var(--green)', background: '#ecfdf5', border: '1px solid #6ee7b7', padding: '3px 10px', borderRadius: 10 }}>{badge}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Value / ROI ── */}
        <section style={{ padding: '90px 5%' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--indigo)', background: '#eef2ff', padding: '5px 12px', borderRadius: 20, marginBottom: 16 }}>The Business Case</div>
            <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 'clamp(1.8rem,3vw,2.6rem)', marginBottom: 56 }}>What this means for your institute</h2>
            <div className="demo-value-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 20 }}>
                {[
                  ['Reply in 30 seconds, not 30 minutes', 'Students who get instant replies are 5x more likely to show up for a demo. Speed matters more than anything else in admissions.'],
                  ['Never lose a lead again', 'Every single WhatsApp enquiry is captured and tracked — whether it comes at 7am or 11pm. Your staff can focus on closing, not managing chats.'],
                  ['Save 2–3 hours of staff time daily', 'The AI handles all repetitive questions about fees, batches, and schedules. Your counselors only talk to serious, pre-qualified leads.'],
                  ['Know your numbers', 'For the first time, see exactly how many enquiries you get, when they peak, and what your conversion rate is. Make data-driven decisions.'],
                  ['Works with your existing number', 'No new SIM card, no new number. InquiAI works with the WhatsApp number you already share with students.'],
                ].map(([strong, text]) => (
                  <li key={strong as string} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ width: 28, height: 28, flexShrink: 0, background: '#ecfdf5', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, marginTop: 2 }}>✅</div>
                    <div><strong style={{ display: 'block', fontSize: 14, marginBottom: 3 }}>{strong}</strong><span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>{text}</span></div>
                  </li>
                ))}
              </ul>
              <div style={{ background: 'linear-gradient(135deg,var(--indigo) 0%,var(--violet) 100%)', borderRadius: 24, padding: '40px 36px', color: '#fff', textAlign: 'center' }}>
                <h3 style={{ fontFamily: "'DM Serif Display',serif", fontSize: '1.8rem', marginBottom: 8 }}>The math is simple</h3>
                <p style={{ color: '#c7d2fe', fontSize: 14, marginBottom: 32 }}>If InquiAI helps you convert just 2 extra students per month…</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  {[['₹30K+', 'Extra monthly revenue\n(avg. ₹15K/student)'], ['20x', 'Return on your\nInquiAI investment'], ['0', 'Missed leads\nafter hours'], ['30s', 'Average student\nresponse time']].map(([val, lbl]) => (
                    <div key={val as string} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: '20px 16px' }}>
                      <div style={{ fontSize: '2rem', fontWeight: 800 }}>{val}</div>
                      <div style={{ fontSize: 11, color: '#c7d2fe', marginTop: 4, whiteSpace: 'pre-line' }}>{lbl}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Use Cases ── */}
        <section style={{ padding: '90px 5%', background: 'var(--light)' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
            <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--indigo)', background: '#eef2ff', padding: '5px 12px', borderRadius: 20, marginBottom: 16 }}>Who It's For</div>
            <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 'clamp(1.8rem,3vw,2.6rem)', marginBottom: 14 }}>Perfect for any education business</h2>
            <p style={{ fontSize: '1rem', color: 'var(--muted)', lineHeight: 1.7, maxWidth: 560, margin: '0 auto 48px' }}>If students enquire on WhatsApp, InquiAI works for you.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20 }}>
              {[
                ['📚', 'JEE / NEET Coaching', 'Handle hundreds of enquiries during admission season without adding staff. AI answers batch timings, fees, faculty, and results.'],
                ['💻', 'IT & Skills Training', 'Explain your courses, certifications, and placement track record to every interested candidate — instantly and consistently.'],
                ['🎨', 'Arts, Music & Dance Academies', 'Share batch schedules, fee structures, and faculty details. Let parents book demo classes without calling your office.'],
                ['🏫', 'School Admission Offices', 'Manage admissions enquiries for new academic sessions. Answer common questions, collect parent info, and schedule visits.'],
                ['🗣️', 'Language & Spoken English', 'Explain your batch levels, schedules, and teaching methodology to prospective students at any hour.'],
                ['🏋️', 'Sports & Fitness Academies', 'Share membership plans, trial class options, and trainer details with every enquiry — automatically.'],
              ].map(([icon, title, desc]) => (
                <div key={title as string} style={{ background: '#fff', borderRadius: 18, padding: '28px 24px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 32, marginBottom: 16 }}>{icon}</div>
                  <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
                  <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pricing ── */}
        <section id="pricing" style={{ padding: '90px 5%' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
            <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--indigo)', background: '#eef2ff', padding: '5px 12px', borderRadius: 20, marginBottom: 16 }}>Pricing</div>
            <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 'clamp(1.8rem,3vw,2.6rem)', marginBottom: 14 }}>Simple, transparent pricing</h2>
            <p style={{ fontSize: '1rem', color: 'var(--muted)', marginBottom: 12 }}>14-day free trial on Starter. No credit card. No risk.</p>
            <span style={{ display: 'inline-block', background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 20, marginBottom: 56 }}>🎉 Annual plans save 2 months — pay 10, get 12</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 24, alignItems: 'start' }}>
              {[
                { badge: '14-Day Free Trial', name: 'Starter', amount: '₹2,499', period: 'per month · ₹24,990/year', popular: false, features: ['1 WhatsApp number', '500 AI responses / month', 'Up to 75 active leads tracked', 'Auto-reply & lead capture (24/7)', 'Basic dashboard & analytics', 'Email support'], cta: 'Start Free Trial →', ctaStyle: 'secondary' },
                { badge: 'Most Popular', name: 'Growth', amount: '₹3,999', period: 'per month · ₹39,990/year', popular: true, features: ['Up to 2 WhatsApp numbers', '2,000 AI responses / month', 'Unlimited active leads', 'AI Training (upload chat history)', 'Advanced analytics & conversion reports', 'Follow-up sequences (auto 2nd & 3rd)', 'Priority email support'], cta: 'Get Started →', ctaStyle: 'primary' },
                { badge: 'Full Power', name: 'Pro', amount: '₹8,999', period: 'per month · ₹89,990/year', popular: false, features: ['Unlimited WhatsApp numbers', 'Unlimited AI responses', 'Multi-branch management dashboard', 'Custom AI persona & tone training', 'Bulk broadcast messaging', 'Dedicated support + onboarding call'], cta: 'Get Started →', ctaStyle: 'secondary' },
              ].map(plan => (
                <div key={plan.name} style={{ borderRadius: 20, overflow: 'hidden', border: plan.popular ? '1.5px solid var(--indigo)' : '1.5px solid var(--border)', boxShadow: plan.popular ? '0 12px 40px rgba(79,70,229,0.15)' : undefined }}>
                  <div style={{ padding: '28px 28px 24px', background: plan.popular ? 'linear-gradient(135deg,var(--indigo),var(--violet))' : 'var(--light)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: 8, color: plan.popular ? '#c7d2fe' : 'var(--indigo)' }}>{plan.badge}</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: 6, color: plan.popular ? '#fff' : 'var(--ink)' }}>{plan.name}</div>
                    <div style={{ fontSize: '2.2rem', fontWeight: 800, color: plan.popular ? '#fff' : 'var(--ink)' }}>{plan.amount}</div>
                    <div style={{ fontSize: 13, color: plan.popular ? '#c7d2fe' : 'var(--muted)' }}>{plan.period}</div>
                  </div>
                  <div style={{ padding: '24px 28px', background: '#fff' }}>
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 0 }}>
                      {plan.features.map(f => (
                        <li key={f} style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'flex-start' }}>
                          <span style={{ color: 'var(--green)', fontWeight: 700, flexShrink: 0 }}>✓</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Link to={`/register?plan=${plan.name.toLowerCase()}`}
                      style={{ display: 'block', textAlign: 'center', marginTop: 24, padding: 13, borderRadius: 12, fontSize: 14, fontWeight: 600, textDecoration: 'none', background: plan.ctaStyle === 'primary' ? '#fff' : 'var(--indigo)', color: plan.ctaStyle === 'primary' ? 'var(--indigo)' : '#fff' }}
                      className={plan.ctaStyle === 'primary' ? 'demo-plan-cta-primary' : 'demo-plan-cta-secondary'}>
                      {plan.cta}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section id="contact" style={{ background: 'linear-gradient(135deg,var(--ink) 0%,#1e1b4b 100%)', textAlign: 'center', padding: '100px 5%', position: 'relative', overflow: 'hidden' }}>
          <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: 'clamp(2rem,4vw,3rem)', color: '#fff', marginBottom: 16 }}>Ready to stop missing leads?</h2>
          <p style={{ color: '#9ca3af', fontSize: '1rem', marginBottom: 36 }}>Book a free 15-minute call. We'll set up InquiAI for your institute live on the call.</p>
          <button onClick={openModal} className="demo-btn-primary" style={{ background: 'linear-gradient(135deg,var(--indigo),var(--violet))', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 15, padding: '16px 36px', borderRadius: 12, fontWeight: 600, boxShadow: '0 4px 20px rgba(79,70,229,0.3)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            📞 Schedule a Free Call →
          </button>
          <p style={{ marginTop: 20, fontSize: 12, color: '#4b5563' }}>
            Questions? Email <a href="mailto:support@inquiai.in" style={{ color: '#a5b4fc' }}>support@inquiai.in</a>
          </p>
        </section>

        {/* ── Footer (same as Home.tsx) ── */}
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

        {/* ── Schedule Call Modal ── */}
        {showModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
            <div style={{ background: '#fff', borderRadius: 24, width: '100%', maxWidth: 480, overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.3)', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
              <div style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', padding: '28px 32px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <h3 style={{ color: '#fff', fontSize: '1.2rem', fontWeight: 700 }}>📞 Schedule a Free Call</h3>
                  <button onClick={closeModal} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
                <p style={{ color: '#c7d2fe', fontSize: 14 }}>We'll set up InquiAI for your institute live on the call — takes just 15 minutes.</p>
              </div>

              <div style={{ padding: '28px 32px' }}>
                {success ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
                    <h4 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>Details Received!</h4>
                    <p style={{ color: 'var(--muted)', fontSize: 14 }}>We'll call you within 2 hours on <strong>{form.mobile}</strong> to set everything up.</p>
                    <button onClick={closeModal} style={{ marginTop: 24, background: 'var(--indigo)', color: '#fff', border: 'none', borderRadius: 12, padding: '10px 28px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Close</button>
                  </div>
                ) : (
                  <form onSubmit={(e) => void handleSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 13, padding: '10px 14px', borderRadius: 10 }}>⚠ {error}</div>}

                    {[
                      { id: 'name', label: 'Your Name', placeholder: 'e.g. Rajesh Sharma', type: 'text', key: 'name' as const },
                      { id: 'institute', label: 'Institute Name', placeholder: 'e.g. ABC Coaching Center', type: 'text', key: 'institute' as const },
                    ].map(field => (
                      <div key={field.id}>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{field.label} <span style={{ color: '#ef4444' }}>*</span></label>
                        <input type={field.type} value={form[field.key]} onChange={e => { setForm(f => ({ ...f, [field.key]: e.target.value })); setError(''); }}
                          placeholder={field.placeholder}
                          style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--border)', fontSize: 14, outline: 'none', boxSizing: 'border-box' as const }} />
                      </div>
                    ))}

                    <div>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Approx. Number of Students <span style={{ color: '#ef4444' }}>*</span></label>
                      <select value={form.size} onChange={e => { setForm(f => ({ ...f, size: e.target.value })); setError(''); }}
                        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--border)', fontSize: 14, background: '#fff', outline: 'none' }}>
                        <option value="">Select institute size</option>
                        <option value="1–50 students">1–50 students</option>
                        <option value="51–200 students">51–200 students</option>
                        <option value="201–500 students">201–500 students</option>
                        <option value="500+ students">500+ students</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Mobile Number <span style={{ color: '#ef4444' }}>*</span></label>
                      <input type="tel" value={form.mobile} onChange={e => { setForm(f => ({ ...f, mobile: e.target.value })); setError(''); }}
                        placeholder="e.g. 9876543210" maxLength={10}
                        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--border)', fontSize: 14, outline: 'none', boxSizing: 'border-box' as const }} />
                    </div>

                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.pilot} onChange={e => setForm(f => ({ ...f, pilot: e.target.checked }))}
                        style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--indigo)' }} />
                      <span style={{ fontSize: 13, color: 'var(--muted)' }}>Yes, I'm interested in a <strong style={{ color: 'var(--ink)' }}>free pilot trial</strong> for my institute</span>
                    </label>

                    <button type="submit" disabled={loading}
                      style={{ width: '100%', background: 'linear-gradient(135deg,var(--indigo),var(--violet))', color: '#fff', border: 'none', borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      {loading ? <><span style={{ width: 16, height: 16, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />Sending…</> : '📲 Send My Details →'}
                    </button>
                    <p style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>We'll reach out within 2 hours on WhatsApp</p>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}