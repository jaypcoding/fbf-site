import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Eye, EyeOff, Shield } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { shouldBlockOnProfile } from '@/lib/authProfile';
import { authErrorMessage } from '@/lib/authErrors';
import { FORGOT_PASSWORD_PATH } from '@/lib/passwordRecovery';
import { usePageTitle } from '@/lib/pageTitle';
import { EmptyState, LoadingCard } from '@/components/ui';
import { FBF_LOGO } from '@/components/site';
import { ThemeToggle } from '@/lib/theme';

// The admin panel is large and only managers use it: it loads on demand.
const AdminPanel = lazy(() => import('@/components/AdminPanel').then((module) => ({ default: module.AdminPanel })));
// "Gravação e validação da partida" (/painel?sumula=<match id>), also on demand.
const MatchReplayPanel = lazy(() => import('@/components/admin/MatchReplayPanel').then((module) => ({ default: module.MatchReplayPanel })));

export function LoginPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  usePageTitle(mode === 'login' ? 'Entrar' : 'Criar conta');

  if (session) {
    return (
      <section className="container auth-section">
        <div className="auth-card">
          <Check className="success-icon" />
          <h1>Você já está conectado</h1>
          <p>Acesse o painel para acompanhar as áreas disponíveis para sua conta.</p>
          <button type="button" className="button button-primary" onClick={() => navigate('/painel')}>Ir para o painel <ArrowRight size={17} /></button>
        </div>
      </section>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() } } });
    setBusy(false);
    if (result.error) {
      setMessage({ tone: 'error', text: authErrorMessage(result.error, mode) });
      return;
    }
    if (mode === 'login') {
      navigate('/painel');
    } else {
      setMessage({
        tone: 'success',
        text: result.data.session ? 'Conta criada. Você já pode acessar a plataforma.' : 'Conta criada. Confira seu e-mail para confirmar o cadastro antes de entrar.',
      });
    }
  }

  function switchMode() {
    setMode(mode === 'login' ? 'signup' : 'login');
    setMessage(null);
  }

  return (
    <section className="container auth-section">
      <div className="auth-card">
        <div className="auth-logo"><img src={FBF_LOGO} alt="Logo FBF" /></div>
        <span className="section-kicker">Área restrita</span>
        <h1>{mode === 'login' ? 'Bem-vindo de volta' : 'Criar uma conta'}</h1>
        <p>{mode === 'login' ? 'Entre para acompanhar sua área na plataforma FBF.' : 'Crie seu acesso para acompanhar novidades e competições.'}</p>
        <form onSubmit={submit}>
          {mode === 'signup' && <label>Nome<input value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" placeholder="Como devemos chamar você?" /></label>}
          <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" inputMode="email" placeholder="voce@email.com" /></label>
          <label>
            Senha
            <span className="password-field">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Mínimo de 6 caracteres" />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </span>
          </label>
          {mode === 'login' && <Link to={FORGOT_PASSWORD_PATH} className="forgot-password-link">Esqueci minha senha?</Link>}
          {message && <div className={`form-message${message.tone === 'success' ? ' is-success' : ''}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</div>}
          <button className="button button-primary full-width" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar na plataforma' : 'Criar minha conta'} <ArrowRight size={17} /></button>
        </form>
        <button type="button" className="switch-auth" onClick={switchMode}>{mode === 'login' ? 'Ainda não tenho uma conta' : 'Já tenho uma conta'}</button>
      </div>
    </section>
  );
}

export function DashboardPage() {
  const { session, loading, profile, profileLoading, profileError } = useAuth();
  const [params] = useSearchParams();
  const sheetMatch = params.get('sumula');
  usePageTitle(sheetMatch ? 'Súmula por gravação' : 'Painel');
  if (loading) return <section className="container auth-section"><LoadingCard /></section>;
  if (!session) {
    return (
      <section className="container auth-section">
        <div className="auth-card">
          <Shield className="success-icon" />
          <h1>Entre para acessar o painel</h1>
          <p>O painel é reservado para usuários autorizados pela FBF.</p>
          <Link to="/login" className="button button-primary">Fazer login <ArrowRight size={17} /></Link>
        </div>
      </section>
    );
  }
  if (shouldBlockOnProfile(profileLoading, Boolean(profile))) return <section className="container auth-section"><LoadingCard /></section>;
  if (profileError || !profile) return <section className="container auth-section"><EmptyState icon={<Shield />} title="Não foi possível confirmar seu perfil" description="As permissões não foram carregadas. Tente novamente mais tarde ou contate a administração da FBF." /></section>;
  const isManager = profile.role === 'ADMIN' || profile.role === 'ORGANIZER';
  if (!isManager) {
    return (
      <section className="container dashboard-section">
        <div className="dashboard-heading">
          <div><span className="section-kicker">Sua conta</span><h1>{profile.display_name || 'Sua conta'}</h1><p>Acompanhe seu acesso e as novidades da FBF.</p></div>
          <div className="dashboard-heading-actions"><ThemeToggle withLabel /><span className="role-badge">Visitante</span></div>
        </div>
        <div className="admin-empty">
          <div className="admin-empty-icon"><Shield /></div>
          <div><h2>Acesso de visualização</h2><p>Seu perfil pode acompanhar todas as informações públicas da plataforma. A gestão é reservada a administradores e organizadores.</p></div>
        </div>
      </section>
    );
  }
  if (sheetMatch && /^[0-9a-f-]{36}$/.test(sheetMatch)) {
    return <Suspense fallback={<section className="container dashboard-section"><LoadingCard /></section>}><section className="container dashboard-section"><MatchReplayPanel matchId={sheetMatch} /></section></Suspense>;
  }
  return <Suspense fallback={<section className="container dashboard-section"><LoadingCard /></section>}><AdminPanel profile={profile} /></Suspense>;
}
