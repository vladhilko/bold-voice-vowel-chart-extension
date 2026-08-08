const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const contentSource = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');
const guidedSource = fs.readFileSync(path.join(root, 'src/guided-training.js'), 'utf8');

test('storage writes catch synchronous and asynchronous extension invalidation errors', () => {
  const storageWrite = /Promise\.resolve\(\)\s*\.then\(\(\) => area\.set\([\s\S]*?\)\)\s*\.catch\(\(\) => \{\}\)/g;
  assert.equal([...contentSource.matchAll(storageWrite)].length, 1);
  assert.equal([...guidedSource.matchAll(storageWrite)].length, 1);
});

test('audio playback waits for a running context instead of attempting autoplay', () => {
  const celebration = guidedSource.slice(
    guidedSource.indexOf('function playCelebrationSound'),
    guidedSource.indexOf('function playCorrectSound'),
  );
  const correct = guidedSource.slice(
    guidedSource.indexOf('function playCorrectSound'),
    guidedSource.indexOf('function acknowledgeCorrectAttempt'),
  );

  assert.doesNotMatch(celebration, /unlockAudio\(\)/);
  assert.doesNotMatch(correct, /unlockAudio\(\)/);
  assert.match(celebration, /audioContext\.state !== 'running'/);
  assert.match(correct, /audioContext\.state !== 'running'/);
  assert.match(guidedSource, /Promise\.resolve\(audioContext\.resume\(\)\)\s*\.catch/);
});
