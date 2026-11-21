import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPETITION_TABS, DEFAULT_COMPETITION_TAB, slugFromTab, tabFromSlug } from '../src/lib/competitionTabs.ts';

test('every tab round-trips through its URL slug', () => {
  for (const tab of COMPETITION_TABS) {
    assert.equal(tabFromSlug(slugFromTab(tab)), tab);
  }
});

test('slugs are URL-safe ASCII', () => {
  for (const tab of COMPETITION_TABS) {
    assert.match(slugFromTab(tab), /^[a-z-]+$/);
  }
});

test('unknown or missing slugs fall back to the overview', () => {
  assert.equal(tabFromSlug(null), DEFAULT_COMPETITION_TAB);
  assert.equal(tabFromSlug(undefined), DEFAULT_COMPETITION_TAB);
  assert.equal(tabFromSlug('nao-existe'), DEFAULT_COMPETITION_TAB);
});

test('old matches links open the rounds tab', () => {
  assert.equal(tabFromSlug('jogos'), 'Rodadas');
  assert.equal(slugFromTab('Rodadas'), 'rodadas');
});
