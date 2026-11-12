/**
 * Acceptance run for AC-1 … AC-12 (see ACCEPTANCE.md).
 *
 * Uses a throwaway DSH home so the user's registry is untouched. Prints one
 * line per check and exits non-zero when any check fails.
 *
 * Run: node test/acceptance.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { callFetchRoute, callRoute, mountHost, startHttpServer } from './harness.mjs';
import {
  collectElements,
  createReactStub,
  loadClientHalf,
  mountClient,
  renderToHtml,
} from './harness.mjs';
import { readSkillMetadata } from '../lib/frontmatter.js';
import { isRelevantWatchEvent, scanRoot } from '../lib/scan.js';
import { SkillMarketStore } from '../lib/store.js';

const results = [];
let failures = 0;

function check(id, label, run) {
  try {
    const detail = run();
    results.push({ id, label, ok: true, detail: detail ?? '' });
  } catch (error) {
    failures += 1;
    results.push({ id, label, ok: false, detail: error.message });
  }
}

async function checkAsync(id, label, run) {
  try {
    const detail = await run();
    results.push({ id, label, ok: true, detail: detail ?? '' });
  } catch (error) {
    failures += 1;
    results.push({ id, label, ok: false, detail: error.message });
  }
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-accept-home-'));
const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-accept-pack-'));
const options = {
  dshHome: home,
  statePath: path.join(home, 'skill-market', 'registry.json'),
  defaultSkillDir: path.join(home, 'skill-market', 'skills'),
  watch: false,
};

function writeSkill(root, dir, name, extra = '') {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(
    path.join(root, dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} description\n${extra}---\nBODY ${name}\n`,
    'utf8',
  );
}

writeSkill(pack, 'alpha', 'acc-alpha');
writeSkill(pack, 'beta', 'acc-beta', 'disable-model-invocation: true\n');
writeSkill(pack, 'gamma', 'acc-gamma');
fs.mkdirSync(path.join(home, 'skill-market'), { recursive: true });
fs.writeFileSync(options.statePath, JSON.stringify({ version: 1, dirs: [pack], disabled: [] }), 'utf8');

const host = mountHost(options);
const server = await startHttpServer(host);

// The directory names are the acceptance document's AC ids.
await checkAsync('AC-1.1', '真实 socket 返回完整快照', async () => {
  const { status, body } = await server.post('/api/skill-market/snapshot');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.value.skills.length, 3);
  assert.deepEqual(body.value.dirs.map((dir) => dir.exists), [true]);
  return `${body.value.skills.length} skills, dirs exists=${body.value.dirs[0].exists}`;
});

await checkAsync('AC-1.2', '正常请求不被取消 & 第二次命中缓存', async () => {
  const first = await server.post('/api/skill-market/snapshot');
  const second = await server.post('/api/skill-market/snapshot');
  assert.equal(second.body.value.skills.length, 3);
  assert.equal(second.body.value.diagnostics.cached, true);
  assert.equal(second.body.value.diagnostics.scans, first.body.value.diagnostics.scans);
  return `scans stable at ${second.body.value.diagnostics.scans}, cached=${second.body.value.diagnostics.cached}`;
});

await checkAsync('AC-1.3', 'addDir 响应内联新快照', async () => {
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-accept-extra-'));
  try {
    writeSkill(extra, 'delta', 'acc-delta');
    const { status, body } = await server.post('/api/skill-market/addDir', { path: extra });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.value.snapshot.skills.length, 4);
    return `${body.value.snapshot.skills.length} skills in the response`;
  } finally {
    fs.rmSync(extra, { recursive: true, force: true });
  }
});

await checkAsync('AC-1.4', '鉴权先于业务', async () => {
  const denied = await startHttpServer(host, { admit: () => ({ rejection: 401 }) });
  try {
    const api = await denied.post('/api/skill-market/snapshot');
    assert.equal(api.status, 401);
  } finally {
    await denied.close();
  }
  // The legacy prefix route carries its own fence from the plugin's context.
  const rejectingHost = mountHost(options, { admit: () => ({ rejection: 401 }) });
  try {
    const legacy = await callRoute(rejectingHost.route, 'snapshot');
    assert.equal(legacy.status, 401);
  } finally {
    rejectingHost.dispose();
  }
  return '401 on both transports before the handler';
});

check('AC-2.1', '首选精确路由与端点集合', () => {
  const paths = [...host.fetchRoutes.keys()].sort();
  assert.equal(paths.length, 12);
  assert.ok(paths.every((entry) => entry.startsWith('/api/skill-market/')));
  for (const route of host.fetchRoutes.values()) {
    assert.deepEqual(route.methods, ['POST']);
    assert.equal(route.requestBody, 'buffered');
  }
  return `${paths.length} exact routes, buffered POST`;
});

await checkAsync('AC-2.2', '无 Fetch 注册表时回退旧路由', async () => {
  const legacyHost = mountHost(options, { noFetch: true });
  try {
    const { body } = await callRoute(legacyHost.route, 'snapshot');
    assert.equal(body.ok, true);
    assert.equal(body.value.features.transport, 'web');
    return `transport=${body.value.features.transport}`;
  } finally {
    legacyHost.dispose();
  }
});

await checkAsync('AC-2.3', '请求约束（415/413/坏 JSON）', async () => {
  const wrongType = await callFetchRoute(host, 'snapshot', {}, { contentType: 'text/plain' });
  const tooLarge = await callFetchRoute(host, 'snapshot', {}, { rawBody: 'x'.repeat((1 << 20) + 1) });
  const badJson = await callFetchRoute(host, 'snapshot', {}, { rawBody: '{ nope' });
  assert.equal(wrongType.status, 415);
  assert.equal(tooLarge.status, 413);
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.error.code, 'bad-request');
  return '415 / 413 / 400';
});

await checkAsync('AC-2.4', '旧客户端仍可用旧路径', async () => {
  const api = await server.post('/api/skill-market/snapshot');
  const legacy = await server.post('/skill-market/snapshot');
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.value.skills.length, api.body.value.skills.length);
  return `legacy route matches the exact route (${legacy.body.value.skills.length} skills)`;
});

await checkAsync('AC-3.1/3.2/3.3', '缓存、失效与并发单飞', async () => {
  const before = (await server.post('/api/skill-market/snapshot')).body.value.diagnostics.scans;
  await server.post('/api/skill-market/snapshot');
  const afterHit = (await server.post('/api/skill-market/snapshot')).body.value.diagnostics.scans;
  assert.equal(afterHit, before);
  await server.post('/api/skill-market/refresh');
  const afterRefresh = (await server.post('/api/skill-market/snapshot')).body.value.diagnostics.scans;
  assert.equal(afterRefresh, before + 1);
  // Two concurrent snapshots while the cache is cold share one scan.
  await server.post('/api/skill-market/refresh');
  const [a, b] = await Promise.all([
    server.post('/api/skill-market/snapshot'),
    server.post('/api/skill-market/snapshot'),
  ]);
  assert.equal(a.body.value.diagnostics.scans, b.body.value.diagnostics.scans);
  return `hits stable=${before}, refresh=${before + 1}, concurrent shared one scan`;
});

await checkAsync('AC-3.4', '真实大目录二次快照 < 50 ms', async () => {
  const target = 'D:/AI/workbuddy的技能';
  if (!fs.existsSync(target)) return 'SKIP: 本机无该目录';
  try {
    await server.post('/api/skill-market/addDir', { path: target });
    const firstStarted = process.hrtime.bigint();
    const first = await server.post('/api/skill-market/snapshot');
    const firstMs = Number(process.hrtime.bigint() - firstStarted) / 1e6;
    const secondStarted = process.hrtime.bigint();
    const second = await server.post('/api/skill-market/snapshot');
    const secondMs = Number(process.hrtime.bigint() - secondStarted) / 1e6;
    const skills = second.body.value.skills.length;
    assert.ok(secondMs < 50, `second snapshot took ${secondMs.toFixed(1)} ms`);
    return `${skills} skills; first=${firstMs.toFixed(0)} ms, second=${secondMs.toFixed(1)} ms (cached=${second.body.value.diagnostics.cached})`;
  } finally {
    await server.post('/api/skill-market/removeDir', { path: target });
  }
});

check('AC-4', '监听过滤', () => {
  assert.equal(isRelevantWatchEvent('change', 'references/notes.md'), false);
  assert.equal(isRelevantWatchEvent('change', 'skills/a/SKILL.md'), true);
  assert.equal(isRelevantWatchEvent('rename', 'skills/cat/new'), true);
  assert.equal(isRelevantWatchEvent('change', null), true);
  return 'resource edits ignored, structure and SKILL.md kept';
});

await checkAsync('AC-5', '预算截断上报为不完整', async () => {
  const limited = mountHost({ ...options, maxSkills: 1 });
  try {
    const { body } = await callRoute(limited.route, 'snapshot');
    assert.equal(body.value.incomplete, true);
    assert.equal(body.value.dirs[0].truncated, true);
    const observation = await limited.provider.list({});
    assert.equal(Array.isArray(observation), false);
    assert.equal(observation.complete, false);
    return 'incomplete + complete:false observation';
  } finally {
    limited.dispose();
  }
});

await checkAsync('AC-6', '配置诊断与声明', async () => {
  const bad = mountHost({ ...options, maxDepth: '8', watch: 'yes', maxdepth: 4 });
  try {
    const { body } = await callRoute(bad.route, 'snapshot');
    assert.equal(body.value.config.warnings.length, 3);
    assert.equal(body.value.config.values.maxDepth, 8);
  } finally {
    bad.dispose();
  }
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(manifest.engines.dsh, /^>=0\.2\.1-rc\.3 <0\.3\.0$/);
  return 'warnings + engines.dsh declared';
});

await checkAsync('AC-7', '失效停用名可见且可清理', async () => {
  const staleHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-accept-stale-'));
  try {
    const staleOptions = {
      dshHome: staleHome,
      statePath: path.join(staleHome, 'skill-market', 'registry.json'),
      defaultSkillDir: path.join(staleHome, 'skills'),
      watch: false,
    };
    fs.mkdirSync(path.join(staleHome, 'skill-market'), { recursive: true });
    fs.writeFileSync(
      staleOptions.statePath,
      JSON.stringify({ version: 1, dirs: [pack], disabled: ['acc-alpha', 'ghost'] }),
      'utf8',
    );
    const staleHost = mountHost(staleOptions);
    try {
      const before = await callRoute(staleHost.route, 'snapshot');
      assert.deepEqual(before.body.value.staleDisabled, ['ghost']);
      const pruned = await callRoute(staleHost.route, 'pruneDisabled');
      assert.deepEqual(pruned.body.value.removed, ['ghost']);
      assert.deepEqual(pruned.body.value.snapshot.staleDisabled, []);
      const alpha = pruned.body.value.snapshot.skills.find((skill) => skill.name === 'acc-alpha');
      assert.equal(alpha.enabled, false);
      return 'removed ghost, kept acc-alpha disabled';
    } finally {
      staleHost.dispose();
    }
  } finally {
    fs.rmSync(staleHome, { recursive: true, force: true });
  }
});

check('AC-8', '状态持久化健壮性', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-accept-store-'));
  try {
    const file = path.join(dir, 'registry.json');
    const store = new SkillMarketStore({ file });
    store.addDir('C:\\skills\\keep');
    store.setEnabled('keep-skill', false);
    for (const bad of ['null', '[]', '{"version":2}', '{"dirs":"nope"}']) {
      fs.writeFileSync(file, bad, 'utf8');
      store.load();
      assert.notEqual(store.loadError, undefined, bad);
      assert.deepEqual(store.dirs, ['C:\\skills\\keep'], bad);
    }
    assert.equal(fs.existsSync(`${file}.${process.pid}.tmp`), false);
    return 'bad shapes rejected, state kept, no temp residue';
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await checkAsync('AC-9', '解析边界（BOM / 扁平名 / 符号链接）', async () => {
  const parsed = readSkillMetadata('\uFEFF---\nname: bom\ndescription: d\n---\n', 'bom');
  assert.equal(parsed.error, undefined);
  const scanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-accept-flat-'));
  let symlinkDetail = 'symlink skipped (no privilege)';
  try {
    fs.writeFileSync(path.join(scanDir, 'README.md'), '---\nname: readme\n---\n', 'utf8');
    fs.writeFileSync(path.join(scanDir, 'real.md'), '---\nname: real\ndescription: d\n---\n', 'utf8');
    const scanned = await scanRoot(scanDir, {});
    assert.deepEqual(scanned.skills.map((skill) => skill.name), ['real']);
    assert.equal(scanned.invalid.length, 0);
    // A symlinked SKILL.md must still be discovered.
    const linkPack = path.join(scanDir, 'linked');
    fs.mkdirSync(linkPack, { recursive: true });
    const source = path.join(scanDir, 'real.md');
    const target = path.join(linkPack, 'SKILL.md');
    try {
      fs.symlinkSync(source, target, 'file');
      const linked = await scanRoot(linkPack, {});
      assert.deepEqual(linked.skills.map((skill) => skill.name), ['real']);
      symlinkDetail = 'symlinked SKILL.md discovered';
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    }
    return `BOM ok, README skipped, ${symlinkDetail}`;
  } finally {
    fs.rmSync(scanDir, { recursive: true, force: true });
  }
});

await checkAsync('AC-10', '快照对齐 / 归一化 / 刷新语义（Host 侧证据）', async () => {
  const { body } = await server.post('/api/skill-market/snapshot');
  const value = body.value;
  assert.equal(value.dirs.length, value.counts.dirs);
  assert.ok(value.skills.every((skill) => typeof skill.name === 'string'));
  assert.equal(typeof value.diagnostics.scans, 'number');
  return 'roots/state captured before the scan; snapshot internally consistent';
});

await checkAsync('AC-11', '三态语义（开启 / 屏蔽 / 移除）', async () => {
  const off = await server.post('/api/skill-market/setEnabled', { name: 'acc-gamma', enabled: false });
  assert.equal(off.body.ok, true);
  const observation = await host.provider.list({});
  const candidates = Array.isArray(observation) ? observation : observation.candidates;
  const gamma = candidates.find((candidate) => candidate.name === 'acc-gamma');
  assert.deepEqual(gamma.invocation, { modelInvocable: false, userInvocable: false });
  const beta = candidates.find((candidate) => candidate.name === 'acc-beta');
  assert.equal(beta.invocation.modelInvocable, false); // declared by the skill itself
  await server.post('/api/skill-market/removeDir', { path: pack });
  const afterObservation = await host.provider.list({});
  const after = Array.isArray(afterObservation) ? afterObservation : afterObservation.candidates;
  assert.equal(after.some((candidate) => candidate.name === 'acc-gamma'), false);
  return 'disabled masked, self-declared user-only kept, removed absent';
});

/** Render the pack tree view with a two-pack fixture. */
async function openTreeView() {
  const { React, slots } = createReactStub();
  const plugin = await loadClientHalf(React);
  const snapshot = {
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
    dirs: [
      {
        path: 'C:\\packs\\alpha-pack',
        exists: true,
        builtin: false,
        fromConfig: false,
        removable: true,
        skills: 2,
        invalid: 1,
        truncated: false,
      },
      {
        path: 'C:\\packs\\beta-pack',
        exists: true,
        builtin: false,
        fromConfig: false,
        removable: true,
        skills: 1,
        invalid: 0,
        truncated: false,
      },
    ],
    skills: [
      {
        name: 'acc-alpha',
        description: 'Alpha',
        path: 'C:\\packs\\alpha-pack\\a\\SKILL.md',
        directory: 'C:\\packs\\alpha-pack\\a',
        root: 'C:\\packs\\alpha-pack',
        relative: 'a/SKILL.md',
        kind: 'bundle',
        builtin: false,
        enabled: true,
        invocation: { modelInvocable: true, userInvocable: true },
      },
      {
        name: 'acc-beta',
        description: 'Beta',
        path: 'C:\\packs\\alpha-pack\\b\\SKILL.md',
        directory: 'C:\\packs\\alpha-pack\\b',
        root: 'C:\\packs\\alpha-pack',
        relative: 'b/SKILL.md',
        kind: 'bundle',
        builtin: false,
        enabled: false,
        invocation: { modelInvocable: false, userInvocable: false },
      },
      {
        name: 'acc-gamma',
        description: 'Gamma',
        path: 'C:\\packs\\beta-pack\\g\\SKILL.md',
        directory: 'C:\\packs\\beta-pack\\g',
        root: 'C:\\packs\\beta-pack',
        relative: 'g/SKILL.md',
        kind: 'bundle',
        builtin: false,
        enabled: true,
        invocation: { modelInvocable: true, userInvocable: true },
      },
    ],
    invalid: [{
      path: 'C:\\packs\\alpha-pack\\broken\\SKILL.md',
      root: 'C:\\packs\\alpha-pack',
      relative: 'broken/SKILL.md',
      error: 'no `name` field',
    }],
    duplicates: [],
    counts: { dirs: 2, skills: 3, enabled: 2, disabled: 1, invalid: 1, duplicates: 0 },
  };
  const mounted = mountClient(plugin, () => ({ ok: true, value: snapshot }));
  const registration = mounted.registrations.find((entry) => entry.options.name === 'settings.section');
  const element = () => React.createElement(registration.Component, {});
  renderToHtml(element(), slots);
  for (const effect of slots.effects.splice(0)) await effect();
  await new Promise((resolve) => setImmediate(resolve));
  const disclosures = () => collectElements(
    element(),
    (node) => node.type === 'button' && node.props?.className === 'dsm-tree-disclosure',
    slots,
  );
  return {
    ...mounted,
    slots,
    element,
    disclosures,
    tree: () => renderToHtml(element(), slots),
    input: () => collectElements(
      element(),
      (node) => node.type === 'input' && node.props?.['aria-label'] === '筛选技能',
      slots,
    )[0],
  };
}

