(function (root, factory) {
  const api = factory();
  root.BVTrainingCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const REQUIRED_CORRECT = 10;
  const BURST_GAP_MS = 100;
  const SUCCESS_REARM_MS = 450;
  const MIN_FOCUS_DWELL_MS = 80;
  const FOCUS_CONTINUITY_GAP_MS = 60;
  const RECENT_LIMIT = 2000;
  const DAILY_LIMIT = 3650;
  const PROGRESS_HISTORY_LIMIT = 3650;
  const SKIP_MISSES = 10;
  const SKIP_TIME_MS = 60000;

  function blankState() {
    return {
      version: 2,
      view: 'guided',
      cursor: { soundId: 'uh', stageId: 'pure', index: 0 },
      soundCursors: {},
      itemStats: {},
      patternStats: {},
      masteryMilestones: {},
      masteryGates: {},
      progressHistory: {},
      progressBaselines: {},
      progressUnlocks: {},
      skipQueues: {},
      daily: {},
      recentAttempts: [],
      legacyTotals: null,
      practiceMs: 0,
    };
  }

  function safeCount(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
  }

  function normalizeStat(value) {
    return {
      attempts: safeCount(value && value.attempts),
      correct: safeCount(value && value.correct),
      skips: safeCount(value && value.skips),
      consecutiveMisses: safeCount(value && value.consecutiveMisses),
      lastAttemptAt: safeCount(value && value.lastAttemptAt),
      completedAt: safeCount(value && value.completedAt),
      wrongVowels: value && typeof value.wrongVowels === 'object' ? { ...value.wrongVowels } : {},
    };
  }

  function normalizeState(saved, legacy) {
    const state = blankState();
    if (saved && saved.version === 2) {
      state.view = saved.view === 'freeplay' ? 'freeplay' : 'guided';
      state.cursor = { ...state.cursor, ...(saved.cursor || {}) };
      state.soundCursors = saved.soundCursors && typeof saved.soundCursors === 'object' ? saved.soundCursors : {};
      state.skipQueues = saved.skipQueues && typeof saved.skipQueues === 'object' ? saved.skipQueues : {};
      state.daily = saved.daily && typeof saved.daily === 'object' ? saved.daily : {};
      state.recentAttempts = Array.isArray(saved.recentAttempts) ? saved.recentAttempts.slice(-RECENT_LIMIT) : [];
      state.legacyTotals = saved.legacyTotals || null;
      state.practiceMs = safeCount(saved.practiceMs);
      state.masteryMilestones = saved.masteryMilestones && typeof saved.masteryMilestones === 'object' ? { ...saved.masteryMilestones } : {};
      state.masteryGates = saved.masteryGates && typeof saved.masteryGates === 'object' ? { ...saved.masteryGates } : {};
      state.progressBaselines = saved.progressBaselines && typeof saved.progressBaselines === 'object' ? { ...saved.progressBaselines } : {};
      state.progressUnlocks = saved.progressUnlocks && typeof saved.progressUnlocks === 'object' ? { ...saved.progressUnlocks } : {};
      for (const [soundId, points] of Object.entries(saved.progressHistory || {})) {
        if (!Array.isArray(points)) continue;
        state.progressHistory[soundId] = points
          .map(normalizeProgressPoint)
          .filter(Boolean)
          .slice(-PROGRESS_HISTORY_LIMIT);
      }
      for (const [id, stat] of Object.entries(saved.itemStats || {})) state.itemStats[id] = normalizeStat(stat);
      for (const [id, stat] of Object.entries(saved.patternStats || {})) state.patternStats[id] = normalizeStat(stat);
    } else if (legacy && typeof legacy === 'object') {
      state.view = legacy.mode === 'sounds' ? 'freeplay' : 'guided';
      state.legacyTotals = legacy.stats || null;
      state.practiceMs = safeCount(legacy.stats && legacy.stats.practiceMs);
    }
    pruneDaily(state);
    return state;
  }

  function accuracy(stat) {
    return stat && stat.attempts ? (stat.correct / stat.attempts) * 100 : null;
  }

  function meanAccuracy(stats) {
    const values = stats.map(accuracy).filter((value) => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  }

  function masteryBand(value) {
    return Math.min(95, Math.max(0, Math.floor((Number(value) || 0) / 5) * 5));
  }

  function nextMasteryGoal(stats) {
    const values = stats.map((stat) => accuracy(normalizeStat(stat)) ?? 0);
    return [80, 85, 90, 95].find((level) => values.some((value) => value < level)) || null;
  }

  function correctAttemptsToReach(stat, targetPercent) {
    const normalized = normalizeStat(stat);
    const target = Math.max(0, Math.min(99.999, Number(targetPercent) || 0));
    const current = accuracy(normalized);
    if (current !== null && current >= target) return 0;
    if (!normalized.attempts) return target > 0 ? 1 : 0;
    const ratio = target / 100;
    return Math.max(0, Math.ceil(((ratio * normalized.attempts) - normalized.correct) / (1 - ratio)));
  }

  function nextMasteryStep(stats, currentGoal) {
    const goalLimit = Number(currentGoal);
    if (!stats.length || !Number.isFinite(goalLimit)) return null;
    const normalized = stats.map(normalizeStat);
    const values = normalized.map((stat) => accuracy(stat) ?? 0);
    const goal = Math.min(goalLimit, masteryBand(Math.min(...values)) + 5);
    const remainingIndexes = values
      .map((value, index) => value < goal ? index : -1)
      .filter((index) => index >= 0);
    return {
      goal,
      remainingIndexes,
      correctAttempts: remainingIndexes.reduce(
        (total, index) => total + correctAttemptsToReach(normalized[index], goal),
        0,
      ),
    };
  }

  function crossedMasteryMilestone(previousAccuracy, nextAccuracy, announced = 0) {
    const previousBand = masteryBand(previousAccuracy);
    const nextBand = masteryBand(nextAccuracy);
    return nextBand > previousBand && nextBand > masteryBand(announced) ? nextBand : null;
  }

  function summaryForIds(state, ids) {
    const stats = ids.map((id) => normalizeStat(state.itemStats[id]));
    const attempted = stats.filter((stat) => stat.attempts > 0).length;
    return {
      total: ids.length,
      attempted,
      completed: stats.filter((stat) => stat.correct >= REQUIRED_CORRECT).length,
      attempts: stats.reduce((total, stat) => total + stat.attempts, 0),
      correct: stats.reduce((total, stat) => total + stat.correct, 0),
      accuracy: meanAccuracy(stats),
      coverage: ids.length ? (attempted / ids.length) * 100 : 0,
    };
  }

  function repetitionProgress(state, ids, requiredCorrect = REQUIRED_CORRECT) {
    const required = Math.max(1, safeCount(requiredCorrect));
    const stats = ids.map((id) => normalizeStat(state.itemStats[id]));
    const correct = stats.reduce((total, stat) => total + Math.min(required, stat.correct), 0);
    const totalCorrect = ids.length * required;
    return {
      completed: stats.filter((stat) => stat.correct >= required).length,
      totalItems: ids.length,
      correct,
      totalCorrect,
      percent: totalCorrect ? (correct / totalCorrect) * 100 : 0,
    };
  }

  function summaryForPatternIds(state, ids) {
    const stats = ids.map((id) => normalizeStat(state.patternStats[id]));
    const attempted = stats.filter((stat) => stat.attempts > 0).length;
    return {
      total: ids.length,
      attempted,
      attempts: stats.reduce((total, stat) => total + stat.attempts, 0),
      correct: stats.reduce((total, stat) => total + stat.correct, 0),
      accuracy: meanAccuracy(stats),
      coverage: ids.length ? (attempted / ids.length) * 100 : 0,
    };
  }

  function applyAttempt(stat, attempt, timestamp) {
    stat.attempts += 1;
    stat.lastAttemptAt = timestamp;
    if (attempt.correct) {
      stat.correct += 1;
      stat.consecutiveMisses = 0;
      if (stat.correct >= REQUIRED_CORRECT && !stat.completedAt) stat.completedAt = timestamp;
    } else {
      stat.consecutiveMisses += 1;
      const detected = String(attempt.detectedArpa || 'NONE').toUpperCase();
      stat.wrongVowels[detected] = safeCount(stat.wrongVowels[detected]) + 1;
    }
    return stat;
  }

  function dayKey(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function normalizeProgressPoint(value) {
    if (!value || !value.day || !Number.isFinite(Number(value.score))) return null;
    return {
      day: String(value.day),
      at: safeCount(value.at),
      score: Math.max(0, Math.min(100, Number(value.score))),
      coverage: Math.max(0, Math.min(100, Number(value.coverage) || 0)),
      attemptedPatterns: safeCount(value.attemptedPatterns),
      totalPatterns: safeCount(value.totalPatterns),
      attempts: safeCount(value.attempts),
      correct: safeCount(value.correct),
    };
  }

  function recordProgressSnapshot(state, soundId, summary, timestamp = Date.now()) {
    if (!summary || summary.accuracy === null || !Number.isFinite(summary.accuracy)) return null;
    const day = dayKey(timestamp);
    const dailySound = state.daily[day] && state.daily[day].sounds && state.daily[day].sounds[soundId];
    const point = normalizeProgressPoint({
      day,
      at: timestamp,
      score: summary.accuracy,
      coverage: summary.coverage,
      attemptedPatterns: summary.attempted,
      totalPatterns: summary.total,
      attempts: dailySound && dailySound.attempts,
      correct: dailySound && dailySound.correct,
    });
    const history = Array.isArray(state.progressHistory[soundId]) ? state.progressHistory[soundId] : [];
    const index = history.findIndex((entry) => entry.day === day);
    if (index >= 0) history[index] = point;
    else history.push(point);
    history.sort((a, b) => a.day.localeCompare(b.day));
    state.progressHistory[soundId] = history.slice(-PROGRESS_HISTORY_LIMIT);
    if (!state.progressBaselines[soundId]) {
      state.progressBaselines[soundId] = {
        score: point.score,
        coverage: point.coverage,
        at: point.at,
        day: point.day,
      };
    }
    return point;
  }

  function pruneDaily(state) {
    const keys = Object.keys(state.daily).sort();
    for (const key of keys.slice(0, Math.max(0, keys.length - DAILY_LIMIT))) delete state.daily[key];
  }

  function recordAttempt(state, attempt) {
    const timestamp = safeCount(attempt.at) || Date.now();
    const stat = normalizeStat(state.itemStats[attempt.itemId]);
    applyAttempt(stat, attempt, timestamp);
    state.itemStats[attempt.itemId] = stat;

    const patternIds = [...new Set((attempt.patternIds || []).filter(Boolean))];
    for (const patternId of patternIds) {
      const patternStat = normalizeStat(state.patternStats[patternId]);
      state.patternStats[patternId] = applyAttempt(patternStat, attempt, timestamp);
    }

    const key = dayKey(timestamp);
    const daily = state.daily[key] || { attempts: 0, correct: 0, practiceMs: 0, sounds: {} };
    daily.attempts += 1;
    if (attempt.correct) daily.correct += 1;
    if (!daily.sounds[attempt.soundId]) daily.sounds[attempt.soundId] = { attempts: 0, correct: 0 };
    daily.sounds[attempt.soundId].attempts += 1;
    if (attempt.correct) daily.sounds[attempt.soundId].correct += 1;
    state.daily[key] = daily;
    pruneDaily(state);

    state.recentAttempts.push({ ...attempt, at: timestamp });
    if (state.recentAttempts.length > RECENT_LIMIT) state.recentAttempts.splice(0, state.recentAttempts.length - RECENT_LIMIT);
    return stat;
  }

  function recordSkip(state, itemId, queueKey) {
    const stat = normalizeStat(state.itemStats[itemId]);
    stat.skips += 1;
    stat.consecutiveMisses = 0;
    state.itemStats[itemId] = stat;
    const queue = Array.isArray(state.skipQueues[queueKey]) ? state.skipQueues[queueKey] : [];
    if (!queue.includes(itemId)) queue.push(itemId);
    state.skipQueues[queueKey] = queue;
    return stat;
  }

  function addPracticeTime(state, milliseconds, timestamp = Date.now()) {
    const amount = Math.max(0, Number(milliseconds) || 0);
    state.practiceMs += amount;
    const key = dayKey(timestamp);
    const daily = state.daily[key] || { attempts: 0, correct: 0, practiceMs: 0, sounds: {} };
    daily.practiceMs += amount;
    state.daily[key] = daily;
    pruneDaily(state);
  }

  function createBurst(targetArpa) {
    return {
      targetArpa: String(targetArpa || '').toUpperCase(),
      detected: {},
      focusRuns: {},
      activeFocus: '',
      sampleAt: null,
    };
  }

  function addBurstSample(burst, focusedArpa, nearestArpa, timestamp) {
    const focused = String(focusedArpa || '').toUpperCase();
    const nearest = String(nearestArpa || '').toUpperCase();
    const previousAt = Number.isFinite(burst.sampleAt) ? burst.sampleAt : null;
    const at = Number.isFinite(Number(timestamp))
      ? Number(timestamp)
      : previousAt === null ? 0 : previousAt + 16;
    const gap = previousAt === null ? 0 : Math.max(0, at - previousAt);

    if (burst.activeFocus) {
      const run = burst.focusRuns[burst.activeFocus];
      if (run && gap <= FOCUS_CONTINUITY_GAP_MS) {
        run.currentMs += gap;
        run.maxMs = Math.max(run.maxMs, run.currentMs);
      } else if (run) {
        run.currentMs = 0;
      }
    }

    if (focused !== burst.activeFocus) {
      burst.activeFocus = focused;
      if (focused) {
        const run = burst.focusRuns[focused] || { currentMs: 0, maxMs: 0 };
        run.currentMs = 0;
        burst.focusRuns[focused] = run;
      }
    } else if (focused && gap > FOCUS_CONTINUITY_GAP_MS) {
      burst.focusRuns[focused].currentMs = 0;
    }

    burst.sampleAt = at;
    const detected = focused || nearest;
    if (detected) burst.detected[detected] = safeCount(burst.detected[detected]) + 1;
    return burst;
  }

  function focusDwell(burst, arpa) {
    const key = String(arpa || '').toUpperCase();
    const run = burst && burst.focusRuns && burst.focusRuns[key];
    return run ? Math.max(0, Number(run.maxMs) || 0) : 0;
  }

  function burstResult(burst) {
    const targetDwell = focusDwell(burst, burst.targetArpa);
    if (targetDwell >= MIN_FOCUS_DWELL_MS) {
      return { gradable: true, correct: true, detectedArpa: burst.targetArpa, dwellMs: targetDwell };
    }

    const sustainedWrong = Object.keys(burst.focusRuns || {})
      .filter((arpa) => arpa !== burst.targetArpa)
      .map((arpa) => [arpa, focusDwell(burst, arpa)])
      .filter(([, dwellMs]) => dwellMs >= MIN_FOCUS_DWELL_MS)
      .sort((a, b) => b[1] - a[1])[0];
    if (sustainedWrong) {
      return { gradable: true, correct: false, detectedArpa: sustainedWrong[0], dwellMs: sustainedWrong[1] };
    }

    const detectedArpa = Object.entries(burst.detected || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || 'NONE';
    const dwellMs = Math.max(0, ...Object.keys(burst.focusRuns || {}).map((arpa) => focusDwell(burst, arpa)));
    return { gradable: false, correct: false, detectedArpa, dwellMs };
  }

  function canSkip(stat, elapsedMs) {
    return safeCount(stat && stat.consecutiveMisses) >= SKIP_MISSES || Math.max(0, Number(elapsedMs) || 0) >= SKIP_TIME_MS;
  }

  return {
    REQUIRED_CORRECT,
    BURST_GAP_MS,
    SUCCESS_REARM_MS,
    MIN_FOCUS_DWELL_MS,
    FOCUS_CONTINUITY_GAP_MS,
    SKIP_MISSES,
    SKIP_TIME_MS,
    RECENT_LIMIT,
    blankState,
    normalizeState,
    normalizeStat,
    accuracy,
    meanAccuracy,
    masteryBand,
    nextMasteryGoal,
    correctAttemptsToReach,
    nextMasteryStep,
    crossedMasteryMilestone,
    summaryForIds,
    repetitionProgress,
    summaryForPatternIds,
    recordProgressSnapshot,
    recordAttempt,
    recordSkip,
    addPracticeTime,
    createBurst,
    addBurstSample,
    focusDwell,
    burstResult,
    canSkip,
    dayKey,
  };
});
