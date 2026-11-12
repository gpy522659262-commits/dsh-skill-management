/**
 * Host-half integration test.
 *
 * `apply()` is driven with a minimal Cordis stand-in that captures the skill
 * provider registration and the `/skill-market` RPC handler, then every
 * endpoint the browser page uses is executed against a real fixture tree. This
 * verifies discovery, the enable/disable mask, the registry mutations, and the
 * exact wire envelopes without starting the Harness process.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { callFetchRoute, callRoute, mountHost, startHttpServer } from './harness.mjs';

/** Build a temporary skill-pack directory with two skills and one invalid file. */
function makePack() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-pack-'));
  const write = (relative, content) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  };
  write('alpha/SKILL.md', '---\nname: pack-alpha\ndescription: Alpha from the pack\n---\nALPHA BODY\n');
  write('nested/beta/SKILL.md', '---\nname: pack-beta\ndescription: Beta from the pack\nuser-invocable: false\n---\nBETA BODY\n');
  write('broken/SKILL.md', '---\ndescription: no name here\n---\n');
  return root;
}

/** The options that keep every test on its own temporary home. */
function optionsFor(home) {
  return {
    dshHome: home,
    statePath: path.join(home, 'skill-market', 'registry.json'),
    defaultSkillDir: path.join(home, 'skill-market', 'skills'),
    watch: false,
  };
}

test('host half: registers the provider and the authenticated channel', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-home-'));
  const pack = makePack();
  try {
    const registrations = mountHost(optionsFor(home));
    const call = async (endpoint, payload) => {
      const { status, body } = await callRoute(registrations.route, endpoint, payload);
      assert.equal(status, 200);
      return body;
    };
    assert.equal(registrations.provider.name, 'skill-market');
    assert.equal(typeof registrations.control.invalidate, 'function');

    // Empty state: no directories, no skills, and a usable snapshot contract.
    const empty = await call('snapshot');
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.value.dirs, []);
    assert.deepEqual(empty.value.skills, []);
    assert.equal(empty.value.provider.rank, 50);
    assert.equal(empty.value.statePath, path.join(home, 'skill-market', 'registry.json'));
    assert.equal(empty.value.features.scopedToggle, true);
    assert.equal(empty.value.features.revisionProbe, true);

    // The cheap revision probe the panel polls while it is visible.
    const probe = await call('revision');
    assert.equal(probe.ok, true);
    assert.equal(typeof probe.value.revision, 'number');
    assert.equal(probe.value.revision, empty.value.revision);

    // addDir validates and registers, and the scan reports both valid skills.
    const missing = await call('addDir', { path: path.join(pack, 'nope') });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, 'not-found');
    assert.equal(typeof missing.error.message, 'string');
    assert.deepEqual(missing.error.details, {});

    const added = await call('addDir', { path: pack });
    assert.equal(added.ok, true);
    assert.equal(added.value.added, true);
    assert.deepEqual(added.value.snapshot.skills.map((skill) => skill.name), ['pack-alpha', 'pack-beta']);
    assert.equal(added.value.snapshot.invalid.length, 1);
    assert.match(added.value.snapshot.invalid[0].error, /no `name`/);
    assert.equal(added.value.snapshot.counts.enabled, 2);
    assert.equal(registrations.invalidated, 1);

    // The provider serves exactly the discovered skills, with the declared policy.
    const candidates = await registrations.provider.list({});
    assert.deepEqual(candidates.map((candidate) => candidate.name), ['pack-alpha', 'pack-beta']);
    assert.equal(candidates[1].invocation.userInvocable, false);
    assert.equal(candidates[0].rank, 50);
    assert.equal(candidates[0].provider, 'skill-market');
    assert.equal(candidates[0].resourceBase.kind, 'directory');
    assert.equal(candidates[0].path, path.join(pack, 'alpha', 'SKILL.md'));

    // get() returns the body for the candidate the registry selected.
    const loaded = await registrations.provider.get(candidates[0], {});
    assert.equal(loaded.content, 'ALPHA BODY');
    assert.equal(loaded.name, 'pack-alpha');
    assert.equal(loaded.invocation.modelInvocable, true);

    // Switching a skill off masks it on both invocation surfaces.
    const off = await call('setEnabled', { name: 'pack-alpha', enabled: false });
    assert.equal(off.ok, true);
    assert.equal(off.value.snapshot.counts.disabled, 1);
    const masked = await registrations.provider.list({});
    const maskedAlpha = masked.find((candidate) => candidate.name === 'pack-alpha');
    assert.deepEqual(maskedAlpha.invocation, { modelInvocable: false, userInvocable: false });
    assert.equal(maskedAlpha.description, 'Alpha from the pack');

    // The switch is durable: a fresh mount reads it back from the registry file.
    const remounted = mountHost(optionsFor(home));
    const restored = await remounted.provider.list({});
    assert.deepEqual(
      restored.find((candidate) => candidate.name === 'pack-alpha').invocation,
      { modelInvocable: false, userInvocable: false },
    );

    // setAllEnabled flips everything back at once.
    const allOn = await call('setAllEnabled', { enabled: true });
    assert.equal(allOn.ok, true);
    assert.equal(allOn.value.snapshot.counts.disabled, 0);
    const allOff = await call('setAllEnabled', { enabled: false });
    assert.equal(allOff.value.snapshot.counts.enabled, 0);

    // ensureDefaultDir creates and registers the fallback location.
    const ensured = await call('ensureDefaultDir', {});
    assert.equal(ensured.ok, true);
    assert.equal(fs.existsSync(path.join(home, 'skill-market', 'skills')), true);
    assert.equal(ensured.value.snapshot.dirs.some((dir) => dir.path === path.join(home, 'skill-market', 'skills')), true);

    // Removing a directory drops its skills.
    const removed = await call('removeDir', { path: pack });
    assert.equal(removed.ok, true);
    assert.equal(removed.value.removed, true);
    assert.equal(removed.value.snapshot.skills.length, 0);

    // Unknown endpoints and malformed arguments stay inside the wire contract.
    const unknown = await call('nope', {});
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error.code, 'unknown-endpoint');
    const badToggle = await call('setEnabled', { name: 'pack-alpha', enabled: 'yes' });
    assert.equal(badToggle.ok, false);
    assert.equal(badToggle.error.code, 'invalid-argument');
    const badPath = await call('addDir', { path: '   ' });
    assert.equal(badPath.ok, false);
    assert.equal(badPath.error.code, 'invalid-path');

    const refreshed = await call('refresh', {});
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.value.snapshot.revision > empty.value.revision, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(pack, { recursive: true, force: true });
  }
});

