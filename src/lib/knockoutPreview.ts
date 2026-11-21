// Planned knockout of a "Grupos + Mata-mata" stage, shown to the public before
// the group stage ends (the real bracket is generated afterwards, from the
// standings). It uses the same bracket builder as the admin panel, with
// placeholders such as "1º do Grupo A" instead of teams, so the preview
// matches what the system will generate.
import { buildGroupKnockoutBracket, type GroupCrossoverMode, type KnockoutSlot } from './competitionFormats.ts';

export type KnockoutPreviewSeries = {
  label: string;
  home: string;
  away: string;
  legs: 1 | 2;
};
export type KnockoutPreviewRound = { label: string; series: KnockoutPreviewSeries[] };

export type KnockoutSettings = {
  qualifiers_per_group?: number;
  knockout_legs?: number;
  third_place?: boolean;
  group_crossing?: string;
};

export function knockoutRoundLabel(roundNumber: number, finalRound: number): string {
  const remaining = finalRound - roundNumber;
  if (remaining === 0) return 'Final';
  if (remaining === 1) return 'Semifinais';
  if (remaining === 2) return 'Quartas de final';
  if (remaining === 3) return 'Oitavas de final';
  return `Fase eliminatória ${roundNumber}`;
}

function seriesName(roundLabel: string, matchNumber: number, count: number): string {
  if (count === 1) return roundLabel;
  const singular = roundLabel === 'Semifinais' ? 'Semifinal' : roundLabel === 'Quartas de final' ? 'Quartas' : roundLabel === 'Oitavas de final' ? 'Oitavas' : roundLabel;
  return `${singular} ${matchNumber}`;
}

/** Returns null when the stage is not a group + knockout stage or the plan cannot be built. */
export function buildKnockoutPreview(groupNames: string[], settings: KnockoutSettings): { rounds: KnockoutPreviewRound[]; thirdPlace: KnockoutPreviewSeries | null } | null {
  const qualifiers = settings.qualifiers_per_group ?? 0;
  if (groupNames.length < 2 || qualifiers < 1) return null;
  const legs: 1 | 2 = settings.knockout_legs === 2 ? 2 : 1;
  const mode: GroupCrossoverMode = settings.group_crossing === 'DRAW' ? 'DRAW' : 'RANKED';
  if (mode === 'DRAW') return null; // drawn crossings are only known after the draw
  let plan;
  try {
    plan = buildGroupKnockoutBracket(
      groupNames.map((name) => ({ name, teamIds: Array.from({ length: qualifiers }, (_, i) => `${i + 1}º do ${name}`) })),
      qualifiers,
      legs,
      settings.third_place ?? false,
      mode,
    );
  } catch {
    return null;
  }
  const finalRound = plan.rounds.length;
  const names = new Map<string, string>();
  const rounds = plan.rounds.map((round, index) => {
    const label = knockoutRoundLabel(index + 1, finalRound);
    round.forEach((series) => names.set(series.key, seriesName(label, series.matchNumber, round.length)));
    return { label, series: round };
  });
  const describe = (slot: KnockoutSlot): string => {
    if (slot.kind === 'team') return slot.teamId;
    const source = names.get(slot.sourceKey) ?? slot.sourceKey;
    return `${slot.kind === 'winner' ? 'Vencedor' : 'Perdedor'} da ${source}`;
  };
  return {
    rounds: rounds.map((round) => ({
      label: round.label,
      series: round.series.map((series) => ({ label: names.get(series.key)!, home: describe(series.home), away: describe(series.away), legs: series.legs })),
    })),
    thirdPlace: plan.thirdPlace
      ? { label: 'Disputa do terceiro lugar', home: describe(plan.thirdPlace.home), away: describe(plan.thirdPlace.away), legs: plan.thirdPlace.legs }
      : null,
  };
}
