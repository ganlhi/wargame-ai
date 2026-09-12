/**
 * The slice of Google Identity Services the app uses: the OAuth 2.0 token
 * client, which hands a browser app a short-lived access token without any
 * server of its own. Loaded at runtime from accounts.google.com, so there is
 * no package to type it from.
 */
declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token?: string
    /** Lifetime in seconds. Documented as a string, occasionally a number. */
    expires_in?: string | number
    scope?: string
    error?: string
    error_description?: string
  }

  interface ClientConfigError {
    type: 'popup_failed_to_open' | 'popup_closed' | 'unknown' | string
    message?: string
  }

  interface OverridableTokenClientConfig {
    prompt?: '' | 'none' | 'consent' | 'select_account'
  }

  interface TokenClient {
    requestAccessToken(overrides?: OverridableTokenClientConfig): void
  }

  interface TokenClientConfig {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: ClientConfigError) => void
  }

  function initTokenClient(config: TokenClientConfig): TokenClient
  function revoke(accessToken: string, done?: () => void): void
}