test('host half: a malformed skill file is reported, never thrown at the registry', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-home-'));
  const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-bad-'));
  try {
    fs.mkdirSync(path.join(pack, 'broken'), { recursive: true });
    fs.writeFileSync(path.join(pack, 'broken', 'SKILL.md'), '---\nname: Broken Name\ndescription: x\n---\n', 'utf8');
    const registrations = mountHost(optionsFor(home));
    const { status, body: added } = await callRoute(registrations.route, 'addDir', { path: pack });
    assert.equal(status, 200);
    assert.equal(added.ok, true);
    // The invalid entry never becomes a provider candidate, so the registry
    // cannot reject the whole catalog for one bad name.
    assert.deepEqual(await registrations.provider.list({}), []);
    assert.equal(added.value.snapshot.invalid.length, 1);
    assert.match(added.value.snapshot.invalid[0].error, /kebab-case/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(pack, { recursive: true, force: true });
  }
});

test('host half: adding a folder scans downward only, and the pack stays opt-in', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-packhome-'));
  const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-packroot-'));
  try {
    const write = (relative, name) => {
      const target = path.join(pack, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `---\nname: ${name}\ndescription: ${name} description\n---\nBODY ${name}\n`, 'utf8');
    };
    write('skills/engineering/one/SKILL.md', 'pack-one');
    write('skills/productivity/two/SKILL.md', 'pack-two');
    write('skills/productivity/three/SKILL.md', 'pack-three');

    // Even with pack detection enabled, adding a directory registers exactly
    // that directory: nothing above it is scanned or pulled in.
    const registrations = mountHost({ ...optionsFor(home), packDetection: true });
    const call = async (endpoint, payload) => {
      const { status, body } = await callRoute(registrations.route, endpoint, payload);
      assert.equal(status, 200);
      return body;
    };

    const picked = path.join(pack, 'skills', 'productivity', 'two');
    const added = await call('addDir', { path: picked });
    assert.equal(added.ok, true);
    assert.equal(added.value.path, picked);
    assert.equal(added.value.resolvedFrom, undefined);
    assert.deepEqual(added.value.snapshot.dirs.map((dir) => dir.path), [picked]);
    assert.deepEqual(added.value.snapshot.skills.map((skill) => skill.name), ['pack-two']);
    // The enclosing pack is offered as a manual action, never registered.
    assert.equal(added.value.snapshot.dirs[0].pack.root, pack);
    assert.equal(added.value.snapshot.dirs[0].pack.skills, 3);

    // Per-directory toggling only touches this directory.
    const off = await call('setAllEnabled', { enabled: false, root: picked });
    assert.equal(off.value.affected, 1);
    assert.equal(off.value.snapshot.counts.disabled, 1);

    // The explicit swap mirrors disk state and keeps the narrow folder intact.
    const replaced = await call('replaceWithPack', { path: picked });
    assert.equal(replaced.ok, true);
    assert.equal(replaced.value.path, pack);
    assert.equal(replaced.value.pack.skills, 3);
    assert.deepEqual(replaced.value.snapshot.dirs.map((dir) => dir.path), [pack]);
    assert.deepEqual(replaced.value.snapshot.skills.map((skill) => skill.name), ['pack-one', 'pack-three', 'pack-two']);
    assert.equal(fs.existsSync(picked), true);

    // The swap is durable across a remount.
    const final = mountHost({ ...optionsFor(home), packDetection: true });
    const { body: after } = await callRoute(final.route, 'snapshot');
    assert.deepEqual(after.value.dirs.map((dir) => dir.path), [pack]);

    // Default configuration: no upward scan, no suggestion, no swap endpoint.
    const plainHome = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-downhome-'));
    try {
      const plain = mountHost(optionsFor(plainHome));
      const { body: plainAdded } = await callRoute(plain.route, 'addDir', { path: picked });
      assert.equal(plainAdded.ok, true);
      assert.equal(plainAdded.value.path, picked);
      assert.deepEqual(plainAdded.value.snapshot.dirs.map((dir) => dir.path), [picked]);
      assert.deepEqual(plainAdded.value.snapshot.skills.map((skill) => skill.name), ['pack-two']);
      assert.equal(plainAdded.value.snapshot.dirs[0].pack, undefined);
      assert.equal(plainAdded.value.snapshot.features.packDetection, false);
      assert.equal(plainAdded.value.snapshot.features.replaceWithPack, false);
      const refused = await callRoute(plain.route, 'replaceWithPack', { path: picked });
      assert.equal(refused.body.ok, false);
      assert.equal(refused.body.error.code, 'no-pack');
    } finally {
      fs.rmSync(plainHome, { recursive: true, force: true });
    }

    // Without a pack above it, the endpoint refuses instead of guessing.
    const lonely = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-lonely-'));
    fs.writeFileSync(path.join(lonely, 'SKILL.md'), '---\nname: lonely\ndescription: x\n---\n', 'utf8');
    const nothing = await call('replaceWithPack', { path: lonely });
    assert.equal(nothing.ok, false);
    assert.equal(nothing.error.code, 'no-pack');
    fs.rmSync(lonely, { recursive: true, force: true });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(pack, { recursive: true, force: true });
  }
});

