import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKnockoutPreview, knockoutRoundLabel } from '../src/lib/knockoutPreview.ts';

const ASPIRANTES = { group_count: 2, group_legs: 2, knockout_legs: 2, qualifiers_per_group: 2, group_crossing: 'RANKED', third_place: true };

test('ASPIRANTES: semifinals 1ºA x 2ºB and 1ºB x 2ºA, final and third place, two legs', () => {
  const preview = buildKnockoutPreview(['Grupo A', 'Grupo B'], ASPIRANTES);
  assert.deepEqual(preview, {
    rounds: [
      { label: 'Semifinais', series: [
        { label: 'Semifinal 1', home: '1º do Grupo A', away: '2º do Grupo B', legs: 2 },
        { label: 'Semifinal 2', home: '1º do Grupo B', away: '2º do Grupo A', legs: 2 },
      ] },
      { label: 'Final', series: [{ label: 'Final', home: 'Vencedor da Semifinal 1', away: 'Vencedor da Semifinal 2', legs: 2 }] },
    ],
    thirdPlace: { label: 'Disputa do terceiro lugar', home: 'Perdedor da Semifinal 1', away: 'Perdedor da Semifinal 2', legs: 2 },
  });
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
