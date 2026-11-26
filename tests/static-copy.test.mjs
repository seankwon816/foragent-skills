import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const callUnit = /(?:(?:first|monthly|free|external) )*calls?/;
const numberUnit = /(?:(?:desktop|app|remote|plugin) )*numbers?/;
const units = `[KMGT]i?B|messages?|${callUnit.source}|${numberUnit.source}`;
const capacity = new RegExp(String.raw`(?<![@\w])\d+(?:[.,]\d+)?[\s-]*(?:${units})\b`, 'i');
const incorrectIdentity = /\b(?:call your phone when stuck|SMS|OTP|companion mobile app)\b|[\u2013\u2014]/i;
const moneyOrRate = /(?:[$€£]\s*\d|\b\d+(?:[.,]\d+)?\s*%)/;

function checkCopy(text, source) {
  for (const pattern of [incorrectIdentity, capacity, moneyOrRate]) {
    assert.doesNotMatch(text, pattern, source);
  }
}

const skills = readdirSync(join(root, 'skills'), { recursive: true })
  .filter((name) => name === 'SKILL.md' || name.endsWith('/SKILL.md') || name.endsWith('\\SKILL.md'));
assert.ok(skills.length, 'No skill documents found');
const packageCopy = [
  'packages/npm-foragent/package.json',
  'packages/npm-foragent/README.md',
  'packages/npm-foragent/SKILL.md',
  'packages/npm-foragent/bin/cli.mjs',
  'packages/pypi-foragent/pyproject.toml',
  'packages/pypi-foragent/README.md',
  'packages/pypi-foragent/src/foragent_mcp/cli.py',
  'mcp-registry/server.json',
];
for (const file of ['README.md', ...packageCopy, ...skills.map((name) => join('skills', name))]) {
  test(file, () => checkCopy(readFileSync(join(root, file), 'utf8'), file));
}

const manifests = ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json',
  '.cursor-plugin/plugin.json', '.antigravity-plugin/plugin.json', 'gemini-extension.json'];
for (const file of manifests) {
  test(file, () => {
    const manifest = JSON.parse(readFileSync(join(root, file), 'utf8'));
    for (const entry of [manifest, ...(manifest.plugins ?? [])]) {
      assert.equal(typeof entry.description, 'string', file);
      checkCopy(entry.description, file);
    }
  });
}

test('publication rules flag product claims and preserve valid examples', () => {
  for (const text of ['call your phone when stuck', 'SMS/OTP', 'companion mobile app',
    'an en–dash', 'an em—dash', '25 MB', '12-message cap', '30 free calls', '3 app numbers']) {
    assert.throws(() => checkCopy(text, 'sample'), assert.AssertionError);
  }
  checkCopy('Call @12 on ForAgent. See /pricing or /manual. Use the agent-to-agent plugin.', 'sample');
});