test('host half: the browser route rejects unauthenticated callers and bad requests', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-transport-'));
  try {
    const options = optionsFor(home);

    // An unauthenticated browser session never reaches the legacy handler.
    const refused = mountHost(options, { admit: () => ({ rejection: 401 }) });
    const unauthorized = await callRoute(refused.route, 'snapshot');
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body, 'unauthorized');
    const forbidden = mountHost(options, { admit: () => ({ rejection: 403 }) });
    assert.equal((await callRoute(forbidden.route, 'snapshot')).status, 403);

    // Wrong method, unknown endpoint shape, wrong media type, bad JSON, and an
    // oversized body all stay bounded and keep the wire contract.
    const allowed = mountHost(options);
    assert.equal((await callRoute(allowed.route, 'snapshot', {}, { method: 'GET' })).status, 405);
    assert.equal((await callRoute(allowed.route, 'nested/deep')).status, 405);
    assert.equal((await callRoute(allowed.route, 'snapshot', {}, { contentType: 'text/plain' })).status, 415);
    const malformed = await callRoute(allowed.route, 'snapshot', {}, { rawBody: '{ not json' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.ok, false);
    assert.equal(malformed.body.error.code, 'bad-request');
    const oversized = await callRoute(allowed.route, 'snapshot', {}, { rawBody: 'x'.repeat((1 << 20) + 1) });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error.code, 'body-too-large');

    // The preferred exact route enforces the same contract through Response.
    const viaFetch = await callFetchRoute(allowed, 'snapshot');
    assert.equal(viaFetch.status, 200);
    assert.equal(viaFetch.body.ok, true);
    assert.equal((await callFetchRoute(allowed, 'snapshot', {}, { contentType: 'text/plain' })).status, 415);
    assert.equal((await callFetchRoute(allowed, 'snapshot', {}, { rawBody: '{ not json' })).status, 400);
    assert.equal(
      (await callFetchRoute(allowed, 'snapshot', {}, { rawBody: 'x'.repeat((1 << 20) + 1) })).status,
      413,
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('host half: real sockets return a populated snapshot on both transports', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-http-'));
  const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-httppack-'));
  try {
    for (const [dir, name] of [['alpha', 'http-alpha'], ['beta', 'http-beta'], ['gamma', 'http-gamma']]) {
      fs.mkdirSync(path.join(pack, dir), { recursive: true });
      fs.writeFileSync(
        path.join(pack, dir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${name} description\n---\nBODY ${name}\n`,
        'utf8',
      );
    }
    const options = optionsFor(home);
    fs.mkdirSync(path.join(home, 'skill-market'), { recursive: true });
    fs.writeFileSync(options.statePath, JSON.stringify({ version: 1, dirs: [pack], disabled: [] }), 'utf8');

    const host = mountHost(options);
    const server = await startHttpServer(host);
    try {
      // Preferred exact route through the emulated authenticated bridge.
      const first = await server.post('/api/skill-market/snapshot');
      assert.equal(first.status, 200);
      assert.equal(first.body.ok, true);
      assert.equal(first.body.value.skills.length, 3);
      assert.deepEqual(first.body.value.dirs.map((dir) => dir.exists), [true]);
      assert.equal(first.body.value.incomplete, false);

      // The second request is served from the cached scan.
      const second = await server.post('/api/skill-market/snapshot');
      assert.equal(second.body.value.skills.length, 3);
      assert.equal(second.body.value.diagnostics.cached, true);
      assert.equal(second.body.value.diagnostics.scans, first.body.value.diagnostics.scans);

      // Legacy prefix route over the same socket (the P0 regression).
      const legacy = await server.post('/skill-market/snapshot');
      assert.equal(legacy.status, 200);
      assert.equal(legacy.body.ok, true);
      assert.equal(legacy.body.value.skills.length, 3);

      // A mutation returns the new snapshot inline.
      const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-httpadd-'));
      fs.mkdirSync(path.join(extra, 'delta'), { recursive: true });
      fs.writeFileSync(path.join(extra, 'delta', 'SKILL.md'), '---\nname: http-delta\ndescription: d\n---\n', 'utf8');
      const added = await server.post('/api/skill-market/addDir', { path: extra });
      assert.equal(added.status, 200);
      assert.equal(added.body.value.snapshot.skills.length, 4);
      fs.rmSync(extra, { recursive: true, force: true });

      // Admission still fences the bridge.
      const denied = await startHttpServer(host, { admit: () => ({ rejection: 401 }) });
      try {
        assert.equal((await denied.post('/api/skill-market/snapshot')).status, 401);
      } finally {
        await denied.close();
      }
    } finally {
      await server.close();
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(pack, { recursive: true, force: true });
  }
});

test('host half: a budget-truncated scan is reported as incomplete', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-truncated-'));
  const pack = makePack();
  try {
    const options = optionsFor(home);
    fs.mkdirSync(path.join(home, 'skill-market'), { recursive: true });
    fs.writeFileSync(options.statePath, JSON.stringify({ version: 1, dirs: [pack], disabled: [] }), 'utf8');
    const host = mountHost({ ...options, maxSkills: 1 });
    const { body } = await callRoute(host.route, 'snapshot');
    assert.equal(body.ok, true);
    assert.equal(body.value.incomplete, true);
    assert.equal(body.value.dirs[0].truncated, true);
    const observation = await host.provider.list({});
    assert.equal(Array.isArray(observation), false);
    assert.equal(observation.complete, false);
    assert.ok(Array.isArray(observation.candidates));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(pack, { recursive: true, force: true });
  }
});

test('host half: invalid configuration is reported, not silently defaulted', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-config-'));
  try {
    const host = mountHost({
      ...optionsFor(home),
      maxDepth: '8',
      watch: 'yes',
      maxSkills: -1,
      maxdepth: 4,
    });
    try {
      const { body } = await callRoute(host.route, 'snapshot');
      assert.equal(body.ok, true);
      const warnings = body.value.config.warnings;
      assert.equal(warnings.length, 4);
      assert.ok(warnings.some((warning) => warning.includes('maxDepth')));
      assert.ok(warnings.some((warning) => warning.includes('maxdepth')));
      assert.equal(body.value.config.values.maxDepth, 8);
    } finally {
      // watch falls back to its default `true` here, so close the watcher.
      host.dispose();
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('host half: stale disabled names are visible and prunable', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-stale-'));
  const pack = makePack();
  try {
    const options = optionsFor(home);
    fs.mkdirSync(path.join(home, 'skill-market'), { recursive: true });
    fs.writeFileSync(
      options.statePath,
      JSON.stringify({ version: 1, dirs: [pack], disabled: ['pack-alpha', 'ghost-skill'] }),
      'utf8',
    );
    const host = mountHost(options);
    const before = await callRoute(host.route, 'snapshot');
    assert.deepEqual(before.body.value.staleDisabled, ['ghost-skill']);
    const pruned = await callRoute(host.route, 'pruneDisabled');
    assert.deepEqual(pruned.body.value.removed, ['ghost-skill']);
    assert.deepEqual(pruned.body.value.snapshot.staleDisabled, []);
    // A still-valid switch survives the cleanup.
    const alpha = pruned.body.value.snapshot.skills.find((skill) => skill.name === 'pack-alpha');
    assert.equal(alpha.enabled, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(pack, { recursive: true, force: true });
  }
});

test('host half: without the Fetch registry the legacy route takes over', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-legacy-'));
  try {
    const host = mountHost(optionsFor(home), { noFetch: true });
    assert.equal(host.fetchRoutes.size, 0);
    const { body } = await callRoute(host.route, 'snapshot');
    assert.equal(body.ok, true);
    assert.equal(body.value.features.transport, 'web');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('host half: the provider filters a session by the scope it is listed with', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-session-'));
  const pack = makePack();
  try {
    const options = optionsFor(home);
    fs.mkdirSync(path.join(home, 'skill-market'), { recursive: true });
    fs.writeFileSync(options.statePath, JSON.stringify({ version: 1, dirs: [pack], disabled: [] }), 'utf8');
    const host = mountHost(options);
    try {
      const names = (list) => list.map((candidate) => candidate.name);
      const alpha = (await host.provider.list({})).find((candidate) => candidate.name === 'pack-alpha');
      assert.notEqual(alpha, undefined);

      const invalidatedBefore = host.invalidated;
      const set = await callRoute(host.route, 'setSessionSkills', {
        sessionId: 's-1',
        excluded: ['pack-alpha', 'ghost-skill'],
      });
      assert.equal(set.status, 200);
      assert.equal(set.body.ok, true);
      assert.deepEqual(set.body.value.excluded, ['pack-alpha']);
      assert.deepEqual(set.body.value.ignored, ['ghost-skill']);
      assert.equal(set.body.value.canFilter, true);
      // A selection change must drop the registry's per-scope catalog cache.
      assert.equal(host.invalidated, invalidatedBefore + 1);

      // The registry passes the viewing Agent (`scope`) to every provider's list().
      assert.deepEqual(names(await host.provider.list({ scope: { id: 's-1' } })), ['pack-beta']);
      assert.deepEqual(names(await host.provider.list({ scope: { id: 's-2' } })), ['pack-alpha', 'pack-beta']);
      assert.deepEqual(names(await host.provider.list({})), ['pack-alpha', 'pack-beta']);

      // get() refuses an excluded skill when the caller carries the session scope.
      assert.equal(await host.provider.get(alpha, { scope: { id: 's-1' } }), undefined);
      assert.equal((await host.provider.get(alpha, {})).name, 'pack-alpha');
      const beta = (await host.provider.list({})).find((candidate) => candidate.name === 'pack-beta');
      assert.equal((await host.provider.get(beta, { scope: { id: 's-1' } })).name, 'pack-beta');

      const listing = await callRoute(host.route, 'sessionSkills', { sessionId: 's-1' });
      assert.equal(listing.body.ok, true);
      assert.deepEqual(listing.body.value.excluded, ['pack-alpha']);
      assert.deepEqual(listing.body.value.skills.map((skill) => skill.name), ['pack-alpha', 'pack-beta']);

      const invalid = await callRoute(host.route, 'setSessionSkills', { sessionId: 's-1', excluded: 'pack-alpha' });
      assert.equal(invalid.body.ok, false);
      assert.equal(invalid.body.error.code, 'invalid-argument');
      const missing = await callRoute(host.route, 'setSessionSkills', { excluded: [] });
      assert.equal(missing.body.error.code, 'invalid-session');
    } finally {
      host.dispose();
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(pack, { recursive: true, force: true });
  }
});
