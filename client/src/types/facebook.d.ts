interface FBLoginOptions {
  config_id?: string;
  response_type?: string;
  override_default_response_type?: boolean;
  scope?: string;
  extras?: Record<string, unknown>;
}

interface FBAuthResponse {
  accessToken?: string;
  code?: string;
  userID?: string;
  expiresIn?: number;
  signedRequest?: string;
  grantedScopes?: string;
}

interface FBLoginResponse {
  authResponse: FBAuthResponse | null;
  status: 'connected' | 'not_authorized' | 'unknown';
}

interface FBStatic {
  init(params: {
    appId: string;
    autoLogAppEvents?: boolean;
    xfbml?: boolean;
    version: string;
  }): void;
  login(callback: (response: FBLoginResponse) => void, options?: FBLoginOptions): void;
}

declare global {
  interface Window {
    FB: FBStatic;
    fbAsyncInit: () => void;
  }
}

export {};
