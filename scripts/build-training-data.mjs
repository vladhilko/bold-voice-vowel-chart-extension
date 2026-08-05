import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(projectDir, '../pronunciation_training/single_sound_mastering/sounds');
const outputPath = path.join(projectDir, 'src/training-data.js');

const SOUND_CONFIG = [
  { id: 'uh', label: 'UH', ipa: 'ʌ', arpa: 'AH', keyword: 'strut', featured: 'humble' },
  { id: 'ee', label: 'EE', ipa: 'i', arpa: 'IY', keyword: 'fleece', featured: 'see' },
  { id: 'ih', label: 'IH', ipa: 'ɪ', arpa: 'IH', keyword: 'kit', featured: 'it' },
  { id: 'u', label: 'U', ipa: 'ʊ', arpa: 'UH', keyword: 'foot', featured: 'book' },
  { id: 'eh', label: 'EH', ipa: 'ɛ', arpa: 'EH', keyword: 'dress', featured: 'when' },
  { id: 'oo', label: 'OO', ipa: 'u', arpa: 'UW', keyword: 'goose', featured: 'move' },
  { id: 'ae', label: 'AA', ipa: 'æ', arpa: 'AE', keyword: 'trap', featured: 'hamble', generatedFrom: 'uh', drill: { base: 'hamble', onsetTail: 'amble', codaLead: 'ha' } },
  { id: 'er', label: 'ER', ipa: 'ɝ', arpa: 'ER', keyword: 'nurse', featured: 'hermble', generatedFrom: 'uh', drill: { base: 'hermble', onsetTail: 'ermble', codaLead: 'her' } },
  { id: 'ao', label: 'AO', ipa: 'ɔ', arpa: 'AO', keyword: 'thought', featured: 'hawmble', generatedFrom: 'uh', drill: { base: 'hawmble', onsetTail: 'awmble', codaLead: 'haw' } },
  { id: 'aa', label: 'AH', ipa: 'ɑ', arpa: 'AA', keyword: 'lot', featured: 'homble', generatedFrom: 'uh', drill: { base: 'homble', onsetTail: 'omble', codaLead: 'ho' } },
];

function clean(value = '') {
  return value
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value) {
  return String(value || '')
    .replace(/ŋ/g, '-eng-')
    .replace(/θ/g, '-theta-')
    .replace(/ð/g, '-eth-')
    .replace(/ʃ/g, '-esh-')
    .replace(/ʒ/g, '-ezh-')
    .replace(/ɹ/g, '-r-')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\u0250-\u02af]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'empty';
}

function countOf(value, fallback = 0) {
  const match = String(value || '').replace(/,/g, '').match(/\d+/);
  if (match) return Number(match[0]);
  if (/\byes\b/i.test(value)) return 1;
  return fallback;
}

function examplesOf(value) {
  if (/drill-only/i.test(value)) return [];
  return clean(value)
    .split(',')
    .map((word) => word.replace(/\s*\([^)]*\)\s*/g, '').trim())
    .filter(Boolean);
}

function normalizeToken(value) {
  const token = clean(value)
    .replace(/\s+\/[^/]+\/.*$/, '')
    .replace(/\s*\([^)]*\)\s*/g, '')
    .trim();
  return /^(?:none|no onset|∅|—|-)?$/i.test(token) ? '∅' : token;
}

