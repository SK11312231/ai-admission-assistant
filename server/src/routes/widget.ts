import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// ── GET /api/widget/:instituteId/info ────────────────────────────────────────
// Returns institute name for widget header (public, CORS-open)

router.get('/:instituteId/info', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { instituteId } = req.params;
  try {
    const result = await pool.query(
      `SELECT name, plan FROM institutes WHERE id = $1`,
      [Number(instituteId)],
    );
    const inst = result.rows[0] as { name: string; plan: string } | undefined;
    if (!inst) { res.status(404).json({ error: 'Institute not found.' }); return; }
    if (!['advanced', 'pro'].includes(inst.plan)) {
      res.status(403).json({ error: 'Widget not available on this plan.' }); return;
    }
    res.json({ name: inst.name });
  } catch (err) {
    console.error('Widget info error:', err);
    res.status(500).json({ error: 'Failed to fetch institute info.' });
  }
});

// ── GET /api/widget/:instituteId/widget.js ───────────────────────────────────
// Serves the self-contained embeddable chat widget script

router.get('/:instituteId/widget.js', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { instituteId } = req.params;

  try {
    const result = await pool.query(
      `SELECT name, plan FROM institutes WHERE id = $1`,
      [Number(instituteId)],
    );
    const inst = result.rows[0] as { name: string; plan: string } | undefined;

    if (!inst || !['advanced', 'pro'].includes(inst.plan)) {
      res.setHeader('Content-Type', 'application/javascript');
      res.send(`console.warn('[InquiAI] Chat widget requires an Advanced or Pro plan.');`);
      return;
    }

    const apiBase = process.env.API_BASE_URL ?? 'https://ai-admission-assistant-production.up.railway.app';
    const instituteName = inst.name.replace(/`/g, '\\`').replace(/\$/g, '\\$');

    const script = buildWidgetScript(Number(instituteId), instituteName, apiBase);

    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache
    res.send(script);
  } catch (err) {
    console.error('Widget script error:', err);
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`console.error('[InquiAI] Failed to load chat widget.');`);
  }
});

// ── Widget Script Builder ─────────────────────────────────────────────────────

