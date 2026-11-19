// Turns Supabase Auth errors into actionable messages without echoing raw
// server text to the visitor.
export type AuthErrorLike = { code?: string | null; message?: string | null; status?: number | null } | null | undefined;

export function authErrorMessage(error: AuthErrorLike, mode: 'login' | 'signup'): string {
  const code = error?.code ?? '';
  const message = (error?.message ?? '').toLowerCase();
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) return 'Confirme seu e-mail pelo link enviado antes de entrar.';
  if (code === 'user_already_exists' || code === 'email_exists' || message.includes('already registered')) return 'Já existe uma conta com este e-mail. Tente entrar.';
  if (code === 'weak_password' || message.includes('password should be')) return 'Escolha uma senha mais forte, com pelo menos 6 caracteres.';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error?.status === 429) return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';
  if (code === 'signup_disabled') return 'Novos cadastros estão temporariamente desativados.';
  return mode === 'login'
    ? 'Não foi possível entrar agora. Confira seus dados e tente novamente.'
    : 'Não foi possível criar a conta agora. Tente novamente em instantes.';
}
