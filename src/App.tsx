import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, CircleUserRound, ClipboardList, LayoutDashboard, LogIn, LogOut, Menu, Trophy, Users, X } from 'lucide-react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { initialAuthHash, supabase } from '@/lib/supabase';
import { FORGOT_PASSWORD_PATH, RESET_PASSWORD_PATH, parseRecoveryHash } from '@/lib/passwordRecovery';
import { LiveMiniPlayer } from '@/components/LiveMiniPlayer';
import { ConfirmProvider, ErrorBoundary, FBF_LOGO, PageFallback, ScrollToTop } from '@/components/site';
import { HomePage, NotFoundPage } from '@/pages/HomePage';

// Every page except the home page is split into its own chunk, so the first
// visit downloads only what it shows.
const CompetitionsPage = lazy(() => import('@/pages/CompetitionsPage').then((m) => ({ default: m.CompetitionsPage })));
const CompetitionDetailPage = lazy(() => import('@/pages/CompetitionDetailPage').then((m) => ({ default: m.CompetitionDetailPage })));
const TeamsPage = lazy(() => import('@/pages/TeamsPages').then((m) => ({ default: m.TeamsPage })));
const TeamDetailPage = lazy(() => import('@/pages/TeamsPages').then((m) => ({ default: m.TeamDetailPage })));
const PlayersPage = lazy(() => import('@/pages/PlayersPages').then((m) => ({ default: m.PlayersPage })));
const PlayerDetailPage = lazy(() => import('@/pages/PlayersPages').then((m) => ({ default: m.PlayerDetailPage })));
const StatsPage = lazy(() => import('@/pages/StatsPage').then((m) => ({ default: m.StatsPage })));
const MatchPage = lazy(() => import('@/pages/MatchPage').then((m) => ({ default: m.MatchPage })));
const LoginPage = lazy(() => import('@/pages/AccountPages').then((m) => ({ default: m.LoginPage })));
const DashboardPage = lazy(() => import('@/pages/AccountPages').then((m) => ({ default: m.DashboardPage })));
const ForgotPasswordPage = lazy(() => import('@/pages/PasswordPages').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/pages/PasswordPages').then((m) => ({ default: m.ResetPasswordPage })));

const navItems = [
  { label: 'Início', to: '/', icon: Trophy, end: true },
  { label: 'Competições', to: '/competicoes', icon: ClipboardList, end: false },
  { label: 'Times', to: '/times', icon: Users, end: false },
  { label: 'Jogadores', to: '/jogadores', icon: CircleUserRound, end: false },
  { label: 'Estatísticas', to: '/estatisticas', icon: BarChart3, end: false },
];

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ConfirmProvider>
          <AppShell />
        </ConfirmProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authActionError, setAuthActionError] = useState('');
  const { session, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isManager = Boolean(session && profile && (profile.role === 'ADMIN' || profile.role === 'ORGANIZER'));

  useEffect(() => setMobileOpen(false), [location.pathname]);
  // A recovery link that landed on another page (e.g. the site URL, when the
  // redirect address is not allowed) still opens the reset form.
  useEffect(() => {
    if (parseRecoveryHash(initialAuthHash).kind === 'recovery' && location.pathname !== RESET_PASSWORD_PATH) {
      navigate(RESET_PASSWORD_PATH, { replace: true });
    }
    // Only on the first render: the fragment is read once, when the site opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  async function signOut() {
    setAuthActionError('');
    const { error } = await supabase.auth.signOut();
    if (error) setAuthActionError('Não foi possível encerrar a sessão. Tente novamente.');
  }

  return (
    <div className="app-shell">
      <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>
      <ScrollToTop />
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="brand" aria-label="FBF, início">
            <img src={FBF_LOGO} alt="" className="brand-mark" width={40} height={40} />
            <span><strong>FBF</strong><small>Federação Brasileira de Futsal</small></span>
          </Link>
          <button type="button" className="mobile-toggle" onClick={() => setMobileOpen((open) => !open)} aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={mobileOpen} aria-controls="menu-principal">
            {mobileOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
          <nav id="menu-principal" className={`main-nav ${mobileOpen ? 'is-open' : ''}`} aria-label="Menu principal">
            {navItems.map(({ label, to, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <Icon size={16} /> {label}
              </NavLink>
            ))}
            {isManager && <NavLink to="/painel" className={({ isActive }) => `nav-link panel-link ${isActive ? 'active' : ''}`}><LayoutDashboard size={16} /> Painel</NavLink>}
            {session
              ? <button type="button" className="account-link" onClick={signOut}><LogOut size={16} /> Sair</button>
              : <Link to="/login" className="login-link"><LogIn size={16} /> Entrar</Link>}
            {authActionError && <span role="alert" className="admin-hint">{authActionError}</span>}
          </nav>
        </div>
      </header>
      <main id="conteudo" tabIndex={-1}>
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/competicoes" element={<CompetitionsPage />} />
              <Route path="/competicoes/:id" element={<CompetitionDetailPage />} />
              <Route path="/times" element={<TeamsPage />} />
              <Route path="/times/:id" element={<TeamDetailPage />} />
              <Route path="/jogadores" element={<PlayersPage />} />
              <Route path="/jogadores/:id" element={<PlayerDetailPage />} />
              <Route path="/estatisticas" element={<StatsPage />} />
              <Route path="/partidas/:id" element={<MatchPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/painel" element={<DashboardPage />} />
              <Route path={FORGOT_PASSWORD_PATH} element={<ForgotPasswordPage />} />
              <Route path={RESET_PASSWORD_PATH} element={<ResetPasswordPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <footer className="site-footer">
        <div className="container footer-inner">
          <div className="footer-brand"><img src={FBF_LOGO} alt="" width={22} height={22} /><strong>FBF</strong><span>Federação Brasileira de Futsal</span></div>
          <nav className="footer-nav" aria-label="Rodapé">
            {navItems.slice(1).map(({ label, to }) => <Link key={to} to={to}>{label}</Link>)}
          </nav>
          <span className="footer-copy">Competições, equipes e histórias do HaxBall brasileiro · © {new Date().getFullYear()} FBF</span>
        </div>
      </footer>
      <LiveMiniPlayer />
    </div>
  );
}

export default App;
