/**
 * Behavior tests for the Skill Manager pure modules: the frontmatter reader, the
 * directory scanner, and the durable registry.
 *
 * Run with the bundled Node runtime:
 *   node --test test/skill-market.test.mjs test/host.test.mjs test/client.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseStrictBoolean, readSkillMetadata } from '../lib/frontmatter.js';
import {
  findPackRoot,
  isRelevantWatchEvent,
  looksLikePackRoot,
  mergeCatalog,
  scanRoot,
  scanRoots,
} from '../lib/scan.js';
import { SkillMarketStore, normalizeDirectory } from '../lib/store.js';

// --------------------------------------------------------------- frontmatter

test('frontmatter: plain scalars and invocation keys', () => {
  const raw = [
    '---',
    'name: demo-skill',
    'description: Does a demo thing',
    'whenToUse: when a demo is needed',
    '---',
    '',
    '# Body',
    '',
    'Steps.',
  ].join('\n');
  const parsed = readSkillMetadata(raw, 'demo');
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.name, 'demo-skill');
  assert.equal(parsed.description, 'Does a demo thing');
  assert.equal(parsed.whenToUse, 'when a demo is needed');
  assert.deepEqual(parsed.invocation, { modelInvocable: true, userInvocable: true });
  assert.match(parsed.body, /# Body/);
});

test('frontmatter: quoted, commented and block-scalar values', () => {
  const raw = [
    '---',
    'name: "quoted-skill"',
    "description: 'single quoted: with colon' # trailing comment",
    'disable-model-invocation: YES',
    'user-invocable: off',
    'metadata:',
    '  owner: team-a',
    '  scope: local',
    '---',
    'body',
  ].join('\n');
  const parsed = readSkillMetadata(raw, 'quoted');
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.name, 'quoted-skill');
  assert.equal(parsed.description, 'single quoted: with colon');
  assert.deepEqual(parsed.invocation, { modelInvocable: false, userInvocable: false });
  assert.deepEqual(parsed.metadata, { owner: 'team-a', scope: 'local' });
});

test('frontmatter: literal block scalar keeps line breaks', () => {
  const raw = [
    '---',
    'name: block-skill',
    'description: |',
    '  first line',
    '  second line',
    '---',
    'body',
  ].join('\n');
  const parsed = readSkillMetadata(raw, 'block');
  assert.equal(parsed.error, undefined);
  // The block scalar keeps its internal line break; the description itself is trimmed.
  assert.equal(parsed.description, 'first line\nsecond line');
});

test('frontmatter: rejects malformed metadata instead of loading it', () => {
  assert.match(readSkillMetadata('no frontmatter at all', 'x').error, /no YAML frontmatter/);
  assert.match(readSkillMetadata('---\ndescription: hi\n---\n', 'x').error, /no `name`/);
  assert.match(readSkillMetadata('---\nname: Bad Name\ndescription: hi\n---\n', 'x').error, /kebab-case/);
  assert.match(readSkillMetadata('---\nname: ok-name\n---\n', 'x').error, /description/);
  assert.match(
    readSkillMetadata('---\nname: ok-name\ndescription: hi\ndisable-model-invocation: maybe\n---\n', 'x').error,
    /must be a boolean/,
  );
});

test('strict booleans accept the documented spellings only', () => {
  for (const value of ['true', 'TRUE', 'yes', 'On', '1']) assert.equal(parseStrictBoolean(value), true);
  for (const value of ['false', 'No', 'OFF', '0']) assert.equal(parseStrictBoolean(value), false);
  for (const value of ['maybe', 'y', '', '2']) assert.equal(parseStrictBoolean(value), undefined);
});

// -------------------------------------------------------------------- scan

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-'));
  const write = (relative, content) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  };
  write('flat-skill.md', '---\nname: flat-skill\ndescription: A flat skill file\n---\nbody\n');
  write('README.md', 'not a skill, no frontmatter\n');
  write('pack/alpha/SKILL.md', '---\nname: alpha\ndescription: Alpha skill\n---\nalpha body\n');
  write('pack/alpha/references/notes.md', 'resource, not a skill\n');
  write('pack/nested/deep/beta/SKILL.md', '---\nname: beta\ndescription: Beta skill\nuser-invocable: false\n---\nbeta body\n');
  write('pack/broken/SKILL.md', 'no frontmatter here\n');
  write('node_modules/ignored/SKILL.md', '---\nname: ignored\ndescription: must not be discovered\n---\n');
  write('.hidden/SKILL.md', '---\nname: hidden\ndescription: must not be discovered\n---\n');
  return root;
}

test('scan: discovers nested bundles, flat files, and skips noise', async () => {
  const root = makeFixture();
  try {
    const result = await scanRoot(root, { maxDepth: 4 });
    assert.equal(result.exists, true);
    assert.deepEqual(result.skills.map((skill) => skill.name).sort(), ['alpha', 'beta', 'flat-skill']);
    const beta = result.skills.find((skill) => skill.name === 'beta');
    assert.equal(beta.kind, 'bundle');
    assert.equal(beta.invocation.userInvocable, false);
    assert.equal(beta.relative, 'pack/nested/deep/beta/SKILL.md');
    const flat = result.skills.find((skill) => skill.name === 'flat-skill');
    assert.equal(flat.kind, 'flat');
    // A frontmatter-less README at a root is not a broken skill; a frontmatter-less
    // SKILL.md is.
    assert.equal(result.invalid.length, 1);
    assert.match(result.invalid[0].error, /no YAML frontmatter/);
    assert.match(result.invalid[0].relative, /broken\/SKILL\.md$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scan: depth limit and missing roots are reported, never thrown', async () => {
  const root = makeFixture();
  try {
    const shallow = await scanRoot(root, { maxDepth: 0 });
    assert.deepEqual(shallow.skills.map((skill) => skill.name), ['flat-skill']);
    const missing = await scanRoot(path.join(root, 'does-not-exist'));
    assert.equal(missing.exists, false);
    assert.equal(missing.error, 'directory does not exist');
    assert.deepEqual(missing.skills, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scan: an earlier root owns a duplicate skill name', async () => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-a-'));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-b-'));
  try {
    fs.mkdirSync(path.join(first, 'dup'), { recursive: true });
    fs.writeFileSync(path.join(first, 'dup', 'SKILL.md'), '---\nname: dup\ndescription: from first\n---\n', 'utf8');
    fs.mkdirSync(path.join(second, 'dup'), { recursive: true });
    fs.writeFileSync(path.join(second, 'dup', 'SKILL.md'), '---\nname: dup\ndescription: from second\n---\n', 'utf8');
    const results = await scanRoots([first, second], {});
    const merged = mergeCatalog(results);
    assert.equal(merged.skills.length, 2);
    assert.equal(merged.skills[0].shadowedBy, undefined);
    assert.equal(merged.skills[0].description, 'from first');
    assert.equal(merged.skills[1].shadowedBy, path.join(first, 'dup', 'SKILL.md'));
    assert.equal(merged.byName.get('dup').description, 'from first');
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test('scan: real skill pack on disk is discovered (integration)', async (t) => {
  const candidates = [
    'D:/AI/mattpocock-skills',
    'C:/Users/G/.agents/skills/ocr-document-processor',
  ];
  const existing = candidates.filter((candidate) => fs.existsSync(candidate));
  if (existing.length === 0) {
    t.skip('no sample skill pack on this machine');
    return;
  }
  for (const candidate of existing) {
    const result = await scanRoot(candidate, { maxDepth: 4 });
    assert.equal(result.exists, true);
    assert.ok(result.skills.length > 0, `${candidate} should expose at least one skill`);
    for (const skill of result.skills) {
      assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(skill.description.length > 0);
    }
  }
});

// -------------------------------------------------------------- pack roots

test('pack: a nested skills/ tree resolves to its pack root', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-pack-'));
  const write = (relative, content) => {
    const target = path.join(base, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  };
  // The layout a real skill repository ships: <pack>/skills/<category>/<skill>.
  write('pack/skills/engineering/one/SKILL.md', '---\nname: pack-one\ndescription: One\n---\n');
  write('pack/skills/productivity/two/SKILL.md', '---\nname: pack-two\ndescription: Two\n---\n');
  // A flat pack: <pack>/<skill>/SKILL.md.
  write('flat/three/SKILL.md', '---\nname: flat-three\ndescription: Three\n---\n');
  write('flat/four/SKILL.md', '---\nname: flat-four\ndescription: Four\n---\n');
  try {
    const packRoot = path.join(base, 'pack');
    const skillDir = path.join(packRoot, 'skills', 'engineering', 'one');
    assert.equal(await looksLikePackRoot(packRoot), true);
    assert.equal(await looksLikePackRoot(path.join(packRoot, 'skills')), false);
    assert.equal(await looksLikePackRoot(path.join(packRoot, 'skills', 'engineering')), false);
    // A picked skill folder resolves upward to the pack that contains it —
    // never to a category folder that merely holds several skills.
    assert.equal(await findPackRoot(skillDir), packRoot);
    assert.equal(await findPackRoot(path.join(packRoot, 'skills', 'productivity')), packRoot);
    assert.equal(await findPackRoot(path.join(base, 'flat', 'three')), path.join(base, 'flat'));
    // The resolved pack really is the wider registration.
    assert.equal((await scanRoot(packRoot, {})).skills.length, 2);
    assert.equal((await scanRoot(skillDir, {})).skills.length, 1);
    // A lone skill with no pack above it is not rewritten to an ancestor.
    const lone = path.join(base, 'lone');
    write('lone/SKILL.md', '---\nname: lone\ndescription: Lone\n---\n');
    assert.notEqual(await findPackRoot(lone), path.join(base, 'lone'));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('pack: deep nesting beyond the old four-level limit is discovered', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-deep-'));
  try {
    // <pack>/skills/a/b/c/<skill>/SKILL.md — the skill folder sits five levels
    // below the pack root, one deeper than the previous default reached.
    const deep = path.join(base, 'pack', 'skills', 'a', 'b', 'c', 'skill');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'SKILL.md'), '---\nname: deep-skill\ndescription: Deep\n---\n', 'utf8');
    const withOldLimit = await scanRoot(path.join(base, 'pack'), { maxDepth: 4 });
    assert.equal(withOldLimit.skills.length, 0);
    const withDefault = await scanRoot(path.join(base, 'pack'), {});
    assert.deepEqual(withDefault.skills.map((skill) => skill.name), ['deep-skill']);
    // The pack root is still resolved from the deep skill folder.
    assert.equal(await findPackRoot(deep), path.join(base, 'pack'));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------- store

test('store: persists directories and switches atomically', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-store-'));
  const file = path.join(directory, 'nested', 'registry.json');
  try {
    const store = new SkillMarketStore({ file });
    store.load();
    assert.deepEqual(store.dirs, []);

    assert.equal(store.addDir('C:\\skills\\a').added, true);
    assert.equal(store.addDir('C:\\skills\\a').added, false);
    store.addDir('C:\\skills\\b');
    assert.equal(store.setEnabled('alpha', false).changed, true);
    assert.equal(store.setEnabled('alpha', false).changed, false);
    assert.equal(store.isDisabled('alpha'), true);

    const reloaded = new SkillMarketStore({ file });
    reloaded.load();
    assert.deepEqual(reloaded.dirs, ['C:\\skills\\a', 'C:\\skills\\b']);
    assert.deepEqual(reloaded.disabled, ['alpha']);

    reloaded.setAllEnabled(['alpha', 'beta'], true);
    assert.deepEqual(reloaded.disabled, []);
    reloaded.setAllEnabled(['alpha', 'beta'], false);
    assert.deepEqual([...reloaded.disabled].sort(), ['alpha', 'beta']);
    assert.equal(reloaded.removeDir('C:\\skills\\a').removed, true);
    assert.deepEqual(reloaded.dirs, ['C:\\skills\\b']);
    assert.equal(fs.existsSync(`${file}.${process.pid}.tmp`), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('store: a malformed registry is ignored, not fatal', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-bad-'));
  const file = path.join(directory, 'registry.json');
  try {
    fs.writeFileSync(file, '{ not json', 'utf8');
    const store = new SkillMarketStore({ file });
    store.load();
    assert.deepEqual(store.dirs, []);
    assert.deepEqual(store.disabled, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('paths: quotes and trailing separators are normalized', () => {
  const normalized = normalizeDirectory('  "C:\\skills\\a\\"  ');
  assert.equal(normalized.endsWith(path.sep), false);
  assert.equal(normalized.toLowerCase().startsWith('c:\\skills'), true);
  assert.equal(normalizeDirectory(''), '');
});

// ------------------------------------------------------- watch event filter

test('watch: only catalog-relevant filesystem events refresh', () => {
  // Resource subtrees and VCS noise cannot change the catalog.
  assert.equal(isRelevantWatchEvent('change', 'references/notes.md'), false);
  assert.equal(isRelevantWatchEvent('change', 'scripts/run.py'), false);
  assert.equal(isRelevantWatchEvent('change', 'nodes/a/b/readme.txt'), false);
  // A SKILL.md anywhere is a catalog change.
  assert.equal(isRelevantWatchEvent('change', 'skills/a/b/SKILL.md'), true);
  // Structural events (directory added, removed, renamed) matter at any depth.
  assert.equal(isRelevantWatchEvent('rename', 'skills/cat/new-skill'), true);
  // Direct children of a root: flat skill files and bundle folders.
  assert.equal(isRelevantWatchEvent('change', 'flat-skill.md'), true);
  assert.equal(isRelevantWatchEvent('rename', 'new-bundle'), true);
  // Unknown paths stay conservative.
  assert.equal(isRelevantWatchEvent('change', null), true);
  assert.equal(isRelevantWatchEvent('change', undefined), true);
});

// --------------------------------------------------------- parsing edges

test('frontmatter: a UTF-8 BOM does not hide a valid skill', () => {
  const raw = '\uFEFF---\nname: bom-skill\ndescription: Has a BOM\n---\nbody\n';
  const parsed = readSkillMetadata(raw, 'bom');
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.name, 'bom-skill');
  assert.match(parsed.body, /body/);
});

test('scan: a flat file must be named after the skill it declares', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-flat-'));
  try {
    // A repository README with YAML frontmatter is not a skill claim.
    fs.writeFileSync(path.join(root, 'README.md'), '---\nname: readme\n---\n', 'utf8');
    fs.writeFileSync(path.join(root, 'real-skill.md'), '---\nname: real-skill\ndescription: Real\n---\n', 'utf8');
    const result = await scanRoot(root, {});
    assert.deepEqual(result.skills.map((skill) => skill.name), ['real-skill']);
    assert.equal(result.invalid.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scan: budget truncation is reported instead of hidden', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-budget-'));
  try {
    for (const name of ['a', 'b', 'c']) {
      fs.mkdirSync(path.join(root, name), { recursive: true });
      fs.writeFileSync(path.join(root, name, 'SKILL.md'), `---\nname: ${name}-skill\ndescription: d\n---\n`);
    }
    const limited = await scanRoot(root, { maxSkills: 1 });
    assert.equal(limited.truncated, true);
    assert.ok(limited.skills.length <= 1);
    const full = await scanRoot(root, {});
    assert.equal(full.truncated, false);
    assert.equal(full.skills.length, 3);
    // scanRoots keeps one result per root even when the pass is cancelled.
    const controller = new AbortController();
    controller.abort();
    const results = await scanRoots([root, root], { signal: controller.signal });
    assert.equal(results.length, 2);
    assert.equal(results.every((entry) => entry.truncated === true), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('store: wrong-shaped documents never replace live state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-shape-'));
  const file = path.join(directory, 'registry.json');
  try {
    const store = new SkillMarketStore({ file });
    store.addDir('C:\\skills\\keep');
    store.setEnabled('keep-skill', false);

    for (const bad of ['null', '[]', '{"version":2,"dirs":[]}', '{"dirs":"nope"}']) {
      fs.writeFileSync(file, bad, 'utf8');
      store.load();
      assert.notEqual(store.loadError, undefined, bad);
      assert.deepEqual(store.dirs, ['C:\\skills\\keep'], bad);
      assert.deepEqual(store.disabled, ['keep-skill'], bad);
    }

    // An empty object is a legitimate empty document, not a failure.
    fs.writeFileSync(file, '{}', 'utf8');
    store.load();
    assert.equal(store.loadError, undefined);
    assert.deepEqual(store.dirs, []);
    assert.deepEqual(store.disabled, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('store: pruneDisabled removes only names that no longer exist', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-prune-'));
  const file = path.join(directory, 'registry.json');
  try {
    const store = new SkillMarketStore({ file });
    store.addDir('C:\\skills\\a');
    store.setAllEnabled(['alive', 'gone'], false);
    const { removed } = store.pruneDisabled(['alive', 'other']);
    assert.deepEqual(removed, ['gone']);
    assert.deepEqual(store.disabled, ['alive']);
    const reloaded = new SkillMarketStore({ file });
    reloaded.load();
    assert.deepEqual(reloaded.disabled, ['alive']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('store: per-session exclusions persist, stay bounded, and tolerate bad shapes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-sessions-'));
  const file = path.join(directory, 'registry.json');
  try {
    const store = new SkillMarketStore({ file });
    store.setSessionExclusions('s-1', ['alpha', 'alpha', '', 'beta']);
    assert.deepEqual(store.sessionExclusions('s-1'), ['alpha', 'beta']);

    const reloaded = new SkillMarketStore({ file });
    reloaded.load();
    assert.deepEqual(reloaded.sessionExclusions('s-1'), ['alpha', 'beta']);

    reloaded.setSessionExclusions('s-1', []);
    assert.deepEqual(reloaded.sessionExclusions('s-1'), []);

    // A malformed record never costs the directory list or a good record.
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      dirs: ['C:\\skills'],
      disabled: [],
      sessions: { bad: 'not-an-object', good: { excluded: ['a'], updatedAt: 7 } },
    }), 'utf8');
    const third = new SkillMarketStore({ file });
    third.load();
    assert.deepEqual(third.dirs, ['C:\\skills']);
    assert.deepEqual(third.sessionExclusions('good'), ['a']);
    assert.deepEqual(third.sessionExclusions('bad'), []);
    assert.equal(fs.existsSync(`${file}.${process.pid}.tmp`), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
