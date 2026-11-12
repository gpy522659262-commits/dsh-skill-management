/**
 * AC-13: the pack → skill tree view.
 *
 * These tests render the real browser bundle through the React stub, so they
 * assert the structure the user sees (parent row, indented child rows, the
 * connector) rather than implementation details.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  collectElements,
  createReactStub,
  loadClientHalf,
  mountClient,
  renderToHtml,
} from './harness.mjs';

/** A three-pack fixture: normal pack, truncated config pack, missing pack. */
function treeSnapshot() {
  return {
    revision: 5,
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
    provider: { name: 'skill-market', rank: 50, registered: true, masked: 1 },
    incomplete: false,
    staleDisabled: [],
    config: { values: {}, warnings: [] },
    diagnostics: { scans: 1, cached: false },
    dirs: [
      {
        path: 'C:\\packs\\pack-a',
        exists: true,
        builtin: false,
        fromConfig: false,
        removable: true,
        skills: 2,
        invalid: 1,
        truncated: false,
        pack: { root: 'C:\\packs\\pack-a', skills: 3 },
      },
      {
        path: 'C:\\packs\\pack-b',
        exists: true,
        builtin: false,
        fromConfig: true,
        removable: false,
        skills: 1,
        invalid: 0,
        truncated: true,
      },
      {
        path: 'C:\\packs\\missing',
        exists: false,
        builtin: false,
        fromConfig: false,
        removable: true,
        skills: 0,
        invalid: 0,
        truncated: false,
      },
    ],
    skills: [
      {
        name: 'alpha-skill',
        description: 'Alpha description',
        path: 'C:\\packs\\pack-a\\alpha\\SKILL.md',
        directory: 'C:\\packs\\pack-a\\alpha',
        root: 'C:\\packs\\pack-a',
        relative: 'alpha/SKILL.md',
        kind: 'bundle',
        builtin: false,
        enabled: true,
        declared: { modelInvocable: true, userInvocable: true },
        invocation: { modelInvocable: true, userInvocable: true },
      },
      {
        name: 'beta-skill',
        description: 'Beta description',
        path: 'C:\\packs\\pack-a\\beta\\SKILL.md',
        directory: 'C:\\packs\\pack-a\\beta',
        root: 'C:\\packs\\pack-a',
        relative: 'beta/SKILL.md',
        kind: 'bundle',
        builtin: false,
        enabled: false,
        declared: { modelInvocable: true, userInvocable: true },
        invocation: { modelInvocable: false, userInvocable: false },
      },
      {
        name: 'gamma-skill',
        description: 'Gamma description',
        path: 'C:\\packs\\pack-b\\gamma\\SKILL.md',
        directory: 'C:\\packs\\pack-b\\gamma',
        root: 'C:\\packs\\pack-b',
        relative: 'gamma/SKILL.md',
        kind: 'bundle',
        builtin: false,
        enabled: true,
        declared: { modelInvocable: true, userInvocable: true },
        invocation: { modelInvocable: true, userInvocable: true },
      },
    ],
    invalid: [{
      path: 'C:\\packs\\pack-a\\broken\\SKILL.md',
      root: 'C:\\packs\\pack-a',
      relative: 'broken/SKILL.md',
      error: 'skill metadata has no `name` field',
    }],
    duplicates: [],
    counts: { dirs: 3, skills: 3, enabled: 2, disabled: 1, invalid: 1, duplicates: 0 },
  };
}

/** Mount and settle one surface; returns the element factory and helpers. */
async function mountTree(overrides = {}) {
  const { React, slots } = createReactStub();
  const plugin = await loadClientHalf(React);
  const snapshot = { ...treeSnapshot(), ...overrides };
  const mounted = mountClient(plugin, (endpoint) => (
    endpoint === 'snapshot' ? { ok: true, value: snapshot } : { ok: true, value: { snapshot } }
  ));
  const registration = mounted.registrations.find((entry) => entry.options.name === 'settings.section');
  const element = () => React.createElement(registration.Component, {});
  renderToHtml(element(), slots);
  for (const effect of slots.effects.splice(0)) await effect();
  await new Promise((resolve) => setImmediate(resolve));
  return {
    ...mounted,
    snapshot,
    element,
    slots,
    tree: () => renderToHtml(element(), slots),
    disclosures: () => collectElements(
      element(),
      (node) => node.type === 'button' && node.props?.className === 'dsm-tree-disclosure',
      slots,
    ),
    switches: () => collectElements(
      element(),
      (node) => node.type === 'button' && node.props?.role === 'switch',
      slots,
    ),
    buttonByText: (label) => collectElements(
      element(),
      (node) => node.type === 'button' && [].concat(node.props?.children ?? []).includes(label),
      slots,
    ),
    input: () => collectElements(
      element(),
      (node) => node.type === 'input' && node.props?.['aria-label'] === '筛选技能',
      slots,
    )[0],
    expandAll: () => {
      for (const toggle of collectElements(
        element(),
        (node) => node.type === 'button' && node.props?.className === 'dsm-tree-disclosure',
        slots,
      )) {
        if (toggle.props.disabled !== true && toggle.props['aria-expanded'] === 'false') toggle.props.onClick();
      }
    },
  };
}

