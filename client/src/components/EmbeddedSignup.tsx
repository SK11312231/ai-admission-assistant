import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmbeddedSignupProps {
  instituteId: number;
  onConnected: (wabaId: string, phoneNumberId: string) => void;
  onDisconnected: () => void;
  isConnected: boolean;
  wabaId: string | null;
  phoneNumberId: string | null;
}

interface FBLoginResponse {
  authResponse?: {
    accessToken: string;
    userID: string;
    expiresIn: number;
    signedRequest: string;
  };
  status: 'connected' | 'not_authorized' | 'unknown';
}

interface WAEmbeddedSignupData {
  event: string;
  data?: {
    phone_number_id?: string;
    waba_id?: string;
  };
}

// Extend window for FB SDK
declare global {
  interface Window {
    fbAsyncInit: () => void;
    FB: {
      init: (config: object) => void;
      login: (callback: (response: FBLoginResponse) => void, options: object) => void;
      getAuthResponse: () => FBLoginResponse['authResponse'] | null;
    };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EmbeddedSignup({
  instituteId,
  onConnected,
  onDisconnected,
  isConnected,
  wabaId,
  phoneNumberId,
}: EmbeddedSignupProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);

  const pendingDataRef = useRef<{ waba_id: string; phone_number_id: string } | null>(null);

  const META_APP_ID = import.meta.env.VITE_META_APP_ID as string | undefined;

  // ── Load Facebook SDK ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!META_APP_ID) return;
    if (document.getElementById('facebook-jssdk')) { setSdkReady(true); return; }

    window.fbAsyncInit = () => {
      window.FB.init({
        appId: META_APP_ID,
        autoLogAppEvents: true,
        xfbml: true,
        version: 'v19.0',
      });
      setSdkReady(true);
      console.log('[EmbeddedSignup] FB SDK ready');
    };

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);

    return () => {
      // Don't remove — SDK is global
    };
  }, [META_APP_ID]);

  // ── Listen for postMessage from Meta Embedded Signup popup ──────────────────
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;

      try {
        const data = typeof event.data === 'string'
          ? JSON.parse(event.data) as WAEmbeddedSignupData
          : event.data as WAEmbeddedSignupData;

        if (data.event === 'WA_EMBEDDED_SIGNUP') {
          console.log('[EmbeddedSignup] postMessage received:', data);
          if (data.data?.waba_id && data.data?.phone_number_id) {
            pendingDataRef.current = {
              waba_id: data.data.waba_id,
              phone_number_id: data.data.phone_number_id,
            };
          }
        }
      } catch {
        // Non-JSON message, ignore
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // ── Save credentials to backend ─────────────────────────────────────────────
  const saveToBackend = async (wabaId: string, phoneNumberId: string, accessToken: string) => {
    const res = await fetch(apiUrl('/api/whatsapp/embedded-signup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        institute_id: instituteId,
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        access_token: accessToken,
      }),
    });

    const data = await res.json() as { success?: boolean; error?: string };
    if (!res.ok) throw new Error(data.error ?? 'Failed to save connection.');
    return data;
  };

  // ── Launch Embedded Signup ──────────────────────────────────────────────────
  const handleLaunchSignup = () => {
    if (!sdkReady || !window.FB) {
      setError('Facebook SDK not loaded yet. Please try again in a moment.');
      return;
    }

    setLoading(true);
    setError(null);
    pendingDataRef.current = null;

    window.FB.login(
      async (response: FBLoginResponse) => {
        if (response.authResponse) {
          const accessToken = response.authResponse.accessToken;
          console.log('[EmbeddedSignup] FB login success, access token received');

          // Wait briefly for postMessage to arrive
          await new Promise(resolve => setTimeout(resolve, 500));

          const pending = pendingDataRef.current;
          if (!pending) {
            setError('WhatsApp Business account details not received. Please try again and complete the full signup flow.');
            setLoading(false);
            return;
          }

          try {
            await saveToBackend(pending.waba_id, pending.phone_number_id, accessToken);
            setSuccess(true);
            onConnected(pending.waba_id, pending.phone_number_id);
            setTimeout(() => setSuccess(false), 4000);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
          }
        } else {
          // User cancelled or closed the popup
          console.log('[EmbeddedSignup] FB login cancelled or closed');
        }
        setLoading(false);
      },
      {
        scope: 'whatsapp_business_management,whatsapp_business_messaging',
        extras: {
          feature: 'whatsapp_embedded_signup',
          setup: {
            // Pre-fill can be added here if known
          },
        },
      },
    );
  };

  // ── Disconnect ──────────────────────────────────────────────────────────────
  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect WhatsApp Business API? Your bot will stop responding to messages.')) return;
    setDisconnecting(true);
    try {
      const res = await fetch(apiUrl(`/api/whatsapp/embedded-signup/${instituteId}`), { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to disconnect.');
      onDisconnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect.');
    } finally {
      setDisconnecting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!META_APP_ID) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
        <span className="font-semibold">⚠️ Setup Required:</span>{' '}
        Add <code className="bg-amber-100 px-1 rounded">VITE_META_APP_ID</code> to your{' '}
        <code className="bg-amber-100 px-1 rounded">.env</code> file to enable Meta Embedded Signup.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status banner */}
      {isConnected ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-xl flex-shrink-0">✅</div>
            <div>
              <p className="text-sm font-semibold text-green-800">WhatsApp Business API Connected</p>
              {wabaId && <p className="text-xs text-green-600 mt-0.5">WABA ID: <code className="bg-green-100 px-1 rounded">{wabaId}</code></p>}
              {phoneNumberId && <p className="text-xs text-green-600 mt-0.5">Phone Number ID: <code className="bg-green-100 px-1 rounded">{phoneNumberId}</code></p>}
            </div>
          </div>
          <button
            onClick={() => void handleDisconnect()}
            disabled={disconnecting}
            className="flex-shrink-0 text-xs text-red-500 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-xl flex-shrink-0">⚪</div>
          <div>
            <p className="text-sm font-semibold text-gray-700">Not Connected</p>
            <p className="text-xs text-gray-500 mt-0.5">Connect your WhatsApp Business Account to start receiving and replying to student messages.</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
          <span>🎉</span>
          <span><span className="font-semibold">Connected!</span> Your WhatsApp Business Account is now linked to InquiAI.</span>
        </div>
      )}

      {/* Connect button */}
      {!isConnected && (
        <button
          onClick={handleLaunchSignup}
          disabled={loading || !sdkReady}
          className="flex items-center gap-3 bg-[#25D366] hover:bg-[#1ebe5d] text-white font-semibold px-5 py-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Connecting…
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Connect with WhatsApp Business
            </>
          )}
        </button>
      )}

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
        <p className="text-xs font-semibold text-blue-700 mb-2">ℹ️ How this works</p>
        <ul className="space-y-1.5 text-xs text-blue-700">
          <li className="flex items-start gap-1.5">
            <span className="font-bold mt-0.5">1.</span>
            <span>Click the button above — a Meta popup opens</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="font-bold mt-0.5">2.</span>
            <span>Select or create your WhatsApp Business Account</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="font-bold mt-0.5">3.</span>
            <span>Grant the required permissions to InquiAI</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="font-bold mt-0.5">4.</span>
            <span>Your account is linked — AI replies go live instantly</span>
          </li>
        </ul>
        <p className="text-xs text-blue-500 mt-3">
          ⚠️ Requires Meta Business Verification to be approved on your Meta App before this flow is active in production.
        </p>
      </div>
    </div>
  );
}
