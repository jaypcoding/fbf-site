import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Eye, EyeOff, KeyRound, Mail, ShieldAlert } from 'lucide-react';
import { initialAuthHash, supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import {
  FORGOT_PASSWORD_PATH,
  PASSWORD_MIN_LENGTH,
  newPasswordError,
  parseRecoveryHash,
  recoveryRedirectUrl,
  recoveryRequestMessage,
  updatePasswordError,
} from '@/lib/passwordRecovery';
import { LoadingCard } from '@/components/ui';
import { FBF_LOGO } from '@/components/site';

// Step 1: ask for the e-mail and send the recovery link. The answer is the
// same whether or not the address has an account.
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  usePageTitle('Recuperar senha');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: recoveryRedirectUrl(window.location.origin) });
    setBusy(false);
    setMessage(recoveryRequestMessage(error));
  }

  const sent = message?.tone === 'success';
  return (
    <section className="container auth-section">
      <div className="auth-card">
        <div className="auth-logo"><img src={FBF_LOGO} alt="Logo FBF" /></div>
        <span className="section-kicker">Recuperar acesso</span>
        <h1>Esqueceu sua senha?</h1>
        <p>Informe o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.</p>
        {sent ? (
          <div className="form-message is-success" role="status"><Mail size={15} /> {message.text}</div>
        ) : (
          <form onSubmit={submit}>
            <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" inputMode="email" placeholder="voce@email.com" /></label>
            {message && <div className="form-message" role="alert">{message.text}</div>}
            <button className="button button-primary full-width" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link de recuperação'} <ArrowRight size={17} /></button>
          </form>
        )}
        <Link to="/login" className="switch-auth">Voltar para o login</Link>
      </div>
    </section>
  );
}

type ResetState = 'checking' | 'ready' | 'expired' | 'invalid' | 'done';

// Step 2: the link from the e-mail. The form only opens for a recovery link
// that Supabase accepted; anything else explains what happened and offers a
// new link.
export function ResetPasswordPage() {
  // The fragment as the site opened; if it was empty (the link was opened in
  // a tab already showing the site), the current one.
  const link = useMemo(() => parseRecoveryHash(initialAuthHash || window.location.hash), []);
  const [state, setState] = useState<ResetState>('checking');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePageTitle('Redefinir senha');

  useEffect(() => {
    let active = true;
    if (link.kind === 'error') { setState(link.reason); return; }
    if (link.kind !== 'recovery') { setState('invalid'); return; }
    // getSession waits until Supabase has processed the link in the URL.
    supabase.auth.getSession().then(({ data }) => {
      if (active) setState(data.session ? 'ready' : 'invalid');
    });
    return () => { active = false; };
  }, [link]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = newPasswordError(password, confirmation);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setBusy(false);
      const outcome = updatePasswordError(err);
      if (outcome.kind === 'link-invalid') setState('invalid');
      else setError(outcome.text);
      return;
    }
    // The recovery session is closed: the new password is used to log in.
    await supabase.auth.signOut();
    setPassword('');
    setConfirmation('');
    setBusy(false);
    setState('done');
  }

  if (state === 'checking') return <section className="container auth-section"><LoadingCard /></section>;

  if (state === 'expired' || state === 'invalid') {
    return (
      <section className="container auth-section">
        <div className="auth-card">
          <ShieldAlert className="success-icon" />
          <h1>{state === 'expired' ? 'Este link expirou' : 'Link inválido'}</h1>
          <p>
            {state === 'expired'
              ? 'O link de recuperação expirou ou já foi usado. Solicite um novo link para redefinir sua senha.'
              : 'Este endereço não contém um link de recuperação válido. Use o link mais recente enviado para o seu e-mail ou solicite um novo.'}
          </p>
          <Link to={FORGOT_PASSWORD_PATH} className="button button-primary">Solicitar novo link <ArrowRight size={17} /></Link>
          <Link to="/login" className="switch-auth">Voltar para o login</Link>
        </div>
      </section>
    );
  }

  if (state === 'done') {
    return (
      <section className="container auth-section">
        <div className="auth-card">
          <Check className="success-icon" />
          <h1>Senha redefinida</h1>
          <p>Sua nova senha foi salva. Entre novamente usando a nova senha.</p>
          <Link to="/login" className="button button-primary">Ir para o login <ArrowRight size={17} /></Link>
        </div>
      </section>
    );
  }

  return (
    <section className="container auth-section">
      <div className="auth-card">
        <div className="auth-logo"><img src={FBF_LOGO} alt="Logo FBF" /></div>
        <span className="section-kicker">Recuperar acesso</span>
        <h1>Crie uma nova senha</h1>
        <p>Escolha uma senha com pelo menos {PASSWORD_MIN_LENGTH} caracteres.</p>
        <form onSubmit={submit} noValidate>
          <label>
            Nova senha
            <span className="password-field">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" placeholder={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres`} />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </span>
          </label>
          <label>
            Confirmar nova senha
            <input type={showPassword ? 'text' : 'password'} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required autoComplete="new-password" placeholder="Repita a nova senha" />
          </label>
          {error && <div className="form-message" role="alert">{error}</div>}
          <button className="button button-primary full-width" disabled={busy}><KeyRound size={16} /> {busy ? 'Salvando…' : 'Salvar nova senha'}</button>
        </form>
      </div>
    </section>
  );
}
