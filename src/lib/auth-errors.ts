// Allowlisted user-facing copy only. Never surface raw Auth responses or credentials.
export function authErrorMessage(error: unknown): string {
  const details = error as { code?: string; name?: string; status?: number } | null;
  switch (details?.code) {
    case 'invalid_credentials': return 'The email or password is incorrect. Please try again.';
    case 'user_already_exists':
    case 'email_exists': return 'An account with this email already exists. Please log in instead.';
    case 'email_not_confirmed': return 'Please confirm your email using the link in your inbox, then log in.';
    case 'weak_password': return 'Choose a stronger password. Use at least 8 characters with uppercase and lowercase letters, a number, and a symbol. Avoid common passwords.';
    case 'email_address_invalid':
    case 'validation_failed': return 'Check your email address and password, then try again.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit': return 'Too many attempts. Please wait a few minutes before trying again.';
    case 'signup_disabled':
    case 'email_provider_disabled': return 'Account access is temporarily unavailable. Please try again later.';
  }
  if (details?.status === 429) return 'Too many attempts. Please wait a few minutes before trying again.';
  if (details?.name === 'AuthRetryableFetchError' || details?.name === 'TypeError') {
    return 'We could not connect. Check your internet connection and try again.';
  }
  return 'We could not complete your request. Please try again in a moment.';
}
