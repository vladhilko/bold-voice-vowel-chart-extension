(function () {
  const EVENT_NAME = 'bv-vowel-focus-reader:update';
  const WRAPPER_ID = 'bv-vowel-extension-row';
  const PANEL_ID = 'bv-vowel-focus-reader';
  const GAME_ID = 'bv-ih-flight-game';
  const STATS_ID = 'bv-training-stats';
  const STORAGE_KEY = 'bv-vowel-vanguard-state-v1';
  const MODE_SOUNDS = 'sounds';
  const MODE_WORDS = 'words';
  const MODE_DRILLS = 'drills';
  const DEFAULT_TARGET_ARPA = 'IH';
  const WORD_TARGET_ARPA = 'AH';
  const WORD_HITS_REQUIRED = 10;
  const DRILL_HITS_REQUIRED = 20;
  const GAME_WIDTH = 360;
  const GAME_HEIGHT = 500;
  const SOUND_ARCHER = { x: 58, y: 420 };
  const WORD_ARCHER = { x: GAME_WIDTH / 2, y: 454 };
  const SHOT_COOLDOWN_MS = 520;
  const MISS_COOLDOWN_MS = 680;
  const WORD_HIT_COOLDOWN_MS = 700;
  const DRILL_HIT_COOLDOWN_MS = 1100;
  const USES_BV_NOTATION = location.hostname === 'boldvoice.com' || location.hostname.endsWith('.boldvoice.com');
  const BV_VOWEL_LABELS = {
    AA: 'AH', AE: 'AA', EH: 'EH', IY: 'EE', IH: 'IH', AO: 'AW',
    UH: 'U', AX: 'uh', AH: 'UH', UW: 'OO', ER: 'ER',
  };
  const WORDS = `
    cup, pup, sup, ups, yup, cups, pups, erupt, guppy, puppy, upped, upper,
    abrupt, couple, erupts, muppet, puppet, supper, supple, upbeat, uphill,
    upkeep, upland, uplift, uplink, upload, uppers, upping, uppity, uproar,
    upshot, upside, uptake, uptick, uptown, upward, upwind, workup, yuppie,
    corrupt, coupled, coupler, couples, couplet, cupcake, cupping, disrupt,
    erupted, muppets, nuptial, puppets, puppies, rupture, suppers, unpaved,
    upfront, uplands, uploads, upscale, upstart, upstate, upsurge, upwards,
    abruptly, corrupts, couplers, coupling, cupcakes, disrupts, erupting,
    eruption, eruptive, nuptials, puppetry, ruptured, ruptures, upcoming,
    uplifted, uploaded, upmarket, uppercut, uprights, upstream, upwardly,
    corrupted, couplings, disrupted, eruptions, interrupt, rupturing,
    uplifting, uploading, uppermost, uprisings, corrupting, corruption,
    decoupling, disrupting, disruption, disruptive, interrupts, prenuptial,
    supplement, tupperware, upbringing, upstanding, voluptuous, comeuppance,
    disruptions, interrupted, supplements, interrupting, interruption
  `.split(',').map((word) => word.trim()).filter(Boolean);
  const HUMBLE_ONSETS = `
    umble, bumble, blumble, brumble, chumble, dumble, drumble, fumble,
    flumble, frumble, gumble, glumble, grumble, jumble, kumble, clumble,
    crumble, lumble, mumble, numble, pumble, plumble, rumble, sumble,
    shumble, shrumble, scumble, slumble, smumble, snumble, spumble,
    splumble, sprumble, stumble, strumble, tumble, thumble, thrumble,
    trumble, vumble, wumble
  `.split(',').map((word) => word.trim()).filter(Boolean);
  const HUMBLE_CODAS = `
    hub, hutch, huddle, hudge, huff, hug, huck, hux, hull, hulb, hulf,
    hulk, hulp, huls, hult, hulch, hum, humble, humph, hump, hun, hundred,
    hunge, huns, hunt, hunth, hung, hunk, hup, huss, hush, husk, hustle,
    hut, huth, huv, huzz, husband
  `.split(',').map((word) => word.trim()).filter(Boolean);
  const HUMBLE_REAL_WORDS = new Set(`
    bumble, fumble, grumble, jumble, crumble, mumble, rumble, scumble,
    stumble, tumble, hub, hutch, huddle, huff, hug, huck, hull, hulk, hum,
    humble, humph, hump, hun, hundred, hunt, hung, hunk, hup, hush, husk, hustle,
    hut, husband
  `.split(',').map((word) => word.trim()).filter(Boolean));
  const HUMBLE_DRILLS = [
    ...HUMBLE_ONSETS.map((word) => ({ word, section: 'Onset', real: HUMBLE_REAL_WORDS.has(word) })),
    ...HUMBLE_CODAS.map((word) => ({ word, section: 'Coda', real: HUMBLE_REAL_WORDS.has(word) })),
  ];

  const DEFAULT_ANCHORS = [
    { arpa: 'AA', label: displayLabel('AA'), openness: 0.9966, forwardness: 0.002 },
    { arpa: 'AE', label: displayLabel('AE'), openness: 0.8156, forwardness: 0.9931 },
    { arpa: 'AH', label: displayLabel('AH'), openness: 0.609, forwardness: 0.1849 },
    { arpa: 'AO', label: displayLabel('AO'), openness: 0.6731, forwardness: 0.0046 },
    { arpa: 'EH', label: displayLabel('EH'), openness: 0.6751, forwardness: 0.996 },
    { arpa: 'ER', label: displayLabel('ER'), openness: 0.3312, forwardness: 0.4997 },
    { arpa: 'IH', label: displayLabel('IH'), openness: 0.1683, forwardness: 0.7473 },
    { arpa: 'IY', label: displayLabel('IY'), openness: 0.0077, forwardness: 0.9975 },
    { arpa: 'UH', label: displayLabel('UH'), openness: 0.1621, forwardness: 0.2467 },
    { arpa: 'UW', label: displayLabel('UW'), openness: 0.0093, forwardness: 0.0909 },
  ];
  const STARS = Array.from({ length: 28 }, (_, index) => ({
    x: (index * 83 + 29) % GAME_WIDTH,
    y: 22 + ((index * 47) % 215),
    r: 0.7 + (index % 3) * 0.45,
    phase: index * 0.73,
  }));

  let wrapper = null;
  let panel = null;
  let statsPanel = null;
  let statsValueEls = {};
  let valueEl = null;
  let detailEl = null;
  let game = null;
  let canvas = null;
  let ctx = null;
  let targetPicker = null;
  let targetPickerWrap = null;
  let wordMeta = null;
  let wordLevelEl = null;
  let wordSoundEl = null;
  let drillMeta = null;
  let drillSelect = null;
  let drillPositionEl = null;
  let drillSoundEl = null;
  let footerLabelEl = null;
  let footerValueEl = null;
  let progressEl = null;
  let resetButton = null;
  let modeButtons = [];
  let currentPayload = null;
  let anchors = DEFAULT_ANCHORS.slice();
  let anchorSignature = '';
  let selectedTargetArpas = [DEFAULT_TARGET_ARPA];
  let gameMode = MODE_DRILLS;
  let lastFrameAt = 0;
  let animationFrame = 0;
  let storageReady = false;
  let saveTimer = 0;
  let lastStatsTickAt = 0;
  let lastStatsRenderAt = 0;
  let lastTrainingActivityAt = 0;
  let practiceSinceSave = 0;

  const trainingStats = {
    practiceMs: 0,
    soundHits: 0,
    wordReps: 0,
    wordsMastered: 0,
    drillReps: 0,
    drillsCompleted: 0,
  };

  let nextEnemyIn = 0;
  let soundScore = 0;
  let streak = 0;
  let lastShotAt = 0;
  let lastSpokenArpa = '';
  let lastMissAt = 0;

  let wordIndex = 0;
  let wordLevel = 1;
  let wordHits = 0;
  let wordY = 74;
  let wordAdvanceAt = 0;
  let wordHitFlash = 0;
  let wordMissFlash = 0;
  let lastWordSpokenArpa = '';
  let lastWordHitAt = Number.NEGATIVE_INFINITY;
  let lastWordMissAt = Number.NEGATIVE_INFINITY;
  let wordCanScore = true;
  let wordUnfocusedSince = 0;

  let drillSet = 'all';
  let drillIndex = 0;
  let drillHits = 0;
  let drillY = 70;
  let drillAdvanceAt = 0;
  let drillHitFlash = 0;
  let drillMissFlash = 0;
  let lastDrillSpokenArpa = '';
  let lastDrillHitAt = Number.NEGATIVE_INFINITY;
  let lastDrillMissAt = Number.NEGATIVE_INFINITY;
  let drillCanScore = true;
  let drillUnfocusedSince = 0;
  let drillProgressBySet = {
    all: { index: 0, hits: 0 },
    onsets: { index: 0, hits: 0 },
    codas: { index: 0, hits: 0 },
    real: { index: 0, hits: 0 },
  };

  const enemies = [];
  const arrows = [];
  const bursts = [];
  const particles = [];

  function displayLabel(arpa) {
    const code = String(arpa || '').toUpperCase();
    return USES_BV_NOTATION ? (BV_VOWEL_LABELS[code] || code) : code;
  }

  function labelForArpa(arpa) {
    const anchor = anchors.find((item) => item.arpa === arpa);
    return (anchor && anchor.label) || displayLabel(arpa);
  }

  function currentWord() {
    return WORDS[wordIndex % WORDS.length];
  }

  function drillsForSet(set) {
    if (set === 'onsets') return HUMBLE_DRILLS.filter((item) => item.section === 'Onset');
    if (set === 'codas') return HUMBLE_DRILLS.filter((item) => item.section === 'Coda');
    if (set === 'real') return HUMBLE_DRILLS.filter((item) => item.real);
    return HUMBLE_DRILLS;
  }

  function currentDrills() {
    return drillsForSet(drillSet);
  }

  function currentDrill() {
    const drills = currentDrills();
    return drills[drillIndex % drills.length];
  }

  function storeCurrentDrillProgress() {
    drillProgressBySet[drillSet] = { index: drillIndex, hits: drillHits };
  }

  function restoreCurrentDrillProgress() {
    const drills = currentDrills();
    const saved = drillProgressBySet[drillSet] || { index: 0, hits: 0 };
    drillIndex = Math.min(Math.max(0, saved.index || 0), Math.max(0, drills.length - 1));
    drillHits = Math.min(Math.max(0, saved.hits || 0), DRILL_HITS_REQUIRED - 1);
    drillY = 70;
    drillAdvanceAt = 0;
    drillHitFlash = 0;
    drillMissFlash = 0;
    lastDrillSpokenArpa = '';
    lastDrillHitAt = Number.NEGATIVE_INFINITY;
    lastDrillMissAt = Number.NEGATIVE_INFINITY;
    drillCanScore = true;
    drillUnfocusedSince = 0;
  }

  function createStatsPanel() {
    if (statsPanel) return statsPanel;
    statsPanel = document.createElement('section');
    statsPanel.id = STATS_ID;
    statsPanel.setAttribute('aria-label', 'Training statistics');
    statsPanel.innerHTML = [
      '<div class="bv-stats-heading">Training totals</div>',
      '<div class="bv-stat"><span>Practice</span><strong data-stat="practiceMs">0m</strong></div>',
      '<div class="bv-stat"><span>Sound hits</span><strong data-stat="soundHits">0</strong></div>',
      '<div class="bv-stat"><span>Word reps</span><strong data-stat="wordReps">0</strong></div>',
      '<div class="bv-stat"><span>Words mastered</span><strong data-stat="wordsMastered">0</strong></div>',
      '<div class="bv-stat"><span>Drill reps</span><strong data-stat="drillReps">0</strong></div>',
      '<div class="bv-stat"><span>Pairs complete</span><strong data-stat="drillsCompleted">0</strong></div>',
    ].join('');
    statsValueEls = Object.fromEntries(
      [...statsPanel.querySelectorAll('[data-stat]')].map((element) => [element.dataset.stat, element]),
    );
    renderStats();
    placeSurfaces();
    return statsPanel;
  }

  function formatPracticeTime(milliseconds) {
    if (milliseconds < 60000) return `${Math.floor(milliseconds / 1000)}s`;
    const totalMinutes = Math.floor(milliseconds / 60000);
    if (totalMinutes < 60) return `${totalMinutes}m`;
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
  }

  function renderStats() {
    if (!statsPanel) return;
    for (const [key, element] of Object.entries(statsValueEls)) {
      element.textContent = key === 'practiceMs'
        ? formatPracticeTime(trainingStats.practiceMs)
        : String(trainingStats[key] || 0);
    }
  }

  function storageArea() {
    return globalThis.chrome && chrome.storage && chrome.storage.local
      ? chrome.storage.local
      : null;
  }

  function readStoredState() {
    const area = storageArea();
    if (area) {
      return area.get(STORAGE_KEY).then((result) => result[STORAGE_KEY] || null);
    }
    try {
      return Promise.resolve(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function writeStoredState(state) {
    const area = storageArea();
    if (area) return area.set({ [STORAGE_KEY]: state });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) { /* storage unavailable */ }
    return Promise.resolve();
  }

  function stateSnapshot() {
    storeCurrentDrillProgress();
    return {
      mode: gameMode,
      selectedTargetArpas,
      words: { index: wordIndex, level: wordLevel, hits: wordHits },
      drills: { set: drillSet, progressBySet: drillProgressBySet },
      stats: trainingStats,
    };
  }

  function scheduleSave(delay = 250) {
    if (!storageReady) return;
    if (saveTimer) return;
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      writeStoredState(stateSnapshot()).catch(() => {});
      practiceSinceSave = 0;
    }, delay);
  }

  function applyStoredState(saved) {
    if (!saved || typeof saved !== 'object') return;
    if ([MODE_SOUNDS, MODE_WORDS, MODE_DRILLS].includes(saved.mode)) gameMode = saved.mode;
    if (Array.isArray(saved.selectedTargetArpas) && saved.selectedTargetArpas.length) {
      selectedTargetArpas = saved.selectedTargetArpas.map((arpa) => String(arpa).toUpperCase());
    }

    if (saved.words && typeof saved.words === 'object') {
      wordIndex = Math.min(Math.max(0, Number(saved.words.index) || 0), WORDS.length - 1);
      wordLevel = Math.max(1, Number(saved.words.level) || wordIndex + 1);
      const savedWordHits = Math.max(0, Number(saved.words.hits) || 0);
      if (savedWordHits >= WORD_HITS_REQUIRED) {
        wordIndex = (wordIndex + 1) % WORDS.length;
        wordLevel += 1;
        wordHits = 0;
      } else {
        wordHits = savedWordHits;
      }
    }

    if (saved.drills && typeof saved.drills === 'object') {
      if (['all', 'onsets', 'codas', 'real'].includes(saved.drills.set)) drillSet = saved.drills.set;
      if (saved.drills.progressBySet && typeof saved.drills.progressBySet === 'object') {
        for (const set of ['all', 'onsets', 'codas', 'real']) {
          const progress = saved.drills.progressBySet[set];
          if (!progress) continue;
          const setLength = drillsForSet(set).length;
          const maxIndex = Math.max(0, setLength - 1);
          const savedHits = Math.max(0, Number(progress.hits) || 0);
          let savedIndex = Math.min(Math.max(0, Number(progress.index) || 0), maxIndex);
          if (savedHits >= DRILL_HITS_REQUIRED) savedIndex = (savedIndex + 1) % setLength;
          drillProgressBySet[set] = {
            index: savedIndex,
            hits: savedHits >= DRILL_HITS_REQUIRED ? 0 : savedHits,
          };
        }
      }
      restoreCurrentDrillProgress();
    }

    if (saved.stats && typeof saved.stats === 'object') {
      for (const key of Object.keys(trainingStats)) {
        trainingStats[key] = Math.max(0, Number(saved.stats[key]) || 0);
      }
    }
  }

  async function loadStoredState() {
    try {
      applyStoredState(await readStoredState());
    } catch (_) { /* start fresh */ }
    storageReady = true;
    if (drillSelect) drillSelect.value = drillSet;
    renderTargetPicker();
    syncModeUI();
    renderStats();
    drawGame(performance.now());
  }

  function createPanel() {
    if (panel) return panel;

    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = [
      '<div class="bv-vfr-label">Focused vowel</div>',
      '<div class="bv-vfr-value">-</div>',
      '<div class="bv-vfr-detail">Waiting for highlight</div>',
    ].join('');

    valueEl = panel.querySelector('.bv-vfr-value');
    detailEl = panel.querySelector('.bv-vfr-detail');
    placeSurfaces();
    return panel;
  }

  function createGame() {
    if (game) return game;

    game = document.createElement('section');
    game.id = GAME_ID;
    game.dataset.mode = gameMode;
    game.innerHTML = [
      '<div class="bv-game-header">',
      '  <div>',
      '    <div class="bv-game-kicker">Pronunciation quest</div>',
      '    <div class="bv-game-title">Vowel Vanguard</div>',
      '  </div>',
      '  <button class="bv-game-reset" type="button" aria-label="Restart current mode" title="Restart current mode">↻</button>',
      '</div>',
      '<div class="bv-game-modes" role="tablist" aria-label="Game mode">',
      '  <button type="button" role="tab" data-mode="sounds">Sounds</button>',
      '  <button type="button" role="tab" data-mode="words">Words</button>',
      '  <button type="button" role="tab" data-mode="drills">Drills</button>',
      '</div>',
      '<div class="bv-game-config bv-game-sound-config">',
      '  <div class="bv-game-label">Allowed sounds</div>',
      '  <div class="bv-game-targets" aria-label="Allowed vowel targets"></div>',
      '</div>',
      '<div class="bv-game-config bv-game-word-config">',
      '  <span>Level <strong class="bv-word-level">1</strong></span>',
      '  <span class="bv-word-sound">UH</span>',
      '</div>',
      '<div class="bv-game-config bv-game-drill-config">',
      '  <label class="bv-game-label" for="bv-humble-drill-select">Word family</label>',
      '  <div class="bv-drill-config-row">',
      '    <select id="bv-humble-drill-select" aria-label="Humble drill set">',
      '      <option value="all">Humble · All drills</option>',
      '      <option value="onsets">Humble · Onsets</option>',
      '      <option value="codas">Humble · Codas</option>',
      '      <option value="real">Humble · Real words</option>',
      '    </select>',
      '    <span class="bv-drill-sound">UH</span>',
      '  </div>',
      '  <div class="bv-drill-position">Pair <strong>1/79</strong></div>',
      '</div>',
      '<canvas class="bv-game-canvas" width="360" height="500" aria-label="Pronunciation game"></canvas>',
      '<div class="bv-game-progress" aria-hidden="true"><span></span></div>',
      '<div class="bv-game-footer">',
      '  <span class="bv-game-footer-label">Mastery</span>',
      '  <strong class="bv-game-footer-value">0/10</strong>',
      '</div>',
    ].join('');

    canvas = game.querySelector('.bv-game-canvas');
    ctx = canvas.getContext('2d');
    targetPicker = game.querySelector('.bv-game-targets');
    targetPickerWrap = game.querySelector('.bv-game-sound-config');
    wordMeta = game.querySelector('.bv-game-word-config');
    wordLevelEl = game.querySelector('.bv-word-level');
    wordSoundEl = game.querySelector('.bv-word-sound');
    drillMeta = game.querySelector('.bv-game-drill-config');
    drillSelect = game.querySelector('#bv-humble-drill-select');
    drillPositionEl = game.querySelector('.bv-drill-position strong');
    drillSoundEl = game.querySelector('.bv-drill-sound');
    footerLabelEl = game.querySelector('.bv-game-footer-label');
    footerValueEl = game.querySelector('.bv-game-footer-value');
    progressEl = game.querySelector('.bv-game-progress span');
    resetButton = game.querySelector('.bv-game-reset');
    modeButtons = [...game.querySelectorAll('.bv-game-modes button')];

    for (const button of modeButtons) {
      button.addEventListener('click', () => setGameMode(button.dataset.mode));
    }
    drillSelect.addEventListener('change', () => {
      storeCurrentDrillProgress();
      drillSet = drillSelect.value;
      restoreCurrentDrillProgress();
      arrows.length = 0;
      particles.length = 0;
      updateHUD();
      scheduleSave();
    });
    resetButton.addEventListener('click', resetActiveGame);
    renderTargetPicker();
    resetSoundGame();
    resetWordGame();
    resetDrillGame();
    syncModeUI();
    placeSurfaces();
    startGameLoop();
    return game;
  }

  function ensureWrapper(stage) {
    if (wrapper && wrapper.isConnected) return wrapper;
    if (!stage || !stage.parentNode) return null;

    wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;
    stage.parentNode.insertBefore(wrapper, stage);
    wrapper.appendChild(stage);
    return wrapper;
  }

  function placeSurfaces() {
    const stage = document.getElementById('stage');
    const row = ensureWrapper(stage);

    if (row && statsPanel && statsPanel.parentNode !== row) {
      row.insertBefore(statsPanel, row.firstChild);
    }

    if (row && panel && !panel.isConnected) {
      const chartColumn = document.createElement('div');
      chartColumn.className = 'bv-vfr-chart-column';
      row.insertBefore(chartColumn, row.firstChild);
      chartColumn.appendChild(stage);
      chartColumn.appendChild(panel);
    }

    if (row && game && !game.isConnected) row.appendChild(game);

    if (!row && document.body) {
      if (statsPanel && !statsPanel.isConnected) document.body.appendChild(statsPanel);
      if (panel && !panel.isConnected) document.body.appendChild(panel);
      if (game && !game.isConnected) document.body.appendChild(game);
      return;
    }

    const looseStage = row && row.querySelector('#stage');
    const chartColumn = row && row.querySelector('.bv-vfr-chart-column');
    if (row && looseStage && chartColumn && looseStage.parentNode !== chartColumn) {
      chartColumn.insertBefore(looseStage, chartColumn.firstChild);
    }
    if (row && panel && chartColumn && panel.parentNode !== chartColumn) {
      chartColumn.appendChild(panel);
    }
    if (row && statsPanel && row.firstChild !== statsPanel) {
      row.insertBefore(statsPanel, row.firstChild);
    }
  }

  function updatePanel(payload) {
    createPanel();

    if (payload && payload.error) {
      valueEl.textContent = '-';
      detailEl.textContent = payload.error;
      panel.dataset.state = 'error';
      setFocusPayload(null);
      return;
    }

    if (!payload) {
      valueEl.textContent = '-';
      detailEl.textContent = 'Waiting for highlight';
      panel.dataset.state = 'idle';
      setFocusPayload(null);
      return;
    }

    if (!payload.focused) {
      valueEl.textContent = payload.nearest ? payload.nearest.symbol : '-';
      detailEl.textContent = payload.nearest ? `Closest: ${payload.nearest.word}` : 'Waiting for highlight';
      panel.dataset.state = 'idle';
      setFocusPayload(payload);
      return;
    }

    valueEl.textContent = payload.symbol || payload.arpa || payload.ipa || '-';
    detailEl.textContent = [payload.word, payload.arpa && `ARPA ${payload.arpa}`, payload.ipa && `IPA ${payload.ipa}`]
      .filter(Boolean)
      .join(' · ');
    panel.dataset.state = 'active';
    setFocusPayload(payload);
  }

  function setFocusPayload(payload) {
    currentPayload = payload;
    if (payload && (payload.focused || payload.live)) {
      lastTrainingActivityAt = performance.now();
    }
    if (payload && Array.isArray(payload.anchors) && payload.anchors.length) {
      setAnchors(payload.anchors);
    }
    updateTargetPickerState();
    if (game) game.dataset.active = currentFocusedArpa() ? 'true' : 'false';
  }

  function setAnchors(nextAnchors) {
    const normalized = nextAnchors
      .filter((anchor) => anchor && anchor.arpa)
      .map((anchor) => ({ ...anchor, arpa: String(anchor.arpa).toUpperCase() }));
    const nextSignature = normalized.map((anchor) => `${anchor.arpa}:${anchor.label}`).join('|');
    if (nextSignature === anchorSignature) return;

    anchors = normalized;
    anchorSignature = nextSignature;
    selectedTargetArpas = selectedTargetArpas.filter((arpa) => anchors.some((anchor) => anchor.arpa === arpa));
    if (!selectedTargetArpas.length) {
      selectedTargetArpas = [anchors.some((anchor) => anchor.arpa === DEFAULT_TARGET_ARPA)
        ? DEFAULT_TARGET_ARPA
        : (anchors[0] && anchors[0].arpa) || DEFAULT_TARGET_ARPA];
    }
    renderTargetPicker();
    syncModeUI();
    scheduleSave();
  }

  function renderTargetPicker() {
    if (!targetPicker) return;
    const buttons = anchors.map((anchor) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bv-game-target';
      button.textContent = anchor.label || anchor.arpa;
      button.dataset.arpa = anchor.arpa;
      button.addEventListener('click', () => toggleTarget(anchor.arpa));
      return button;
    });
    targetPicker.replaceChildren(...buttons);
    updateTargetPickerState();
  }

  function toggleTarget(arpa) {
    if (selectedTargetArpas.includes(arpa)) {
      if (selectedTargetArpas.length === 1) return;
      selectedTargetArpas = selectedTargetArpas.filter((target) => target !== arpa);
    } else {
      selectedTargetArpas = [...selectedTargetArpas, arpa];
    }
    resetSoundGame();
    updateTargetPickerState();
    scheduleSave();
  }

  function updateTargetPickerState() {
    if (!targetPicker) return;
    const spoken = currentFocusedArpa();
    for (const button of targetPicker.querySelectorAll('.bv-game-target')) {
      const arpa = button.dataset.arpa;
      button.dataset.selected = selectedTargetArpas.includes(arpa) ? 'true' : 'false';
      button.dataset.active = selectedTargetArpas.includes(arpa) && spoken === arpa ? 'true' : 'false';
    }
  }

  function currentFocusedArpa() {
    return currentPayload && currentPayload.focused
      ? String(currentPayload.arpa || '').toUpperCase()
      : '';
  }

  function setGameMode(nextMode) {
    if (nextMode !== MODE_SOUNDS && nextMode !== MODE_WORDS && nextMode !== MODE_DRILLS) return;
    if (gameMode === nextMode) return;
    gameMode = nextMode;
    enemies.length = 0;
    arrows.length = 0;
    bursts.length = 0;
    particles.length = 0;
    lastSpokenArpa = '';
    lastWordSpokenArpa = '';
    lastDrillSpokenArpa = '';
    nextEnemyIn = 0;
    lastFrameAt = performance.now();
    syncModeUI();
    scheduleSave();
  }

  function syncModeUI() {
    if (!game) return;
    game.dataset.mode = gameMode;
    for (const button of modeButtons) {
      const selected = button.dataset.mode === gameMode;
      button.dataset.selected = selected ? 'true' : 'false';
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    targetPickerWrap.hidden = gameMode !== MODE_SOUNDS;
    wordMeta.hidden = gameMode !== MODE_WORDS;
    drillMeta.hidden = gameMode !== MODE_DRILLS;
    wordLevelEl.textContent = String(wordLevel);
    wordSoundEl.textContent = labelForArpa(WORD_TARGET_ARPA);
    drillSoundEl.textContent = labelForArpa(WORD_TARGET_ARPA);
    const drills = currentDrills();
    drillPositionEl.textContent = `${drillIndex + 1}/${drills.length}`;
    updateHUD();
  }

  function resetActiveGame() {
    if (gameMode === MODE_WORDS) resetWordGame();
    else if (gameMode === MODE_DRILLS) resetDrillGame();
    else resetSoundGame();
  }

  function resetSoundGame() {
    enemies.length = 0;
    arrows.length = 0;
    bursts.length = 0;
    particles.length = 0;
    soundScore = 0;
    streak = 0;
    lastShotAt = 0;
    lastSpokenArpa = '';
    lastMissAt = 0;
    nextEnemyIn = 0;
    lastFrameAt = performance.now();
    updateHUD();
    scheduleSave();
  }

  function resetWordGame() {
    enemies.length = 0;
    arrows.length = 0;
    bursts.length = 0;
    particles.length = 0;
    wordIndex = 0;
    wordLevel = 1;
    wordHits = 0;
    wordY = 74;
    wordAdvanceAt = 0;
    wordHitFlash = 0;
    wordMissFlash = 0;
    lastWordSpokenArpa = '';
    lastWordHitAt = Number.NEGATIVE_INFINITY;
    lastWordMissAt = Number.NEGATIVE_INFINITY;
    wordCanScore = true;
    wordUnfocusedSince = 0;
    lastFrameAt = performance.now();
    updateHUD();
    scheduleSave();
  }

  function resetDrillGame() {
    enemies.length = 0;
    arrows.length = 0;
    bursts.length = 0;
    particles.length = 0;
    drillIndex = 0;
    drillHits = 0;
    drillY = 70;
    drillAdvanceAt = 0;
    drillHitFlash = 0;
    drillMissFlash = 0;
    lastDrillSpokenArpa = '';
    lastDrillHitAt = Number.NEGATIVE_INFINITY;
    lastDrillMissAt = Number.NEGATIVE_INFINITY;
    drillCanScore = true;
    drillUnfocusedSince = 0;
    storeCurrentDrillProgress();
    lastFrameAt = performance.now();
    updateHUD();
    scheduleSave();
  }

  function startGameLoop() {
    if (animationFrame) return;
    const step = (timestamp) => {
      animationFrame = window.requestAnimationFrame(step);
      tickGame(timestamp);
    };
    animationFrame = window.requestAnimationFrame(step);
  }

  function tickGame(timestamp) {
    if (!ctx) return;
    const dt = Math.min(0.034, Math.max(0.001, (timestamp - lastFrameAt) / 1000 || 0.016));
    lastFrameAt = timestamp;
    tickTrainingTime(timestamp);

    if (gameMode === MODE_WORDS) {
      moveWord(dt, timestamp);
      processWordSpeech(timestamp);
    } else if (gameMode === MODE_DRILLS) {
      moveDrill(dt, timestamp);
      processDrillSpeech(timestamp);
    } else {
      spawnEnemies(dt);
      moveEnemies(dt);
      processSoundSpeech(timestamp);
    }
    moveArrows(dt);
    moveBursts(dt);
    moveParticles(dt);
    wordHitFlash = Math.max(0, wordHitFlash - dt * 2.8);
    wordMissFlash = Math.max(0, wordMissFlash - dt * 2.2);
    drillHitFlash = Math.max(0, drillHitFlash - dt * 2.8);
    drillMissFlash = Math.max(0, drillMissFlash - dt * 2.2);
    updateHUD();
    drawGame(timestamp);
  }

  function tickTrainingTime(timestamp) {
    if (!lastStatsTickAt) {
      lastStatsTickAt = timestamp;
      return;
    }
    const elapsed = Math.min(1000, Math.max(0, timestamp - lastStatsTickAt));
    lastStatsTickAt = timestamp;
    const activelyTraining = document.visibilityState === 'visible'
      && lastTrainingActivityAt > 0
      && timestamp - lastTrainingActivityAt < 10000;
    if (!activelyTraining) return;

    trainingStats.practiceMs += elapsed;
    practiceSinceSave += elapsed;
    if (timestamp - lastStatsRenderAt >= 1000) {
      lastStatsRenderAt = timestamp;
      renderStats();
    }
    if (practiceSinceSave >= 5000) scheduleSave();
  }

  function spawnEnemies(dt) {
    nextEnemyIn -= dt * 1000;
    if (nextEnemyIn > 0) return;
    const lanes = [118, 184, 250, 316];
    const arpa = selectedTargetArpas[Math.floor(Math.random() * selectedTargetArpas.length)] || DEFAULT_TARGET_ARPA;
    enemies.push({
      id: `${Date.now()}-${Math.random()}`,
      arpa,
      x: GAME_WIDTH + 30,
      y: lanes[Math.floor(Math.random() * lanes.length)],
      radius: 24,
      speed: 19 + Math.random() * 13,
      phase: Math.random() * Math.PI * 2,
    });
    nextEnemyIn = 1250 + Math.random() * 900;
  }

  function moveEnemies(dt) {
    for (const enemy of enemies) enemy.x -= enemy.speed * dt;
    for (let index = enemies.length - 1; index >= 0; index -= 1) {
      if (enemies[index].x + enemies[index].radius < 0) enemies.splice(index, 1);
    }
  }

  function processSoundSpeech(timestamp) {
    const spoken = currentFocusedArpa();
    if (!spoken) {
      lastSpokenArpa = '';
      return;
    }
    const repeated = spoken === lastSpokenArpa && timestamp - lastShotAt < SHOT_COOLDOWN_MS;
    if (repeated) return;
    const matchingEnemy = findClosestEnemy(spoken);
    if (matchingEnemy) shootAtEnemy(matchingEnemy, spoken, timestamp);
    else if (timestamp - lastMissAt > MISS_COOLDOWN_MS) shootMiss(spoken, timestamp, MODE_SOUNDS);
    lastSpokenArpa = spoken;
  }

  function findClosestEnemy(arpa) {
    let best = null;
    for (const enemy of enemies) {
      if (enemy.arpa !== arpa) continue;
      if (!best || enemy.x < best.x) best = enemy;
    }
    return best;
  }

  function shootAtEnemy(enemy, spoken, timestamp) {
    arrows.push({
      x: SOUND_ARCHER.x + 18,
      y: SOUND_ARCHER.y - 27,
      tx: enemy.x,
      ty: enemy.y,
      progress: 0,
      duration: 0.2,
      enemyId: enemy.id,
      arpa: spoken,
      hit: true,
      mode: MODE_SOUNDS,
    });
    lastShotAt = timestamp;
  }

  function shootMiss(spoken, timestamp, mode) {
    const archer = mode === MODE_SOUNDS ? SOUND_ARCHER : WORD_ARCHER;
    const direction = Math.random() > 0.5 ? 1 : -1;
    arrows.push({
      x: archer.x,
      y: archer.y - 28,
      tx: archer.x + direction * (80 + Math.random() * 95),
      ty: archer.y - 190,
      progress: 0,
      duration: 0.3,
      enemyId: null,
      arpa: spoken,
      hit: false,
      mode,
    });
    lastShotAt = timestamp;
    lastMissAt = timestamp;
    streak = 0;
  }

  function moveWord(dt, timestamp) {
    if (wordAdvanceAt && timestamp >= wordAdvanceAt) {
      advanceWord();
      return;
    }
    if (!wordAdvanceAt) wordY = Math.min(302, wordY + dt * 7.5);
  }

  function processWordSpeech(timestamp) {
    const spoken = currentFocusedArpa();
    if (!spoken) {
      if (!wordUnfocusedSince) wordUnfocusedSince = timestamp;
      if (timestamp - wordUnfocusedSince >= 350) wordCanScore = true;
      lastWordSpokenArpa = '';
      return;
    }
    wordUnfocusedSince = 0;
    if (spoken === lastWordSpokenArpa) return;
    lastWordSpokenArpa = spoken;
    if (wordAdvanceAt) return;

    if (spoken === WORD_TARGET_ARPA && wordCanScore && timestamp - lastWordHitAt >= WORD_HIT_COOLDOWN_MS) {
      lastWordHitAt = timestamp;
      wordCanScore = false;
      wordHits = Math.min(WORD_HITS_REQUIRED, wordHits + 1);
      trainingStats.wordReps += 1;
      wordY = Math.max(68, wordY - 24);
      wordHitFlash = 1;
      shootWordArrow(true, spoken);
      spawnParticles(GAME_WIDTH / 2, wordY + 58, 14, '#f8c85c');
      if (wordHits >= WORD_HITS_REQUIRED) {
        trainingStats.wordsMastered += 1;
        wordAdvanceAt = timestamp + 1050;
        spawnParticles(GAME_WIDTH / 2, wordY + 56, 38, '#55e6c1');
      }
      renderStats();
      scheduleSave();
      return;
    }

    if (spoken !== WORD_TARGET_ARPA && timestamp - lastWordMissAt >= MISS_COOLDOWN_MS) {
      lastWordMissAt = timestamp;
      wordMissFlash = 1;
      shootWordArrow(false, spoken);
    }
  }

  function shootWordArrow(hit, spoken) {
    const targetX = hit ? GAME_WIDTH / 2 : GAME_WIDTH / 2 + (Math.random() > 0.5 ? 118 : -118);
    const targetY = hit ? wordY + 58 : wordY + 88;
    arrows.push({
      x: WORD_ARCHER.x,
      y: WORD_ARCHER.y - 31,
      tx: targetX,
      ty: targetY,
      progress: 0,
      duration: hit ? 0.2 : 0.3,
      enemyId: null,
      arpa: spoken,
      hit,
      mode: MODE_WORDS,
    });
  }

  function advanceWord() {
    wordIndex = (wordIndex + 1) % WORDS.length;
    wordLevel += 1;
    wordHits = 0;
    wordY = 72;
    wordAdvanceAt = 0;
    wordHitFlash = 0;
    wordMissFlash = 0;
    lastWordSpokenArpa = '';
    lastWordHitAt = Number.NEGATIVE_INFINITY;
    wordCanScore = true;
    wordUnfocusedSince = 0;
    arrows.length = 0;
    bursts.length = 0;
    particles.length = 0;
    scheduleSave();
  }

  function moveDrill(dt, timestamp) {
    if (drillAdvanceAt && timestamp >= drillAdvanceAt) {
      advanceDrill();
      return;
    }
    if (!drillAdvanceAt) drillY = Math.min(274, drillY + dt * 6.5);
  }

  function processDrillSpeech(timestamp) {
    const spoken = currentFocusedArpa();
    if (!spoken) {
      if (!drillUnfocusedSince) drillUnfocusedSince = timestamp;
      if (timestamp - drillUnfocusedSince >= 450) drillCanScore = true;
      lastDrillSpokenArpa = '';
      return;
    }
    drillUnfocusedSince = 0;
    if (spoken === lastDrillSpokenArpa) return;
    lastDrillSpokenArpa = spoken;
    if (drillAdvanceAt) return;

    if (spoken === WORD_TARGET_ARPA && drillCanScore && timestamp - lastDrillHitAt >= DRILL_HIT_COOLDOWN_MS) {
      lastDrillHitAt = timestamp;
      drillCanScore = false;
      drillHits = Math.min(DRILL_HITS_REQUIRED, drillHits + 1);
      trainingStats.drillReps += 1;
      drillY = Math.max(64, drillY - 18);
      drillHitFlash = 1;
      shootDrillArrow(true, spoken);
      spawnParticles(GAME_WIDTH / 2, drillY + 76, 12, '#f8c85c');
      if (drillHits >= DRILL_HITS_REQUIRED) {
        trainingStats.drillsCompleted += 1;
        drillAdvanceAt = timestamp + 1050;
        spawnParticles(GAME_WIDTH / 2, drillY + 74, 40, '#55e6c1');
      }
      storeCurrentDrillProgress();
      renderStats();
      scheduleSave();
      return;
    }

    if (spoken !== WORD_TARGET_ARPA && timestamp - lastDrillMissAt >= MISS_COOLDOWN_MS) {
      lastDrillMissAt = timestamp;
      drillMissFlash = 1;
      shootDrillArrow(false, spoken);
    }
  }

  function shootDrillArrow(hit, spoken) {
    const targetX = hit ? GAME_WIDTH / 2 : GAME_WIDTH / 2 + (Math.random() > 0.5 ? 118 : -118);
    const targetY = hit ? drillY + 76 : drillY + 105;
    arrows.push({
      x: WORD_ARCHER.x,
      y: WORD_ARCHER.y - 31,
      tx: targetX,
      ty: targetY,
      progress: 0,
      duration: hit ? 0.2 : 0.3,
      enemyId: null,
      arpa: spoken,
      hit,
      mode: MODE_DRILLS,
    });
  }

  function advanceDrill() {
    const drills = currentDrills();
    drillIndex = (drillIndex + 1) % drills.length;
    drillHits = 0;
    drillY = 68;
    drillAdvanceAt = 0;
    drillHitFlash = 0;
    drillMissFlash = 0;
    lastDrillSpokenArpa = '';
    lastDrillHitAt = Number.NEGATIVE_INFINITY;
    drillCanScore = true;
    drillUnfocusedSince = 0;
    arrows.length = 0;
    bursts.length = 0;
    particles.length = 0;
    storeCurrentDrillProgress();
    scheduleSave();
  }

  function moveArrows(dt) {
    for (const arrow of arrows) arrow.progress += dt / arrow.duration;
    for (let index = arrows.length - 1; index >= 0; index -= 1) {
      const arrow = arrows[index];
      if (arrow.progress < 1) continue;
      if (arrow.mode === MODE_SOUNDS && arrow.hit) {
        const enemyIndex = enemies.findIndex((enemy) => enemy.id === arrow.enemyId);
        if (enemyIndex >= 0) {
          const enemy = enemies[enemyIndex];
          enemies.splice(enemyIndex, 1);
          streak += 1;
          soundScore += 10 + Math.min(streak, 5) * 2;
          trainingStats.soundHits += 1;
          bursts.push({ x: enemy.x, y: enemy.y, life: 0.5, color: '#f97db2' });
          spawnParticles(enemy.x, enemy.y, 16, '#f97db2');
          renderStats();
          scheduleSave();
        }
      }
      arrows.splice(index, 1);
    }
  }

  function moveBursts(dt) {
    for (const burst of bursts) burst.life -= dt;
    for (let index = bursts.length - 1; index >= 0; index -= 1) {
      if (bursts[index].life <= 0) bursts.splice(index, 1);
    }
  }

  function spawnParticles(x, y, count, color) {
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + Math.random() * 0.4;
      const speed = 34 + Math.random() * 78;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 18,
        life: 0.45 + Math.random() * 0.45,
        maxLife: 0.9,
        size: 1.5 + Math.random() * 3.5,
        color,
      });
    }
  }

  function moveParticles(dt) {
    for (const particle of particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 65 * dt;
    }
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      if (particles[index].life <= 0) particles.splice(index, 1);
    }
  }

  function updateHUD() {
    if (!game || !footerLabelEl) return;
    if (gameMode === MODE_DRILLS) {
      const drills = currentDrills();
      footerLabelEl.textContent = 'Repetitions';
      footerValueEl.textContent = `${drillHits}/${DRILL_HITS_REQUIRED}`;
      progressEl.style.width = `${(drillHits / DRILL_HITS_REQUIRED) * 100}%`;
      drillPositionEl.textContent = `${drillIndex + 1}/${drills.length}`;
      drillSoundEl.textContent = labelForArpa(WORD_TARGET_ARPA);
    } else if (gameMode === MODE_WORDS) {
      footerLabelEl.textContent = 'Mastery';
      footerValueEl.textContent = `${wordHits}/${WORD_HITS_REQUIRED}`;
      progressEl.style.width = `${(wordHits / WORD_HITS_REQUIRED) * 100}%`;
      wordLevelEl.textContent = String(wordLevel);
      wordSoundEl.textContent = labelForArpa(WORD_TARGET_ARPA);
    } else {
      footerLabelEl.textContent = 'Score';
      footerValueEl.textContent = String(soundScore);
      progressEl.style.width = '0%';
    }
  }

  function drawGame(timestamp) {
    if (!ctx) return;
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    drawBackground(timestamp);
    if (gameMode === MODE_WORDS) drawWordMode(timestamp);
    else if (gameMode === MODE_DRILLS) drawDrillMode(timestamp);
    else drawSoundMode(timestamp);
    drawArrows();
    drawParticles();
    drawBursts();
  }

  function drawBackground(timestamp) {
    const time = timestamp / 1000;
    const bg = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
    bg.addColorStop(0, '#101729');
    bg.addColorStop(0.55, '#172439');
    bg.addColorStop(1, '#0b1118');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    ctx.save();
    for (const star of STARS) {
      ctx.globalAlpha = 0.28 + (Math.sin(time * 1.6 + star.phase) + 1) * 0.22;
      ctx.fillStyle = star.r > 1.2 ? '#f8c85c' : '#d9ecff';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const moon = ctx.createRadialGradient(298, 74, 4, 298, 74, 38);
    moon.addColorStop(0, 'rgba(255, 222, 147, 0.28)');
    moon.addColorStop(1, 'rgba(255, 222, 147, 0)');
    ctx.fillStyle = moon;
    ctx.beginPath();
    ctx.arc(298, 74, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f3dca7';
    ctx.beginPath();
    ctx.arc(298, 74, 15, 0, Math.PI * 2);
    ctx.fill();

    drawMountainLayer(285, '#172437', 0.65);
    drawMountainLayer(332, '#101c2a', 1);

    const ground = ctx.createLinearGradient(0, 365, 0, GAME_HEIGHT);
    ground.addColorStop(0, '#17281f');
    ground.addColorStop(1, '#0b1512');
    ctx.fillStyle = ground;
    ctx.fillRect(0, 365, GAME_WIDTH, GAME_HEIGHT - 365);

    ctx.fillStyle = 'rgba(85, 230, 193, 0.08)';
    ctx.beginPath();
    ctx.ellipse(GAME_WIDTH / 2, 464, 142, 29, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMountainLayer(baseY, color, offset) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(0, baseY - 62 * offset);
    ctx.lineTo(62, baseY - 116 * offset);
    ctx.lineTo(112, baseY - 54 * offset);
    ctx.lineTo(172, baseY - 132 * offset);
    ctx.lineTo(232, baseY - 72 * offset);
    ctx.lineTo(300, baseY - 122 * offset);
    ctx.lineTo(GAME_WIDTH, baseY - 52 * offset);
    ctx.lineTo(GAME_WIDTH, baseY);
    ctx.closePath();
    ctx.fill();
  }

  function drawSoundMode(timestamp) {
    drawSoundLanes();
    drawAllowedHint();
    drawEnemies(timestamp);
    drawArcher(SOUND_ARCHER, currentAimedEnemy(), timestamp);
  }

  function drawSoundLanes() {
    ctx.save();
    ctx.strokeStyle = 'rgba(180, 220, 226, 0.09)';
    ctx.setLineDash([7, 12]);
    for (const y of [118, 184, 250, 316]) {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(GAME_WIDTH - 16, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAllowedHint() {
    const label = selectedTargetArpas.map(labelForArpa).join(' ');
    ctx.save();
    ctx.globalAlpha = 0.075;
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 46px Satoshi, system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, GAME_WIDTH / 2, 45);
    ctx.restore();
  }

  function drawEnemies(timestamp) {
    const aimedEnemy = currentAimedEnemy();
    const time = timestamp / 1000;
    for (const enemy of enemies) {
      const active = aimedEnemy && aimedEnemy.id === enemy.id;
      const bob = Math.sin(time * 3 + enemy.phase) * 3;
      const y = enemy.y + bob;
      ctx.save();
      ctx.shadowColor = active ? 'rgba(245, 39, 127, 0.9)' : 'rgba(0, 0, 0, 0.52)';
      ctx.shadowBlur = active ? 22 : 10;

      ctx.fillStyle = active ? '#f97db2' : '#6073a1';
      ctx.beginPath();
      ctx.moveTo(enemy.x - 17, y - 15);
      ctx.lineTo(enemy.x - 11, y - 36);
      ctx.lineTo(enemy.x - 1, y - 18);
      ctx.lineTo(enemy.x + 12, y - 37);
      ctx.lineTo(enemy.x + 17, y - 13);
      ctx.closePath();
      ctx.fill();

      const body = ctx.createRadialGradient(enemy.x - 8, y - 10, 3, enemy.x, y, enemy.radius + 4);
      body.addColorStop(0, active ? '#ffe2ee' : '#9fb0d2');
      body.addColorStop(0.45, active ? '#f5277f' : '#52658d');
      body.addColorStop(1, '#26324b');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(enemy.x, y, enemy.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#101729';
      ctx.beginPath();
      ctx.arc(enemy.x - 8, y - 5, 3, 0, Math.PI * 2);
      ctx.arc(enemy.x + 8, y - 5, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = active ? '#ffffff' : '#dff8f2';
      ctx.beginPath();
      ctx.arc(enemy.x - 7, y - 6, 1.1, 0, Math.PI * 2);
      ctx.arc(enemy.x + 9, y - 6, 1.1, 0, Math.PI * 2);
      ctx.fill();

      roundedRectPath(enemy.x - 23, y + 8, 46, 24, 6);
      ctx.fillStyle = active ? '#f5277f' : '#1a263c';
      ctx.fill();
      ctx.strokeStyle = active ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 15px Satoshi, system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelForArpa(enemy.arpa), enemy.x, y + 20);
      ctx.restore();
    }
  }

  function drawWordMode(timestamp) {
    const targetActive = currentFocusedArpa() === WORD_TARGET_ARPA;
    const bob = Math.sin(timestamp / 520) * 3;
    const x = GAME_WIDTH / 2;
    const y = wordY + bob;

    ctx.save();
    ctx.strokeStyle = targetActive ? 'rgba(85, 230, 193, 0.32)' : 'rgba(142, 182, 214, 0.13)';
    ctx.lineWidth = targetActive ? 2 : 1;
    ctx.setLineDash([5, 10]);
    ctx.beginPath();
    ctx.moveTo(x, 26);
    ctx.lineTo(x, WORD_ARCHER.y - 58);
    ctx.stroke();
    ctx.restore();

    const scale = 0.84 + (y / 500) * 0.19;
    const cardW = 294 * scale;
    const cardH = 116 * scale;
    const cardX = x - cardW / 2;
    const cardY = y;

    ctx.save();
    ctx.shadowColor = targetActive
      ? 'rgba(85, 230, 193, 0.85)'
      : wordMissFlash > 0 ? 'rgba(234, 125, 53, 0.75)' : 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = targetActive ? 28 : 18;
    roundedRectPath(cardX, cardY, cardW, cardH, 8);
    const cardGradient = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    cardGradient.addColorStop(0, wordHitFlash > 0 ? '#1f5a50' : '#23334d');
    cardGradient.addColorStop(0.55, '#17243a');
    cardGradient.addColorStop(1, wordMissFlash > 0 ? '#5a3024' : '#121c2d');
    ctx.fillStyle = cardGradient;
    ctx.fill();
    ctx.strokeStyle = targetActive ? '#55e6c1' : 'rgba(188, 215, 232, 0.3)';
    ctx.lineWidth = targetActive ? 2.5 : 1.25;
    ctx.stroke();

    const badgeW = 44 * scale;
    const badgeH = 23 * scale;
    roundedRectPath(x - badgeW / 2, cardY - badgeH / 2, badgeW, badgeH, 6);
    ctx.fillStyle = targetActive ? '#55e6c1' : '#f8c85c';
    ctx.fill();
    ctx.fillStyle = '#0c1820';
    ctx.font = `900 ${12 * scale}px Satoshi, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelForArpa(WORD_TARGET_ARPA), x, cardY + 1);

    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${fitWordFont(currentWord(), cardW - 32, 38 * scale)}px Satoshi, system-ui`;
    ctx.fillText(currentWord(), x, cardY + cardH * 0.43);

    const pipGap = 19 * scale;
    const pipStart = x - ((WORD_HITS_REQUIRED - 1) * pipGap) / 2;
    for (let index = 0; index < WORD_HITS_REQUIRED; index += 1) {
      ctx.beginPath();
      ctx.arc(pipStart + index * pipGap, cardY + cardH * 0.77, 4.5 * scale, 0, Math.PI * 2);
      ctx.fillStyle = index < wordHits ? '#55e6c1' : 'rgba(255,255,255,0.14)';
      ctx.fill();
      if (index < wordHits) {
        ctx.strokeStyle = 'rgba(255,255,255,0.72)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.restore();

    if (wordAdvanceAt) drawLevelComplete(x, cardY + cardH / 2);
    else if (wordMissFlash > 0) drawTryAgain(x, cardY + cardH + 25, wordMissFlash);

    drawArcher(WORD_ARCHER, { x, y: cardY + cardH / 2 }, timestamp);
  }

  function drawDrillMode(timestamp) {
    const drill = currentDrill();
    const targetActive = currentFocusedArpa() === WORD_TARGET_ARPA;
    const bob = Math.sin(timestamp / 540) * 3;
    const x = GAME_WIDTH / 2;
    const y = drillY + bob;

    ctx.save();
    ctx.strokeStyle = targetActive ? 'rgba(85, 230, 193, 0.32)' : 'rgba(142, 182, 214, 0.13)';
    ctx.lineWidth = targetActive ? 2 : 1;
    ctx.setLineDash([5, 10]);
    ctx.beginPath();
    ctx.moveTo(x, 24);
    ctx.lineTo(x, WORD_ARCHER.y - 58);
    ctx.stroke();
    ctx.restore();

    const scale = 0.84 + (y / 500) * 0.17;
    const cardW = 302 * scale;
    const cardH = 160 * scale;
    const cardX = x - cardW / 2;
    const cardY = y;

    ctx.save();
    ctx.shadowColor = targetActive
      ? 'rgba(85, 230, 193, 0.85)'
      : drillMissFlash > 0 ? 'rgba(234, 125, 53, 0.75)' : 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = targetActive ? 28 : 18;
    roundedRectPath(cardX, cardY, cardW, cardH, 8);
    const cardGradient = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    cardGradient.addColorStop(0, drillHitFlash > 0 ? '#1f5a50' : '#26364d');
    cardGradient.addColorStop(0.58, '#17243a');
    cardGradient.addColorStop(1, drillMissFlash > 0 ? '#5a3024' : '#101a2b');
    ctx.fillStyle = cardGradient;
    ctx.fill();
    ctx.strokeStyle = targetActive ? '#55e6c1' : 'rgba(188, 215, 232, 0.3)';
    ctx.lineWidth = targetActive ? 2.5 : 1.25;
    ctx.stroke();

    const badgeW = 44 * scale;
    const badgeH = 23 * scale;
    roundedRectPath(x - badgeW / 2, cardY - badgeH / 2, badgeW, badgeH, 6);
    ctx.fillStyle = targetActive ? '#55e6c1' : '#f8c85c';
    ctx.fill();
    ctx.fillStyle = '#0c1820';
    ctx.font = `900 ${12 * scale}px Satoshi, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelForArpa(WORD_TARGET_ARPA), x, cardY + 1);

    ctx.fillStyle = drill.real ? '#8ff3da' : '#aebbd0';
    ctx.font = `800 ${9.5 * scale}px Satoshi, system-ui`;
    ctx.fillText(`${drill.section.toUpperCase()} · ${drill.real ? 'REAL WORD' : 'DRILL ONLY'}`, x, cardY + cardH * 0.19);

    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${fitWordFont(drill.word, cardW - 34, 31 * scale)}px Satoshi, system-ui`;
    ctx.fillText(drill.word, x, cardY + cardH * 0.39);

    const arrowY = cardY + cardH * 0.53;
    ctx.strokeStyle = 'rgba(248, 200, 92, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 18, arrowY);
    ctx.lineTo(x + 16, arrowY);
    ctx.stroke();
    ctx.fillStyle = '#f8c85c';
    ctx.beginPath();
    ctx.moveTo(x + 20, arrowY);
    ctx.lineTo(x + 12, arrowY - 5);
    ctx.lineTo(x + 12, arrowY + 5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.font = `800 ${21 * scale}px Satoshi, system-ui`;
    ctx.fillText('humble', x, cardY + cardH * 0.68);

    const pipGap = 12.5 * scale;
    const pipStart = x - ((DRILL_HITS_REQUIRED - 1) * pipGap) / 2;
    for (let index = 0; index < DRILL_HITS_REQUIRED; index += 1) {
      ctx.beginPath();
      ctx.arc(pipStart + index * pipGap, cardY + cardH * 0.86, 3.3 * scale, 0, Math.PI * 2);
      ctx.fillStyle = index < drillHits ? '#55e6c1' : 'rgba(255,255,255,0.13)';
      ctx.fill();
    }
    ctx.restore();

    if (drillAdvanceAt) drawDrillComplete(x, cardY + cardH / 2);
    else if (drillMissFlash > 0) drawTryAgain(x, cardY + cardH + 24, drillMissFlash);

    drawArcher(WORD_ARCHER, { x, y: cardY + cardH / 2 }, timestamp);
  }

  function fitWordFont(word, maxWidth, maxSize) {
    let size = maxSize;
    while (size > 20) {
      ctx.font = `900 ${size}px Satoshi, system-ui`;
      if (ctx.measureText(word).width <= maxWidth) break;
      size -= 1;
    }
    return size;
  }

  function drawLevelComplete(x, y) {
    ctx.save();
    ctx.globalAlpha = 0.94;
    roundedRectPath(x - 88, y - 27, 176, 54, 8);
    ctx.fillStyle = '#55e6c1';
    ctx.fill();
    ctx.fillStyle = '#0a1a18';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 17px Satoshi, system-ui';
    ctx.fillText('WORD MASTERED', x, y - 6);
    ctx.font = '800 11px Satoshi, system-ui';
    ctx.fillText(`LEVEL ${wordLevel} COMPLETE`, x, y + 13);
    ctx.restore();
  }

  function drawDrillComplete(x, y) {
    ctx.save();
    ctx.globalAlpha = 0.95;
    roundedRectPath(x - 91, y - 27, 182, 54, 8);
    ctx.fillStyle = '#55e6c1';
    ctx.fill();
    ctx.fillStyle = '#0a1a18';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 17px Satoshi, system-ui';
    ctx.fillText('PAIR COMPLETE', x, y - 6);
    ctx.font = '800 11px Satoshi, system-ui';
    ctx.fillText('NEXT DRILL READY', x, y + 13);
    ctx.restore();
  }

  function drawTryAgain(x, y, alpha) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = '#f5b17d';
    ctx.font = '800 12px Satoshi, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('TRY AGAIN', x, y);
    ctx.restore();
  }

  function drawArcher(position, target, timestamp) {
    const aimX = target ? target.x : position.x + 82;
    const aimY = target ? target.y : position.y - 82;
    const shoulderX = position.x + 8;
    const shoulderY = position.y - 36;
    const angle = Math.atan2(aimY - shoulderY, aimX - shoulderX);
    const breathing = Math.sin(timestamp / 390) * 1.2;

    ctx.save();
    ctx.translate(position.x, position.y + breathing);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.beginPath();
    ctx.ellipse(0, 22, 30, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#243b42';
    ctx.beginPath();
    ctx.moveTo(-18, 17);
    ctx.lineTo(-13, -25);
    ctx.quadraticCurveTo(0, -37, 15, -24);
    ctx.lineTo(22, 19);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#55e6c1';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#f2c89d';
    ctx.beginPath();
    ctx.arc(0, -43, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#19283b';
    ctx.beginPath();
    ctx.arc(-1, -47, 12, Math.PI, Math.PI * 2);
    ctx.lineTo(12, -42);
    ctx.lineTo(-13, -40);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#d8edf0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-8, 16);
    ctx.lineTo(-13, 34);
    ctx.moveTo(10, 16);
    ctx.lineTo(15, 34);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(shoulderX, shoulderY + breathing);
    ctx.rotate(angle);
    ctx.strokeStyle = '#f3dca7';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(35, 0);
    ctx.stroke();
    ctx.strokeStyle = currentFocusedArpa() ? '#55e6c1' : 'rgba(216,237,240,0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(34, 0, 19, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(34, -19);
    ctx.lineTo(25, 0);
    ctx.lineTo(34, 19);
    ctx.stroke();
    ctx.restore();
  }

  function drawArrows() {
    for (const arrow of arrows) {
      const progress = Math.min(1, arrow.progress);
      const x = arrow.x + (arrow.tx - arrow.x) * progress;
      const y = arrow.y + (arrow.ty - arrow.y) * progress;
      const angle = Math.atan2(arrow.ty - arrow.y, arrow.tx - arrow.x);
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = arrow.hit ? '#55e6c1' : '#ea7d35';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(arrow.x, arrow.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.strokeStyle = arrow.hit ? '#d9fff5' : '#f5b17d';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
      ctx.fillStyle = arrow.hit ? '#55e6c1' : '#ea7d35';
      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.lineTo(4, -5);
      ctx.lineTo(4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBursts() {
    for (const burst of bursts) {
      const alpha = Math.max(0, burst.life / 0.5);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = 2 + 5 * alpha;
      ctx.beginPath();
      ctx.arc(burst.x, burst.y, 22 + (1 - alpha) * 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const particle of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function currentAimedEnemy() {
    const spoken = currentFocusedArpa();
    return spoken ? findClosestEnemy(spoken) : null;
  }

  function roundedRectPath(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function parseDetail(detail) {
    if (!detail) return null;
    try {
      return typeof detail === 'string' ? JSON.parse(detail) : detail;
    } catch (_) {
      return null;
    }
  }

  window.addEventListener(EVENT_NAME, (event) => updatePanel(parseDetail(event.detail)));

  function initialize() {
    createPanel();
    createStatsPanel();
    createGame();
    loadStoredState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }

  window.addEventListener('pagehide', () => {
    if (storageReady) writeStoredState(stateSnapshot()).catch(() => {});
  });

  const observer = new MutationObserver(() => placeSurfaces());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
