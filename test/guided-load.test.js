const test = require('node:test');
const assert = require('node:assert/strict');

test('guided script initializes its core dependency before reading constants', () => {
  global.window = {
    BV_TRAINING_DATA: { sounds: [] },
    BVTrainingCore: { BURST_GAP_MS: 100, SUCCESS_REARM_MS: 450, blankState: () => ({}) },
    addEventListener: () => {},
  };
  global.document = { readyState: 'loading', addEventListener: () => {} };
  global.performance = { now: () => 0 };
  assert.doesNotThrow(() => require('../src/guided-training.js'));
});
