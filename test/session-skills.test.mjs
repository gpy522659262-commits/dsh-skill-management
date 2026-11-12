/**
 * AC-15: the per-session skill picker (New Session row + composer control).
 *
 * The real browser bundle is rendered through the React stub against the same
 * wire contract the Host serves, so a field rename on either side fails here.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { collectElements, createReactStub, loadClientHalf, mountClient, renderToHtml } from './harness.mjs';

const SKILLS = [
  { name: 'alpha', description: 'Alpha description', root: 'C:\\packs\\a', relative: 'alpha/SKILL.md' },
  { name: 'beta', description: 'Beta description', root: 'C:\\packs\\a', relative: 'beta/SKILL.md' },
  { name: 'gamma', description: 'Gamma description', root: 'C:\\packs\\b', relative: 'gamma/SKILL.md' },
];

/** The Host answers the picker's two endpoints. */
function payloadFor(endpoint, payload) {
  if (endpoint === 'sessionSkills') {
    return { ok: true, value: { sessionId: 's-1', excluded: [], skills: SKILLS, canFilter: true } };
  }
  if (endpoint === 'setSessionSkills') {
    return {
      ok: true,
      value: { sessionId: payload.sessionId, excluded: payload.excluded, ignored: [], canFilter: true },
    };
  }
  return { ok: false, error: { code: 'test', message: `unexpected ${endpoint}`, details: {} } };
}

/** Mount the hero picker and settle its initial read. */
async function mountPicker(options = {}) {
  const { React, slots } = createReactStub();
  const plugin = await loadClientHalf(React);
  const mounted = mountClient(plugin, payloadFor, options);
  const registration = mounted.registrations.find((entry) => entry.options.name === 'conversation.hero.options');
  const element = (props = { sessionId: 's-1' }) => React.createElement(registration.Component, props);
  renderToHtml(element(), slots);
  for (const effect of slots.effects.splice(0)) await effect();
  await new Promise((resolve) => setImmediate(resolve));
  return { ...mounted, React, slots, element, registration };
}

/** The trigger button of the rendered control. */
function trigger(view) {
  return collectElements(
    view.element(),
    (node) => node.type === 'button' && node.props?.['aria-haspopup'] === 'dialog',
    view.slots,
  )[0];
}

test('AC-15.1 the picker renders in the New Session row and hides without a session', async () => {
  const view = await mountPicker();
  try {
    const tree = renderToHtml(view.element(), view.slots);
    assert.match(tree, /dsm-session-trigger/);
    assert.match(tree, /本次会话技能/);
    assert.equal(renderToHtml(view.element({}), view.slots), '');
  } finally {
    view.restore();
  }
});

test('AC-15.2 opening the picker lists skills grouped by pack', async () => {
  const view = await mountPicker();
  try {
    assert.ok(view.calls.some((entry) => entry.endpoint === 'sessionSkills'));
    trigger(view).props.onClick();
    const collapsed = renderToHtml(view.element(), view.slots);
    assert.match(collapsed, /dsm-session-panel/);
    assert.match(collapsed, /dsm-session-group/);
    // Packs start collapsed: pack rows only, no skill row.
    assert.doesNotMatch(collapsed, /alpha/);
    assert.match(collapsed, /已选 3 \/ 共 3/);
    assert.match(collapsed, /只影响本会话/);
    expandAll(view);
    const tree = renderToHtml(view.element(), view.slots);
    assert.match(tree, /alpha/);
    assert.match(tree, /gamma/);
    const boxes = skillBoxes(view);
    assert.equal(boxes.length, 3);
    assert.equal(boxes.every((node) => node.props.checked === true), true);
  } finally {
    view.restore();
  }
});

test('AC-15.3 unchecking a skill stores the exclusion for this session', async () => {
  const view = await mountPicker();
  try {
    trigger(view).props.onClick();
    expandAll(view);
    const alphaBox = skillBoxes(view)[0];
    alphaBox.props.onChange();
    await new Promise((resolve) => setImmediate(resolve));
    const call = view.calls.filter((entry) => entry.endpoint === 'setSessionSkills').at(-1);
    assert.deepEqual(call.payload, { sessionId: 's-1', excluded: ['alpha'] });
    assert.match(renderToHtml(view.element(), view.slots), /已选 2 \/ 共 3/);
  } finally {
    view.restore();
  }
});

