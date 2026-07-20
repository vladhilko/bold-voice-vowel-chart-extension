(function () {
  if (window.__bvVowelFocusReaderInstalled) return;
  window.__bvVowelFocusReaderInstalled = true;

  const EVENT_NAME = 'bv-vowel-focus-reader:update';
  const CANVAS_ID = 'chart';
  const ANCHOR_RADIUS = 36;
  const HIT_RING_RADIUS = ANCHOR_RADIUS + 1;
  const LIVE_DOT_RADIUS = 14;
  const RING_COLOR = '#f5277f';
  const ANCHOR_MARGIN = 50;
  const BV_VOWEL_LABELS = {
    AA: 'AH',
    AE: 'AA',
    EH: 'EH',
    IY: 'EE',
    IH: 'IH',
    AO: 'AW',
    UH: 'U',
    AX: 'uh',
    AH: 'UH',
    UW: 'OO',
    ER: 'ER',
  };

  let anchors = null;
  let anchorsPromise = null;
  let lastLivePayload = null;
  let lastHitPayload = null;
  let lastPayloadKey = '';
  let lastHitAt = 0;
  let lastLiveAt = 0;
  let clearTimer = 0;
  let canvasTexts = [];

  function publish(payload) {
    const normalized = payload || { focused: false };
    const key = JSON.stringify(normalized);
    if (key === lastPayloadKey) return;
    lastPayloadKey = key;
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: key }));
  }

  function normalizeColor(value) {
    if (!value) return '';
    const color = String(value).trim().toLowerCase();
    if (color === RING_COLOR) return color;
    if (color === 'rgb(245, 39, 127)' || color === 'rgba(245, 39, 127, 1)') {
      return RING_COLOR;
    }
    return color;
  }

  function anchorLabel(ipa, arpa) {
    const params = new URLSearchParams(location.search);
    if ((params.get('labels') || '').toLowerCase() === 'ipa') return ipa;
    if (location.hostname === 'boldvoice.com' || location.hostname.endsWith('.boldvoice.com')) {
      return BV_VOWEL_LABELS[String(arpa || '').toUpperCase()] || arpa || ipa;
    }
    return arpa || ipa;
  }

  function normalizeToken(value) {
    return String(value || '').trim().toUpperCase();
  }

  function anchorTokens(anchor) {
    return [
      anchor.label,
      anchor.arpa,
      anchor.ipa,
      anchor.word,
    ].map(normalizeToken).filter(Boolean);
  }

  function applyPageAnchorFilters(rows) {
    const params = new URLSearchParams(location.search);
    let filtered = Array.isArray(rows) ? rows.slice() : [];
    const compareRaw = (params.get('compare') || params.get('vowels') || '').toLowerCase();
    const keepSchwa =
      (params.get('schwa') || '') === '1' ||
      /\bax\b/.test(compareRaw) ||
      compareRaw.includes('ə');

    if (!keepSchwa) {
      filtered = filtered.filter((row) => String(row[4] || '').toUpperCase() !== 'AX');
    }

    const compareParam = (params.get('compare') || params.get('vowels') || '').trim();
    if (compareParam) {
      const wanted = new Set(
        compareParam
          .split(/[,\s]+/)
          .filter(Boolean)
          .map((value) => value.toLowerCase()),
      );
      const narrowed = filtered.filter(([ipa, , , , arpa]) => (
        wanted.has(String(arpa || '').toLowerCase()) ||
        wanted.has(String(ipa || '').toLowerCase())
      ));
      if (narrowed.length) filtered = narrowed;
    }

    return filtered.map(([ipa, word, openness, forwardness, arpa]) => ({
      ipa,
      word,
      openness,
      forwardness,
      arpa,
      label: anchorLabel(ipa, arpa),
    }));
  }

  function loadAnchors() {
    if (anchors) return Promise.resolve(anchors);
    if (anchorsPromise) return anchorsPromise;

    const params = new URLSearchParams(location.search);
    const speaker = (params.get('anchors') || 'ron').toLowerCase();
    anchorsPromise = fetch(`${speaker}_anchors.json`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((rows) => {
        anchors = applyPageAnchorFilters(rows);
        publish({
          focused: false,
          anchors,
        });
        return anchors;
      })
      .catch((error) => {
        publish({
          focused: false,
          error: `Could not load vowel anchors: ${error.message}`,
        });
        anchors = [];
        return anchors;
      });

    return anchorsPromise;
  }

  function anchorPoint(anchor, canvas) {
    const width = canvas.width - 2 * ANCHOR_MARGIN;
    const height = canvas.height - 2 * ANCHOR_MARGIN;
    return {
      x: ANCHOR_MARGIN + (1 - anchor.forwardness) * width,
      y: ANCHOR_MARGIN + anchor.openness * height,
    };
  }

  function findAnchorAt(canvas, x, y) {
    if (!anchors || !anchors.length) return null;
    let best = null;
    let bestDistance = ANCHOR_RADIUS;

    for (const anchor of anchors) {
      const point = anchorPoint(anchor, canvas);
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = anchor;
      }
    }

    return best;
  }

  function findAnchorByTextAt(canvas, x, y) {
    if (!anchors || !anchors.length) return null;

    const now = performance.now();
    const recentTexts = canvasTexts.filter((item) => (
      item.canvas === canvas &&
      now - item.at < 1800 &&
      Math.hypot(x - item.x, y - item.y) <= ANCHOR_RADIUS + 24
    ));

    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const anchor of anchors) {
      const tokens = anchorTokens(anchor);
      for (const item of recentTexts) {
        if (!tokens.includes(normalizeToken(item.text))) continue;
        const distance = Math.hypot(x - item.x, y - item.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = anchor;
        }
      }
    }

    return best;
  }

  function nearestAnchor(canvas, x, y) {
    if (!anchors || !anchors.length) return null;
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const anchor of anchors) {
      const point = anchorPoint(anchor, canvas);
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = anchor;
      }
    }

    return best ? { ...best, distance: bestDistance } : null;
  }

  function reportHit(canvas, x, y) {
    lastHitAt = performance.now();
    loadAnchors().then(() => {
      // The ring is drawn at the exact model anchor. Canvas text uses a
      // display notation whose labels can collide with raw ARPABET codes.
      const anchor = findAnchorAt(canvas, x, y) || findAnchorByTextAt(canvas, x, y);
      if (!anchor) return;
      lastHitPayload = {
        focused: true,
        symbol: anchor.label,
        arpa: anchor.arpa,
        ipa: anchor.ipa,
        word: anchor.word,
        anchors,
        live: lastLivePayload && lastLivePayload.live,
      };
      publish(lastHitPayload);
    });
  }

  function reportLiveDot(canvas, x, y) {
    lastLiveAt = performance.now();
    loadAnchors().then(() => {
      const nearest = nearestAnchor(canvas, x, y);
      lastLivePayload = {
        focused: false,
        anchors,
        live: { x, y, canvasWidth: canvas.width, canvasHeight: canvas.height },
        nearest: nearest && {
          symbol: nearest.label,
          arpa: nearest.arpa,
          ipa: nearest.ipa,
          word: nearest.word,
          distance: nearest.distance,
        },
      };
      if (lastHitPayload && performance.now() - lastHitAt < 160) {
        publish({
          ...lastHitPayload,
          anchors,
          live: lastLivePayload.live,
          nearest: lastLivePayload.nearest,
        });
        return;
      }
      publish(lastLivePayload);
    });
  }

  function scheduleClearIfNoHit() {
    if (clearTimer) window.clearTimeout(clearTimer);
    clearTimer = window.setTimeout(() => {
      const now = performance.now();
      if (now - lastHitAt > 120 && now - lastLiveAt > 120) {
        lastLivePayload = null;
        lastHitPayload = null;
        publish({ focused: false, anchors: anchors || [] });
      }
    }, 140);
  }

  loadAnchors();

  const proto = CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (!proto) return;

  const originalArc = proto.arc;
  const originalFillText = proto.fillText;
  const originalFill = proto.fill;
  const originalStroke = proto.stroke;
  const originalClearRect = proto.clearRect;

  proto.arc = function (x, y, radius) {
    if (this.canvas && this.canvas.id === CANVAS_ID) {
      this.__bvLastArc = { x, y, radius };
    }
    return originalArc.apply(this, arguments);
  };

  proto.fillText = function (text, x, y) {
    if (this.canvas && this.canvas.id === CANVAS_ID) {
      canvasTexts.push({
        canvas: this.canvas,
        text,
        x,
        y,
        at: performance.now(),
      });
      if (canvasTexts.length > 240) canvasTexts = canvasTexts.slice(-160);
    }
    return originalFillText.apply(this, arguments);
  };

  proto.stroke = function () {
    const arc = this.__bvLastArc;
    if (this.canvas && this.canvas.id === CANVAS_ID && arc) {
      const color = normalizeColor(this.strokeStyle);
      const radiusMatches = Math.abs(arc.radius - HIT_RING_RADIUS) <= 1.5;
      const lineWidth = Number(this.lineWidth);
      const styleMatches = color === RING_COLOR && lineWidth >= 3.5 && lineWidth <= 4.5;
      if (radiusMatches && styleMatches) {
        reportHit(this.canvas, arc.x, arc.y);
      }
    }
    return originalStroke.apply(this, arguments);
  };

  proto.fill = function () {
    const arc = this.__bvLastArc;
    if (this.canvas && this.canvas.id === CANVAS_ID && arc) {
      const radiusMatches = Math.abs(arc.radius - LIVE_DOT_RADIUS) <= 1.5;
      const styleMatches = Number(this.shadowBlur) >= 12;
      if (radiusMatches && styleMatches) {
        reportLiveDot(this.canvas, arc.x, arc.y);
      }
    }
    return originalFill.apply(this, arguments);
  };

  proto.clearRect = function () {
    if (this.canvas && this.canvas.id === CANVAS_ID) {
      scheduleClearIfNoHit();
    }
    return originalClearRect.apply(this, arguments);
  };
})();
