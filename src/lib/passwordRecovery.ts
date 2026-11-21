// Password recovery ("Esqueci minha senha") with Supabase Auth.
//
// The e-mail link opens /redefinir-senha with the result in the URL fragment:
//   #access_token=...&type=recovery...   valid link (Supabase creates a session)
//   #error=access_denied&error_code=otp_expired...   expired or used link
// Supabase JS reads and clears that fragment while it starts, so supabase.ts
// keeps a copy of the fragment as it was when the page loaded. The reset form
// only opens when that copy says "recovery" AND Supabase accepted the token.
// Nothing here logs or stores passwords or tokens.

export const PASSWORD_MIN_LENGTH = 8;
// bcrypt, used by Supabase Auth, only considers the first 72 bytes.
export const PASSWORD_MAX_BYTES = 72;
export const RESET_PASSWORD_PATH = '/redefinir-senha';
export const FORGOT_PASSWORD_PATH = '/recuperar-senha';

export type RecoveryLink =
  | { kind: 'recovery' }
  | { kind: 'error'; reason: 'expired' | 'invalid' }
  | { kind: 'none' };

export function parseRecoveryHash(hash: string | null | undefined): RecoveryLink {
  const params = new URLSearchParams((hash ?? '').replace(/^#/, ''));
  if (params.has('error') || params.has('error_code')) {
    return { kind: 'error', reason: params.get('error_code') === 'otp_expired' ? 'expired' : 'invalid' };
  }
  if (params.get('type') === 'recovery' && params.get('access_token')) return { kind: 'recovery' };
  return { kind: 'none' };
}

export function recoveryRedirectUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${RESET_PASSWORD_PATH}`;
}

export function newPasswordError(password: string, confirmation: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `A nova senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return 'A nova senha é longa demais. Use até 72 caracteres simples.';
  if (password.trim().length === 0) return 'A nova senha não pode conter apenas espaços.';
  if (password !== confirmation) return 'As senhas não coincidem.';
  return null;
}

type AuthErrorLike = { code?: string | null; message?: string | null; status?: number | null; name?: string | null } | null | undefined;

const isRateLimit = (error: AuthErrorLike) =>
  error?.code === 'over_email_send_rate_limit' || error?.code === 'over_request_rate_limit' || error?.status === 429;

// The answer to a reset request never says whether the e-mail has an account:
// success and every error (unknown address, address not allowed by the mail
// provider, ...) show the same text. Only "too many attempts" differs, and it
// depends on the requests made, not on the account.
export const RECOVERY_REQUEST_SENT =
  'Se existir uma conta com este e-mail, enviaremos em instantes um link para redefinir a senha. Confira também a caixa de spam. O link vale por tempo limitado e só pode ser usado uma vez.';

export function recoveryRequestMessage(error: AuthErrorLike): { tone: 'success' | 'error'; text: string } {
  if (isRateLimit(error)) return { tone: 'error', text: 'Muitas solicitações seguidas. Aguarde alguns minutos e tente novamente.' };
  return { tone: 'success', text: RECOVERY_REQUEST_SENT };
}

export type UpdatePasswordOutcome = { kind: 'retry'; text: string } | { kind: 'link-invalid' };

export function updatePasswordError(error: AuthErrorLike): UpdatePasswordOutcome {
  const code = error?.code ?? '';
  const message = (error?.message ?? '').toLowerCase();
  if (code === 'same_password' || message.includes('different from the old password')) {
    return { kind: 'retry', text: 'A nova senha precisa ser diferente da senha atual.' };
  }
  if (code === 'weak_password' || message.includes('password should be')) {
    return { kind: 'retry', text: `Escolha uma senha mais forte, com pelo menos ${PASSWORD_MIN_LENGTH} caracteres.` };
  }
  if (isRateLimit(error)) return { kind: 'retry', text: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.' };
  if (code === 'session_not_found' || code === 'session_expired' || code === 'bad_jwt' || error?.name === 'AuthSessionMissingError'
    || error?.status === 401 || error?.status === 403) {
    return { kind: 'link-invalid' };
  }
  return { kind: 'retry', text: 'Não foi possível salvar a nova senha agora. Tente novamente em instantes.' };
}
