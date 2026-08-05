(function () {
  'use strict';

  const EVENT_NAME = 'bv-vowel-focus-reader:update';
  const STORAGE_KEY = 'bv-vowel-training-state-v2';
  const LEGACY_KEY = 'bv-vowel-vanguard-state-v1';
  const data = window.BV_TRAINING_DATA;
  const core = window.BVTrainingCore;
  if (!data || !core) return;
  const BURST_GAP_MS = core.BURST_GAP_MS;
  const SUCCESS_REARM_MS = core.SUCCESS_REARM_MS;
  const MIN_FOCUS_DWELL_MS = core.MIN_FOCUS_DWELL_MS;

  const sounds = data.sounds;
  const soundById = new Map(sounds.map((sound) => [sound.id, sound]));
  const stagesBySound = new Map();
  const familyGroupsBySound = new Map();
  const itemById = new Map();
  const foundationStages = ['pure', 'onsets', 'codas', 'families'];
  const stageOrder = [...foundationStages, 'mastery'];
  const stageLabels = { pure: 'Pure sound', onsets: 'Onset transitions', codas: 'Coda transitions', families: 'Word families', mastery: 'Mastery phrases' };

  let state = core.blankState();
  let shell = null;
  let summary = null;
  let modal = null;
  let currentPayload = null;
  let burst = null;
  let burstTimer = 0;
  let successRearmTimer = 0;
  let successRearmStartedAt = 0;
  let successRearmUntil = 0;
  let strikeFrame = 0;
  let saveTimer = 0;
  let advancing = false;
  let trainingPaused = false;
  let itemStartedAt = performance.now();
  let lastActivityAt = 0;
  let lastPracticeTick = performance.now();
  let modalSoundId = 'uh';
  let modalView = 'patterns';
  let modalRange = 'lifetime';
  let modalType = 'all';
  let modalStatus = 'all';
  let celebrationTimer = 0;
  let correctCueTimer = 0;
  let audioContext = null;

  function globalItemId(soundId, localId) {
    return `${soundId}:${localId}`;
  }

  function phraseWords(sound, pattern) {
    const familyWords = sound.families.flatMap((family) => family.items
      .filter((item) => item.patternIds.includes(pattern.id))
      .sort((a, b) => Number(b.real) - Number(a.real))
      .map((item) => item.word));
    const candidates = [...(pattern.examples || []), ...familyWords, sound.keyword, sound.featured]
      .map((word) => String(word || '').trim().toLowerCase())
      .filter(Boolean);
    return [...new Set(candidates)].slice(0, 3);
  }

  function buildCurriculum() {
    for (const sound of sounds) {
      const stages = {
        pure: [{
          id: globalItemId(sound.id, 'pure'),
          stageId: 'pure',
          soundId: sound.id,
          prompt: sound.label,
          ipa: `/${sound.ipa}/`,
          detail: sound.keyword,
          type: 'pure',
        }],
        onsets: sound.onsets.map((pattern) => ({
          ...pattern,
          id: globalItemId(sound.id, pattern.id),
          stageId: 'onsets',
          soundId: sound.id,
          detail: pattern.label,
          type: 'onset',
          patternIds: [globalItemId(sound.id, pattern.id)],
        })),
        codas: sound.codas.map((pattern) => ({
          ...pattern,
          id: globalItemId(sound.id, pattern.id),
          stageId: 'codas',
          soundId: sound.id,
          detail: pattern.label,
          type: 'coda',
          patternIds: [globalItemId(sound.id, pattern.id)],
        })),
        families: sound.families.flatMap((family) => family.items.map((item) => ({
          ...item,
          id: globalItemId(sound.id, item.id),
          stageId: 'families',
          soundId: sound.id,
          familyId: globalItemId(sound.id, family.id),
          familyBase: family.base,
          familyIpa: family.ipa,
          spelling: family.spelling,
          prompt: item.word,
          detail: `${item.section === 'onset' ? 'Onset' : 'Coda'} ${item.token} - ${family.base}`,
          type: 'family',
          patternIds: item.patternIds.map((patternId) => globalItemId(sound.id, patternId)),
        }))),
      };
      stages.mastery = [...sound.onsets, ...sound.codas].map((pattern, orderIndex) => {
        const patternId = globalItemId(sound.id, pattern.id);
        const words = phraseWords(sound, pattern);
        return {
          id: `${patternId}:mastery`,
          stageId: 'mastery',
          soundId: sound.id,
          prompt: words.join(' / '),
          ipa: `/${sound.ipa}/`,
          detail: `${pattern.direction === 'onset' ? 'Onset' : 'Coda'} ${pattern.token}`,
          type: 'mastery',
          token: pattern.token,
          direction: pattern.direction,
          sourcePatternId: patternId,
          patternIds: [patternId],
          orderIndex,
        };
      });
      stagesBySound.set(sound.id, stages);
      const groups = sound.families.map((family) => {
        const familyId = globalItemId(sound.id, family.id);
        const items = stages.families.filter((item) => item.familyId === familyId);
        return { ...family, id: familyId, items, startIndex: stages.families.indexOf(items[0]) };
      });
      familyGroupsBySound.set(sound.id, groups);
      for (const items of Object.values(stages)) {
        for (const item of items) itemById.set(item.id, item);
      }
    }
  }

  function hydratePatternStats() {
    for (const attempt of state.recentAttempts) {
      const item = itemById.get(attempt.itemId);
      if ((!attempt.patternIds || !attempt.patternIds.length) && item) attempt.patternIds = item.patternIds || [];
    }
    if (Object.keys(state.patternStats || {}).length) return;
    state.patternStats = {};
    for (const sound of sounds) {
      const stages = stagesFor(sound.id);
      for (const item of [...stages.onsets, ...stages.codas, ...stages.families]) {
        const source = core.normalizeStat(state.itemStats[item.id]);
        if (!source.attempts && !source.skips) continue;
        for (const patternId of new Set(item.patternIds || [])) {
          const target = core.normalizeStat(state.patternStats[patternId]);
          target.attempts += source.attempts;
          target.correct += source.correct;
          target.skips += source.skips;
          target.lastAttemptAt = Math.max(target.lastAttemptAt, source.lastAttemptAt);
          target.completedAt = target.completedAt || source.completedAt;
          for (const [arpa, count] of Object.entries(source.wrongVowels)) target.wrongVowels[arpa] = (target.wrongVowels[arpa] || 0) + count;
          state.patternStats[patternId] = target;
        }
      }
    }
  }

  function ensureProgressHistory() {
    state.progressHistory = state.progressHistory || {};
    state.progressBaselines = state.progressBaselines || {};
    state.progressUnlocks = state.progressUnlocks || {};
    for (const sound of sounds) {
      if (!state.progressUnlocks[sound.id]) {
        state.progressHistory[sound.id] = [];
        delete state.progressBaselines[sound.id];
        if (!historyFoundationComplete(sound.id)) continue;
        unlockProgressHistory(sound.id);
      }
      const current = core.summaryForPatternIds(state, patternIdsForSound(sound.id));
      if (current.attempted > 0) core.recordProgressSnapshot(state, sound.id, current, Date.now());
    }
  }

  function historyFoundationIds(soundId) {
    return ['pure', 'onsets', 'codas'].flatMap((stageId) => idsForStage(soundId, stageId));
  }

  function historyFoundationSummary(soundId) {
    return core.summaryForIds(state, historyFoundationIds(soundId));
  }

  function historyFoundationComplete(soundId) {
    const foundation = historyFoundationSummary(soundId);
    return foundation.total > 0 && foundation.completed === foundation.total;
  }

  function unlockProgressHistory(soundId, timestamp = Date.now()) {
    state.progressUnlocks = state.progressUnlocks || {};
    if (state.progressUnlocks[soundId]) return false;
    state.progressHistory[soundId] = [];
    delete state.progressBaselines[soundId];
    state.progressUnlocks[soundId] = {
      at: timestamp,
      day: core.dayKey(timestamp),
      afterStage: 'codas',
    };
    return true;
  }

  function storageArea() {
    return globalThis.chrome && chrome.storage && chrome.storage.local ? chrome.storage.local : null;
  }

  async function readStates() {
    const area = storageArea();
    if (area) {
      const result = await area.get([STORAGE_KEY, LEGACY_KEY]);
      return [result[STORAGE_KEY], result[LEGACY_KEY]];
    }
    try {
      return [JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'), JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null')];
    } catch (_) {
      return [null, null];
    }
  }

  function writeState() {
    const area = storageArea();
    if (area) return area.set({ [STORAGE_KEY]: state });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* unavailable */ }
    return Promise.resolve();
  }

  function scheduleSave(delay = 200) {
    if (saveTimer) return;
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      writeState().catch(() => {});
    }, delay);
  }

  function stagesFor(soundId) {
    return stagesBySound.get(soundId) || stagesBySound.get('uh');
  }

  function currentSound() {
    return soundById.get(state.cursor.soundId) || sounds[0];
  }

  function queueKeyForItem(item) {
    const familySuffix = item.stageId === 'families' && item.familyId ? `:${item.familyId}` : '';
    return `${item.soundId}:${item.stageId}${familySuffix}`;
  }

  function masteryState(soundId) {
    const items = stagesFor(soundId).mastery;
    const stats = items.map((item) => core.normalizeStat(state.patternStats[item.sourcePatternId]));
    const goal = core.nextMasteryGoal(stats);
    const eligible = goal === null ? [] : items
      .filter((item) => (core.accuracy(state.patternStats[item.sourcePatternId]) ?? 0) < goal)
      .sort((a, b) => {
        const aAccuracy = core.accuracy(state.patternStats[a.sourcePatternId]) ?? 0;
        const bAccuracy = core.accuracy(state.patternStats[b.sourcePatternId]) ?? 0;
        return aAccuracy - bAccuracy || a.orderIndex - b.orderIndex;
      });
    return { goal, eligible, mastered: goal === null };
  }

  function initializeMasteryMilestones(soundId) {
    state.masteryMilestones = state.masteryMilestones || {};
    for (const item of stagesFor(soundId).mastery) {
      if (state.masteryMilestones[item.sourcePatternId] !== undefined) continue;
      const current = core.accuracy(state.patternStats[item.sourcePatternId]) ?? 0;
      state.masteryMilestones[item.sourcePatternId] = core.masteryBand(current);
    }
  }

  function masteryGateProgress(soundId, mastery = masteryState(soundId)) {
    if (mastery.mastered) return { completed: 0, total: 0, remaining: 0 };
    state.masteryGates = state.masteryGates || {};
    let gate = state.masteryGates[soundId];
    let changed = false;
    if (!gate || gate.goal !== mastery.goal || !Array.isArray(gate.patternIds)) {
      gate = {
        goal: mastery.goal,
        patternIds: mastery.eligible.map((item) => item.sourcePatternId),
        startedAt: Date.now(),
      };
      state.masteryGates[soundId] = gate;
      changed = true;
    } else {
      const cohort = new Set(gate.patternIds);
      for (const item of mastery.eligible) {
        if (cohort.has(item.sourcePatternId)) continue;
        cohort.add(item.sourcePatternId);
        changed = true;
      }
      gate.patternIds = [...cohort];
    }
    if (changed) scheduleSave();
    const completed = gate.patternIds.filter((patternId) => (
      (core.accuracy(state.patternStats[patternId]) ?? 0) >= mastery.goal
    )).length;
    return {
      completed,
      total: gate.patternIds.length,
      remaining: Math.max(0, gate.patternIds.length - completed),
    };
  }

  function masteryStepProgress(soundId, mastery = masteryState(soundId)) {
    if (mastery.mastered) return null;
    const items = stagesFor(soundId).mastery;
    const stats = items.map((item) => state.patternStats[item.sourcePatternId]);
    const step = core.nextMasteryStep(stats, mastery.goal);
    if (!step) return null;
    const remainingItems = step.remainingIndexes.map((index) => items[index]);
    return {
      ...step,
      onsets: remainingItems.filter((item) => item.direction === 'onset').length,
      codas: remainingItems.filter((item) => item.direction === 'coda').length,
    };
  }

  function masteryStepLabel(step) {
    const parts = [];
    if (step.onsets) parts.push(`${step.onsets} onset${step.onsets === 1 ? '' : 's'}`);
    if (step.codas) parts.push(`${step.codas} coda${step.codas === 1 ? '' : 's'}`);
    const remaining = parts.length ? parts.join(' + ') : 'No patterns';
    return `${remaining} left to ${step.goal}% \u00B7 ~${step.correctAttempts} correct`;
  }

  function selectMasteryItem(soundId, excludeId = '') {
    initializeMasteryMilestones(soundId);
    const mastery = masteryState(soundId);
    if (mastery.mastered) {
      state.cursor.complete = true;
      return null;
    }
    const candidate = mastery.eligible.find((item) => item.id !== excludeId) || mastery.eligible[0];
    state.cursor.stageId = 'mastery';
    state.cursor.masteryPatternId = candidate.id;
    state.cursor.index = Math.max(0, stagesFor(soundId).mastery.findIndex((item) => item.id === candidate.id));
    delete state.cursor.complete;
    return candidate;
  }

  function currentItem() {
    if (state.targeted && itemById.has(state.targeted.itemId)) return itemById.get(state.targeted.itemId);
    if (state.cursor.revisitId && itemById.has(state.cursor.revisitId)) return itemById.get(state.cursor.revisitId);
    if (state.cursor.stageId === 'mastery') {
      const mastery = masteryState(state.cursor.soundId);
      const preferred = itemById.get(state.cursor.masteryPatternId);
      if (mastery.mastered) return preferred || stagesFor(state.cursor.soundId).mastery.at(-1) || null;
      if (preferred && mastery.eligible.some((item) => item.id === preferred.id)) return preferred;
      return selectMasteryItem(state.cursor.soundId);
    }
    const items = stagesFor(state.cursor.soundId)[state.cursor.stageId] || [];
    return items[Math.min(Math.max(0, Number(state.cursor.index) || 0), Math.max(0, items.length - 1))] || null;
  }

  function itemStat(item = currentItem()) {
    return core.normalizeStat(item && state.itemStats[item.id]);
  }

  function idsForSound(soundId) {
    const stages = stagesFor(soundId);
    return stageOrder.flatMap((stageId) => stages[stageId].map((item) => item.id));
  }

  function patternIdsForSound(soundId) {
    const stages = stagesFor(soundId);
    return [...stages.onsets, ...stages.codas].map((item) => item.id);
  }

  function currentFamily(item = currentItem()) {
    if (!item || item.stageId !== 'families') return null;
    return (familyGroupsBySound.get(item.soundId) || []).find((family) => family.id === item.familyId) || null;
  }

  function familySummary(family) {
    return core.summaryForIds(state, family ? family.items.map((item) => item.id) : []);
  }

  function idsForStage(soundId, stageId) {
    return stagesFor(soundId)[stageId].map((item) => item.id);
  }

  function firstIncompleteCursor(soundId) {
    const stages = stagesFor(soundId);
    for (const stageId of foundationStages) {
      const index = stages[stageId].findIndex((item) => itemStat(item).correct < core.REQUIRED_CORRECT);
      if (index >= 0) return { soundId, stageId, index };
    }
    const mastery = masteryState(soundId);
    if (!mastery.mastered) {
      const item = mastery.eligible[0];
      return { soundId, stageId: 'mastery', index: stages.mastery.indexOf(item), masteryPatternId: item.id };
    }
    return { soundId, stageId: 'mastery', index: Math.max(0, stages.mastery.length - 1), masteryPatternId: stages.mastery.at(-1)?.id, complete: true };
  }

  function normalizeCursor() {
    if (!soundById.has(state.cursor.soundId)) state.cursor = firstIncompleteCursor('uh');
    if (state.cursor.complete && !masteryState(state.cursor.soundId).mastered) state.cursor = firstIncompleteCursor(state.cursor.soundId);
    if (!stageOrder.includes(state.cursor.stageId)) state.cursor.stageId = 'pure';
    if (state.cursor.stageId === 'mastery') {
      initializeMasteryMilestones(state.cursor.soundId);
      const mastery = masteryState(state.cursor.soundId);
      if (mastery.mastered) state.cursor.complete = true;
      else if (!mastery.eligible.some((item) => item.id === state.cursor.masteryPatternId)) selectMasteryItem(state.cursor.soundId);
      return;
    }
    const items = stagesFor(state.cursor.soundId)[state.cursor.stageId];
    state.cursor.index = Math.min(Math.max(0, Number(state.cursor.index) || 0), Math.max(0, items.length - 1));
  }

  function setSound(soundId) {
    if (!soundById.has(soundId) || soundId === state.cursor.soundId) return;
    state.soundCursors[state.cursor.soundId] = { ...state.cursor };
    state.cursor = state.soundCursors[soundId] || firstIncompleteCursor(soundId);
    state.cursor.soundId = soundId;
    state.targeted = null;
    resetItemSession();
    renderAll();
    scheduleSave();
  }

  function resetItemSession() {
    clearBurst();
    advancing = false;
    itemStartedAt = performance.now();
  }

  function selectFamily(familyId) {
    const family = (familyGroupsBySound.get(state.cursor.soundId) || []).find((entry) => entry.id === familyId);
    if (!family || state.targeted) return;
    state.cursor.stageId = 'families';
    state.cursor.index = family.startIndex + Math.max(0, family.items.findIndex((item) => itemStat(item).correct < core.REQUIRED_CORRECT));
    delete state.cursor.revisitId;
    delete state.cursor.complete;
    resetItemSession();
    renderAll();
    scheduleSave();
  }

  function unlockAudio() {
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
    } catch (_) { /* audio is optional */ }
  }

  function playCelebrationSound() {
    unlockAudio();
    if (!audioContext) return;
    const now = audioContext.currentTime;
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = now + index * 0.085;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.24);
    });
  }

  function playCorrectSound() {
    unlockAudio();
    if (!audioContext) return;
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(659.25, now);
    oscillator.frequency.exponentialRampToValueAtTime(783.99, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.15);
  }

  function acknowledgeCorrectAttempt() {
    if (!shell) return;
    const card = shell.querySelector('.bv-prompt-card');
    window.clearTimeout(correctCueTimer);
    card.classList.remove('is-correct-pulse');
    void card.offsetWidth;
    card.classList.add('is-correct-pulse');
    playCorrectSound();
    correctCueTimer = window.setTimeout(() => card.classList.remove('is-correct-pulse'), 440);
  }

  function celebrate(label = '10 complete') {
    if (!shell) return;
    const element = shell.querySelector('.bv-celebration');
    window.clearTimeout(celebrationTimer);
    element.querySelector('strong').textContent = label;
    element.classList.remove('is-active');
    void element.offsetWidth;
    element.classList.add('is-active');
    element.setAttribute('aria-hidden', 'false');
    playCelebrationSound();
    celebrationTimer = window.setTimeout(() => {
      element.classList.remove('is-active');
      element.setAttribute('aria-hidden', 'true');
    }, 1050);
  }

  function setView(view) {
    state.view = view === 'freeplay' ? 'freeplay' : 'guided';
    clearBurst();
    renderView();
    scheduleSave();
  }

  function toggleTrainingPaused() {
    trainingPaused = !trainingPaused;
    clearBurst();
    clearSuccessRearm();
    itemStartedAt = performance.now();
    lastActivityAt = 0;
    setFeedback(trainingPaused ? 'Training paused - voice attempts are ignored' : 'Training resumed - ready for your next attempt');
    renderAll();
  }

  function createSummary(row) {
    summary = document.createElement('section');
    summary.id = 'bv-guided-summary';
    summary.innerHTML = [
      '<div class="bv-summary-title"><span>Training progress</span><strong>Vowel Lab</strong></div>',
      '<div class="bv-summary-stat"><span>Today</span><strong data-summary="today">0m</strong></div>',
      '<div class="bv-summary-stat"><span>Attempts</span><strong data-summary="attempts">0</strong></div>',
      '<div class="bv-summary-stat"><span>Overall</span><strong data-summary="overall">--</strong></div>',
      '<div class="bv-summary-stat"><span>Current sound</span><strong data-summary="sound">--</strong></div>',
      '<div class="bv-summary-stat"><span>Coverage</span><strong data-summary="coverage">0%</strong></div>',
      '<button type="button" class="bv-summary-progress">Progress</button>',
    ].join('');
    summary.querySelector('.bv-summary-progress').addEventListener('click', openModal);
    row.insertBefore(summary, row.firstChild);
  }

  function createShell(row) {
    shell = document.createElement('section');
    shell.id = 'bv-guided-training';
    shell.innerHTML = [
      '<div class="bv-guide-header">',
      '  <div><span class="bv-guide-kicker">Pronunciation course</span><strong>Vowel evolution</strong></div>',
      '  <div class="bv-guide-actions">',
      '    <button type="button" class="bv-guide-pause" aria-pressed="false" title="Pause pronunciation training"><i aria-hidden="true">&#10074;&#10074;</i><span>Pause</span></button>',
      '    <button type="button" class="bv-guide-progress">Progress</button>',
      '  </div>',
      '</div>',
      '<div class="bv-guide-tabs" role="tablist" aria-label="Training mode">',
      '  <button type="button" role="tab" data-view="guided">Guided</button>',
      '  <button type="button" role="tab" data-view="freeplay">Free Play</button>',
      '</div>',
      '<div class="bv-guide-pane">',
      '  <div class="bv-guide-toolbar">',
      '    <label for="bv-guide-sound">Target vowel</label>',
      '    <select id="bv-guide-sound"></select>',
      '  </div>',
      '  <div class="bv-family-toolbar" hidden>',
      '    <label for="bv-guide-family">Base word</label>',
      '    <select id="bv-guide-family"></select>',
      '    <span data-family-progress></span>',
      '  </div>',
      '  <div class="bv-stage-track" aria-label="Curriculum stages"></div>',
      '  <div class="bv-stage-progress">',
      '    <div class="bv-stage-progress-head"><span data-stage-progress-label>Stage total</span><strong data-stage-progress-value>0/0 correct</strong></div>',
      '    <div class="bv-stage-progress-track" role="progressbar" aria-label="Stage correct repetitions" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span></span></div>',
      '    <small data-stage-progress-detail>0/0 drills complete</small>',
      '  </div>',
      '  <div class="bv-targeted-banner" hidden><span>Targeted practice</span><button type="button">Return</button></div>',
      '  <div class="bv-prompt-card">',
      '    <div class="bv-prompt-meta"><span data-prompt="stage"></span><span data-prompt="position"></span></div>',
      '    <strong class="bv-prompt-value" data-prompt="value">UH</strong>',
      '    <div class="bv-prompt-ipa" data-prompt="ipa">/ʌ/</div>',
      '    <div class="bv-prompt-detail" data-prompt="detail">Pure sound</div>',
      '    <div class="bv-celebration" aria-hidden="true"><strong>10 complete</strong><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>',
      '    <div class="bv-strike-state" data-phase="ready" aria-live="polite">',
      '      <div class="bv-strike-copy"><i></i><span><strong>Ready</strong><small>Next attempt will count</small></span></div>',
      '      <div class="bv-reload-track" aria-hidden="true"><span></span></div>',
      '    </div>',
      '  </div>',
      '  <div class="bv-repetition-row"><span data-guide="repetition-label">Correct repetitions</span><strong data-guide="repetitions">0/10</strong></div>',
      '  <div class="bv-repetition-track"><span></span></div>',
      '  <div class="bv-guide-metrics">',
      '    <div><span>Attempts</span><strong data-guide="attempts">0</strong></div>',
      '    <div><span>Accuracy</span><strong data-guide="accuracy">--</strong></div>',
      '    <div><span>Sound score</span><strong data-guide="sound-score">--</strong></div>',
      '    <div><span>Coverage</span><strong data-guide="coverage">0%</strong></div>',
      '  </div>',
      '  <div class="bv-guide-feedback" aria-live="polite">Waiting for voice</div>',
      '  <button type="button" class="bv-guide-skip" hidden>Skip for now</button>',
      '</div>',
      '<div class="bv-freeplay-pane" hidden></div>',
    ].join('');

    const select = shell.querySelector('#bv-guide-sound');
    select.innerHTML = sounds.map((sound) => `<option value="${sound.id}">${sound.label} /${sound.ipa}/ - ${sound.keyword}</option>`).join('');
    select.addEventListener('change', () => setSound(select.value));
    shell.querySelector('#bv-guide-family').addEventListener('change', (event) => selectFamily(event.target.value));
    shell.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
    shell.querySelector('.bv-guide-pause').addEventListener('click', toggleTrainingPaused);
    shell.querySelector('.bv-guide-progress').addEventListener('click', openModal);
    shell.querySelector('.bv-guide-skip').addEventListener('click', skipCurrentItem);
    shell.querySelector('.bv-targeted-banner button').addEventListener('click', stopTargetedTraining);
    row.appendChild(shell);
    shell.addEventListener('pointerdown', unlockAudio, { once: true });

    const oldGame = document.getElementById('bv-ih-flight-game');
    if (oldGame) shell.querySelector('.bv-freeplay-pane').appendChild(oldGame);
    const oldStats = document.getElementById('bv-training-stats');
    if (oldStats) oldStats.hidden = true;
  }

  function createModal() {
    modal = document.createElement('div');
    modal.id = 'bv-progress-modal';
    modal.hidden = true;
    modal.innerHTML = '<div class="bv-modal-backdrop"></div><section class="bv-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="bv-modal-title"></section>';
    modal.querySelector('.bv-modal-backdrop').addEventListener('click', closeModal);
    document.body.appendChild(modal);
  }

  function renderView() {
    if (!shell) return;
    const guided = state.view !== 'freeplay';
    shell.querySelector('.bv-guide-pane').hidden = !guided;
    shell.querySelector('.bv-freeplay-pane').hidden = guided;
    const pauseButton = shell.querySelector('.bv-guide-pause');
    pauseButton.hidden = !guided;
    pauseButton.setAttribute('aria-pressed', trainingPaused ? 'true' : 'false');
    pauseButton.setAttribute('title', trainingPaused ? 'Resume pronunciation training' : 'Pause pronunciation training');
    pauseButton.querySelector('i').textContent = trainingPaused ? '\u25B6' : '\u275A\u275A';
    pauseButton.querySelector('span').textContent = trainingPaused ? 'Resume' : 'Pause';
    shell.querySelectorAll('[data-view]').forEach((button) => {
      const selected = button.dataset.view === state.view;
      button.dataset.selected = selected ? 'true' : 'false';
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    shell.dataset.view = state.view;
  }

  function percent(value) {
    return value === null || !Number.isFinite(value) ? '--' : `${Math.round(value)}%`;
  }

  function formatTime(milliseconds) {
    const minutes = Math.floor((Number(milliseconds) || 0) / 60000);
    if (minutes < 1) return `${Math.floor((Number(milliseconds) || 0) / 1000)}s`;
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  function setFeedback(message, result = '', scoreChange = null) {
    if (!shell) return;
    const feedback = shell.querySelector('.bv-guide-feedback');
    feedback.replaceChildren();
    if (result) feedback.dataset.result = result;
    else delete feedback.dataset.result;
    if (!scoreChange) {
      delete feedback.dataset.trend;
      feedback.textContent = message;
      return;
    }

    const trend = scoreChange.direction === 'up' ? 'up' : 'down';
    const icon = document.createElement('i');
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    const detail = document.createElement('small');
    feedback.dataset.trend = trend;
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = trend === 'up' ? '\u2191' : '\u2193';
    title.textContent = message;
    const delta = Number(scoreChange.delta) || 0;
    detail.textContent = `${scoreChange.accuracy.toFixed(1)}% (${delta > 0 ? '+' : ''}${delta.toFixed(1)} pts)`;
    copy.append(title, detail);
    feedback.append(icon, copy);
  }

  function renderSummary() {
    if (!summary) return;
    const today = state.daily[core.dayKey(Date.now())] || { attempts: 0, practiceMs: 0 };
    const soundSummaries = sounds.map((sound) => core.summaryForPatternIds(state, patternIdsForSound(sound.id)));
    const soundScores = soundSummaries.map((item) => item.accuracy).filter((value) => value !== null);
    const overall = soundScores.length ? soundScores.reduce((total, value) => total + value, 0) / soundScores.length : null;
    const current = core.summaryForPatternIds(state, patternIdsForSound(state.cursor.soundId));
    summary.querySelector('[data-summary="today"]').textContent = formatTime(today.practiceMs || 0);
    summary.querySelector('[data-summary="attempts"]').textContent = String(today.attempts || 0);
    summary.querySelector('[data-summary="overall"]').textContent = percent(overall);
    summary.querySelector('[data-summary="sound"]').textContent = percent(current.accuracy);
    summary.querySelector('[data-summary="coverage"]').textContent = percent(current.coverage);
  }

  function renderStageTrack() {
    const track = shell.querySelector('.bv-stage-track');
    const activeItem = currentItem();
    const soundId = activeItem ? activeItem.soundId : state.cursor.soundId;
    const activeStageId = state.targeted ? state.targeted.stageId : state.cursor.stageId;
    const activeIndex = stageOrder.indexOf(activeStageId);
    const activeFamily = activeStageId === 'families' ? currentFamily(activeItem) : null;
    track.innerHTML = stageOrder.map((stageId, index) => {
      const summaryData = core.summaryForIds(state, idsForStage(soundId, stageId));
      const complete = stageId === 'mastery'
        ? masteryState(soundId).mastered
        : summaryData.completed === summaryData.total && summaryData.total > 0;
      return `<div data-active="${index === activeIndex}" data-complete="${complete}"><i>${complete ? '&#10003;' : index + 1}</i><span>${stageLabels[stageId].replace(' transitions', '')}</span></div>`;
    }).join('');

    const stageProgress = shell.querySelector('.bv-stage-progress');
    stageProgress.hidden = activeStageId === 'mastery';
    if (activeStageId !== 'mastery') {
      const progressIds = activeFamily
        ? activeFamily.items.map((item) => item.id)
        : idsForStage(soundId, activeStageId);
      const repetition = core.repetitionProgress(state, progressIds);
      const progressTrack = stageProgress.querySelector('.bv-stage-progress-track');
      stageProgress.querySelector('[data-stage-progress-label]').textContent = activeFamily
        ? `${activeFamily.base} family total`
        : `${stageLabels[activeStageId]} total`;
      stageProgress.querySelector('[data-stage-progress-value]').textContent = `${repetition.correct}/${repetition.totalCorrect} correct`;
      stageProgress.querySelector('[data-stage-progress-detail]').textContent = `${repetition.completed}/${repetition.totalItems} drills complete`;
      progressTrack.setAttribute('aria-valuemax', String(repetition.totalCorrect));
      progressTrack.setAttribute('aria-valuenow', String(repetition.correct));
      progressTrack.setAttribute('aria-valuetext', `${repetition.correct} of ${repetition.totalCorrect} correct repetitions; ${repetition.completed} of ${repetition.totalItems} drills complete`);
      progressTrack.querySelector('span').style.width = `${repetition.percent}%`;
    }
  }

  function renderGuide() {
    if (!shell) return;
    normalizeCursor();
    const item = currentItem();
    if (!item) return;
    const sound = soundById.get(item.soundId);
    const stat = itemStat(item);
    const isMastery = item.stageId === 'mastery';
    const patternStat = isMastery ? core.normalizeStat(state.patternStats[item.sourcePatternId]) : stat;
    const targetedStart = state.targeted && state.targeted.itemId === item.id ? state.targeted.startCorrect : null;
    const shownCorrect = targetedStart !== null && targetedStart >= core.REQUIRED_CORRECT
      ? stat.correct - targetedStart
      : stat.correct;
    const stageItems = stagesFor(item.soundId)[item.stageId];
    const family = currentFamily(item);
    const displayedItems = family ? family.items : stageItems;
    const position = displayedItems.findIndex((entry) => entry.id === item.id);
    const soundSummary = core.summaryForPatternIds(state, patternIdsForSound(item.soundId));
    const skipReady = !isMastery && core.canSkip(stat, performance.now() - itemStartedAt);
    const active = Boolean(burst);

    shell.querySelector('#bv-guide-sound').value = sound.id;
    shell.querySelector('[data-prompt="stage"]').textContent = stageLabels[item.stageId];
    const mastery = isMastery ? masteryState(item.soundId) : null;
    const masteryComplete = isMastery && mastery.mastered;
    const masteryStep = isMastery && !masteryComplete ? masteryStepProgress(item.soundId, mastery) : null;
    shell.querySelector('[data-prompt="position"]').textContent = isMastery
      ? masteryComplete
        ? 'Officially mastered'
        : masteryStepLabel(masteryStep)
      : `${Math.max(1, position + 1)} / ${displayedItems.length}`;
    shell.querySelector('[data-prompt="value"]').textContent = item.prompt;
    const itemIpa = item.promptIpa || item.ipa;
    shell.querySelector('[data-prompt="ipa"]').textContent = itemIpa ? (itemIpa.startsWith('/') ? itemIpa : `/${itemIpa}/`) : `/${sound.ipa}/`;
    const patternAccuracy = core.accuracy(patternStat) ?? 0;
    const nextMilestone = isMastery ? (masteryComplete ? 95 : Math.min(mastery.goal, core.masteryBand(patternAccuracy) + 5)) : null;
    shell.querySelector('[data-prompt="detail"]').textContent = item.type === 'family'
      ? `${item.real ? 'Real word' : 'Drill only'} - ${item.detail} - compare with ${item.familyBase}`
      : isMastery
        ? masteryComplete
          ? `${sound.label} officially mastered - every pattern is at least 95%`
          : `${item.detail} - ${patternAccuracy.toFixed(1)}% now - next full step ${masteryStep.goal}% - mastery target ${mastery.goal}%`
        : item.detail;
    const repetitionLabel = shell.querySelector('[data-guide="repetition-label"]');
    const masteryTrend = isMastery ? shell.querySelector('.bv-guide-feedback').dataset.trend || '' : '';
    repetitionLabel.textContent = isMastery ? 'Next pattern level' : 'Correct repetitions';
    if (masteryTrend) repetitionLabel.dataset.trend = masteryTrend;
    else delete repetitionLabel.dataset.trend;
    shell.querySelector('[data-guide="repetitions"]').textContent = isMastery
      ? masteryComplete ? '95%+ complete' : `${patternAccuracy.toFixed(1)}% / ${nextMilestone}%`
      : `${Math.min(core.REQUIRED_CORRECT, shownCorrect)}/${core.REQUIRED_CORRECT}`;
    shell.querySelector('.bv-repetition-track span').style.width = isMastery
      ? masteryComplete ? '100%' : `${Math.min(100, (patternAccuracy / mastery.goal) * 100)}%`
      : `${Math.min(100, (shownCorrect / core.REQUIRED_CORRECT) * 100)}%`;
    shell.querySelector('[data-guide="attempts"]').textContent = String(patternStat.attempts);
    shell.querySelector('[data-guide="accuracy"]').textContent = percent(core.accuracy(patternStat));
    shell.querySelector('[data-guide="sound-score"]').textContent = percent(soundSummary.accuracy);
    shell.querySelector('[data-guide="coverage"]').textContent = percent(soundSummary.coverage);
    shell.querySelector('.bv-guide-skip').hidden = isMastery || !skipReady || advancing || trainingPaused;
    shell.querySelector('.bv-prompt-card').dataset.active = active ? 'true' : 'false';
    shell.querySelector('.bv-prompt-card').dataset.stage = item.stageId;
    shell.dataset.paused = trainingPaused ? 'true' : 'false';
    renderStrikeState();
    const banner = shell.querySelector('.bv-targeted-banner');
    banner.hidden = !state.targeted;
    const familyToolbar = shell.querySelector('.bv-family-toolbar');
    familyToolbar.hidden = !family || Boolean(state.targeted);
    if (family && !state.targeted) {
      const familySelect = shell.querySelector('#bv-guide-family');
      const groups = familyGroupsBySound.get(item.soundId) || [];
      familySelect.innerHTML = groups.map((entry) => {
        const repetitions = core.repetitionProgress(state, entry.items.map((familyItem) => familyItem.id));
        return `<option value="${entry.id}">${entry.base} - ${repetitions.completed}/${repetitions.totalItems} drills - ${repetitions.correct}/${repetitions.totalCorrect}</option>`;
      }).join('');
      familySelect.value = family.id;
      const repetitions = core.repetitionProgress(state, family.items.map((familyItem) => familyItem.id));
      familyToolbar.querySelector('[data-family-progress]').innerHTML = [
        `<span>${repetitions.completed}/${repetitions.totalItems} drills complete \u00B7 ${repetitions.correct}/${repetitions.totalCorrect} correct</span>`,
        `<i aria-hidden="true"><b style="width:${repetitions.percent}%"></b></i>`,
      ].join('');
    }
    if (masteryComplete) {
      const feedback = shell.querySelector('.bv-guide-feedback');
      if (!feedback.dataset.trend) setFeedback(`${sound.label} sound officially mastered`, 'correct');
    }
    renderStageTrack();
  }

  function renderAll() {
    renderView();
    renderGuide();
    renderSummary();
    if (modal && !modal.hidden) renderModal();
  }

  function clearBurst() {
    if (burstTimer) window.clearTimeout(burstTimer);
    if (strikeFrame) window.cancelAnimationFrame(strikeFrame);
    burstTimer = 0;
    strikeFrame = 0;
    burst = null;
    renderStrikeState();
  }

  function finishSuccessRearm() {
    const remaining = successRearmUntil - performance.now();
    if (remaining > 0) {
      successRearmTimer = window.setTimeout(finishSuccessRearm, remaining);
      return;
    }
    successRearmTimer = 0;
    successRearmStartedAt = 0;
    successRearmUntil = 0;
    renderStrikeState();
  }

  function clearSuccessRearm() {
    if (successRearmTimer) window.clearTimeout(successRearmTimer);
    successRearmTimer = 0;
    successRearmStartedAt = 0;
    successRearmUntil = 0;
  }

  function armSuccessRearm(timestamp = performance.now()) {
    if (successRearmTimer) window.clearTimeout(successRearmTimer);
    successRearmStartedAt = timestamp;
    successRearmUntil = timestamp + SUCCESS_REARM_MS;
    successRearmTimer = window.setTimeout(finishSuccessRearm, SUCCESS_REARM_MS);
    startStrikeAnimation();
  }

  function startStrikeAnimation() {
    if (!strikeFrame) strikeFrame = window.requestAnimationFrame(updateStrikeAnimation);
  }

  function updateStrikeAnimation(timestamp) {
    strikeFrame = 0;
    renderStrikeState(timestamp);
    if (burst || advancing || successRearmUntil) strikeFrame = window.requestAnimationFrame(updateStrikeAnimation);
  }

  function renderStrikeState(timestamp = performance.now()) {
    if (!shell) return;
    const element = shell.querySelector('.bv-strike-state');
    if (!element) return;
    const title = element.querySelector('strong');
    const detail = element.querySelector('small');
    const bar = element.querySelector('.bv-reload-track span');
    let phase = 'ready';
    let progress = 100;

    if (trainingPaused) {
      phase = 'paused';
      progress = 0;
      title.textContent = 'Paused';
      detail.textContent = 'Voice attempts are not counted';
    } else if (state.cursor.complete && !state.targeted) {
      phase = 'complete';
      progress = 100;
      title.textContent = 'Mastered';
      detail.textContent = 'Choose another vowel to continue';
    } else if (advancing) {
      phase = 'advancing';
      progress = 100;
      title.textContent = 'Next drill';
      detail.textContent = 'Preparing the next prompt';
    } else if (successRearmUntil) {
      const elapsed = Math.max(0, timestamp - successRearmStartedAt);
      phase = 'reloading';
      progress = Math.min(100, (elapsed / SUCCESS_REARM_MS) * 100);
      title.textContent = 'Finishing word';
      detail.textContent = 'Pause until Ready returns';
    } else if (burst) {
      const quietFor = Math.max(0, timestamp - burst.lastSampleAt);
      if (quietFor < 18) {
        const item = currentItem();
        const sound = item && soundById.get(item.soundId);
        const targetDwell = sound ? core.focusDwell(burst, sound.arpa) : 0;
        phase = 'listening';
        progress = Math.min(100, (targetDwell / MIN_FOCUS_DWELL_MS) * 100);
        title.textContent = targetDwell >= MIN_FOCUS_DWELL_MS ? 'Target held' : 'Hold vowel';
        detail.textContent = targetDwell >= MIN_FOCUS_DWELL_MS ? 'Finish, then pause briefly' : 'Stay inside the target circle';
      } else {
        phase = 'reloading';
        progress = Math.min(100, (quietFor / BURST_GAP_MS) * 100);
        title.textContent = 'Wait';
        detail.textContent = 'Pause until the check returns';
      }
    } else {
      title.textContent = 'Ready';
      detail.textContent = 'Your next attempt will count';
    }

    element.dataset.phase = phase;
    bar.style.width = `${progress}%`;
  }

  function parseDetail(detail) {
    try { return typeof detail === 'string' ? JSON.parse(detail) : detail; } catch (_) { return null; }
  }

  function handleVowelEvent(payload) {
    currentPayload = payload;
    const now = performance.now();
    if (trainingPaused) {
      if (burst || burstTimer) clearBurst();
      renderGuide();
      return;
    }
    if (payload && (payload.live || payload.focused)) lastActivityAt = now;
    if (successRearmUntil) {
      if (payload && payload.live) armSuccessRearm(now);
      else if (now >= successRearmUntil) finishSuccessRearm();
    }
    if (!shell || state.view !== 'guided' || advancing || (state.cursor.complete && !state.targeted) || (modal && !modal.hidden)) {
      clearBurst();
      renderGuide();
      return;
    }
    if (successRearmUntil) {
      renderGuide();
      return;
    }
    const item = currentItem();
    const sound = item && soundById.get(item.soundId);
    if (!item || !sound || !payload || !payload.live) {
      renderGuide();
      return;
    }

    if (!burst) burst = { itemId: item.id, soundId: sound.id, ...core.createBurst(sound.arpa), startedAt: performance.now(), lastSampleAt: performance.now() };
    if (burst.itemId !== item.id) clearBurst();
    if (!burst) burst = { itemId: item.id, soundId: sound.id, ...core.createBurst(sound.arpa), startedAt: performance.now(), lastSampleAt: performance.now() };
    burst.lastSampleAt = performance.now();

    const sampleAt = Number(payload.live.at) || performance.now();
    const focusedAt = Number(payload.focusedAt);
    const focusIsFresh = !Number.isFinite(focusedAt) || Math.abs(sampleAt - focusedAt) <= core.FOCUS_CONTINUITY_GAP_MS;
    const focused = payload.focused && focusIsFresh ? String(payload.arpa || '').toUpperCase() : '';
    const nearest = payload.nearest ? String(payload.nearest.arpa || '').toUpperCase() : '';
    core.addBurstSample(burst, focused, nearest, sampleAt);
    if (burstTimer) window.clearTimeout(burstTimer);
    burstTimer = window.setTimeout(finalizeBurst, BURST_GAP_MS);
    startStrikeAnimation();
    renderGuide();
  }

  function finalizeBurst() {
    burstTimer = 0;
    const finished = burst;
    burst = null;
    if (!finished || advancing || state.view !== 'guided' || (modal && !modal.hidden)) return;
    const item = currentItem();
    if (!item || item.id !== finished.itemId) return;
    const sound = soundById.get(item.soundId);
    const result = core.burstResult(finished);
    if (!result.gradable) {
      setFeedback('Not counted - hold a vowel inside its circle longer');
      renderAll();
      return;
    }
    const correct = result.correct;
    if (correct) armSuccessRearm();
    const isMastery = item.stageId === 'mastery';
    const previousPatternAccuracy = isMastery ? (core.accuracy(state.patternStats[item.sourcePatternId]) ?? 0) : null;
    const masteryGoalBefore = isMastery ? masteryState(item.soundId).goal : null;
    const stat = core.recordAttempt(state, {
      at: Date.now(),
      itemId: item.id,
      soundId: item.soundId,
      stageId: item.stageId,
      familyId: item.familyId || null,
      patternId: item.patternId || (item.type === 'pure' ? item.id : `${item.soundId}:${item.type}:${item.token}`),
      patternIds: item.patternIds || [],
      targetArpa: sound.arpa,
      detectedArpa: result.detectedArpa,
      correct,
    });
    if (state.progressUnlocks[item.soundId] || historyFoundationComplete(item.soundId)) {
      unlockProgressHistory(item.soundId);
      core.recordProgressSnapshot(
        state,
        item.soundId,
        core.summaryForPatternIds(state, patternIdsForSound(item.soundId)),
        Date.now(),
      );
    }
    if (isMastery) {
      const nextPatternAccuracy = core.accuracy(state.patternStats[item.sourcePatternId]) ?? 0;
      const scoreChange = {
        direction: correct ? 'up' : 'down',
        accuracy: nextPatternAccuracy,
        delta: nextPatternAccuracy - previousPatternAccuracy,
      };
      setFeedback(
        correct ? 'Successful attempt' : `Missed - closest ${result.detectedArpa}`,
        correct ? 'correct' : 'wrong',
        scoreChange,
      );
      const announced = state.masteryMilestones[item.sourcePatternId] || 0;
      const milestone = core.crossedMasteryMilestone(previousPatternAccuracy, nextPatternAccuracy, announced);
      const reachedGate = masteryGoalBefore !== null && nextPatternAccuracy >= masteryGoalBefore;
      if (milestone) {
        state.masteryMilestones[item.sourcePatternId] = milestone;
        advancing = true;
        const soundMastered = masteryState(item.soundId).mastered;
        celebrate(soundMastered ? `${sound.label} mastered at 95%` : `${item.detail} level ${milestone}%`);
        setFeedback(
          soundMastered ? 'Sound officially mastered' : `Pattern improved to ${milestone}%`,
          'correct',
          scoreChange,
        );
        startStrikeAnimation();
        window.setTimeout(advanceCurrentItem, 1150);
      } else if (reachedGate) {
        if (correct) acknowledgeCorrectAttempt();
        advancing = true;
        setFeedback(`Pattern cleared ${masteryGoalBefore}%`, 'correct', scoreChange);
        startStrikeAnimation();
        window.setTimeout(advanceCurrentItem, 480);
      } else if (correct) {
        acknowledgeCorrectAttempt();
      }
      scheduleSave();
      renderAll();
      return;
    }
    setFeedback(correct ? 'Correct' : `Try again - closest ${result.detectedArpa}`, correct ? 'correct' : 'wrong');
    const reachedGoal = state.targeted
      ? stat.correct >= state.targeted.goalCorrect
      : stat.correct >= core.REQUIRED_CORRECT;
    if (correct && reachedGoal) {
      advancing = true;
      const family = currentFamily(item);
      const familyComplete = family && familySummary(family).completed === family.items.length;
      celebrate(familyComplete ? `${family.base} complete` : '10 complete');
      startStrikeAnimation();
      window.setTimeout(advanceCurrentItem, 1150);
    } else if (correct) {
      acknowledgeCorrectAttempt();
    }
    scheduleSave();
    renderAll();
  }

  function advanceCurrentItem() {
    advancing = false;
    const item = currentItem();
    if (!item) return;
    if (state.targeted) {
      stopTargetedTraining();
      return;
    }
    if (item.stageId === 'mastery') {
      const next = selectMasteryItem(item.soundId, item.id);
      resetItemSession();
      setFeedback(next ? 'Next weakest pattern' : `${currentSound().label} officially mastered`);
      renderAll();
      scheduleSave();
      return;
    }
    if (state.cursor.revisitId) {
      const key = queueKeyForItem(item);
      state.skipQueues[key] = (state.skipQueues[key] || []).filter((id) => id !== state.cursor.revisitId);
      delete state.cursor.revisitId;
      enterRevisitOrNextStage(item);
      return;
    }
    const family = currentFamily(item);
    const endIndex = family ? family.startIndex + family.items.length - 1 : stagesFor(item.soundId)[item.stageId].length - 1;
    if (state.cursor.index >= endIndex) enterRevisitOrNextStage(item);
    else state.cursor.index += 1;
    resetItemSession();
    setFeedback('Next pattern');
    renderAll();
    scheduleSave();
  }

  function enterRevisitOrNextStage(completedItem = currentItem()) {
    if (!completedItem) return;
    const key = queueKeyForItem(completedItem);
    const queue = (state.skipQueues[key] || []).filter((id) => itemById.has(id) && itemStat(itemById.get(id)).correct < core.REQUIRED_CORRECT);
    state.skipQueues[key] = queue;
    if (queue.length) {
      state.cursor.revisitId = queue[0];
      const family = currentFamily(completedItem);
      state.cursor.index = family ? family.startIndex + family.items.length - 1 : Math.max(0, stagesFor(state.cursor.soundId)[state.cursor.stageId].length - 1);
      resetItemSession();
      return;
    }
    if (completedItem.stageId === 'families') {
      const family = currentFamily(completedItem);
      const nextIndex = family ? family.startIndex + family.items.length : stagesFor(completedItem.soundId).families.length;
      if (nextIndex < stagesFor(completedItem.soundId).families.length) {
        state.cursor.index = nextIndex;
        delete state.cursor.revisitId;
      } else {
        state.cursor.stageId = 'mastery';
        delete state.cursor.revisitId;
        selectMasteryItem(completedItem.soundId);
        setFeedback('Calibration phrases unlocked');
      }
      resetItemSession();
      return;
    }
    const stageIndex = stageOrder.indexOf(state.cursor.stageId);
    if (stageIndex < stageOrder.length - 1) {
      state.cursor.stageId = stageOrder[stageIndex + 1];
      state.cursor.index = 0;
      delete state.cursor.revisitId;
    }
    resetItemSession();
  }

  function skipCurrentItem() {
    if (advancing || state.targeted) return;
    const item = currentItem();
    const stat = itemStat(item);
    if (!item || !core.canSkip(stat, performance.now() - itemStartedAt)) return;
    const key = queueKeyForItem(item);
    core.recordSkip(state, item.id, key);
    state.skipQueues[key] = (state.skipQueues[key] || []).filter((id) => id !== item.id);
    state.skipQueues[key].push(item.id);
    if (state.cursor.revisitId) {
      delete state.cursor.revisitId;
      enterRevisitOrNextStage(item);
    } else {
      const family = currentFamily(item);
      const endIndex = family ? family.startIndex + family.items.length - 1 : stagesFor(item.soundId)[item.stageId].length - 1;
      if (state.cursor.index >= endIndex) enterRevisitOrNextStage(item);
      else state.cursor.index += 1;
    }
    resetItemSession();
    setFeedback('Saved for the end of this stage');
    renderAll();
    scheduleSave();
  }

  function startTargetedTraining(itemId) {
    const item = itemById.get(itemId);
    if (!item) return;
    state.previousCursor = { ...state.cursor };
    const existingCorrect = itemStat(item).correct;
    state.targeted = {
      itemId,
      soundId: item.soundId,
      stageId: item.stageId,
      startCorrect: existingCorrect,
      goalCorrect: existingCorrect >= core.REQUIRED_CORRECT ? existingCorrect + core.REQUIRED_CORRECT : core.REQUIRED_CORRECT,
    };
    state.view = 'guided';
    closeModal();
    resetItemSession();
    renderAll();
    scheduleSave();
  }

  function stopTargetedTraining() {
    if (state.previousCursor) state.cursor = state.previousCursor;
    delete state.previousCursor;
    delete state.targeted;
    resetItemSession();
    renderAll();
    scheduleSave();
  }

  function rangeStart() {
    if (modalRange === 'lifetime') return 0;
    const days = modalRange === 'today' ? 1 : modalRange === '7d' ? 7 : 30;
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - 1));
    return date.getTime();
  }

  function statsForPatternInRange(item) {
    if (modalRange === 'lifetime') return core.normalizeStat(state.patternStats[item.id]);
    const attempts = state.recentAttempts.filter((entry) => {
      const memberships = entry.patternIds || (entry.patternId ? [entry.patternId] : []);
      return entry.at >= rangeStart() && (entry.itemId === item.id || memberships.includes(item.id));
    });
    const wrongVowels = {};
    for (const attempt of attempts.filter((entry) => !entry.correct)) {
      const key = attempt.detectedArpa || 'NONE';
      wrongVowels[key] = (wrongVowels[key] || 0) + 1;
    }
    return { attempts: attempts.length, correct: attempts.filter((entry) => entry.correct).length, skips: core.normalizeStat(state.patternStats[item.id]).skips, wrongVowels };
  }

  function modalItems(soundId) {
    const stages = stagesFor(soundId);
    return [...stages.onsets, ...stages.codas];
  }

  function itemStatus(item, stat) {
    if (item.aggregateStatus) return item.aggregateStatus;
    if (stat.correct >= core.REQUIRED_CORRECT) return 'complete';
    if (stat.skips > 0) return 'skipped';
    if (stat.attempts === 0) return 'untouched';
    return 'active';
  }

  function renderModal() {
    if (!modal || modal.hidden) return;
    const dialog = modal.querySelector('.bv-modal-dialog');
    const sound = soundById.get(modalSoundId) || sounds[0];
    const allItems = modalItems(sound.id);
    const lifetimeSummary = core.summaryForPatternIds(state, allItems.map((item) => item.id));
    const itemRows = allItems.map((item) => ({ item, stat: statsForPatternInRange(item) }));
    const rows = itemRows;
    const attemptedRows = itemRows.filter(({ stat }) => stat.attempts > 0);
    const rangeScore = core.meanAccuracy(attemptedRows.map(({ stat }) => stat));
    const filterRows = rows.filter(({ item, stat }) => {
      const typeMatches = modalType === 'all' || item.type === modalType;
      return typeMatches && (modalStatus === 'all' || itemStatus(item, stat) === modalStatus);
    });
    const sortedRows = filterRows.sort((a, b) => {
      const aAccuracy = core.accuracy(a.stat);
      const bAccuracy = core.accuracy(b.stat);
      if (aAccuracy === null && bAccuracy !== null) return 1;
      if (bAccuracy === null && aAccuracy !== null) return -1;
      return (aAccuracy || 0) - (bAccuracy || 0) || b.stat.attempts - a.stat.attempts;
    });

    dialog.innerHTML = [
      '<div class="bv-modal-header">',
      '  <div><span>Training analyzer</span><h2 id="bv-modal-title">Progress and weak patterns</h2></div>',
      '  <button type="button" class="bv-modal-close" aria-label="Close">&times;</button>',
      '</div>',
      `<div class="bv-modal-sounds">${sounds.map((entry) => {
        const itemSummary = core.summaryForPatternIds(state, patternIdsForSound(entry.id));
        return `<button type="button" data-modal-sound="${entry.id}" data-selected="${entry.id === sound.id}"><strong>${entry.label}</strong><span>${percent(itemSummary.accuracy)}</span></button>`;
      }).join('')}</div>`,
      '<div class="bv-modal-controls">',
      `  <div class="bv-modal-tabs">${['patterns', 'history'].map((view) => `<button type="button" data-modal-view="${view}" data-selected="${modalView === view}">${view === 'patterns' ? 'Patterns' : 'History'}</button>`).join('')}</div>`,
      `  <div class="bv-modal-ranges">${[['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['lifetime', 'Lifetime']].map(([value, label]) => `<button type="button" data-modal-range="${value}" data-selected="${modalRange === value}">${label}</button>`).join('')}</div>`,
      '</div>',
      '<div class="bv-modal-scoreband">',
      `  <div><span>${modalView === 'history' ? 'Current score' : modalRange === 'lifetime' ? 'Sound score' : 'Range score'}</span><strong>${percent(modalView === 'history' || modalRange === 'lifetime' ? lifetimeSummary.accuracy : rangeScore)}</strong></div>`,
      `  <div><span>Coverage</span><strong>${percent(lifetimeSummary.coverage)}</strong></div>`,
      `  <div><span>Patterns trained</span><strong>${lifetimeSummary.attempted}/${lifetimeSummary.total}</strong></div>`,
      `  <div><span>10+ correct</span><strong>${allItems.filter((item) => core.normalizeStat(state.patternStats[item.id]).correct >= core.REQUIRED_CORRECT).length}</strong></div>`,
      '</div>',
      modalView === 'history' ? renderHistory(sound) : renderPatternAnalysis(sortedRows),
    ].join('');

    dialog.querySelector('.bv-modal-close').addEventListener('click', closeModal);
    dialog.querySelectorAll('[data-modal-sound]').forEach((button) => button.addEventListener('click', () => { modalSoundId = button.dataset.modalSound; renderModal(); }));
    dialog.querySelectorAll('[data-modal-view]').forEach((button) => button.addEventListener('click', () => { modalView = button.dataset.modalView; renderModal(); }));
    dialog.querySelectorAll('[data-modal-range]').forEach((button) => button.addEventListener('click', () => { modalRange = button.dataset.modalRange; renderModal(); }));
    dialog.querySelectorAll('[data-modal-type]').forEach((select) => select.addEventListener('change', () => { modalType = select.value; renderModal(); }));
    dialog.querySelectorAll('[data-modal-status]').forEach((select) => select.addEventListener('change', () => { modalStatus = select.value; renderModal(); }));
    dialog.querySelectorAll('[data-train-item]').forEach((button) => button.addEventListener('click', () => startTargetedTraining(button.dataset.trainItem)));
  }

  function renderPatternAnalysis(rows) {
    const visible = rows;
    return [
      '<div class="bv-pattern-toolbar">',
      `<label>Type<select data-modal-type><option value="all" ${modalType === 'all' ? 'selected' : ''}>All patterns</option><option value="onset" ${modalType === 'onset' ? 'selected' : ''}>Onsets</option><option value="coda" ${modalType === 'coda' ? 'selected' : ''}>Codas</option></select></label>`,
      `<label>Status<select data-modal-status><option value="all" ${modalStatus === 'all' ? 'selected' : ''}>All statuses</option><option value="active" ${modalStatus === 'active' ? 'selected' : ''}>In progress</option><option value="complete" ${modalStatus === 'complete' ? 'selected' : ''}>Completed</option><option value="skipped" ${modalStatus === 'skipped' ? 'selected' : ''}>Skipped</option><option value="untouched" ${modalStatus === 'untouched' ? 'selected' : ''}>Untouched</option></select></label>`,
      `  <span>${rows.length} matches</span>`,
      '</div>',
      '<div class="bv-pattern-list">',
      visible.map(({ item, stat }) => {
        const wrong = Object.entries(stat.wrongVowels || {}).sort((a, b) => b[1] - a[1])[0];
        const status = itemStatus(item, stat);
        return `<div class="bv-pattern-row" data-status="${status}"><div class="bv-pattern-main"><i></i><span><strong>${item.prompt}</strong><small>${stageLabels[item.stageId]}</small></span></div><div class="bv-pattern-numbers"><span>${stat.correct}/${stat.attempts}</span><strong>${percent(core.accuracy(stat))}</strong><small>${wrong ? `Often ${wrong[0]}` : status}</small></div><button type="button" data-train-item="${item.id}">Train</button></div>`;
      }).join(''),
      '</div>',
    ].join('');
  }

  function renderHistory(sound) {
    if (!state.progressUnlocks[sound.id]) return renderLockedHistory(sound);
    const allPoints = (state.progressHistory[sound.id] || []).filter((point) => Number.isFinite(point.score));
    const start = rangeStart();
    const points = modalRange === 'lifetime'
      ? allPoints
      : allPoints.filter((point) => new Date(`${point.day}T12:00:00`).getTime() >= start);
    const baseline = state.progressBaselines[sound.id] || (allPoints[0] && { score: allPoints[0].score, day: allPoints[0].day });
    const current = allPoints.at(-1);
    const currentScore = current ? current.score : null;
    const change = currentScore !== null && baseline ? currentScore - baseline.score : null;
    const rangeAttempts = points.reduce((total, point) => total + (point.attempts || 0), 0);
    const rangeCorrect = points.reduce((total, point) => total + (point.correct || 0), 0);
    const activeDays = points.filter((point) => point.attempts > 0).length;
    const best = points.length ? Math.max(...points.map((point) => point.score)) : null;
    const trend = change === null || Math.abs(change) < 0.05 ? 'flat' : change > 0 ? 'up' : 'down';
    const changeLabel = change === null ? '--' : `${change > 0 ? '+' : ''}${change.toFixed(1)} pts`;
    const dailyAccuracy = rangeAttempts ? (rangeCorrect / rangeAttempts) * 100 : null;
    const rows = points.filter((point) => point.attempts > 0).slice(-30).reverse();

    return [
      `<div class="bv-history" data-trend="${trend}">`,
      '<div class="bv-performance-head">',
      '  <div><span>Performance</span><h3>Score growth over time</h3></div>',
      `  <div class="bv-performance-change"><span>Since first tracked session</span><strong>${changeLabel}</strong><small>${baseline ? `Started at ${percent(baseline.score)}` : 'No baseline yet'}</small></div>`,
      '</div>',
      '<div class="bv-performance-kpis">',
      `  <div><span>Current</span><strong>${percent(currentScore)}</strong></div>`,
      `  <div><span>Best in range</span><strong>${percent(best)}</strong></div>`,
      `  <div><span>Attempts</span><strong>${rangeAttempts}</strong></div>`,
      `  <div><span>Attempt accuracy</span><strong>${percent(dailyAccuracy)}</strong></div>`,
      `  <div><span>Training days</span><strong>${activeDays}</strong></div>`,
      '</div>',
      renderPerformanceChart(points, baseline && baseline.score, trend),
      '<div class="bv-history-days">',
      '<div class="bv-history-days-head"><h3>Daily performance</h3><span>Closing score and training volume</span></div>',
      rows.length ? [
        '<div class="bv-history-table">',
        '<div class="bv-history-table-header"><span>Date</span><span>Score</span><span>Since start</span><span>Attempts</span><span>Accuracy</span></div>',
        rows.map((point) => {
          const pointChange = baseline ? point.score - baseline.score : 0;
          const pointAccuracy = point.attempts ? (point.correct / point.attempts) * 100 : null;
          const pointTrend = Math.abs(pointChange) < 0.05 ? 'flat' : pointChange > 0 ? 'up' : 'down';
          return `<div class="bv-history-table-row" data-trend="${pointTrend}"><time>${new Date(`${point.day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time><strong>${percent(point.score)}</strong><span>${pointChange > 0 ? '+' : ''}${pointChange.toFixed(1)} pts</span><span>${point.correct}/${point.attempts}</span><span>${percent(pointAccuracy)}</span></div>`;
        }).join(''),
        '</div>',
      ].join('') : '<p class="bv-history-empty">No training attempts in this range yet.</p>',
      '</div>',
      '</div>',
    ].join('');
  }

  function renderLockedHistory(sound) {
    const stageProgress = ['pure', 'onsets', 'codas'].map((stageId) => {
      const stageSummary = core.summaryForIds(state, idsForStage(sound.id, stageId));
      return { stageId, ...stageSummary };
    });
    const completed = stageProgress.reduce((total, stage) => total + stage.completed, 0);
    const total = stageProgress.reduce((sum, stage) => sum + stage.total, 0);
    const progress = total ? (completed / total) * 100 : 0;
    return [
      '<div class="bv-history-locked">',
      '  <span>Fair comparison</span>',
      '  <h3>History starts after level 3</h3>',
      '  <p>Complete Pure Sound, Onsets, and Codas. Your score at that moment becomes the permanent starting line.</p>',
      `  <div class="bv-history-unlock-total"><strong>${completed}/${total}</strong><span>foundation drills complete</span></div>`,
      `  <div class="bv-history-unlock-track"><span style="width:${Math.min(100, progress)}%"></span></div>`,
      '  <div class="bv-history-unlock-stages">',
      stageProgress.map((stage, index) => `<div data-complete="${stage.completed === stage.total}"><i>${stage.completed === stage.total ? '&#10003;' : index + 1}</i><span>${stageLabels[stage.stageId]}</span><strong>${stage.completed}/${stage.total}</strong></div>`).join(''),
      '  </div>',
      '</div>',
    ].join('');
  }

  function renderPerformanceChart(points, baselineScore, trend) {
    if (!points.length) return '<div class="bv-performance-empty">Your progress chart will appear after the first training attempt.</div>';
    const width = 820;
    const height = 270;
    const left = 42;
    const right = 32;
    const top = 22;
    const plotBottom = 190;
    const volumeTop = 214;
    const volumeBottom = 250;
    const scores = points.map((point) => point.score);
    if (Number.isFinite(baselineScore)) scores.push(baselineScore);
    let minimum = Math.max(0, Math.floor(Math.min(...scores) - 5));
    let maximum = Math.min(100, Math.ceil(Math.max(...scores) + 5));
    if (maximum - minimum < 10) {
      const padding = (10 - (maximum - minimum)) / 2;
      minimum = Math.max(0, minimum - padding);
      maximum = Math.min(100, maximum + padding);
    }
    const range = Math.max(1, maximum - minimum);
    const timestamps = points.map((point) => new Date(`${point.day}T12:00:00`).getTime());
    const firstTime = Math.min(...timestamps);
    const lastTime = Math.max(...timestamps);
    const timeRange = Math.max(1, lastTime - firstTime);
    const xFor = (timestamp, index) => points.length === 1
      ? (left + width - right) / 2
      : left + ((timestamp - firstTime) / timeRange) * (width - left - right);
    const yFor = (score) => plotBottom - ((score - minimum) / range) * (plotBottom - top);
    const coordinates = points.map((point, index) => ({
      point,
      x: xFor(timestamps[index], index),
      y: yFor(point.score),
    }));
    const linePath = coordinates.map((entry, index) => `${index ? 'L' : 'M'} ${entry.x.toFixed(1)} ${entry.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L ${coordinates.at(-1).x.toFixed(1)} ${plotBottom} L ${coordinates[0].x.toFixed(1)} ${plotBottom} Z`;
    const maxAttempts = Math.max(1, ...points.map((point) => point.attempts || 0));
    const barWidth = Math.max(3, Math.min(18, (width - left - right) / Math.max(3, points.length) - 3));
    const lineColor = trend === 'down' ? '#f08b72' : '#61dec0';
    const grid = [minimum, minimum + range / 2, maximum].map((value) => {
      const y = yFor(value);
      return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="bv-chart-grid"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">${Math.round(value)}%</text>`;
    }).join('');
    const baseline = Number.isFinite(baselineScore)
      ? `<line x1="${left}" y1="${yFor(baselineScore)}" x2="${width - right}" y2="${yFor(baselineScore)}" class="bv-chart-baseline"/><text x="${width - right}" y="${yFor(baselineScore) - 7}" text-anchor="end" class="bv-chart-baseline-label">START ${Math.round(baselineScore)}%</text>`
      : '';
    const dots = coordinates.length <= 90 ? coordinates.map(({ point, x, y }) => `<circle cx="${x}" cy="${y}" r="3.5"><title>${point.day}: ${point.score.toFixed(1)}%, ${point.attempts} attempts</title></circle>`).join('') : '';
    const bars = coordinates.map(({ point, x }) => {
      const attempts = point.attempts || 0;
      const barHeight = (attempts / maxAttempts) * (volumeBottom - volumeTop);
      const barTop = volumeBottom - barHeight;
      const valueY = barTop < volumeTop + 14 ? barTop + 14 : barTop - 5;
      const hitWidth = Math.max(16, barWidth);
      const attemptLabel = `${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}`;
      return [
        '<g class="bv-chart-volume-point">',
        `  <rect class="bv-chart-volume-bar" x="${(x - barWidth / 2).toFixed(1)}" y="${barTop.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, barHeight).toFixed(1)}"/>`,
        `  <foreignObject class="bv-chart-volume-hit" x="${(x - hitWidth / 2).toFixed(1)}" y="${volumeTop}" width="${hitWidth.toFixed(1)}" height="${volumeBottom - volumeTop}">`,
        `    <div xmlns="http://www.w3.org/1999/xhtml" class="bv-chart-volume-focus" tabindex="0" role="img" aria-label="${point.day}: ${attemptLabel}" title="${point.day}: ${attemptLabel}"></div>`,
        '  </foreignObject>',
        `  <text class="bv-chart-volume-value" x="${x.toFixed(1)}" y="${valueY.toFixed(1)}" text-anchor="middle" aria-hidden="true">${attempts}</text>`,
        '</g>',
      ].join('');
    }).join('');
    const firstLabel = new Date(`${points[0].day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const lastLabel = new Date(`${points.at(-1).day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    return `<div class="bv-performance-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Score growth and daily attempts"><g class="bv-chart-axis">${grid}</g>${baseline}<path d="${areaPath}" class="bv-chart-area" style="color:${lineColor}"/><path d="${linePath}" class="bv-chart-line" style="stroke:${lineColor}"/><g class="bv-chart-points" style="color:${lineColor}">${dots}</g><line x1="${left}" y1="${volumeBottom}" x2="${width - right}" y2="${volumeBottom}" class="bv-chart-grid"/><g class="bv-chart-volume">${bars}</g><text x="${left}" y="${height - 3}">${firstLabel}</text><text x="${width - right}" y="${height - 3}" text-anchor="end">${lastLabel}</text><text x="${left}" y="${volumeTop - 7}" class="bv-chart-volume-label">ATTEMPTS</text></svg></div>`;
  }

  function openModal() {
    modalSoundId = currentItem()?.soundId || state.cursor.soundId;
    modal.hidden = false;
    document.documentElement.classList.add('bv-modal-open');
    clearBurst();
    renderModal();
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.documentElement.classList.remove('bv-modal-open');
    resetItemSession();
  }

  function tick() {
    const now = performance.now();
    const elapsed = Math.min(1000, Math.max(0, now - lastPracticeTick));
    lastPracticeTick = now;
    if (!trainingPaused && !document.hidden && now - lastActivityAt < 10000) {
      core.addPracticeTime(state, elapsed);
      if (Math.floor(state.practiceMs / 5000) !== Math.floor((state.practiceMs - elapsed) / 5000)) scheduleSave();
    }
    renderAll();
  }

  async function initialize() {
    buildCurriculum();
    const [saved, legacy] = await readStates();
    state = core.normalizeState(saved, legacy);
    hydratePatternStats();
    ensureProgressHistory();
    normalizeCursor();
    const row = document.getElementById('bv-vowel-extension-row');
    if (!row) return;
    createSummary(row);
    createShell(row);
    createModal();
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    renderAll();
    scheduleSave(0);
    window.setInterval(tick, 1000);
  }

  window.addEventListener(EVENT_NAME, (event) => handleVowelEvent(parseDetail(event.detail)));
  window.addEventListener('pagehide', () => writeState().catch(() => {}));
  window.addEventListener('keydown', (event) => {
    unlockAudio();
    if (event.key === 'Escape' && modal && !modal.hidden) closeModal();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
