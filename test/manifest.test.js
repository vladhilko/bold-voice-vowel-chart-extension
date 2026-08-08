const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('manifest is a publishable MV3 shape for the supported site', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+(\.\d+){1,3}$/);
  assert.ok(manifest.description.length <= 132);
  assert.deepEqual(Object.keys(manifest.icons), ['16', '32', '48', '128']);
  assert.ok(!JSON.stringify(manifest).includes('vowel-chart-experiment.onrender.com'));
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.permissions, ['storage']);

  const referencedFiles = [
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((script) => [...(script.js || []), ...(script.css || [])]),
  ];
  for (const file of referencedFiles) assert.ok(fs.existsSync(path.join(root, file)), file);

  for (const script of manifest.content_scripts) {
    assert.deepEqual(script.matches, ['https://boldvoice.com/games/vowel-map*']);
  }
});
