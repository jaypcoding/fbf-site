export const COMPETITION_TABS = [
  'Visão geral',
  'Classificação',
  'Jogos',
  'Times',
  'Artilharia',
  'Assistências',
  'Goleiros / CS',
] as const;

export type CompetitionTab = typeof COMPETITION_TABS[number];

const TAB_SLUGS: Record<CompetitionTab, string> = {
  'Visão geral': 'visao-geral',
  'Classificação': 'classificacao',
  'Jogos': 'jogos',
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

/** Tab for a `?aba=` value; unknown or missing values fall back to the overview. */
export function tabFromSlug(slug: string | null | undefined): CompetitionTab {
  const match = COMPETITION_TABS.find((tab) => TAB_SLUGS[tab] === slug);
  return match ?? DEFAULT_COMPETITION_TAB;
}