test('AC-15.2 all and none rewrite the whole selection', async () => {
  const view = await mountPicker();
  try {
    trigger(view).props.onClick();
    const buttonByText = (label) => collectElements(
      view.element(),
      (node) => node.type === 'button' && [].concat(node.props?.children ?? []).includes(label),
      view.slots,
    )[0];
    buttonByText('全选').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    buttonByText('清空').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    const last = view.calls.filter((entry) => entry.endpoint === 'setSessionSkills').at(-1);
    assert.deepEqual([...last.payload.excluded].sort(), ['alpha', 'beta', 'gamma']);
  } finally {
    view.restore();
  }
});

test('AC-15.2 filtering narrows the visible rows', async () => {
  const view = await mountPicker();
  try {
    trigger(view).props.onClick();
    const filter = collectElements(
      view.element(),
      (node) => node.type === 'input' && node.props?.['aria-label'] === '筛选技能',
      view.slots,
    )[0];
    filter.props.onChange({ target: { value: 'gamma' } });
    const tree = renderToHtml(view.element(), view.slots);
    assert.match(tree, /gamma/);
    assert.doesNotMatch(tree, /alpha/);
  } finally {
    view.restore();
  }
});

test('AC-15.5 an older Host hides the picker instead of breaking', async () => {
  const view = await mountPicker({ statusFor: () => 404 });
  try {
    assert.equal(renderToHtml(view.element(), view.slots), '');
  } finally {
    view.restore();
  }
});

test('AC-16.1 the stylesheet is injected once at apply time', async () => {
  const { React } = createReactStub();
  const plugin = await loadClientHalf(React);
  const appended = [];
  const head = {
    appendChild(node) {
      node.parentNode = head;
      appended.push(node);
    },
    removeChild(node) {
      node.removed = true;
    },
  };
  const fakeDocument = {
    head,
    createElement(tag) {
      return {
        tagName: tag,
        attrs: {},
        textContent: '',
        setAttribute(name, value) {
          this.attrs[name] = value;
        },
        remove() {
          this.removed = true;
        },
      };
    },
  };
  const previous = globalThis.document;
  globalThis.document = fakeDocument;
  const disposers = [];
  const ctx = {
    effect(callback) {
      const disposer = callback();
      if (typeof disposer === 'function') disposers.push(disposer);
      return disposer;
    },
    locale: {
      register() {
        return () => {};
      },
      bind() {
        return (key) => key;
      },
    },
    slots: { inject() {}, register() {} },
    get() {},
  };
  try {
    plugin.apply(ctx);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].attrs['data-skill-market'], '');
    assert.match(appended[0].textContent, /\.dsm-session-panel/);
    assert.match(appended[0].textContent, /\.dsm-tree \{/);
  } finally {
    for (const dispose of disposers.reverse()) dispose();
    assert.equal(appended[0].removed, true);
    globalThis.document = previous;
  }
});

test('AC-16.2/16.3 the popover is bounded and absolutely positioned', () => {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(source, /\.dsm-session-panel \{[^}]*max-height: min\(60vh, 480px\)/s);
  assert.match(source, /\.dsm-session-panel \{[^}]*width: 380px/s);
  assert.match(source, /\.dsm-session-panel \{[^}]*max-width: calc\(100vw - 24px\)/s);
  assert.match(source, /\.dsm-session-panel \{[^}]*position: absolute/s);
  assert.match(source, /\.dsm-session-list \{[^}]*overflow-y: auto/s);
  assert.match(source, /\.dsm-session-list \{[^}]*flex: 1 1 auto/s);
  assert.match(source, /\.dsm-session \{[^}]*position: relative/s);
  // The composer control sits at the bottom of the page: open upward there.
  assert.match(source, /\.dsm-session-compact \.dsm-session-panel \{[^}]*bottom: calc\(100% \+ 6px\)/s);
});

/** Pack disclosure buttons in the open panel. */
function groupToggles(view) {
  return collectElements(
    view.element(),
    (node) => node.type === 'button' && String(node.props?.className ?? '').includes('dsm-session-group-toggle'),
    view.slots,
  );
}

/** The per-pack "toggle every skill" checkboxes. */
function packBoxes(view) {
  return collectElements(
    view.element(),
    (node) => node.type === 'input' && String(node.props?.className ?? '').includes('dsm-session-pack-box'),
    view.slots,
  );
}

/** Skill-row checkboxes (the per-pack boxes excluded). */
function skillBoxes(view) {
  return collectElements(
    view.element(),
    (node) => node.type === 'input' && node.props?.type === 'checkbox'
      && String(node.props?.className ?? '').includes('dsm-session-pack-box') === false,
    view.slots,
  );
}

/** Expand every pack; the picker starts collapsed. */
function expandAll(view) {
  for (const toggle of groupToggles(view)) {
    if (toggle.props['aria-expanded'] === 'false') toggle.props.onClick();
  }
}

