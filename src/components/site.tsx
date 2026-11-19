/* eslint-disable react-refresh/only-export-components */
import { Component, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, ChevronRight, RefreshCw, Search, X } from 'lucide-react';
import type { Competition, Match } from '@/lib/supabase';
import { competitionStatusLabels, matchStatusLabels } from '@/lib/labels';
import { formatMatchDate } from '@/lib/format';
import { TeamLogo } from '@/components/ui';

export const FBF_LOGO = '/1389286770004463646.webp';

/* ------------------------------------------------------------------ */
/* Match card                                                           */
/* ------------------------------------------------------------------ */

function sideName(match: Match, side: 'home' | 'away') {
  const team = side === 'home' ? match.home_team : match.away_team;
  const source = side === 'home' ? match.home_source_outcome : match.away_source_outcome;
  if (team?.team?.name) return team.team.name;
  if (source) return source === 'WINNER' ? 'Aguardando vencedor' : 'Aguardando perdedor';
  return 'A definir';
}

export function MatchCard({ match, context }: { match: Match; context?: string }) {
  const homeName = sideName(match, 'home');
  const awayName = sideName(match, 'away');
  const hasScore = (match.status === 'FINISHED' || match.status === 'LIVE') && match.home_score !== null && match.away_score !== null;
  const roundLabel = [match.round?.stage_group?.name, match.round?.name].filter(Boolean).join(' · ');
  const homeWon = match.status === 'FINISHED' && hasScore && (match.home_score ?? 0) > (match.away_score ?? 0);
  const awayWon = match.status === 'FINISHED' && hasScore && (match.away_score ?? 0) > (match.home_score ?? 0);
  return (
    <Link to={`/partidas/${match.id}`} className={`match-card match-${match.status.toLowerCase()}`}>
      <div className="match-date">
        <span>{[context, roundLabel].filter(Boolean).join(' · ') || 'Partida'}</span>
        <span className={`match-status-tag tag-${match.status.toLowerCase()}`}>
          {match.status === 'LIVE' && <i aria-hidden="true" />}
          {match.status === 'SCHEDULED' ? formatMatchDate(match.scheduled_at) : matchStatusLabels[match.status]}
        </span>
      </div>
      <div className="match-teams">
        <div className={`match-team-side${homeWon ? ' is-winner' : ''}`}>
          <TeamLogo src={match.home_team?.team?.logo_url || null} name={homeName} size={30} />
          <span>{homeName}</span>
        </div>
        <div className="match-score-display" aria-label={hasScore ? `Placar ${match.home_score} a ${match.away_score}` : 'Sem placar'}>
          {hasScore ? <>{match.home_score}<small>×</small>{match.away_score}</> : <span className="match-vs">vs</span>}
        </div>
        <div className={`match-team-side${awayWon ? ' is-winner' : ''}`}>
          <span>{awayName}</span>
          <TeamLogo src={match.away_team?.team?.logo_url || null} name={awayName} size={30} />
        </div>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Competition grid                                                     */
/* ------------------------------------------------------------------ */

export function CompetitionGrid({ competitions }: { competitions: Competition[] }) {
  return (
    <div className="competition-grid">
      {competitions.map((competition) => (
        <Link to={`/competicoes/${competition.id}`} className="competition-card" key={competition.id}>
          <div className="card-top">
            <span className="category-label">{competition.category}</span>
            <span className={`status-dot status-${competition.status.toLowerCase()}`}><span />{competitionStatusLabels[competition.status]}</span>
          </div>
          <div className="card-symbol"><img src={FBF_LOGO} alt="" /></div>
          <h3>{competition.name}</h3>
          <p className="card-format">{competition.format}</p>
          <div className="card-bottom"><span>Ver jogos, tabela e estatísticas</span><ChevronRight size={17} /></div>
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Search field                                                         */
/* ------------------------------------------------------------------ */

export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return (
    <div className="search-field">
      <Search size={16} aria-hidden="true" />
      <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={label} />
      {value && <button type="button" onClick={() => onChange('')} aria-label="Limpar busca"><X size={14} /></button>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Routing helpers                                                      */
/* ------------------------------------------------------------------ */

// Scrolls to the top on page changes (not on ?aba= changes inside a page).
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [pathname]);
  return null;
}

export function PageFallback() {
  return <section className="container detail-section"><div className="loading-card"><div className="loader" /><span>Carregando…</span></div></section>;
}

type ErrorBoundaryState = { failed: boolean };

// Keeps a rendering error on one page from blanking the whole site, and recovers
// from stale chunks after a deploy (the old lazy file no longer exists).
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/dynamically imported module|Failed to fetch|Importing a module script failed/i.test(message)) {
      try {
        // At most one automatic reload per minute, so a real outage cannot loop.
        const last = Number(sessionStorage.getItem('fbf:chunk-reload') || 0);
        if (Date.now() - last > 60_000) {
          sessionStorage.setItem('fbf:chunk-reload', String(Date.now()));
          window.location.reload();
        }
      } catch {
        // Storage can be unavailable (private mode); the fallback UI still shows.
      }
    }
  }

  componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="container detail-section">
        <div className="empty-state">
          <div className="empty-icon"><AlertTriangle /></div>
          <h2>Algo deu errado nesta página</h2>
          <p>Recarregue a página. Se o problema continuar, volte mais tarde.</p>
          <button type="button" className="button button-dark" onClick={() => window.location.reload()}>Recarregar <RefreshCw size={16} /></button>
        </div>
      </section>
    );
  }
}

/* ------------------------------------------------------------------ */
/* Confirmation dialog                                                  */
/* ------------------------------------------------------------------ */

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: 'danger' | 'default';
};

type PendingConfirm = ConfirmOptions & { resolve: (value: boolean) => void };

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(
  async (options) => window.confirm(`${options.title}\n\n${options.message}`),
);

// In-page replacement for window.confirm: states the consequence, keeps focus
// inside the dialog and works the same on every browser.
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setPending({ ...options, resolve });
  }), []);

  const close = useCallback((value: boolean) => {
    setPending((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!pending) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    confirmButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div className="modal-backdrop" onClick={() => close(false)}>
          <div className="modal-card confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message" onClick={(event) => event.stopPropagation()}>
            <div className={`confirm-icon ${pending.tone === 'danger' ? 'is-danger' : ''}`}><AlertTriangle size={20} /></div>
            <h3 id="confirm-title">{pending.title}</h3>
            <p id="confirm-message">{pending.message}</p>
            <div className="confirm-actions">
              <button type="button" className="button button-outline" onClick={() => close(false)}>Cancelar</button>
              <button ref={confirmButton} type="button" className={`button ${pending.tone === 'danger' ? 'button-danger' : 'button-primary'}`} onClick={() => close(true)}>
                {pending.confirmLabel || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
