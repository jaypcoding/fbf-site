import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKnockoutPreview, knockoutRoundLabel } from '../src/lib/knockoutPreview.ts';

const ASPIRANTES = { group_count: 2, group_legs: 2, knockout_legs: 2, final_legs: 1, better_seed_hosts_second_leg: true, qualifiers_per_group: 2, group_crossing: 'RANKED', third_place: false };

test('ASPIRANTES: two-legged semifinals with the better-placed team at home in the second leg, single-match final, no third place', () => {
  const preview = buildKnockoutPreview(['Grupo A', 'Grupo B'], ASPIRANTES);
  assert.deepEqual(preview, {
    rounds: [
      { label: 'Semifinais', series: [
        { label: 'Semifinal 1', home: '2º do Grupo B', away: '1º do Grupo A', legs: 2 },
        { label: 'Semifinal 2', home: '2º do Grupo A', away: '1º do Grupo B', legs: 2 },
      ] },
      { label: 'Final', series: [{ label: 'Final', home: 'Vencedor da Semifinal 1', away: 'Vencedor da Semifinal 2', legs: 1 }] },
    ],
    thirdPlace: null,
  });
});

test('without the new options the plan is the previous one (first leg at the better-placed team, final like the other ties)', () => {
  const preview = buildKnockoutPreview(['Grupo A', 'Grupo B'], { qualifiers_per_group: 2, knockout_legs: 2, group_crossing: 'RANKED', third_place: true });
  assert.deepEqual(preview.rounds[0].series.map((s) => `${s.home} x ${s.away}`), ['1º do Grupo A x 2º do Grupo B', '1º do Grupo B x 2º do Grupo A']);
  assert.equal(preview.rounds[1].series[0].legs, 2);
  assert.equal(preview.thirdPlace.label, 'Disputa do terceiro lugar');
});

test('four groups with two qualifiers: quarterfinals cross first and second placed teams of different groups', () => {
  const preview = buildKnockoutPreview(['Grupo A', 'Grupo B', 'Grupo C', 'Grupo D'], { qualifiers_per_group: 2, knockout_legs: 2, group_crossing: 'RANKED', third_place: false });
  assert.equal(preview.rounds.length, 3);
  assert.deepEqual(preview.rounds.map((r) => r.label), ['Quartas de final', 'Semifinais', 'Final']);
  for (const series of preview.rounds[0].series) {
    assert.match(series.home, /^1º do Grupo [A-D]$/);
    assert.match(series.away, /^2º do Grupo [A-D]$/);
    assert.notEqual(series.home.slice(-1), series.away.slice(-1), 'never two teams of the same group');
  }
  assert.equal(preview.thirdPlace, null);
});

test('no preview when it cannot be known in advance or the stage is not configured', () => {
  assert.equal(buildKnockoutPreview(['Grupo A', 'Grupo B'], { ...ASPIRANTES, group_crossing: 'DRAW' }), null);
  assert.equal(buildKnockoutPreview(['Grupo A'], ASPIRANTES), null);
  assert.equal(buildKnockoutPreview(['Grupo A', 'Grupo B'], { knockout_legs: 2 }), null);
});

test('round labels', () => {
  assert.equal(knockoutRoundLabel(2, 2), 'Final');
  assert.equal(knockoutRoundLabel(1, 2), 'Semifinais');
  assert.equal(knockoutRoundLabel(1, 3), 'Quartas de final');
  assert.equal(knockoutRoundLabel(1, 4), 'Oitavas de final');
});

test('PRINCIPAL (current settings): quarterfinals as generated today (1ºA x 2ºB, 1ºB x 2ºA, 1ºC x 2ºD, 1ºD x 2ºC), two legs, no third place', () => {
  const preview = buildKnockoutPreview(['Grupo A', 'Grupo B', 'Grupo C', 'Grupo D'], { group_count: 4, group_legs: 2, knockout_legs: 2, qualifiers_per_group: 2, group_crossing: 'RANKED', third_place: false });
  assert.deepEqual(preview.rounds[0].series.map((s) => `${s.label}: ${s.home} x ${s.away} (${s.legs})`), [
    'Quartas 1: 1º do Grupo A x 2º do Grupo B (2)',
    'Quartas 2: 1º do Grupo B x 2º do Grupo A (2)',
    'Quartas 3: 1º do Grupo C x 2º do Grupo D (2)',
    'Quartas 4: 1º do Grupo D x 2º do Grupo C (2)',
  ]);
  assert.deepEqual(preview.rounds.map((r) => r.label), ['Quartas de final', 'Semifinais', 'Final']);
  assert.equal(preview.thirdPlace, null);
});

test('sources use the right article', () => {
  const preview = buildKnockoutPreview(['Grupo A', 'Grupo B', 'Grupo C', 'Grupo D'], { qualifiers_per_group: 2, knockout_legs: 1, group_crossing: 'RANKED' });
  assert.equal(preview.rounds[1].series[0].home, 'Vencedor das Quartas 1');
  assert.equal(preview.rounds[2].series[0].home, 'Vencedor da Semifinal 1');
});

test('series names for source keys', async () => {
  const { knockoutSeriesName } = await import('../src/lib/knockoutPreview.ts');
  assert.equal(knockoutSeriesName('R1M2', 2, () => 2), 'Semifinal 2');
  assert.equal(knockoutSeriesName('R1M3', 3, () => 4), 'Quartas 3');
  assert.equal(knockoutSeriesName('R2M1', 2, () => 1), 'Final');
  assert.equal(knockoutSeriesName('THIRD_PLACE', 2, () => 1), 'THIRD_PLACE');
});
