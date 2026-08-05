const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/training-core.js');

test('uses the requested 100 ms voice-burst gap', () => {
  assert.equal(core.BURST_GAP_MS, 100);
});

test('uses a longer recovery window after a successful attempt', () => {
  assert.equal(core.SUCCESS_REARM_MS, 450);
  assert.ok(core.SUCCESS_REARM_MS > core.BURST_GAP_MS);
});

test('a burst is correct after sustained target focus despite a brief wrong onset', () => {
  const burst = core.createBurst('AH');
  core.addBurstSample(burst, 'IH', 'IH', 0);
  core.addBurstSample(burst, '', 'IH', 30);
  core.addBurstSample(burst, 'AH', 'AH', 40);
  core.addBurstSample(burst, 'AH', 'AH', 80);
  core.addBurstSample(burst, 'AH', 'AH', 125);
  assert.deepEqual(core.burstResult(burst), { gradable: true, correct: true, detectedArpa: 'AH', dwellMs: 85 });
});

test('a sustained wrong circle creates one incorrect attempt', () => {
  const burst = core.createBurst('IH');
  core.addBurstSample(burst, 'EH', 'EH', 0);
  core.addBurstSample(burst, 'EH', 'EH', 40);
  core.addBurstSample(burst, 'EH', 'EH', 90);
  assert.deepEqual(core.burstResult(burst), { gradable: true, correct: false, detectedArpa: 'EH', dwellMs: 90 });
});

test('a brief wrong-circle flicker is ignored instead of counted negative', () => {
  const burst = core.createBurst('ER');
  core.addBurstSample(burst, 'IH', 'IH', 0);
  core.addBurstSample(burst, '', 'IH', 35);
  assert.deepEqual(core.burstResult(burst), { gradable: false, correct: false, detectedArpa: 'IH', dwellMs: 35 });
});

test('separate short visits to a circle do not add up to the dwell threshold', () => {
  const burst = core.createBurst('ER');
  core.addBurstSample(burst, 'IH', 'IH', 0);
  core.addBurstSample(burst, '', 'IH', 40);
  core.addBurstSample(burst, 'IH', 'IH', 100);
  core.addBurstSample(burst, '', 'IH', 140);
  assert.deepEqual(core.burstResult(burst), { gradable: false, correct: false, detectedArpa: 'IH', dwellMs: 40 });
});

test('attempts retain misses and complete after ten correct repetitions', () => {
  const state = core.blankState();
  for (let index = 0; index < 5; index += 1) {
    core.recordAttempt(state, { itemId: 'uh:pure', soundId: 'uh', correct: false, detectedArpa: 'EH', at: 1000 + index });
  }
  for (let index = 0; index < 10; index += 1) {
    core.recordAttempt(state, { itemId: 'uh:pure', soundId: 'uh', correct: true, detectedArpa: 'AH', at: 2000 + index });
  }
  const stat = state.itemStats['uh:pure'];
  assert.equal(stat.attempts, 15);
  assert.equal(stat.correct, 10);
  assert.equal(Math.round(core.accuracy(stat)), 67);
  assert.ok(stat.completedAt > 0);
  assert.deepEqual(stat.wrongVowels, { EH: 5 });
});

test('sound score gives every attempted pattern equal weight', () => {
  const state = core.blankState();
  state.itemStats.easy = { attempts: 1, correct: 1 };
  state.itemStats.established = { attempts: 1000, correct: 500 };
  const summary = core.summaryForIds(state, ['easy', 'established', 'untouched']);
  assert.equal(summary.accuracy, 75);
  assert.equal(Math.round(summary.coverage), 67);
  assert.equal(summary.attempted, 2);
  assert.equal(summary.total, 3);
});

test('stage repetition progress includes partial drills and caps completed drills', () => {
  const state = core.blankState();
  state.itemStats = {
    complete: { correct: 10 },
    partial: { correct: 7 },
    retrained: { correct: 14 },
  };
  assert.deepEqual(core.repetitionProgress(state, ['complete', 'partial', 'retrained', 'untouched']), {
    completed: 2,
    totalItems: 4,
    correct: 27,
    totalCorrect: 40,
    percent: 67.5,
  });
});

test('mastery gates rise from 80 to 95 only when every pattern qualifies', () => {
  const stat = (correct, attempts = 100) => ({ correct, attempts });
  assert.equal(core.nextMasteryGoal([stat(80), stat(79)]), 80);
  assert.equal(core.nextMasteryGoal([stat(80), stat(84)]), 85);
  assert.equal(core.nextMasteryGoal([stat(85), stat(89)]), 90);
  assert.equal(core.nextMasteryGoal([stat(90), stat(94)]), 95);
  assert.equal(core.nextMasteryGoal([stat(95), stat(100)]), null);
});

test('next mastery step reports blockers and best-case correct attempts', () => {
  const stats = [
    { attempts: 100, correct: 60 },
    { attempts: 100, correct: 62 },
    { attempts: 20, correct: 14 },
  ];
  assert.deepEqual(core.nextMasteryStep(stats, 80), {
    goal: 65,
    remainingIndexes: [0, 1],
    correctAttempts: 24,
  });
  assert.equal(core.correctAttemptsToReach({ attempts: 20, correct: 13 }, 65), 0);
});

test('mastery milestones celebrate new five-point bands but not recovery', () => {
  assert.equal(core.crossedMasteryMilestone(37, 40, 35), 40);
  assert.equal(core.crossedMasteryMilestone(55, 54, 55), null);
  assert.equal(core.crossedMasteryMilestone(54, 55, 55), null);
  assert.equal(core.crossedMasteryMilestone(59, 60, 55), 60);
});