test('AC-17.1/17.2 packs start collapsed and fold-all flips every pack', async () => {
  const view = await mountPicker();
  try {
    trigger(view).props.onClick();
    assert.equal(groupToggles(view).length, 2);
    // Default: every pack collapsed, no skill row rendered.
    assert.equal(groupToggles(view).every((node) => node.props['aria-expanded'] === 'false'), true);
    assert.equal(skillBoxes(view).length, 0);

    // Expanding one pack shows only that pack's rows.
    const controls = groupToggles(view)[0].props['aria-controls'];
    groupToggles(view)[0].props.onClick();
    const opened = renderToHtml(view.element(), view.slots);
    assert.equal(groupToggles(view)[0].props['aria-expanded'], 'true');
    assert.match(opened, /alpha/);
    assert.doesNotMatch(opened, /gamma/);
    assert.match(opened, new RegExp(`id="${controls}"`));

    const buttonByText = (label) => collectElements(
      view.element(),
      (node) => node.type === 'button' && [].concat(node.props?.children ?? []).includes(label),
      view.slots,
    )[0];
    buttonByText('展开全部').props.onClick();
    assert.equal(skillBoxes(view).length, 3);
    buttonByText('折叠全部').props.onClick();
    assert.equal(skillBoxes(view).length, 0);
    assert.equal(groupToggles(view).every((node) => node.props['aria-expanded'] === 'false'), true);
  } finally {
    view.restore();
  }
});

test('AC-17.3 filtering opens a collapsed pack and keeps bulk actions global', async () => {
  const view = await mountPicker();
  try {
    trigger(view).props.onClick();
    // Every pack is collapsed already; filtering must still reveal a match.
    const filter = collectElements(
      view.element(),
      (node) => node.type === 'input' && node.props?.['aria-label'] === '筛选技能',
      view.slots,
    )[0];
    filter.props.onChange({ target: { value: 'gamma' } });
    const filtered = renderToHtml(view.element(), view.slots);
    assert.match(filtered, /gamma/);
    assert.doesNotMatch(filtered, /alpha/);

    // Bulk "清空" still acts on every skill, not only visible rows.
    const clear = collectElements(
      view.element(),
      (node) => node.type === 'button' && [].concat(node.props?.children ?? []).includes('清空'),
      view.slots,
    )[0];
    clear.props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    const last = view.calls.filter((entry) => entry.endpoint === 'setSessionSkills').at(-1);
    assert.deepEqual([...last.payload.excluded].sort(), ['alpha', 'beta', 'gamma']);
  } finally {
    view.restore();
  }
});

test('AC-18 a pack checkbox toggles every skill in that pack', async () => {
  const view = await mountPicker();
  try {
    trigger(view).props.onClick();
    assert.equal(packBoxes(view).length, 2);
    // All skills included by default: the pack box is checked.
    assert.equal(packBoxes(view)[0].props.checked, true);
    assert.equal(packBoxes(view)[0].props['aria-checked'], 'true');

    // Unchecking the pack excludes all of its skills in one call.
    packBoxes(view)[0].props.onChange();
    await new Promise((resolve) => setImmediate(resolve));
    let last = view.calls.filter((entry) => entry.endpoint === 'setSessionSkills').at(-1);
    assert.deepEqual([...last.payload.excluded].sort(), ['alpha', 'beta']);
    assert.equal(packBoxes(view)[0].props.checked, false);
    assert.equal(packBoxes(view)[0].props['aria-checked'], 'false');
    // The other pack is untouched.
    assert.equal(packBoxes(view)[1].props.checked, true);

    // Checking it again includes them all.
    packBoxes(view)[0].props.onChange();
    await new Promise((resolve) => setImmediate(resolve));
    last = view.calls.filter((entry) => entry.endpoint === 'setSessionSkills').at(-1);
    assert.deepEqual(last.payload.excluded, []);

    // A partial selection shows the mixed state.
    groupToggles(view)[0].props.onClick();
    skillBoxes(view)[0].props.onChange();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(packBoxes(view)[0].props.checked, false);
    assert.equal(packBoxes(view)[0].props['aria-checked'], 'mixed');
  } finally {
    view.restore();
  }
});

test('AC-16.5 the popover anchors to the viewport, not to a clipping container', () => {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(source, /getBoundingClientRect/);
  assert.match(source, /position: 'fixed'/);
  assert.match(source, /viewportHeight - below >= 260/);
  assert.match(source, /Math\.min\(380, viewportWidth - 24\)/);
});
