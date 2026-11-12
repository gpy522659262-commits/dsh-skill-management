/**
 * Client-half tests, including the cross-half contract test.
 *
 * The browser bundle is materialized against a minimal React stand-in, so a
 * rendering crash, a broken switch, or a snapshot field the Host no longer
 * sends fails a test instead of blanking the settings page. The contract test
 * feeds the Client half a snapshot produced by the real Host half.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  callRoute,
  collectElements,
  createReactStub,
  loadClientHalf,
  mountClient,
  mountHost,
  renderToHtml,
} from './harness.mjs';

/** The settings page registered by the Client half. */
const SECTION = { slot: 'settings.section', id: 'skill-market' };

/** One complete snapshot with overridable fields. */
function baseSnapshot(overrides = {}) {
  return {
    revision: 1,
    statePath: 'C:\\home\\registry.json',
    defaultDir: 'C:\\home\\skills',
    watching: true,
    features: {
      scopedToggle: true,
      replaceWithPack: true,
      packDetection: true,
      revisionProbe: true,
      pruneDisabled: true,
      configDiagnostics: true,
      incompleteReporting: true,
      transport: 'fetch',
    },
    provider: { name: 'skill-market', rank: 50, registered: true, masked: 0 },
    incomplete: false,
    staleDisabled: [],
    config: { values: {}, warnings: [] },
    diagnostics: { scans: 1, cached: false },
    dirs: [{
      path: 'C:\\packs',
      exists: true,
      builtin: false,
      fromConfig: false,
      removable: true,
      skills: 1,
      invalid: 0,
      truncated: false,
    }],
    skills: [{
      name: 'demo-skill',
      description: 'Demo skill',
      path: 'C:\\packs\\demo\\SKILL.md',
      directory: 'C:\\packs\\demo',
      root: 'C:\\packs',
      relative: 'demo/SKILL.md',
      kind: 'bundle',
      builtin: false,
      enabled: true,
      declared: { modelInvocable: true, userInvocable: true },
      invocation: { modelInvocable: true, userInvocable: true },
    }],
    duplicates: [],
    invalid: [],
    counts: { dirs: 1, skills: 1, enabled: 1, disabled: 0, invalid: 0, duplicates: 0 },
    ...overrides,
  };
}

/** Click every pack disclosure, expanding the whole tree. */
function expandPacks(element, slots) {
  const toggles = collectElements(
    element(),
    (node) => node.type === 'button' && node.props?.className === 'dsm-tree-disclosure',
    slots,
  );
  for (const toggle of toggles) toggle.props.onClick();
  return toggles.length;
}

/** Render one surface to its settled HTML. */
async function renderSection(React, slots, registrations, slotName = 'settings.section', options = {}) {
  const registration = registrations.find((entry) => entry.options.name === slotName);
  const element = () => React.createElement(registration.Component, {});
  renderToHtml(element(), slots);
  for (const effect of slots.effects.splice(0)) await effect();
  await new Promise((resolve) => setImmediate(resolve));
  if (options.expand === true) expandPacks(element, slots);
  return { element, tree: renderToHtml(element(), slots) };
}