function buildWidgetScript(instituteId: number, instituteName: string, apiBase: string): string {
  return `
(function () {
  'use strict';

  var INSTITUTE_ID = ${instituteId};
  var INSTITUTE_NAME = '${instituteName.replace(/'/g, "\\'")}';
  var API_BASE = '${apiBase}';
  var SESSION_KEY = 'inquiai_sid_' + INSTITUTE_ID;

  // Prevent double init
  if (window.__inquiaiLoaded) return;
  window.__inquiaiLoaded = true;

  // ── Session ID ────────────────────────────────────────────────────────────
  function getSessionId() {
    var sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = 'widget-' + INSTITUTE_ID + '-' + Math.random().toString(36).slice(2) + '-' + Date.now();
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  // ── Inject Styles ─────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = \`
    #inquiai-widget * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #inquiai-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 999999;
      width: 60px; height: 60px; border-radius: 50%;
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      border: none; cursor: pointer; box-shadow: 0 4px 20px rgba(79,70,229,0.45);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #inquiai-btn:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(79,70,229,0.55); }
    #inquiai-btn svg { width: 28px; height: 28px; fill: white; transition: opacity 0.2s; }
    #inquiai-panel {
      position: fixed; bottom: 96px; right: 24px; z-index: 999998;
      width: 360px; height: 520px; max-height: calc(100vh - 120px);
      background: #fff; border-radius: 20px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06);
      display: flex; flex-direction: column; overflow: hidden;
      transform: scale(0.92) translateY(12px); opacity: 0; pointer-events: none;
      transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease;
    }
    #inquiai-panel.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: all; }
    #inquiai-header {
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      padding: 16px 18px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
    }
    #inquiai-header-left { display: flex; align-items: center; gap: 10px; }
    #inquiai-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center;
      font-size: 18px; flex-shrink: 0;
    }
    #inquiai-header-text h4 { margin: 0; color: #fff; font-size: 14px; font-weight: 700; }
    #inquiai-header-text p { margin: 2px 0 0; color: rgba(255,255,255,0.75); font-size: 11px; }
    #inquiai-close {
      background: none; border: none; cursor: pointer; padding: 4px;
      color: rgba(255,255,255,0.8); font-size: 20px; line-height: 1; border-radius: 6px;
      transition: background 0.15s;
    }
    #inquiai-close:hover { background: rgba(255,255,255,0.15); }
    #inquiai-messages {
      flex: 1; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 10px;
      background: #f8f9fb;
    }
    #inquiai-messages::-webkit-scrollbar { width: 4px; }
    #inquiai-messages::-webkit-scrollbar-track { background: transparent; }
    #inquiai-messages::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
    .inquiai-msg { display: flex; flex-direction: column; max-width: 82%; }
    .inquiai-msg.user { align-self: flex-end; align-items: flex-end; }
    .inquiai-msg.bot { align-self: flex-start; align-items: flex-start; }
    .inquiai-bubble {
      padding: 10px 14px; border-radius: 18px; font-size: 13.5px; line-height: 1.5;
      word-break: break-word; white-space: pre-wrap;
    }
    .inquiai-msg.user .inquiai-bubble {
      background: #4f46e5; color: #fff; border-bottom-right-radius: 5px;
    }
    .inquiai-msg.bot .inquiai-bubble {
      background: #fff; color: #1f2937; border-bottom-left-radius: 5px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e5e7eb;
    }
    .inquiai-time { font-size: 10px; color: #9ca3af; margin-top: 3px; padding: 0 4px; }
    #inquiai-typing { display: flex; align-items: center; gap: 4px; padding: 10px 14px; }
    #inquiai-typing span {
      width: 7px; height: 7px; border-radius: 50%; background: #9ca3af;
      animation: inquiai-bounce 1.2s infinite;
    }
    #inquiai-typing span:nth-child(2) { animation-delay: 0.2s; }
    #inquiai-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes inquiai-bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.6; }
      30% { transform: translateY(-5px); opacity: 1; }
    }
    #inquiai-footer {
      padding: 12px 14px; border-top: 1px solid #e5e7eb; background: #fff;
      display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0;
    }
    #inquiai-input {
      flex: 1; border: 1.5px solid #e5e7eb; border-radius: 14px;
      padding: 9px 13px; font-size: 13px; resize: none; outline: none;
      max-height: 90px; min-height: 40px; line-height: 1.4; color: #1f2937;
      background: #f9fafb; transition: border-color 0.15s;
      font-family: inherit;
    }
    #inquiai-input:focus { border-color: #6366f1; background: #fff; }
    #inquiai-input::placeholder { color: #9ca3af; }
    #inquiai-send {
      width: 38px; height: 38px; border-radius: 50%; border: none; cursor: pointer; flex-shrink: 0;
      background: #4f46e5; color: white; display: flex; align-items: center; justify-content: center;
      transition: background 0.15s, transform 0.15s; padding: 0;
    }
    #inquiai-send:hover { background: #4338ca; transform: scale(1.06); }
    #inquiai-send:disabled { background: #c7d2fe; cursor: not-allowed; transform: none; }
    #inquiai-send svg { width: 16px; height: 16px; }
    #inquiai-powered {
      text-align: center; font-size: 10px; color: #c4c4c4; padding: 5px 0 2px;
      background: #fff; flex-shrink: 0;
    }
    #inquiai-powered a { color: #c4c4c4; text-decoration: none; }
    @media (max-width: 480px) {
      #inquiai-panel { width: calc(100vw - 24px); right: 12px; bottom: 86px; }
      #inquiai-btn { bottom: 16px; right: 16px; }
    }
  \`;
  document.head.appendChild(style);

  // ── Build DOM ─────────────────────────────────────────────────────────────
  var wrapper = document.createElement('div');
  wrapper.id = 'inquiai-widget';
  wrapper.innerHTML = \`
    <button id="inquiai-btn" aria-label="Chat with us">
      <svg id="inquiai-icon-chat" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
      </svg>
      <svg id="inquiai-icon-close" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="display:none">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
    </button>
    <div id="inquiai-panel" role="dialog" aria-label="Chat">
      <div id="inquiai-header">
        <div id="inquiai-header-left">
          <div id="inquiai-avatar">🎓</div>
          <div id="inquiai-header-text">
            <h4>\${INSTITUTE_NAME}</h4>
            <p>AI Admission Assistant · Usually replies instantly</p>
          </div>
        </div>
        <button id="inquiai-close" aria-label="Close chat">✕</button>
      </div>
      <div id="inquiai-messages"></div>
      <div id="inquiai-footer">
        <textarea id="inquiai-input" placeholder="Ask about admissions, courses, fees…" rows="1"></textarea>
        <button id="inquiai-send" aria-label="Send">
          <svg viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
      <div id="inquiai-powered">Powered by <a href="https://inquiai.com" target="_blank">InquiAI</a></div>
    </div>
  \`;
  document.body.appendChild(wrapper);

  // ── Elements ──────────────────────────────────────────────────────────────
  var btn     = document.getElementById('inquiai-btn');
  var panel   = document.getElementById('inquiai-panel');
  var msgs    = document.getElementById('inquiai-messages');
  var input   = document.getElementById('inquiai-input');
  var send    = document.getElementById('inquiai-send');
  var closeBtn = document.getElementById('inquiai-close');
  var iconChat  = document.getElementById('inquiai-icon-chat');
  var iconClose = document.getElementById('inquiai-icon-close');

  var isOpen = false;
  var isLoading = false;

  // ── Toggle panel ──────────────────────────────────────────────────────────
  function openPanel() {
    isOpen = true;
    panel.classList.add('open');
    iconChat.style.display = 'none';
    iconClose.style.display = 'block';
    if (msgs.children.length === 0) addWelcome();
    setTimeout(function() { input.focus(); }, 250);
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove('open');
    iconChat.style.display = 'block';
    iconClose.style.display = 'none';
  }

  btn.addEventListener('click', function() { isOpen ? closePanel() : openPanel(); });
  closeBtn.addEventListener('click', closePanel);

  // ── Welcome message ───────────────────────────────────────────────────────
  function addWelcome() {
    addBotMessage('Hi there! 👋 Welcome to ' + INSTITUTE_NAME + '. I can help you with admissions, courses, fees, and more. What would you like to know?');
  }

  // ── Render messages ───────────────────────────────────────────────────────
  function formatTime() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + ':' + (m < 10 ? '0' + m : m) + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  function addUserMessage(text) {
    var el = document.createElement('div');
    el.className = 'inquiai-msg user';
    el.innerHTML = '<div class="inquiai-bubble">' + escapeHtml(text) + '</div><span class="inquiai-time">' + formatTime() + '</span>';
    msgs.appendChild(el);
    scrollBottom();
  }

  function addBotMessage(text) {
    removeTyping();
    var el = document.createElement('div');
    el.className = 'inquiai-msg bot';
    el.innerHTML = '<div class="inquiai-bubble">' + escapeHtml(text) + '</div><span class="inquiai-time">' + formatTime() + '</span>';
    msgs.appendChild(el);
    scrollBottom();
  }

  function showTyping() {
    removeTyping();
    var el = document.createElement('div');
    el.className = 'inquiai-msg bot';
    el.id = 'inquiai-typing-wrap';
    el.innerHTML = '<div class="inquiai-bubble" style="padding:10px 14px;"><div id="inquiai-typing"><span></span><span></span><span></span></div></div>';
    msgs.appendChild(el);
    scrollBottom();
  }

  function removeTyping() {
    var t = document.getElementById('inquiai-typing-wrap');
    if (t) t.remove();
  }

  function scrollBottom() {
    msgs.scrollTop = msgs.scrollHeight;
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ── Send message ──────────────────────────────────────────────────────────
  function sendMessage() {
    var text = input.value.trim();
    if (!text || isLoading) return;

    addUserMessage(text);
    input.value = '';
    input.style.height = 'auto';
    isLoading = true;
    send.disabled = true;
    showTyping();

    fetch(API_BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        sessionId: getSessionId(),
        instituteId: INSTITUTE_ID,
      }),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      addBotMessage(data.reply || 'Sorry, I could not get a response. Please try again.');
    })
    .catch(function() {
      addBotMessage('Sorry, something went wrong. Please try again in a moment.');
    })
    .finally(function() {
      isLoading = false;
      send.disabled = false;
      input.focus();
    });
  }

  send.addEventListener('click', sendMessage);

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  input.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 90) + 'px';
  });

})();
`;
}

export default router;