test('mastery milestone history persists in v2 state', () => {
  const state = core.normalizeState({ version: 2, masteryMilestones: { 'uh:onset:h': 65 } });
  assert.equal(state.masteryMilestones['uh:onset:h'], 65);
});

test('mastery gate cohorts persist in v2 state', () => {
  const gate = { goal: 80, patternIds: ['uh:onset:h', 'uh:coda:t'], startedAt: 1234 };
  const state = core.normalizeState({ version: 2, masteryGates: { uh: gate } });
  assert.deepEqual(state.masteryGates.uh, gate);
});

test('daily progress snapshots keep the first baseline and update the daily close', () => {
  const state = core.blankState();
  const firstAt = new Date(2026, 6, 20, 10).getTime();
  const nextAt = new Date(2026, 6, 20, 18).getTime();
  const day = core.dayKey(firstAt);
  state.daily[day] = { sounds: { uh: { attempts: 4, correct: 2 } } };
  core.recordProgressSnapshot(state, 'uh', { accuracy: 40, coverage: 25, attempted: 20, total: 80 }, firstAt);
  state.daily[day].sounds.uh = { attempts: 10, correct: 7 };
  core.recordProgressSnapshot(state, 'uh', { accuracy: 52.5, coverage: 50, attempted: 40, total: 80 }, nextAt);

  assert.equal(state.progressHistory.uh.length, 1);
  assert.equal(state.progressHistory.uh[0].score, 52.5);
  assert.equal(state.progressHistory.uh[0].attempts, 10);
  assert.equal(state.progressHistory.uh[0].correct, 7);
  assert.equal(state.progressBaselines.uh.score, 40);
  assert.equal(state.progressBaselines.uh.day, day);
});

test('progress history and baselines survive state normalization', () => {
  const saved = {
    version: 2,
    progressBaselines: { uh: { score: 41, day: '2026-07-20', at: 10 } },
    progressHistory: {
      uh: [{ day: '2026-07-20', at: 10, score: 41.25, coverage: 20, attemptedPatterns: 16, totalPatterns: 80, attempts: 12, correct: 8 }],
    },
  };
  const state = core.normalizeState(saved);
  assert.equal(state.progressBaselines.uh.score, 41);
  assert.equal(state.progressHistory.uh[0].score, 41.25);
  assert.equal(state.progressHistory.uh[0].attempts, 12);
});

test('history unlock markers survive state normalization', () => {
  const state = core.normalizeState({
    version: 2,
    progressUnlocks: { uh: { at: 1234, day: '2026-07-22', afterStage: 'codas' } },
  });
  assert.deepEqual(state.progressUnlocks.uh, { at: 1234, day: '2026-07-22', afterStage: 'codas' });
});

test('a word attempt updates shared onset and coda statistics once', () => {
  const state = core.blankState();
  core.recordAttempt(state, {
    itemId: 'uh:family:humble:onset:b:bubble',
    soundId: 'uh',
    patternIds: ['uh:onset:b', 'uh:coda:mb', 'uh:onset:b'],
    correct: true,
    detectedArpa: 'AH',
    at: 1000,
  });
  assert.equal(state.itemStats['uh:family:humble:onset:b:bubble'].attempts, 1);
  assert.equal(state.patternStats['uh:onset:b'].attempts, 1);
  assert.equal(state.patternStats['uh:coda:mb'].correct, 1);
  assert.equal(core.summaryForPatternIds(state, ['uh:onset:b', 'uh:coda:mb', 'uh:onset:z']).accuracy, 100);
  assert.equal(Math.round(core.summaryForPatternIds(state, ['uh:onset:b', 'uh:coda:mb', 'uh:onset:z']).coverage), 67);
});

test('skips retain statistics and enter the stage queue once', () => {
  const state = core.blankState();
  state.itemStats.item = { attempts: 10, correct: 0, consecutiveMisses: 10 };
  core.recordSkip(state, 'item', 'uh:onsets');
  core.recordSkip(state, 'item', 'uh:onsets');
  assert.deepEqual(state.skipQueues['uh:onsets'], ['item']);
  assert.equal(state.itemStats.item.skips, 2);
  assert.equal(state.itemStats.item.attempts, 10);
  assert.equal(state.itemStats.item.consecutiveMisses, 0);
});

test('skip becomes available after ten misses or sixty seconds', () => {
  assert.equal(core.canSkip({ consecutiveMisses: 9 }, 59999), false);
  assert.equal(core.canSkip({ consecutiveMisses: 10 }, 0), true);
  assert.equal(core.canSkip({ consecutiveMisses: 0 }, 60000), true);
});

test('v1 migration preserves old activity without inventing accuracy', () => {
  const state = core.normalizeState(null, { mode: 'sounds', stats: { practiceMs: 12345, soundHits: 42 } });
  assert.equal(state.view, 'freeplay');
  assert.equal(state.practiceMs, 12345);
  assert.deepEqual(state.legacyTotals, { practiceMs: 12345, soundHits: 42 });
  assert.deepEqual(state.itemStats, {});
});

test('recent attempt history is capped', () => {
  const state = core.blankState();
  for (let index = 0; index < core.RECENT_LIMIT + 20; index += 1) {
    core.recordAttempt(state, { itemId: 'item', soundId: 'uh', correct: true, at: 100000 + index });
  }
  assert.equal(state.recentAttempts.length, core.RECENT_LIMIT);
  assert.equal(state.recentAttempts[0].at, 100020);
});