test('client half: registers a settings section and renders cards with working switches', async () => {
  const { React, slots } = createReactStub();
  const plugin = await loadClientHalf(React);
  assert.deepEqual(plugin.inject, ['slots', 'locale']);

  const snapshot = {
    revision: 3,
    statePath: 'C:\\home\\.dsh\\skill-market\\registry.json',
    defaultDir: 'C:\\home\\.dsh\\skill-market\\skills',
    maxDepth: 4,
    watching: true,
    provider: { name: 'skill-market', rank: 50, registered: true, masked: 1 },
    dirs: [{
      path: 'C:\\packs',
      exists: true,
      builtin: false,
      fromConfig: false,
      removable: true,
      skills: 2,
      invalid: 0,
    }],
    skills: [
      {
        name: 'demo-skill',
        description: '演示技能',
        path: 'C:\\packs\\demo\\SKILL.md',
        directory: 'C:\\packs\\demo',
        root: 'C:\\packs',
        relative: 'demo/SKILL.md',
        kind: 'bundle',
        builtin: false,
        enabled: true,
        declared: { modelInvocable: true, userInvocable: true },
        invocation: { modelInvocable: true, userInvocable: true },
      },
      {
        name: 'off-skill',
        description: '停用的技能',
        path: 'C:\\packs\\off\\SKILL.md',
        directory: 'C:\\packs\\off',
        root: 'C:\\packs',
        relative: 'off/SKILL.md',
        kind: 'bundle',
        builtin: false,
        enabled: false,
        declared: { modelInvocable: true, userInvocable: true },
        invocation: { modelInvocable: false, userInvocable: false },
      },
    ],
    duplicates: [],
    invalid: [],
    counts: { dirs: 1, skills: 2, enabled: 1, disabled: 1, invalid: 0, duplicates: 0 },
  };

  const { registrations, calls, restore } = mountClient(plugin, (endpoint) => {
    if (endpoint === 'snapshot') return { ok: true, value: snapshot };
    if (endpoint === 'setEnabled') return { ok: true, value: { snapshot } };
    return { ok: false, error: { code: 'test', message: `unexpected ${endpoint}`, details: {} } };
  });
  try {

  // Five surfaces: settings page, sidebar rail icon, panel, and the two
  // session-scoped skill picker seats (New Session row + composer row).
  assert.equal(registrations.length, 5);
  const bySlot = (slot) => registrations.find((entry) => entry.options.name === slot);
  const section = bySlot('settings.section');
  assert.equal(section.options.id, SECTION.id);
  assert.equal(section.options.order, 18);
  assert.equal(section.options.label(), '技能管理');
  assert.equal(typeof section.Component, 'function');
  const rail = bySlot('sidebar.panellist');
  assert.equal(rail.options.id, SECTION.id);
  assert.equal(rail.options.label(), '技能管理');
  assert.equal(typeof rail.Component, 'function');
  // The rail glyph renders at the size the sidebar asks for.
  assert.match(renderToHtml(React.createElement(rail.Component, { size: 18 }), slots), /viewBox="0 0 16 16"/);
  const panel = bySlot('main');
  assert.equal(panel.options.key, SECTION.id);
  assert.equal(typeof panel.Component, 'function');
  const heroPicker = bySlot('conversation.hero.options');
  assert.equal(heroPicker.options.id, 'session-skills');
  assert.equal(typeof heroPicker.Component, 'function');
  const composerPicker = bySlot('conversation.input.left');
  assert.equal(composerPicker.options.id, 'session-skills');
  assert.equal(typeof composerPicker.Component, 'function');

  const element = () => React.createElement(section.Component, {});

  // First render shows the loading state and schedules the snapshot read.
  let tree = renderToHtml(element(), slots);
  assert.match(tree, /正在读取技能/);

  // Run the mount effect (the RPC read) and render again with the snapshot.
  for (const effect of slots.effects.splice(0)) await effect();
  await new Promise((resolve) => setImmediate(resolve));
  const firstCall = calls.at(-1);
  assert.equal(firstCall.url, 'api/skill-market/snapshot');
  assert.equal(firstCall.endpoint, 'snapshot');

  tree = renderToHtml(element(), slots);
  // Packs start collapsed: the parent row exists, the skill rows do not.
  assert.match(tree, /className="dsm-tree-parent"/);
  assert.doesNotMatch(tree, /demo-skill/);
  expandPacks(element, slots);
  tree = renderToHtml(element(), slots);
  assert.match(tree, /demo-skill/);
  assert.match(tree, /停用的技能/);
  assert.match(tree, /demo\/SKILL\.md/);
  assert.match(tree, /className="dsm-root"/);

  // The enabled card is on, the disabled card is off; both expose a switch.
  const switches = collectElements(element(), (node) => node.type === 'button' && node.props?.role === 'switch', slots);
  assert.equal(switches.length, 2);
  const byLabel = (name) => switches.find((node) => String(node.props['aria-label']).startsWith(name));
  assert.equal(byLabel('demo-skill').props['aria-checked'], 'true');
  assert.equal(byLabel('off-skill').props['aria-checked'], 'false');

  // Flipping the switch calls the Host endpoint with the exact skill name.
  byLabel('demo-skill').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  const toggle = calls.filter((entry) => entry.endpoint === 'setEnabled').at(-1);
  assert.deepEqual(toggle.payload, { name: 'demo-skill', enabled: false });

  // The Host in this fixture reports no feature table, so the newer controls
  // stay hidden rather than calling an endpoint it does not implement.
  assert.doesNotMatch(tree, /本目录全开/);
  assert.doesNotMatch(tree, /改为添加技能包/);
  } finally {
    restore();
  }
});

