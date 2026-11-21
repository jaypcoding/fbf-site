// Planned knockout of a "Grupos + Mata-mata" stage, shown to the public before
// the group stage ends (the real bracket is generated afterwards, from the
// standings). It uses the same bracket builder as the admin panel, with
// placeholders such as "1º do Grupo A" instead of teams, so the preview
// matches what the system will generate.
import { applyKnockoutOptions, buildGroupKnockoutBracket, type GroupCrossoverMode, type KnockoutSlot } from './competitionFormats.ts';

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
  final_legs?: number;
  better_seed_hosts_second_leg?: boolean;
};

export function knockoutRoundLabel(roundNumber: number, finalRound: number): string {
  const remaining = finalRound - roundNumber;
  if (remaining === 0) return 'Final';
  if (remaining === 1) return 'Semifinais';
  if (remaining === 2) return 'Quartas de final';
  if (remaining === 3) return 'Oitavas de final';
  return `Fase eliminatória ${roundNumber}`;
}

/** "Semifinal 1", "Quartas 2", "Final"... for a series key such as R1M2 in a bracket with finalRound rounds. */
export function knockoutSeriesName(sourceKey: string, finalRound: number, seriesInRound: (round: number) => number): string {
  const match = /^R(\d+)M(\d+)$/.exec(sourceKey);
  if (!match) return sourceKey;
  const round = Number(match[1]);
  return seriesName(knockoutRoundLabel(round, finalRound), Number(match[2]), seriesInRound(round));
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
    plan = applyKnockoutOptions(buildGroupKnockoutBracket(
      groupNames.map((name) => ({ name, teamIds: Array.from({ length: qualifiers }, (_, i) => `${i + 1}º do ${name}`) })),
      qualifiers,
      legs,
      settings.third_place ?? false,
      mode,
    ), {
      finalLegs: settings.final_legs === 1 || settings.final_legs === 2 ? settings.final_legs : undefined,
      betterSeedHostsSecondLeg: settings.better_seed_hosts_second_leg === true,
    });
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
    const article = /^(Quartas|Oitavas)/.test(source) ? 'das' : 'da';
    return `${slot.kind === 'winner' ? 'Vencedor' : 'Perdedor'} ${article} ${source}`;
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
