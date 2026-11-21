export const COMPETITION_TABS = [
  'Visão geral',
  'Classificação',
  'Rodadas',
  'Times',
  'Artilharia',
  'Assistências',
  'Goleiros / CS',
] as const;

export type CompetitionTab = typeof COMPETITION_TABS[number];

const TAB_SLUGS: Record<CompetitionTab, string> = {
  'Visão geral': 'visao-geral',
  'Classificação': 'classificacao',
  'Rodadas': 'rodadas',
  'Times': 'times',
  'Artilharia': 'artilharia',
  'Assistências': 'assistencias',
  'Goleiros / CS': 'goleiros',
};

export const DEFAULT_COMPETITION_TAB: CompetitionTab = 'Visão geral';

/** URL slug (`?aba=`) for a competition tab. */
export function slugFromTab(tab: CompetitionTab): string {
  return TAB_SLUGS[tab];
}

// Old links (?aba=jogos) open the rounds tab, which replaced the matches list.
const LEGACY_SLUGS: Record<string, CompetitionTab> = { jogos: 'Rodadas' };

/** Tab for a `?aba=` value; unknown or missing values fall back to the overview. */
export function tabFromSlug(slug: string | null | undefined): CompetitionTab {
  if (slug && LEGACY_SLUGS[slug]) return LEGACY_SLUGS[slug];
  const match = COMPETITION_TABS.find((tab) => TAB_SLUGS[tab] === slug);
  return match ?? DEFAULT_COMPETITION_TAB;
}