function familyBoundary(markdown, name) {
  const match = markdown.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*([^|\\n]+)`, 'i'));
  return normalizeToken(match ? match[1] : '');
}

function tableRows(markdown, startPattern, endPattern, direction, sound) {
  const start = markdown.search(startPattern);
  if (start < 0) return [];
  const tail = markdown.slice(start + 1);
  const relativeEnd = tail.search(endPattern);
  const section = markdown.slice(start, relativeEnd < 0 ? undefined : start + 1 + relativeEnd);

  return section.split('\n')
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line, sourceIndex) => {
      const cells = line.split('|').slice(1, -1).map(clean);
      const token = normalizeToken(cells[1]);
      const examples = examplesOf(cells[3] || '');
      const frequency = countOf(cells[4], examples.length);
      const before = direction === 'onset' ? (token === '∅' ? '' : token) : sound.label;
      const after = direction === 'onset' ? sound.label : (token === '∅' ? '' : token);
      const consonantIpa = String(cells[2] || '').replaceAll('/', '').replace('—', '');
      const promptIpa = direction === 'onset' ? `${consonantIpa}${sound.ipa}` : `${sound.ipa}${consonantIpa}`;
      return {
        id: `${direction}:${slug(token)}`,
        direction,
        token,
        ipa: cells[2] || '—',
        label: direction === 'onset' ? `${token} → ${sound.label}` : `${sound.label} → ${token}`,
        prompt: (`${before}${after}` || sound.label).toUpperCase(),
        promptIpa: `/${promptIpa || sound.ipa}/`,
        frequency,
        sourceIndex,
        examples,
      };
    })
    .sort((a, b) => b.frequency - a.frequency || a.sourceIndex - b.sourceIndex);
}

function spellingRows(markdown) {
  const sectionEnd = markdown.search(/^##\s+2\./m);
  const section = sectionEnd < 0 ? markdown : markdown.slice(0, sectionEnd);
  return section.split('\n')
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line, sourceIndex) => {
      const cells = line.split('|').slice(1, -1).map(clean);
      const examplesCell = cells.length >= 5 ? cells[3] : cells[2];
      const countCell = cells.length >= 5 ? cells[4] : cells[3];
      return {
        id: `spelling:${slug(cells[1])}`,
        spelling: cells[1],
        examples: examplesOf(examplesCell),
        frequency: countOf(countCell),
        sourceIndex,
      };
    })
    .sort((a, b) => b.frequency - a.frequency || a.sourceIndex - b.sourceIndex);
}

function parseFamily(filePath, sound, onsetByToken, codaByToken) {
  const markdown = fs.readFileSync(filePath, 'utf8');
  const baseMatch = markdown.match(/\*\*Base word:\*\*\s*([^\s*(]+)/i);
  const headingMatch = markdown.match(/^#\s+Training Drills:\s*([^\s/]+)/im);
  const base = clean((baseMatch && baseMatch[1]) || (headingMatch && headingMatch[1]) || path.basename(filePath).replace(/_training|\.md/g, ''));
  const ipaMatch = markdown.match(/^#\s+Training Drills:[^/]*\/([^/]+)\//im);
  const spellingMatch = markdown.match(/spelling:\s*["']?([^"')]+)["']?/i);
  const baseOnset = familyBoundary(markdown, 'Onset');
  const baseCoda = familyBoundary(markdown, 'Coda');
  const lines = markdown.split('\n');
  let section = '';
  let token = '';
  const items = [];
  const seen = new Map();

  for (const line of lines) {
    if (/^##\s+Section A:/i.test(line)) section = 'onset';
    if (/^##\s+Section B:/i.test(line)) section = 'coda';
    if (!section) continue;

    const onsetHeading = line.match(/^###\s+A\d+\.\s*(.*?)\s*(?:→|to)\s*/i);
    const codaHeading = line.match(/^###\s+B\d+\.\s*(?:Coda:\s*)?(.+?)\s*$/i);
    if (onsetHeading) token = normalizeToken(onsetHeading[1]);
    if (codaHeading) token = normalizeToken(codaHeading[1]);

    const itemMatch = line.match(/^\d+\.\s*([\u2713⚡])?\s*\*\*([^*]+)\*\*(?:\s*\/([^/]+)\/)?/);
    if (!itemMatch || !token) continue;
    const word = clean(itemMatch[2]).toLowerCase();
    const key = `${section}:${token}:${word}`;
    if (seen.has(key)) {
      const existing = items[seen.get(key)];
      if (itemMatch[1] === '⚡') {
        existing.real = false;
        existing.drillOnly = true;
      }
      if (!existing.ipa && itemMatch[3]) existing.ipa = itemMatch[3];
      continue;
    }
    seen.set(key, items.length);
    const pattern = (section === 'onset' ? onsetByToken : codaByToken).get(token);
    items.push({
      id: `family:${slug(base)}:${section}:${slug(token)}:${slug(word)}`,
      familyId: `family:${slug(base)}`,
      section,
      token,
      word,
      ipa: itemMatch[3] || '',
      real: itemMatch[1] === '✓',
      drillOnly: itemMatch[1] === '⚡',
      patternId: pattern ? pattern.id : `${section}:${slug(token)}`,
      frequency: pattern ? pattern.frequency : 0,
      sourceIndex: items.length,
    });
  }

  const byPattern = new Map();
  for (const item of items) {
    const key = `${item.section}:${item.patternId}`;
    const existing = byPattern.get(key);
    if (!existing || (!existing.ipa && item.ipa)) byPattern.set(key, item);
  }
  items.splice(0, items.length, ...byPattern.values());

  const baseOnsetPattern = onsetByToken.get(baseOnset);
  const baseCodaPattern = codaByToken.get(baseCoda);
  const patternsBySection = { onset: onsetByToken, coda: codaByToken };
  for (const [sectionName, patterns] of Object.entries(patternsBySection)) {
    for (const pattern of patterns.values()) {
      if (items.some((item) => item.section === sectionName && item.patternId === pattern.id)) continue;
      const isOriginal = sectionName === 'onset' ? pattern.token === baseOnset : pattern.token === baseCoda;
      items.push({
        id: `family:${slug(base)}:${sectionName}:${slug(pattern.token)}:${slug(base)}:generated`,
        familyId: `family:${slug(base)}`,
        section: sectionName,
        token: pattern.token,
        word: base.toLowerCase(),
        ipa: ipaMatch ? ipaMatch[1] : '',
        real: isOriginal,
        drillOnly: !isOriginal,
        generated: true,
        patternId: pattern.id,
        frequency: pattern.frequency,
        sourceIndex: items.length,
      });
    }
  }

  for (const item of items) {
    const memberships = item.section === 'onset'
      ? [item.patternId, baseCodaPattern && baseCodaPattern.id]
      : [baseOnsetPattern && baseOnsetPattern.id, item.patternId];
    item.patternIds = [...new Set(memberships.filter(Boolean))];
  }

  items.sort((a, b) => b.frequency - a.frequency || a.sourceIndex - b.sourceIndex);
  return {
    id: `family:${slug(base)}`,
    base,
    ipa: ipaMatch ? ipaMatch[1] : '',
    spelling: spellingMatch ? clean(spellingMatch[1]) : '',
    baseOnset,
    baseCoda,
    featured: base.toLowerCase() === sound.featured,
    source: path.basename(filePath),
    items,
  };
}

function parseSound(sound) {
  const soundRoot = path.join(sourceRoot, sound.id);
  const patternsPath = path.join(soundRoot, 'unique_patterns.md');
  const markdown = fs.readFileSync(patternsPath, 'utf8');
  const onsets = tableRows(markdown, /^##\s+2\..*$/m, /^##\s+3\..*$/m, 'onset', sound);
  const codas = tableRows(markdown, /^##\s+3\..*$/m, /^##\s+4\..*$/m, 'coda', sound);
  const spellingPatterns = spellingRows(markdown);
  const onsetByToken = new Map(onsets.map((item) => [item.token, item]));
  const codaByToken = new Map(codas.map((item) => [item.token, item]));
  const trainingDir = path.join(soundRoot, 'training');
  const familyPaths = fs.readdirSync(trainingDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(trainingDir, name));
  const families = familyPaths
    .map((filePath) => parseFamily(filePath, sound, onsetByToken, codaByToken))
    .filter((family) => family.items.length)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.source.localeCompare(b.source));
  for (const family of families) {
    if (family.spelling) continue;
    const match = spellingPatterns.find((pattern) => pattern.examples.some((word) => word.toLowerCase() === family.base.toLowerCase()));
    if (match) family.spelling = match.spelling;
  }

  return {
    ...sound,
    spellingPatterns,
    onsets,
    codas,
    families,
    counts: {
      onsets: onsets.length,
      codas: codas.length,
      families: families.length,
      familyItems: families.reduce((total, family) => total + family.items.length, 0),
    },
  };
}

function tokenSpelling(token) {
  if (token === '∅') return '';
  return token
    .replaceAll('tʃ', 'ch')
    .replaceAll('dʒ', 'j')
    .replaceAll('ʃ', 'sh')
    .replaceAll('ʒ', 'zh')
    .replaceAll('θ', 'th')
    .replaceAll('ð', 'th')
    .replaceAll('ŋ', 'ng');
}

function cloneTransition(pattern, sound) {
  const token = pattern.token;
  const consonantIpa = String(pattern.ipa || '').replaceAll('/', '').replace('—', '');
  const before = pattern.direction === 'onset' ? (token === '∅' ? '' : tokenSpelling(token)) : sound.label;
  const after = pattern.direction === 'onset' ? sound.label : (token === '∅' ? '' : tokenSpelling(token));
  const promptIpa = pattern.direction === 'onset' ? `${consonantIpa}${sound.ipa}` : `${sound.ipa}${consonantIpa}`;
  return {
    ...pattern,
    label: pattern.direction === 'onset' ? `${token} → ${sound.label}` : `${sound.label} → ${token}`,
    prompt: (`${before}${after}` || sound.label).toUpperCase(),
    promptIpa: `/${promptIpa || sound.ipa}/`,
    examples: [],
  };
}

function generateFamilySound(sound, template) {
  const onsets = template.onsets.map((pattern) => cloneTransition(pattern, sound));
  const codas = template.codas.map((pattern) => cloneTransition(pattern, sound));
  const baseOnset = 'h';
  const baseCoda = 'mb';
  const baseOnsetPattern = onsets.find((pattern) => pattern.token === baseOnset);
  const baseCodaPattern = codas.find((pattern) => pattern.token === baseCoda);
  const familyId = `family:${slug(sound.drill.base)}`;
  const items = [];

  for (const pattern of onsets) {
    const original = pattern.token === baseOnset;
    const word = original ? sound.drill.base : `${tokenSpelling(pattern.token)}${sound.drill.onsetTail}`;
    const consonantIpa = String(pattern.ipa || '').replaceAll('/', '').replace('—', '');
    items.push({
      id: `${familyId}:onset:${slug(pattern.token)}:${slug(word)}:generated`,
      familyId,
      section: 'onset',
      token: pattern.token,
      word,
      ipa: original ? `h${sound.ipa}m.bəl` : `${consonantIpa}${sound.ipa}m.bəl`,
      real: false,
      drillOnly: true,
      generated: true,
      patternId: pattern.id,
      patternIds: [...new Set([pattern.id, baseCodaPattern.id])],
      frequency: pattern.frequency,
      sourceIndex: items.length,
    });
  }

  for (const pattern of codas) {
    const original = pattern.token === baseCoda;
    const word = original ? sound.drill.base : `${sound.drill.codaLead}${tokenSpelling(pattern.token)}`;
    const consonantIpa = String(pattern.ipa || '').replaceAll('/', '').replace('—', '');
    items.push({
      id: `${familyId}:coda:${slug(pattern.token)}:${slug(word)}:generated`,
      familyId,
      section: 'coda',
      token: pattern.token,
      word,
      ipa: original ? `h${sound.ipa}m.bəl` : `h${sound.ipa}${consonantIpa}`,
      real: false,
      drillOnly: true,
      generated: true,
      patternId: pattern.id,
      patternIds: [...new Set([baseOnsetPattern.id, pattern.id])],
      frequency: pattern.frequency,
      sourceIndex: items.length,
    });
  }

  items.sort((a, b) => b.frequency - a.frequency || a.sourceIndex - b.sourceIndex);
  const families = [{
    id: familyId,
    base: sound.drill.base,
    ipa: `h${sound.ipa}m.bəl`,
    spelling: 'generated',
    baseOnset,
    baseCoda,
    featured: true,
    generated: true,
    source: `generated-from-${template.id}`,
    items,
  }];

  return {
    ...sound,
    spellingPatterns: [],
    onsets,
    codas,
    families,
    counts: { onsets: onsets.length, codas: codas.length, families: 1, familyItems: items.length },
  };
}

const parsedSounds = [];
for (const sound of SOUND_CONFIG) {
  if (!sound.generatedFrom) {
    parsedSounds.push(parseSound(sound));
    continue;
  }
  const template = parsedSounds.find((entry) => entry.id === sound.generatedFrom);
  if (!template) throw new Error(`Missing generated-sound template: ${sound.generatedFrom}`);
  parsedSounds.push(generateFamilySound(sound, template));
}

const data = {
  version: 2,
  generatedAt: new Date().toISOString(),
  sounds: parsedSounds,
};

fs.writeFileSync(outputPath, `/* Generated by scripts/build-training-data.mjs. */\nwindow.BV_TRAINING_DATA = ${JSON.stringify(data, null, 2)};\n`);
console.log(`Generated ${outputPath}`);
for (const sound of data.sounds) {
  console.log(`${sound.label}: ${sound.counts.onsets} onsets, ${sound.counts.codas} codas, ${sound.counts.families} families, ${sound.counts.familyItems} family items`);
}