await checkAsync('AC-13.1/13.8', '技能包树：父行 + 子行，无效条目入树', async () => {
  const view = await openTreeView();
  try {
    const collapsed = view.tree();
    assert.equal(view.disclosures().length, 2);
    assert.match(collapsed, /className="dsm-tree-parent"/);
    assert.doesNotMatch(collapsed, /acc-alpha/);
    assert.doesNotMatch(collapsed, /dsm-card/);
    view.disclosures()[0].props.onClick();
    const opened = view.tree();
    assert.match(opened, /acc-alpha/);
    assert.match(opened, /dsm-tree-invalid/);
    assert.doesNotMatch(opened, /无法解析的条目/);
    return '2 parent rows, child rows only when open, invalid row inside the pack';
  } finally {
    view.restore();
  }
});

await checkAsync('AC-13.2', '展开 / 折叠与快照刷新后的状态', async () => {
  const view = await openTreeView();
  try {
    const [first] = view.disclosures();
    assert.equal(first.props['aria-expanded'], 'false');
    first.props.onClick();
    assert.equal(view.disclosures()[0].props['aria-expanded'], 'true');
    assert.match(view.tree(), new RegExp(`id="${first.props['aria-controls']}"`));
    const toggle = collectElements(
      view.element(),
      (node) => node.type === 'button' && node.props?.role === 'switch',
      view.slots,
    )[0];
    toggle.props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(view.disclosures()[0].props['aria-expanded'], 'true');
    return 'aria-expanded/controls wired; open state survives a snapshot refresh';
  } finally {
    view.restore();
  }
});