test('client half: a feature table reveals the per-pack controls and the pack hint', async () => {
  const { React, slots } = createReactStub();
  const plugin = await loadClientHalf(React);

  const snapshot = {
    revision: 9,
    statePath: 'C:\\home\\registry.json',
    defaultDir: 'C:\\home\\skills',
    watching: true,
    features: { scopedToggle: true, replaceWithPack: true, packDetection: true },
    provider: { name: 'skill-market', rank: 50, registered: true, masked: 0 },
    dirs: [{
      path: 'C:\\packs\\MattPocock技能\\skills\\productivity\\grill-me',
      exists: true,
      builtin: false,
      fromConfig: false,
      removable: true,
      skills: 1,
      invalid: 0,
      pack: { root: 'C:\\packs\\MattPocock技能', skills: 37 },
    }],
    skills: [{
      name: 'grill-me',
      description: 'One skill out of a pack',
      path: 'C:\\packs\\MattPocock技能\\skills\\productivity\\grill-me\\SKILL.md',
      directory: 'C:\\packs\\MattPocock技能\\skills\\productivity\\grill-me',
      root: 'C:\\packs\\MattPocock技能\\skills\\productivity\\grill-me',
      relative: 'SKILL.md',
      kind: 'bundle',
      builtin: false,
      enabled: true,
      declared: { modelInvocable: true, userInvocable: true },
      invocation: { modelInvocable: true, userInvocable: true },
    }],
    duplicates: [],
    invalid: [],
    counts: { dirs: 1, skills: 1, enabled: 1, disabled: 0, invalid: 0, duplicates: 0 },
  };

  const { registrations, calls, restore } = mountClient(plugin, (endpoint) => (
    endpoint === 'snapshot' ? { ok: true, value: snapshot } : { ok: true, value: { snapshot } }
  ));
  try {
    const section = registrations.find((entry) => entry.options.name === 'settings.section');
    const element = () => React.createElement(section.Component, {});
    renderToHtml(element(), slots);
    for (const effect of slots.effects.splice(0)) await effect();
    await new Promise((resolve) => setImmediate(resolve));
    const tree = renderToHtml(element(), slots);

    assert.match(tree, /识别到所属技能包/);
    assert.match(tree, /37/);
    assert.match(tree, /本目录全开/);
    assert.match(tree, /本目录全关/);

    // The pack button swaps the narrow registration for the whole pack.
    const packButton = collectElements(
      element(),
      (node) => node.type === 'button' && [].concat(node.props?.children ?? []).includes('改为添加技能包'),
      slots,
    );
    assert.equal(packButton.length, 1);
    packButton[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    const replacement = calls.filter((entry) => entry.endpoint === 'replaceWithPack').at(-1);
    assert.deepEqual(replacement.payload, { path: snapshot.dirs[0].path });

    // The per-directory button scopes the toggle to that one directory.
    const dirOff = collectElements(
      element(),
      (node) => node.type === 'button' && [].concat(node.props?.children ?? []).includes('本目录全关'),
      slots,
    );
    assert.equal(dirOff.length, 1);
    dirOff[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    const scoped = calls.filter((entry) => entry.endpoint === 'setAllEnabled').at(-1);
    assert.deepEqual(scoped.payload, { enabled: false, root: snapshot.dirs[0].path });
  } finally {
    restore();
  }
});

test('contract: the client renders a snapshot produced by the real host half', async () => {
  const { React, slots } = createReactStub();
  const plugin = await loadClientHalf(React);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-contract-'));
  const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-market-pack-'));
  try {
    fs.mkdirSync(path.join(pack, 'live-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(pack, 'live-skill', 'SKILL.md'),
      '---\nname: live-skill\ndescription: Produced by the Host half\nwhenToUse: during the contract test\n---\nBODY\n',
      'utf8',
    );
    const host = mountHost({
      dshHome: home,
      statePath: path.join(home, 'skill-market', 'registry.json'),
      defaultSkillDir: path.join(home, 'skill-market', 'skills'),
      watch: false,
    });
    const added = await callRoute(host.route, 'addDir', { path: pack });
    assert.equal(added.status, 200);
    assert.equal(added.body.ok, true);
    await callRoute(host.route, 'setEnabled', { name: 'live-skill', enabled: false });
    const real = (await callRoute(host.route, 'snapshot', {})).body.value;
    assert.deepEqual(real.skills.map((skill) => skill.name), ['live-skill']);

    // Serve exactly what the Host produced, with no client-side fixture.
    const { registrations, calls } = mountClient(plugin, (endpoint) => {
      if (endpoint === 'snapshot') return { ok: true, value: real };
      return { ok: true, value: { snapshot: real } };
    });
    const element = () => React.createElement(registrations[0].Component, {});
    // First render schedules the snapshot read; run it, then render the result.
    renderToHtml(element(), slots);
    for (const effect of slots.effects.splice(0)) await effect();
    await new Promise((resolve) => setImmediate(resolve));
    expandPacks(element, slots);
    const tree = renderToHtml(element(), slots);

    assert.equal(calls.at(-1).endpoint, 'snapshot');
    assert.match(tree, /live-skill/);
    assert.match(tree, /Produced by the Host half/);
    assert.match(tree, /during the contract test/);
    assert.match(tree, /1 目录|目录/);
    // The Host reported it switched off, and the client shows that state.
    const switches = collectElements(element(), (node) => node.type === 'button' && node.props?.role === 'switch', slots);
    assert.equal(switches.length, 1);
    assert.equal(switches[0].props['aria-checked'], 'false');
    assert.match(tree, /未加载/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(pack, { recursive: true, force: true });
  }
});

test('client half: falls back to the legacy route when the exact namespace is missing', async () => {
  const { React, slots } = createReactStub();
  const plugin = await loadClientHalf(React);
  const snapshot = baseSnapshot();
  const { registrations, calls, restore } = mountClient(
    plugin,
    () => ({ ok: true, value: snapshot }),
    { statusFor: (url) => (url.startsWith('api/') ? 404 : 200) },
  );
  try {
    const { tree } = await renderSection(React, slots, registrations, 'settings.section', { expand: true });
    assert.deepEqual(calls.slice(0, 2).map((call) => call.url), [
      'api/skill-market/snapshot',
      'skill-market/snapshot',
    ]);
    assert.match(tree, /demo-skill/);
  } finally {
    restore();
  }
});

test('client half: a snapshot without invocation policies still renders', async () => {
  const { React, slots } = createReactStub();
  const plugin = await loadClientHalf(React);
  const bare = {
    name: 'bare-skill',
    description: 'No policy fields',
    path: 'C:\\packs\\b\\SKILL.md',
    directory: 'C:\\packs\\b',
    root: 'C:\\packs',
    relative: 'b/SKILL.md',
    kind: 'bundle',
    builtin: false,
    enabled: true,
  };
  const snapshot = baseSnapshot({
    skills: [bare],
    counts: { dirs: 1, skills: 1, enabled: 1, disabled: 0, invalid: 0, duplicates: 0 },
  });
  const { registrations, restore } = mountClient(plugin, () => ({ ok: true, value: snapshot }));
  try {
    const { tree } = await renderSection(React, slots, registrations, 'settings.section', { expand: true });
    assert.match(tree, /bare-skill/);
    assert.match(tree, /b\/SKILL\.md/);
  } finally {
    restore();
  }
});

test('client half: stale switch records are shown and pruned on request', async () => {
  const { React, slots } = createReactStub();
  const plugin = await loadClientHalf(React);
  const snapshot = baseSnapshot({ staleDisabled: ['ghost-skill'] });
  const { registrations, calls, restore } = mountClient(plugin, () => ({ ok: true, value: snapshot }));
  try {
    const { element, tree } = await renderSection(React, slots, registrations);
    assert.match(tree, /失效的停用记录/);
    const prune = collectElements(
      element(),
      (node) => node.type === 'button' && [].concat(node.props?.children ?? []).includes('清理'),
      slots,
    );
    assert.equal(prune.length, 1);
    prune[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    const call = calls.filter((entry) => entry.endpoint === 'pruneDisabled').at(-1);
    assert.deepEqual(call.payload, {});
  } finally {
    restore();
  }
});

test('client half: a mutation refreshes data without blanking the cards', async () => {
  const { React, slots } = createReactStub();
  const plugin = await loadClientHalf(React);
  const snapshot = baseSnapshot();
  const { registrations, restore } = mountClient(plugin, (endpoint) => (
    endpoint === 'setEnabled' ? { ok: true, value: { snapshot } } : { ok: true, value: snapshot }
  ));
  try {
    const { element } = await renderSection(React, slots, registrations, 'settings.section', { expand: true });
    const switches = collectElements(
      element(),
      (node) => node.type === 'button' && node.props?.role === 'switch',
      slots,
    );
    assert.equal(switches.length, 1);
    switches[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    const tree = renderToHtml(element(), slots);
    assert.match(tree, /demo-skill/);
    assert.doesNotMatch(tree, /正在读取技能/);
  } finally {
    restore();
  }
});