test('AC-13.1 a pack is one parent row and its skills are child rows', async () => {
  const view = await mountTree();
  try {
    const tree = view.tree();
    assert.equal(view.disclosures().length, 3);
    assert.match(tree, /className="dsm-tree/);
    assert.doesNotMatch(tree, /dsm-card/);
    assert.doesNotMatch(tree, /dsm-dirs/);
    // Collapsed by default: no skill row is rendered until the pack opens.
    assert.doesNotMatch(tree, /alpha-skill/);
    assert.match(tree, /className="dsm-tree-parent"/);
  } finally {
    view.restore();
  }
});

test('AC-13.2 disclosure expands, collapses, and keeps state across a snapshot refresh', async () => {
  const view = await mountTree();
  try {
    const [first] = view.disclosures();
    assert.equal(first.props['aria-expanded'], 'false');
    first.props.onClick();
    let tree = view.tree();
    assert.match(tree, /alpha-skill/);
    assert.match(tree, /beta-skill/);
    assert.match(tree, /broken\/SKILL\.md/);
    assert.equal(view.disclosures()[0].props['aria-expanded'], 'true');
    const controls = view.disclosures()[0].props['aria-controls'];
    assert.match(tree, new RegExp(`id="${controls}"`));

    view.disclosures()[0].props.onClick();
    assert.doesNotMatch(view.tree(), /alpha-skill/);

    // Expand again, then replace the snapshot through a real endpoint round-trip.
    view.disclosures()[0].props.onClick();
    const before = view.tree();
    assert.match(before, /alpha-skill/);
    const alphaSwitch = view.switches().find((node) => String(node.props['aria-label']).startsWith('alpha-skill'));
    alphaSwitch.props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    const after = view.tree();
    assert.match(after, /alpha-skill/);
    assert.equal(view.disclosures()[0].props['aria-expanded'], 'true');
  } finally {
    view.restore();
  }
});

test('AC-13.3 expand all and collapse all drive every pack', async () => {
  const view = await mountTree();
  try {
    view.buttonByText('展开全部')[0].props.onClick();
    const opened = view.disclosures().map((node) => node.props['aria-expanded']);
    assert.deepEqual(opened.filter((value) => value === 'true').length, 2); // the missing pack stays disabled
    assert.match(view.tree(), /gamma-skill/);

    view.buttonByText('折叠全部')[0].props.onClick();
    const closed = view.disclosures().map((node) => node.props['aria-expanded']);
    assert.deepEqual(closed, ['false', 'false', 'false']);
    assert.doesNotMatch(view.tree(), /gamma-skill/);
  } finally {
    view.restore();
  }
});

test('AC-13.4 the parent row reports the pack counts and state tags', async () => {
  const view = await mountTree();
  try {
    const tree = view.tree();
    assert.match(tree, /2 技能/);
    assert.match(tree, /1 已启用/);
    assert.match(tree, /1 无效/);
    assert.match(tree, /未扫全/);
    assert.match(tree, /来自配置/);
    assert.match(tree, /目录不存在/);
    assert.match(tree, /建议整包/);
  } finally {
    view.restore();
  }
});

test('AC-13.5 child rows keep the switch semantics', async () => {
  const view = await mountTree();
  try {
    view.disclosures()[0].props.onClick();
    const switches = view.switches();
    assert.equal(switches.length, 2);
    const alpha = switches.find((node) => String(node.props['aria-label']).startsWith('alpha-skill'));
    const beta = switches.find((node) => String(node.props['aria-label']).startsWith('beta-skill'));
    assert.equal(alpha.props['aria-checked'], 'true');
    assert.equal(beta.props['aria-checked'], 'false');
    // The disabled skill keeps its name in the row.
    assert.match(view.tree(), /beta-skill/);
    alpha.props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    const toggle = view.calls.filter((entry) => entry.endpoint === 'setEnabled').at(-1);
    assert.deepEqual(toggle.payload, { name: 'alpha-skill', enabled: false });
  } finally {
    view.restore();
  }
});

test('AC-13.6 filtering opens matching packs only and restores the previous state', async () => {
  const view = await mountTree();
  try {
    // Start with pack-a open so the restore step is observable.
    view.disclosures()[0].props.onClick();
    assert.match(view.tree(), /alpha-skill/);

    view.input().props.onChange({ target: { value: 'gamma' } });
    const filtered = view.tree();
    assert.match(filtered, /gamma-skill/);
    assert.doesNotMatch(filtered, /alpha-skill/);
    assert.doesNotMatch(filtered, /pack-a/);
    assert.match(filtered, /dsm-tree-child/);

    view.input().props.onChange({ target: { value: '' } });
    const restored = view.tree();
    assert.match(restored, /alpha-skill/);
    assert.equal(view.disclosures().length, 3);

    view.input().props.onChange({ target: { value: 'no-such-skill' } });
    assert.match(view.tree(), /没有匹配的技能/);
  } finally {
    view.restore();
  }
});

test('AC-13.7 pack-level actions stay on the parent row', async () => {
  const view = await mountTree();
  try {
    const disable = view.buttonByText('本目录全关');
    assert.equal(disable.length, 1); // pack-b is from config: no scoped toggle
    disable[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    const scoped = view.calls.filter((entry) => entry.endpoint === 'setAllEnabled').at(-1);
    assert.deepEqual(scoped.payload, { enabled: false, root: 'C:\\packs\\pack-a' });

    const usePack = view.buttonByText('改为添加技能包');
    assert.equal(usePack.length, 1);
    assert.match(usePack[0].props.title, /识别到所属技能包/);
    usePack[0].props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    const replaced = view.calls.filter((entry) => entry.endpoint === 'replaceWithPack').at(-1);
    assert.deepEqual(replaced.payload, { path: 'C:\\packs\\pack-a' });

    // The missing directory cannot expand, but it can still be removed.
    assert.equal(view.disclosures()[2].props.disabled, true);
    assert.equal(view.buttonByText('移除').length, 2);
  } finally {
    view.restore();
  }
});

test('AC-13.8 unparsable entries live inside their pack', async () => {
  const view = await mountTree();
  try {
    view.disclosures()[0].props.onClick();
    const tree = view.tree();
    assert.match(tree, /dsm-tree-invalid/);
    assert.match(tree, /broken\/SKILL\.md/);
    assert.match(tree, /no `name` field/);
    // No separate global invalid block any more.
    assert.doesNotMatch(tree, /无法解析的条目/);
  } finally {
    view.restore();
  }
});

test('AC-13.9 the connector is theme-token CSS on the tree only', async () => {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const start = source.indexOf('.dsm-tree {');
  assert.notEqual(start, -1);
  const block = source.slice(start, source.indexOf('.dsm-tags {', start));
  assert.match(block, /\.dsm-tree-children \{[^}]*border-left: 1px solid var\(--dsw-alias-border-l2\)/s);
  assert.match(block, /\.dsm-tree-child::before \{[^}]*border-bottom-left-radius/s);
  assert.match(block, /\.dsm-tree-child::before \{[^}]*border-left: 1px solid/s);
  // No hard-coded colour in the tree rules: everything resolves through tokens.
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/);
});

test('AC-13.10 an empty pack explains itself and a missing one cannot expand', async () => {
  const view = await mountTree({
    dirs: [
      ...treeSnapshot().dirs.slice(0, 2),
      {
        path: 'C:\\packs\\empty',
        exists: true,
        builtin: false,
        fromConfig: false,
        removable: true,
        skills: 0,
        invalid: 0,
        truncated: false,
      },
      treeSnapshot().dirs[2],
    ],
  });
  try {
    const disclosures = view.disclosures();
    assert.equal(disclosures.length, 4);
    disclosures[2].props.onClick();
    assert.match(view.tree(), /这个技能包里没有发现技能/);
    assert.equal(disclosures[3].props.disabled, true);
  } finally {
    view.restore();
  }
});

test('AC-14.1/14.2 the sidebar panel scrolls its body with a themed scrollbar', () => {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(source, /\.dsm-panel \{[^}]*height: 100%/s);
  assert.match(source, /\.dsm-panel \{[^}]*display: flex; flex-direction: column/s);
  assert.match(source, /\.dsm-panel \{[^}]*min-height: 0/s);
  assert.match(source, /\.dsm-panel > \.dsm-root \{[^}]*overflow-y: auto/s);
  assert.match(source, /\.dsm-panel > \.dsm-root \{[^}]*min-height: 0/s);
  assert.match(source, /scrollbar-color: var\(--dsw-alias-border-l3/s);
  assert.match(source, /\.dsm-panel > \.dsm-root::-webkit-scrollbar-thumb/s);
});

test('AC-14.3 the settings section relies on the shell scroll, not a nested one', () => {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const rootRule = /\.dsm-root \{[^}]*\}/s.exec(source);
  assert.notEqual(rootRule, null);
  assert.doesNotMatch(rootRule[0], /overflow-y/);
  // A clipping host still gets a scrollbar, but only through the opt-in class
  // the component adds after finding no scrollable ancestor.
  assert.match(source, /\.dsm-root-scroll \{[^}]*overflow-y: auto/s);
  assert.match(source, /\.dsm-root-scroll \{[^}]*max-height: 100%/s);
});

test('AC-14.4 the panel renders its body inside the scroll container', async () => {
  const { React, slots } = createReactStub();
  const plugin = await loadClientHalf(React);
  const mounted = mountClient(plugin, () => ({ ok: true, value: treeSnapshot() }));
  try {
    const panel = mounted.registrations.find((entry) => entry.options.name === 'main');
    const html = renderToHtml(React.createElement(panel.Component, {}), slots);
    assert.match(html, /className="dsm-panel"/);
    assert.match(html, /className="dsm-panel"><div className="dsm-root"/);
    assert.match(html, /className="dsm-root"/);
  } finally {
    mounted.restore();
  }
});