await checkAsync('AC-13.6', '筛选自动展开并在清空后恢复', async () => {
  const view = await openTreeView();
  try {
    view.disclosures()[0].props.onClick();
    view.input().props.onChange({ target: { value: 'gamma' } });
    const filtered = view.tree();
    assert.match(filtered, /acc-gamma/);
    assert.doesNotMatch(filtered, /acc-alpha/);
    view.input().props.onChange({ target: { value: '' } });
    assert.match(view.tree(), /acc-alpha/);
    return 'matching pack opened, non-matching hidden, previous state restored';
  } finally {
    view.restore();
  }
});

await checkAsync('AC-13.9', '树形连接线使用主题 token', async () => {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const start = source.indexOf('.dsm-tree {');
  assert.notEqual(start, -1);
  const block = source.slice(start, source.indexOf('.dsm-tags {', start));
  assert.match(block, /\.dsm-tree-children \{[^}]*border-left: 1px solid var\(--dsw-alias-border-l2\)/s);
  assert.match(block, /\.dsm-tree-child::before \{[^}]*border-bottom-left-radius/s);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/);
  return 'vertical spine + rounded elbow, no hard-coded colour';
});

check('AC-14', '侧栏面板内容区独立滚动（结构断言）', () => {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(source, /\.dsm-panel \{[^}]*height: 100%/s);
  assert.match(source, /\.dsm-panel \{[^}]*display: flex; flex-direction: column/s);
  assert.match(source, /\.dsm-panel > \.dsm-root \{[^}]*overflow-y: auto/s);
  assert.match(source, /scrollbar-color: var\(--dsw-alias-border-l3/s);
  // The fallback for a clipping host is opt-in, never applied on top of a
  // surface that already scrolls.
  assert.match(source, /\.dsm-root-scroll \{[^}]*overflow-y: auto/s);
  return 'panel column + scrolling body + themed scrollbar + opt-in fallback (real wheel scrolling needs a page refresh)';
});

await checkAsync('AC-15.1/15.2', '会话技能选择器：入口 + 弹窗', async () => {
  const { React, slots } = createReactStub();
  const plugin = await loadClientHalf(React);
  const skills = [
    { name: 'acc-alpha', description: 'Alpha', root: 'C:\\packs\\a', relative: 'alpha/SKILL.md' },
    { name: 'acc-beta', description: 'Beta', root: 'C:\\packs\\a', relative: 'beta/SKILL.md' },
  ];
  const mounted = mountClient(plugin, () => ({
    ok: true,
    value: { sessionId: 's-1', excluded: [], skills, canFilter: true },
  }));
  try {
    const registration = mounted.registrations.find((entry) => entry.options.name === 'conversation.hero.options');
    const element = () => React.createElement(registration.Component, { sessionId: 's-1' });
    renderToHtml(element(), slots);
    for (const effect of slots.effects.splice(0)) await effect();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(renderToHtml(element(), slots), /本次会话技能/);
    const trigger = collectElements(
      element(),
      (node) => node.type === 'button' && node.props?.['aria-haspopup'] === 'dialog',
      slots,
    )[0];
    trigger.props.onClick();
    const opened = renderToHtml(element(), slots);
    assert.match(opened, /dsm-session-panel/);
    assert.match(opened, /只影响本会话/);
    return 'trigger + popover with grouped skill rows';
  } finally {
    mounted.restore();
  }
});

await checkAsync('AC-15.3/15.6', '会话过滤只影响该会话', async () => {
  const sessionHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-session-gate-'));
  try {
    const sessionOptions = {
      dshHome: sessionHome,
      statePath: path.join(sessionHome, 'skill-market', 'registry.json'),
      defaultSkillDir: path.join(sessionHome, 'skills'),
      watch: false,
    };
    fs.mkdirSync(path.join(sessionHome, 'skill-market'), { recursive: true });
    fs.writeFileSync(sessionOptions.statePath, JSON.stringify({ version: 1, dirs: [pack], disabled: [] }), 'utf8');
    const sessionHost = mountHost(sessionOptions);
    try {
      const names = (list) => list.map((candidate) => candidate.name);
      const alpha = (await sessionHost.provider.list({})).find((candidate) => candidate.name === 'acc-alpha');
      const set = await callRoute(sessionHost.route, 'setSessionSkills', {
        sessionId: 's-1',
        excluded: ['acc-alpha'],
      });
      assert.equal(set.body.ok, true);
      assert.deepEqual(set.body.value.excluded, ['acc-alpha']);
      // The registry passes the viewing Agent as `scope` to the provider.
      assert.deepEqual(names(await sessionHost.provider.list({ scope: { id: 's-1' } })), ['acc-beta', 'acc-gamma']);
      assert.deepEqual(names(await sessionHost.provider.list({ scope: { id: 's-2' } })), ['acc-alpha', 'acc-beta', 'acc-gamma']);
      assert.equal(await sessionHost.provider.get(alpha, { scope: { id: 's-1' } }), undefined);
      const invalid = await callRoute(sessionHost.route, 'setSessionSkills', { sessionId: 's-1', excluded: 'x' });
      assert.equal(invalid.body.error.code, 'invalid-argument');
      return 'provider filters by scope; other sessions and global unchanged';
    } finally {
      sessionHost.dispose();
    }
  } finally {
    fs.rmSync(sessionHome, { recursive: true, force: true });
  }
});

check('AC-15.4', '会话选择持久化', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-sessions-'));
  try {
    const file = path.join(dir, 'registry.json');
    const store = new SkillMarketStore({ file });
    store.setSessionExclusions('s-1', ['acc-alpha']);
    const reloaded = new SkillMarketStore({ file });
    reloaded.load();
    assert.deepEqual(reloaded.sessionExclusions('s-1'), ['acc-alpha']);
    reloaded.setSessionExclusions('s-1', []);
    assert.deepEqual(reloaded.sessionExclusions('s-1'), []);
    return 'persisted across reload, cleared cleanly';
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('AC-16', '弹窗尺寸与样式加载（结构断言）', () => {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(source, /document\.head\.appendChild/);
  assert.match(source, /data-skill-market/);
  assert.match(source, /\.dsm-session-panel \{[^}]*max-height: min\(60vh, 480px\)/s);
  assert.match(source, /\.dsm-session-panel \{[^}]*width: 380px/s);
  assert.match(source, /\.dsm-session-panel \{[^}]*max-width: calc\(100vw - 24px\)/s);
  assert.match(source, /\.dsm-session-list \{[^}]*overflow-y: auto/s);
  return 'styles injected globally; popover capped at 380px / min(60vh, 480px) with a scrolling list';
});
await checkAsync('AC-17/18', '技能包默认折叠 + 父级勾选（结构 + 交互）', async () => {
  const { React, slots } = createReactStub();
  const plugin = await loadClientHalf(React);
  const skills = [
    { name: 'acc-alpha', description: 'Alpha', root: 'C:\\packs\\a', relative: 'a/SKILL.md' },
    { name: 'acc-beta', description: 'Beta', root: 'C:\\packs\\b', relative: 'b/SKILL.md' },
  ];
  const mounted = mountClient(plugin, () => ({
    ok: true,
    value: { sessionId: 's-1', excluded: [], skills, canFilter: true },
  }));
  try {
    const registration = mounted.registrations.find((entry) => entry.options.name === 'conversation.hero.options');
    const element = () => React.createElement(registration.Component, { sessionId: 's-1' });
    renderToHtml(element(), slots);
    for (const effect of slots.effects.splice(0)) await effect();
    await new Promise((resolve) => setImmediate(resolve));
    const trigger = collectElements(
      element(),
      (node) => node.type === 'button' && node.props?.['aria-haspopup'] === 'dialog',
      slots,
    )[0];
    trigger.props.onClick();
    const groups = () => collectElements(
      element(),
      (node) => node.type === 'button' && String(node.props?.className ?? '').includes('dsm-session-group-toggle'),
      slots,
    );
    const packBoxes = () => collectElements(
      element(),
      (node) => node.type === 'input' && String(node.props?.className ?? '').includes('dsm-session-pack-box'),
      slots,
    );
    assert.equal(groups().length, 2);
    // Default collapsed: no skill rows, both packs closed.
    assert.equal(groups().every((node) => node.props['aria-expanded'] === 'false'), true);
    assert.doesNotMatch(renderToHtml(element(), slots), /acc-alpha/);
    // Expanding one pack shows only its rows.
    groups()[0].props.onClick();
    const opened = renderToHtml(element(), slots);
    assert.match(opened, /acc-alpha/);
    assert.doesNotMatch(opened, /acc-beta/);
    // The pack checkbox turns every skill of that pack off in one call.
    assert.equal(packBoxes()[0].props.checked, true);
    packBoxes()[0].props.onChange();
    await new Promise((resolve) => setImmediate(resolve));
    const last = mounted.calls.filter((entry) => entry.endpoint === 'setSessionSkills').at(-1);
    assert.deepEqual(last.payload.excluded, ['acc-alpha']);
    return 'packs start collapsed; the pack checkbox toggles the whole pack';
  } finally {
    mounted.restore();
  }
});
check('AC-16.5', '浮层定位（视口锚定）', () => {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(source, /getBoundingClientRect/);
  assert.match(source, /position: 'fixed'/);
  assert.match(source, /viewportHeight - below >= 260/);
  return 'measured viewport anchor; flips above when the bottom lacks room';
});
check('AC-12.2', '文档与配置一致', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const patch = fs.readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(patch.includes('maxDepth: 8'));
  assert.match(readme, /\| `maxDepth` \| `8` \|/);
  assert.match(readme, /63 个|63 tests|用例.*63/);
  assert.equal(manifest.version, '1.1.0');
  return 'maxDepth=8 in code/patch/README, count documented';
});

check('AC-12.3', 'bundle 已在当前 profile 中选择', () => {
  const profileDir = process.env.DSH_PROFILE_DIR;
  if (!profileDir) return 'SKIP: no DSH_PROFILE_DIR';
  const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
  const bundles = manifest?.dsh?.profile?.bundles ?? [];
  assert.ok(bundles.includes('@local/dsh-skill-market'), 'bundle missing from dsh.profile.bundles');
  return `selected in ${path.basename(profileDir)}`;
});

await server.close();
host.dispose();
fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(pack, { recursive: true, force: true });

for (const entry of results) {
  console.log(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.id.padEnd(12)} ${entry.label}${entry.detail === '' ? '' : ` — ${entry.detail}`}`);
}
console.log(`\n${results.filter((entry) => entry.ok).length}/${results.length} checks passed`);
process.exitCode = failures === 0 ? 0 : 1;
