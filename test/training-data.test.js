const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('../src/training-data.js');
const data = global.window.BV_TRAINING_DATA;

const EXPECTED = {
  uh: { arpa: 'AH', onsets: 42, codas: 38, families: 13, familyItems: 1040, featured: 'humble' },
  ee: { arpa: 'IY', onsets: 50, codas: 34, families: 7, familyItems: 588, featured: 'see' },
  ih: { arpa: 'IH', onsets: 50, codas: 53, families: 5, familyItems: 515, featured: 'it' },
  u: { arpa: 'UH', onsets: 50, codas: 30, families: 5, familyItems: 400, featured: 'book' },
  eh: { arpa: 'EH', onsets: 48, codas: 51, families: 7, familyItems: 693, featured: 'when' },
  oo: { arpa: 'UW', onsets: 57, codas: 34, families: 5, familyItems: 455, featured: 'move' },
  ae: { label: 'AA', arpa: 'AE', onsets: 42, codas: 38, families: 1, familyItems: 80, featured: 'hamble' },
  er: { arpa: 'ER', onsets: 42, codas: 38, families: 1, familyItems: 80, featured: 'hermble' },
  ao: { arpa: 'AO', onsets: 42, codas: 38, families: 1, familyItems: 80, featured: 'hawmble' },
  aa: { label: 'AH', arpa: 'AA', onsets: 42, codas: 38, families: 1, familyItems: 80, featured: 'homble' },
};

test('contains all ten map vowels with canonical detector mappings', () => {
  assert.deepEqual(data.sounds.map((sound) => sound.id), Object.keys(EXPECTED));
  for (const sound of data.sounds) {
    assert.equal(sound.arpa, EXPECTED[sound.id].arpa);
    if (EXPECTED[sound.id].label) assert.equal(sound.label, EXPECTED[sound.id].label);
  }
});

test('contains every parsed transition and family substitution', () => {
  for (const sound of data.sounds) {
    const expected = EXPECTED[sound.id];
    assert.deepEqual(sound.counts, {
      onsets: expected.onsets,
      codas: expected.codas,
      families: expected.families,
      familyItems: expected.familyItems,
    });
    assert.equal(sound.families[0].base, expected.featured);
    assert.equal(sound.families[0].featured, true);
  }
});

test('every word family has one drill for every onset and coda', () => {
  for (const sound of data.sounds) {
    for (const family of sound.families) {
      const onsetIds = family.items.filter((item) => item.section === 'onset').map((item) => item.patternId);
      const codaIds = family.items.filter((item) => item.section === 'coda').map((item) => item.patternId);
      assert.deepEqual(new Set(onsetIds), new Set(sound.onsets.map((item) => item.id)), `${sound.id}:${family.base}:onsets`);
      assert.deepEqual(new Set(codaIds), new Set(sound.codas.map((item) => item.id)), `${sound.id}:${family.base}:codas`);
      assert.equal(family.items.length, sound.onsets.length + sound.codas.length);
      assert.ok(family.items.every((item) => item.patternIds.length >= 1 && item.patternIds.length <= 2));
    }
  }
});

test('orders onset and coda transitions from common to rare', () => {
  for (const sound of data.sounds) {
    for (const patterns of [sound.onsets, sound.codas]) {
      for (let index = 1; index < patterns.length; index += 1) {
        assert.ok(patterns[index - 1].frequency >= patterns[index].frequency);
        if (patterns[index - 1].frequency === patterns[index].frequency) {
          assert.ok(patterns[index - 1].sourceIndex < patterns[index].sourceIndex);
        }
      }
    }
  }
});

test('orders family substitutions by frequency with source-order fallback', () => {
  for (const sound of data.sounds) {
    for (const family of sound.families) {
      for (let index = 1; index < family.items.length; index += 1) {
        assert.ok(family.items[index - 1].frequency >= family.items[index].frequency);
        if (family.items[index - 1].frequency === family.items[index].frequency) {
          assert.ok(family.items[index - 1].sourceIndex < family.items[index].sourceIndex);
        }
      }
    }
  }
});

test('uses stable unique IDs without duplicate family substitutions', () => {
  const ids = new Set();
  for (const sound of data.sounds) {
    for (const pattern of [...sound.onsets, ...sound.codas]) {
      const id = `${sound.id}:${pattern.id}`;
      assert.equal(ids.has(id), false, id);
      ids.add(id);
    }
    for (const family of sound.families) {
      const familyKeys = new Set();
      for (const item of family.items) {
        const id = `${sound.id}:${item.id}`;
        const key = `${item.section}:${item.token}:${item.word}`;
        assert.equal(ids.has(id), false, id);
        assert.equal(familyKeys.has(key), false, `${family.id}:${key}`);
        ids.add(id);
        familyKeys.add(key);
      }
    }
  }
});

test('family files retain real and drill-only classifications', () => {
  for (const sound of data.sounds.filter((entry) => !entry.generatedFrom)) {
    const items = sound.families.flatMap((family) => family.items);
    assert.ok(items.some((item) => item.real), `${sound.id} real`);
    assert.ok(items.some((item) => item.drillOnly), `${sound.id} drill-only`);
  }
});

test('generated vowels use complete approximate drill families', () => {
  for (const sound of data.sounds.filter((entry) => entry.generatedFrom)) {
    const family = sound.families[0];
    assert.equal(family.generated, true);
    assert.equal(family.items.length, sound.onsets.length + sound.codas.length);
    assert.ok(family.items.every((item) => item.generated && item.drillOnly));
  }
});

test('collapses conflicting duplicate declarations into drill-only exercises', () => {
  const uh = data.sounds.find((sound) => sound.id === 'uh');
  const blood = uh.families.find((family) => family.base === 'blood');
  const sud = blood.items.find((item) => item.word === 'sud');
  assert.equal(sud.real, false);
  assert.equal(sud.drillOnly, true);
});
