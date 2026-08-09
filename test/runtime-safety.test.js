const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const contentSource = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');
const guidedSource = fs.readFileSync(path.join(root, 'src/guided-training.js'), 'utf8');
const detectorSource = fs.readFileSync(path.join(root, 'src/page-detector.js'), 'utf8');

test('storage writes catch synchronous and asynchronous extension invalidation errors', () => {
  const storageWrite = /Promise\.resolve\(\)\s*\.then\(\(\) => area\.set\([\s\S]*?\)\)\s*\.catch\(\(\) => \{\}\)/g;
  assert.equal([...contentSource.matchAll(storageWrite)].length, 1);
  assert.equal([...guidedSource.matchAll(storageWrite)].length, 1);
});

test('audio unlock stays in the main page world and guided training only requests cues', () => {
  assert.doesNotMatch(guidedSource, /AudioContext|audioContext|\.resume\(/);
  assert.doesNotMatch(guidedSource, /function unlockAudio/);
  assert.match(guidedSource, /new CustomEvent\(AUDIO_EVENT_NAME, \{ detail: 'correct' \}\)/);
  assert.match(guidedSource, /new CustomEvent\(AUDIO_EVENT_NAME, \{ detail: 'celebration' \}\)/);
  assert.match(guidedSource, /addEventListener\(AUDIO_READY_EVENT_NAME, markAudioReady\)/);

  assert.match(detectorSource, /function unlockAudio\(event\)/);
  assert.match(detectorSource, /event\.isTrusted !== true/);
  assert.match(detectorSource, /navigator\.userActivation\.isActive !== true/);
  assert.match(detectorSource, /audioContext\.resume\(\)/);
  assert.match(detectorSource, /document\.addEventListener\('pointerdown', unlockAudio, \{ capture: true/);
  assert.match(detectorSource, /document\.addEventListener\('click', unlockAudio, \{ capture: true/);
  assert.match(detectorSource, /if \(!audioContext \|\| audioContext\.state !== 'running'\) return/);
});
