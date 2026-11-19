import { useSearchParams } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import type { Competition } from '@/lib/supabase';
import { useCompetitions } from '@/lib/hooks';
import { usePageTitle } from '@/lib/pageTitle';
import { matchesSearch } from '@/lib/search';
import { EmptyState, LoadingCard, PageIntro } from '@/components/ui';
import { CompetitionGrid, SearchField } from '@/components/site';

const STATUS_FILTERS: { slug: string; label: string; statuses: Competition['status'][] | null }[] = [
  { slug: '', label: 'Todas', statuses: null },
  { slug: 'em-andamento', label: 'Em andamento', statuses: ['ACTIVE'] },
  { slug: 'proximas', label: 'Próximas', statuses: ['UPCOMING', 'REGISTRATION'] },
  { slug: 'finalizadas', label: 'Finalizadas', statuses: ['FINISHED'] },
  { slug: 'arquivadas', label: 'Arquivadas', statuses: ['CANCELLED'] },
];

export function CompetitionsPage() {
  usePageTitle('Competições');
  const { competitions, loading, error } = useCompetitions();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusSlug = searchParams.get('situacao') ?? '';
  const category = searchParams.get('categoria') ?? '';
  const query = searchParams.get('busca') ?? '';
  const statusFilter = STATUS_FILTERS.find((item) => item.slug === statusSlug) ?? STATUS_FILTERS[0];

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const categories = Array.from(new Set(competitions.map((competition) => competition.category))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  // Archived competitions only appear when that filter is chosen explicitly.
  const filtered = competitions.filter((competition) => {
    const statusMatches = statusFilter.statuses ? statusFilter.statuses.includes(competition.status) : competition.status !== 'CANCELLED';
    return statusMatches
      && (!category || competition.category === category)
      && matchesSearch(query, competition.name, competition.category, competition.format);
  });
  const hasArchived = competitions.some((competition) => competition.status === 'CANCELLED');

  return <>
    <PageIntro eyebrow="Calendário FBF" title="Competições" description="Acompanhe todas as competições e suas edições em um calendário único." />
    <section className="container listing-section">
      <div className="filter-bar">
        <div className="filter-tabs" role="group" aria-label="Filtrar por situação">
          {STATUS_FILTERS.filter((item) => item.slug !== 'arquivadas' || hasArchived).map((item) => (
            <button key={item.slug || 'todas'} type="button" onClick={() => setParam('situacao', item.slug)} className={statusFilter.slug === item.slug ? 'selected' : ''} aria-pressed={statusFilter.slug === item.slug}>{item.label}</button>
          ))}
        </div>
        <div className="filter-controls">
          <SearchField value={query} onChange={(value) => setParam('busca', value)} placeholder="Buscar competição" label="Buscar competição" />
          {categories.length > 1 && (
            <select value={category} onChange={(event) => setParam('categoria', event.target.value)} aria-label="Filtrar por categoria">
              <option value="">Todas as categorias</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          )}
        </div>
      </div>
      {loading ? <LoadingCard />
        : error ? <EmptyState icon={<Trophy />} title="Não foi possível carregar as competições" description="Tente novamente mais tarde." />
        : filtered.length ? <CompetitionGrid competitions={filtered} />
        : <EmptyState icon={<Trophy />} title="Nenhuma competição encontrada" description="Não há competições com esses filtros no momento." />}
    </section>
  </>;
}
