/**
 * Skill Manager — Host half.
 *
 * A local skill manager for DeepSeek Harness. The user registers one or more
 * directories; every skill package below them (`<dir>/SKILL.md`, nested at any
 * bounded depth, plus flat `<dir>/<name>.md` files) is discovered, shown as a
 * card in the Web settings page, and can be switched on or off individually.
 *
 * The Host half owns four things:
 *
 *   1. a skill provider registered on `ctx.skills`, so enabled skills reach the
 *      session catalog and the `skill` tool exactly like a filesystem skill;
 *   2. the durable registry of directories and switches;
 *   3. a cached, single-flight discovery pass shared by the provider and the UI;
 *   4. an authenticated browser transport: exact `POST /api/skill-market/<name>`
 *      routes through the framework's Fetch registry, plus the legacy
 *      `/skill-market/<name>` prefix route for pages loaded from an older build.
 *
 * Switching a skill off removes it from the model catalog *and* neutralizes any
 * same-name skill another provider still reports: the registry resolves a
 * duplicate name by rank and picks the lowest, so this provider answers with a
 * masked candidate (both invocation surfaces refused) at rank 50 — below every
 * shipped filesystem root (100/200/300/400/500/600) and below the runtime rank
 * (250). The visible consequence is documented: an *enabled* skill from a
 * registered directory also wins a same-name skill from another local provider.
 *
 * @module skill-market
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readSkillMetadata } from './lib/frontmatter.js';
import { findPackRoot, hasPackMarker, isRelevantWatchEvent, mergeCatalog, scanRoot, scanRoots } from './lib/scan.js';
import { SkillMarketStore, normalizeDirectory, sameDirectory } from './lib/store.js';

/** Cordis plugin identity used in loader diagnostics. */
export const name = 'skill-market';

/** The skill registry is the one hard dependency. */
export const inject = ['skills'];

/** Provider name registered on `ctx.skills`. */
const PROVIDER_NAME = 'skill-market';

/**
 * Rank below every shipped filesystem root so this provider owns a duplicate
 * name in its layer. See the module comment for the full precedence story.
 */
const PROVIDER_RANK = 50;

/** Legacy prefix route the browser half used before the Fetch-registry move. */
const CHANNEL = '/skill-market';

/** Preferred exact-route namespace inside the framework's authenticated bridge. */
const API_CHANNEL = '/api/skill-market';

/** Every endpoint the browser half may call. */
const ENDPOINTS = Object.freeze([
  'snapshot',
  'revision',
  'addDir',
  'removeDir',
  'replaceWithPack',
  'setEnabled',
  'setAllEnabled',
  'ensureDefaultDir',
  'refresh',
  'pruneDisabled',
  'sessionSkills',
  'setSessionSkills',
]);

/** Request body cap for both transports. */
const MAX_BODY_BYTES = 1 << 20;

/** Default recursion depth for one registered root. */
const DEFAULT_MAX_DEPTH = 8;

/** A pack must serve at least this many skills to replace a picked folder. */
const PACK_MIN_SKILLS = 2;

/** Build the success envelope the browser half unwraps. */
function ok(value) {
  return { ok: true, value };
}

/** Build the failure envelope the browser half unwraps. */
function fail(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

/** Build an exact-route JSON response. */
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Resolve the effective plugin options, collecting diagnostics for values that
 * are present but unusable instead of silently ignoring them.
 *
 * The field set mirrors the documented `config`; unknown keys are reported so a
 * typo (`maxdepth`) is visible in the UI rather than silently defaulted.
 *
 * @param config - the row config from the Loader.
 * @returns normalized options plus `configWarnings`.
 */
function resolveOptions(config) {
  const settings = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const warnings = [];
  const known = new Set([
    'dshHome',
    'agentsHome',
    'statePath',
    'defaultSkillDir',
    'skillDirs',
    'maxDepth',
    'watch',
    'packDetection',
    'maxDirectories',
    'maxSkills',
  ]);
  for (const key of Object.keys(settings)) {
    if (!known.has(key)) warnings.push(`未知配置项 "${key}" 已忽略`);
  }

  const readPath = (key, fallback) => {
    const value = settings[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || value.trim() === '') {
      warnings.push(`配置 ${key}=${JSON.stringify(value)} 无效（需为非空路径字符串），已用默认值`);
      return fallback;
    }
    return normalizeDirectory(value);
  };
  const readInteger = (key, fallback, min, max) => {
    const value = settings[key];
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < min || value > max) {
      warnings.push(`配置 ${key}=${JSON.stringify(value)} 无效（需为 ${min}–${max} 的整数），已用默认值 ${fallback}`);
      return fallback;
    }
    return value;
  };
  const readBoolean = (key, fallback) => {
    const value = settings[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') {
      warnings.push(`配置 ${key}=${JSON.stringify(value)} 无效（需为 true/false），已用默认值 ${fallback}`);
      return fallback;
    }
    return value;
  };

  const dshHome = readPath('dshHome', normalizeDirectory(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')));
  const agentsHome = readPath('agentsHome', normalizeDirectory(process.env.DSH_AGENTS_HOME ?? path.join(os.homedir(), '.agents')));
  const stateDir = path.join(dshHome, 'skill-market');
  const rawDirs = settings.skillDirs;
  let configDirs = [];
  if (rawDirs !== undefined) {
    if (!Array.isArray(rawDirs)) {
      warnings.push('配置 skillDirs 无效（需为路径数组），已忽略');
    } else {
      configDirs = rawDirs
        .map((entry) => {
          if (typeof entry !== 'string' || entry.trim() === '') {
            warnings.push(`配置 skillDirs 中的 ${JSON.stringify(entry)} 已忽略（需为非空路径字符串）`);
            return '';
          }
          return normalizeDirectory(entry);
        })
        .filter((entry) => entry !== '');
    }
  }
  return {
    warnings,
    dshHome,
    agentsHome,
    stateFile: readPath('statePath', path.join(stateDir, 'registry.json')),
    defaultDir: readPath('defaultSkillDir', path.join(stateDir, 'skills')),
    configDirs,
    maxDepth: readInteger('maxDepth', DEFAULT_MAX_DEPTH, 0, 32),
    watch: readBoolean('watch', true),
    // Upward pack detection is opt-in and never implicit: adding a directory
    // always registers exactly that directory and scans only downward. With
    // this on, a registered narrow folder is *offered* the enclosing pack, and
    // the user swaps it with an explicit `replaceWithPack` click.
    packDetection: readBoolean('packDetection', false),
    maxDirectories: readInteger('maxDirectories', 4000, 1, 100000),
    maxSkills: readInteger('maxSkills', 500, 1, 100000),
  };
}

/** The nearest ancestor containing `.git`, mirroring the shipped provider. */
function projectRootOf(start) {
  let current = start;
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Every root the shipped filesystem provider scans, for UI provenance only. */
function shippedRoots(options) {
  const roots = [path.join(options.dshHome, 'skills'), path.join(options.agentsHome, 'skills')];
  const project = projectRootOf(process.cwd());
  if (project !== undefined) {
    roots.push(path.join(project, '.dsh', 'skills'), path.join(project, '.agents', 'skills'));
  }
  return roots;
}

/**
 * Mount the local skill manager.
 *
 * @param ctx - the Host plugin context.
 * @param config - optional plugin configuration (see the package README).
 */
export function apply(ctx, config = {}) {
  const options = resolveOptions(config);
  const logger = typeof ctx.logger === 'function' ? ctx.logger('skill-market') : { info() {}, warn() {}, debug() {} };
  const store = new SkillMarketStore({ file: options.stateFile, logger });
  store.load();

  const builtinRoots = shippedRoots(options);
  const isBuiltinRoot = (directory) => builtinRoots.some((root) => sameDirectory(root, directory));

  let revision = 0;
  /** @type {{ revision: number, catalog: object } | undefined} */
  let cache;
  /** @type {Promise<object> | undefined} */
  let inFlight;
  let scanCount = 0;
  let lastCollectCached = false;
  /** @type {Map<string, object | undefined>} */
  const suggestionCache = new Map();
  let providerControl;
  let disposed = false;
  /** @type {'fetch' | 'web' | 'none'} */
  let transportMode = 'none';

  /** Every root the manager serves: configuration first, then user-registered. */
  const allRoots = () => [...options.configDirs, ...store.dirs];

  /**
   * Discover skills once per revision.
   *
   * The registry calls `list()` on cache misses and the browser half calls
   * `snapshot()` on every panel action; both share one cached, single-flight
   * scan. Discovery is always complete or explicitly reported incomplete —
   * never silently truncated.
   *
   * @returns the cached or freshly scanned catalog.
   */
  async function collect() {
    if (cache !== undefined && cache.revision === revision) {
      lastCollectCached = true;
      return cache.catalog;
    }
    if (inFlight !== undefined) {
      lastCollectCached = true;
      return inFlight;
    }
    const startedAtRevision = revision;
    const roots = allRoots();
    const run = (async () => {
      const results = await scanRoots(roots, {
        maxDepth: options.maxDepth,
        maxDirectories: options.maxDirectories,
        maxSkills: options.maxSkills,
      });
      scanCount += 1;
      const catalog = {
        results,
        ...mergeCatalog(results),
        complete: results.every((result) => result.exists === true && result.truncated !== true),
      };
      if (revision === startedAtRevision) cache = { revision: startedAtRevision, catalog };
      return catalog;
    })();
    inFlight = run.finally(() => {
      inFlight = undefined;
    });
    lastCollectCached = false;
    return inFlight;
  }

  /** Scan one directory on demand (used by pack detection). */
  function scanOne(root) {
    return scanRoot(root, {
      maxDepth: options.maxDepth,
      maxDirectories: options.maxDirectories,
      maxSkills: options.maxSkills,
    });
  }

  /**
   * Whether a discovered pack root is trustworthy enough to act on.
   *
   * @param root - the candidate pack root.
   * @param directory - the directory the search started from.
   * @returns whether the candidate may replace or be suggested for `directory`.
   */
  async function isTrustworthyPack(root, directory) {
    if (await hasPackMarker(root)) return true;
    return sameDirectory(root, path.dirname(directory));
  }

  /**
   * Say whether a registered directory is a narrow slice of a larger pack.
   * Results are cached per revision because it costs one pack scan.
   *
   * Only runs when `packDetection` is enabled: the default configuration never
   * looks above a registered directory, so nothing outside it is scanned.
   *
   * @param directory - the normalized absolute registered directory.
   * @param ownSkills - skills this directory currently contributes.
   * @param knownRoots - the captured root list for this snapshot.
   * @returns the enclosing pack and its skill count, or undefined.
   */
  async function packSuggestionFor(directory, ownSkills, knownRoots) {
    if (suggestionCache.has(directory)) return suggestionCache.get(directory);
    let suggestion;
    if (options.packDetection === true && ownSkills <= 1) {
      const root = await findPackRoot(directory);
      if (root !== undefined && !sameDirectory(root, directory) && (await isTrustworthyPack(root, directory))) {
        if (!knownRoots.some((entry) => sameDirectory(entry, root))) {
          const scanned = await scanOne(root);
          if (scanned.skills.length > Math.max(ownSkills, 1)) suggestion = { root, skills: scanned.skills.length };
        }
      }
    }
    suggestionCache.set(directory, suggestion);
    return suggestion;
  }

  /** Build the provider candidates, masking switched-off skills. */
  function candidatesOf(catalog) {
    const candidates = [];
    for (const skill of catalog.skills) {
      if (skill.shadowedBy !== undefined) continue;
      const disabled = store.isDisabled(skill.name);
      candidates.push({
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
        invocation: disabled ? { modelInvocable: false, userInvocable: false } : skill.invocation,
        source: 'custom',
        provider: PROVIDER_NAME,
        rank: PROVIDER_RANK,
        path: skill.path,
        resourceBase: { kind: 'directory', path: skill.directory },
        locator: { path: skill.path, directory: skill.directory, name: skill.name },
        ...(skill.metadata === undefined ? {} : { metadata: skill.metadata }),
      });
    }
    return candidates;
  }

  const provider = {
    name: PROVIDER_NAME,
    async list(lookup = {}) {
      if (lookup.signal?.aborted === true) return { candidates: [], complete: false };
      const catalog = await collect();
      let candidates = candidatesOf(catalog);
      // `dsh-tool-skill` builds the model-facing catalog with the viewing Agent
      // as `scope`, and the registry hands that same view object to every
      // provider's `list()`. Filtering here keeps the global registry intact and
      // gives each session its own catalog.
      const excluded = excludedForScope(lookup.scope);
      if (excluded !== undefined) {
        candidates = candidates.filter((candidate) => excluded.has(candidate.name) === false);
      }
      // A bare array means "complete"; a truncated or aborted pass must not be
      // cached by the registry as the whole catalog.
      if (catalog.complete === true && lookup.signal?.aborted !== true) return candidates;
      return { candidates, complete: false };
    },
    async get(candidate, lookup = {}) {
      const excluded = excludedForScope(lookup.scope);
      if (excluded !== undefined && excluded.has(candidate?.name) === true) return undefined;
      const { rank: _rank, locator, ...summary } = candidate;
      const raw = await fs.promises.readFile(locator.path, { encoding: 'utf8', signal: lookup.signal });
      const parsed = readSkillMetadata(raw, locator.path);
      if (parsed.error !== undefined) throw new Error(parsed.error);
      return { ...summary, content: parsed.body.trim() };
    },
  };

  const providerDisposer = ctx.skills.registerProvider((control) => {
    providerControl = control;
    return provider;
  });

  // ------------------------------------------------------ session skill filter
  //
  // A mounted Host service cannot be patched from a plugin context: assigning
  // `ctx.skills.snapshot` is rejected (the framework hands back a bound facade),
  // so the per-session choice is enforced inside this provider instead — the
  // registry passes `scope` through to `list()` and keeps a per-scope cache.

  /**
   * Exclusions for the session a skill lookup is scoped to.
   *
   * @param scope - `SkillViewOptions.scope`, the Agent object the caller passes.
   * @returns the excluded names, or undefined when the session loads everything.
   */
  function excludedForScope(scope) {
    if (scope === null || typeof scope !== 'object') return undefined;
    const id = scope.id;
    if (typeof id !== 'string' || id === '') return undefined;
    const excluded = store.sessionExclusions(id);
    return excluded.length === 0 ? undefined : new Set(excluded);
  }

  // ---------------------------------------------------------------- watchers

  /** @type {Map<string, import('node:fs').FSWatcher>} */
  const watchers = new Map();
  /** @type {import('node:fs').FSWatcher | undefined} */
  let stateWatcher;
  let debounce;

  function scheduleRefresh(reason) {
    if (disposed) return;
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      refresh(reason);
    }, 250);
  }

  function closeWatcher(key) {
    const watcher = watchers.get(key);
    if (watcher === undefined) return;
    watchers.delete(key);
    try {
      watcher.close();
    } catch {
      /* already closed */
    }
  }

  function openWatcher(directory) {
    const onChange = (eventType, filename) => {
      // Resource subtrees (references/, scripts/, .git) cannot change the
      // catalog; filtering here avoids needless rescans and model-facing
      // catalog replacements.
      if (!isRelevantWatchEvent(eventType, filename)) return;
      scheduleRefresh(`change under ${directory}`);
    };
    try {
      const watcher = fs.watch(directory, { recursive: true, persistent: false }, onChange);
      watcher.on('error', (error) => {
        logger.warn(`stopped watching ${directory}: ${error.message}`);
        closeWatcher(directory);
      });
      watchers.set(directory, watcher);
      return;
    } catch {
      /* recursive watching is not available everywhere */
    }
    try {
      const watcher = fs.watch(directory, { persistent: false }, onChange);
      watcher.on('error', () => closeWatcher(directory));
      watchers.set(directory, watcher);
    } catch (error) {
      logger.warn(`cannot watch ${directory}: ${error.message}`);
    }
  }

  function syncWatchers() {
    if (!options.watch) return;
    const wanted = new Set(allRoots());
    for (const directory of [...watchers.keys()]) {
      if (!wanted.has(directory)) closeWatcher(directory);
    }
    for (const directory of wanted) {
      if (watchers.has(directory)) continue;
      if (!fs.existsSync(directory)) continue;
      openWatcher(directory);
    }
    if (stateWatcher === undefined) {
      const directory = path.dirname(options.stateFile);
      const fileName = path.basename(options.stateFile);
      try {
        fs.mkdirSync(directory, { recursive: true });
        stateWatcher = fs.watch(directory, { persistent: false }, (_event, changed) => {
          if (changed !== null && changed !== undefined && changed.toString() !== fileName) return;
          store.load();
          scheduleRefresh('registry file changed');
        });
        stateWatcher.on('error', () => {
          try {
            stateWatcher?.close();
          } catch {
            /* already closed */
          }
          stateWatcher = undefined;
        });
      } catch (error) {
        logger.warn(`cannot watch ${directory}: ${error.message}`);
      }
    }
  }

  /** Drop the cached scan, tell the registry, and re-arm the watchers. */
  function refresh(reason) {
    revision += 1;
    cache = undefined;
    suggestionCache.clear();
    try {
      providerControl?.invalidate();
    } catch (error) {
      logger.warn(`skill catalog invalidation failed: ${error.message}`);
    }
    syncWatchers();
    if (reason !== undefined) logger.debug?.(`refreshed: ${reason}`);
  }

  ctx.effect(() => () => {
    disposed = true;
    if (debounce !== undefined) clearTimeout(debounce);
    for (const directory of [...watchers.keys()]) closeWatcher(directory);
    try {
      stateWatcher?.close();
    } catch {
      /* already closed */
    }
    stateWatcher = undefined;
  }, 'skill-market: watchers');

  ctx.effect(() => providerDisposer, 'skill-market: skill provider');

  // ------------------------------------------------------------- snapshots

  /** Build the complete UI/state snapshot from one captured root/state pair. */
  async function snapshot() {
    const rootOrder = [...allRoots()];
    const state = store.snapshot();
    const loadError = store.loadError;
    const catalog = await collect();
    const fromConfig = (directory) => options.configDirs.some((entry) => sameDirectory(entry, directory));

    const dirs = [];
    for (const [index, directory] of rootOrder.entries()) {
      const result = catalog.results[index];
      const dirSkills = result?.skills ?? [];
      const invalid = result?.invalid ?? [];
      const pack = result?.exists === true
        ? await packSuggestionFor(directory, dirSkills.length, rootOrder)
        : undefined;
      dirs.push({
        path: directory,
        exists: result?.exists ?? false,
        builtin: isBuiltinRoot(directory),
        fromConfig: fromConfig(directory),
        removable: !fromConfig(directory),
        skills: dirSkills.length,
        invalid: invalid.length,
        truncated: result?.truncated === true,
        ...(pack === undefined ? {} : { pack }),
        ...(result?.error === undefined ? {} : { error: result.error }),
      });
    }

    const skills = catalog.skills
      .filter((skill) => skill.shadowedBy === undefined)
      .map((skill) => {
        const enabled = !store.isDisabled(skill.name);
        const invocation = enabled ? skill.invocation : { modelInvocable: false, userInvocable: false };
        return {
          name: skill.name,
          description: skill.description,
          ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
          path: skill.path,
          directory: skill.directory,
          root: skill.root,
          relative: skill.relative,
          kind: skill.kind,
          builtin: isBuiltinRoot(skill.root),
          enabled,
          declared: skill.invocation,
          invocation,
        };
      });

    const duplicates = catalog.skills
      .filter((skill) => skill.shadowedBy !== undefined)
      .map((skill) => ({ name: skill.name, path: skill.path, root: skill.root, shadowedBy: skill.shadowedBy }));

    const staleDisabled = state.disabled.filter((name) => catalog.byName.has(name) === false);

    return {
      revision,
      statePath: options.stateFile,
      defaultDir: options.defaultDir,
      maxDepth: options.maxDepth,
      watching: watchers.size > 0,
      // The browser half gates newer controls on these, so a page that loaded a
      // newer bundle than the running Host cannot mis-call an older endpoint.
      features: {
        scopedToggle: true,
        replaceWithPack: options.packDetection === true,
        packDetection: options.packDetection === true,
        // A cheap revision probe lets the panel notice changes made elsewhere.
        revisionProbe: true,
        pruneDisabled: true,
        configDiagnostics: true,
        incompleteReporting: true,
        // The provider filters by the caller's `scope`, so per-session selection
        // is always available on this Host generation.
        sessionSkills: true,
        transport: transportMode,
      },
      provider: {
        name: PROVIDER_NAME,
        rank: PROVIDER_RANK,
        registered: providerControl !== undefined,
        // A disabled skill still occupies its name so no other provider can
        // serve it: the registry resolves duplicates by rank.
        masked: skills.filter((skill) => skill.enabled === false).length,
      },
      // Discovery truthfulness: `incomplete` means some root was truncated by a
      // budget or unreadable, so the UI must say the list may be partial.
      incomplete: catalog.complete !== true,
      stateError: loadError,
      staleDisabled,
      config: {
        values: {
          statePath: options.stateFile,
          defaultDir: options.defaultDir,
          maxDepth: options.maxDepth,
          watch: options.watch,
          packDetection: options.packDetection,
          maxDirectories: options.maxDirectories,
          maxSkills: options.maxSkills,
          skillDirs: [...options.configDirs],
        },
        warnings: [...options.warnings],
      },
      diagnostics: {
        scans: scanCount,
        cached: lastCollectCached,
      },
      dirs,
      skills,
      duplicates,
      invalid: catalog.invalid,
      counts: {
        dirs: dirs.length,
        skills: skills.length,
        enabled: skills.filter((skill) => skill.enabled).length,
        disabled: skills.filter((skill) => skill.enabled === false).length,
        invalid: catalog.invalid.length,
        duplicates: duplicates.length,
      },
    };
  }

  // --------------------------------------------------------------- endpoints

  /** Answer one endpoint of the browser channel. */
  async function handle(endpoint, payload) {
    const input = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    switch (endpoint) {
      case 'snapshot':
        return ok(await snapshot());

      case 'revision':
        // Cheap probe: the panel polls this and only refetches on a change.
        return ok({ revision });

      case 'addDir': {
        const picked = normalizeDirectory(input.path, input.cwd);
        if (picked === '') return fail('invalid-path', '请输入一个目录路径。');
        let stats;
        try {
          stats = await fs.promises.stat(picked);
        } catch {
          return fail('not-found', `目录不存在：${picked}`);
        }
        if (!stats.isDirectory()) return fail('not-a-directory', `不是一个目录：${picked}`);
        // Downward only: the picked directory is registered exactly as typed.
        // Nothing above it is scanned or registered, so adding a skill folder
        // never drags in its parent tree. Widening to an enclosing pack stays
        // an explicit action (`replaceWithPack`).
        const { added } = store.addDir(picked);
        refresh('directory added');
        return ok({
          added,
          path: picked,
          snapshot: await snapshot(),
        });
      }

      case 'replaceWithPack': {
        const directory = normalizeDirectory(input.path, input.cwd);
        if (directory === '') return fail('invalid-path', '缺少目录路径。');
        if (options.packDetection !== true) return fail('no-pack', '技能包识别已在插件配置里关闭（packDetection: false）。');
        if (options.configDirs.some((entry) => sameDirectory(entry, directory))) {
          return fail('from-config', '该目录来自插件配置 skillDirs，请修改配置而不是在这里替换。');
        }
        const root = await findPackRoot(directory);
        if (root === undefined || !(await isTrustworthyPack(root, directory))) {
          return fail('no-pack', '没有在上层找到包含更多技能的技能包。');
        }
        const scanned = await scanOne(root);
        if (scanned.skills.length < PACK_MIN_SKILLS) {
          return fail('no-pack', `上层目录 ${root} 里只找到 ${scanned.skills.length} 个技能，未替换。`);
        }
        // Add first, remove second: a failed persistence leaves the old
        // registration in place instead of losing it.
        const { added } = store.addDir(root);
        try {
          store.removeDir(directory);
        } catch (error) {
          try {
            store.removeDir(root);
          } catch {
            /* rollback is best effort */
          }
          return fail('internal', `替换目录失败，已保留原注册：${error.message}`);
        }
        refresh('directory replaced by its skill pack');
        return ok({ added, path: root, pack: { root, skills: scanned.skills.length }, snapshot: await snapshot() });
      }

      case 'removeDir': {
        const directory = normalizeDirectory(input.path, input.cwd);
        if (directory === '') return fail('invalid-path', '缺少目录路径。');
        if (options.configDirs.some((entry) => sameDirectory(entry, directory))) {
          return fail('from-config', '该目录来自插件配置 skillDirs，请修改配置而不是在这里移除。');
        }
        const { removed } = store.removeDir(directory);
        refresh('directory removed');
        return ok({ removed, snapshot: await snapshot() });
      }

      case 'setEnabled': {
        const skill = typeof input.name === 'string' ? input.name.trim() : '';
        if (skill === '') return fail('invalid-name', '缺少技能名称。');
        if (typeof input.enabled !== 'boolean') return fail('invalid-argument', 'enabled 必须是布尔值。');
        store.setEnabled(skill, input.enabled);
        refresh('skill toggled');
        return ok({ snapshot: await snapshot() });
      }

      case 'setAllEnabled': {
        if (typeof input.enabled !== 'boolean') return fail('invalid-argument', 'enabled 必须是布尔值。');
        // An optional `root` scopes the operation to one directory (one pack).
        const root = typeof input.root === 'string' && input.root.trim() !== ''
          ? normalizeDirectory(input.root)
          : undefined;
        const catalog = await collect();
        const names = catalog.skills
          .filter((skill) => skill.shadowedBy === undefined)
          .filter((skill) => root === undefined || sameDirectory(skill.root, root))
          .map((skill) => skill.name);
        store.setAllEnabled(names, input.enabled);
        refresh(root === undefined ? 'all skills toggled' : 'one pack toggled');
        return ok({ affected: names.length, snapshot: await snapshot() });
      }

      case 'ensureDefaultDir': {
        try {
          await fs.promises.mkdir(options.defaultDir, { recursive: true });
        } catch (error) {
          return fail('mkdir-failed', `无法创建默认技能目录：${error.message}`);
        }
        const { added } = store.addDir(options.defaultDir);
        refresh('default directory ensured');
        return ok({ added, path: options.defaultDir, snapshot: await snapshot() });
      }

      case 'refresh':
        refresh('ui refresh');
        return ok({ snapshot: await snapshot() });

      case 'pruneDisabled': {
        const catalog = await collect();
        const { removed } = store.pruneDisabled([...catalog.byName.keys()]);
        if (removed.length > 0) refresh('stale switches pruned');
        return ok({ removed, snapshot: await snapshot() });
      }

      case 'sessionSkills': {
        const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
        if (sessionId === '') return fail('invalid-session', '缺少会话 id。');
        const catalog = await collect();
        // Only globally enabled skills can be chosen for a session: a global
        // switch is a hard "not available", not a default.
        const skills = catalog.skills
          .filter((skill) => skill.shadowedBy === undefined && store.isDisabled(skill.name) === false)
          .map((skill) => ({
            name: skill.name,
            description: skill.description,
            root: skill.root,
            relative: skill.relative,
          }))
          .sort((left, right) => left.name.localeCompare(right.name));
        return ok({
          sessionId,
          excluded: store.sessionExclusions(sessionId),
          skills,
          canFilter: true,
        });
      }

      case 'setSessionSkills': {
        const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
        if (sessionId === '') return fail('invalid-session', '缺少会话 id。');
        if (!Array.isArray(input.excluded)) return fail('invalid-argument', 'excluded 必须是数组。');
        const catalog = await collect();
        const selectable = new Set(catalog.skills
          .filter((skill) => skill.shadowedBy === undefined && store.isDisabled(skill.name) === false)
          .map((skill) => skill.name));
        const requested = input.excluded.filter((name) => typeof name === 'string');
        const accepted = requested.filter((name) => selectable.has(name));
        const ignored = requested.filter((name) => selectable.has(name) === false);
        store.setSessionExclusions(sessionId, accepted);
        // The registry caches a collected catalog per scope: drop it so the next
        // step re-reads this provider with the new exclusion set.
        try {
          providerControl?.invalidate();
        } catch (error) {
          logger.warn(`session selection invalidation failed: ${error.message}`);
        }
        return ok({
          sessionId,
          excluded: store.sessionExclusions(sessionId),
          ignored,
          canFilter: true,
        });
      }

      default:
        return fail('unknown-endpoint', `未知操作：${endpoint}`);
    }
  }

  /** Run one endpoint, converting internal failures into the wire envelope. */
  async function dispatch(endpoint, payload) {
    try {
      return await handle(endpoint, payload);
    } catch (error) {
      logger.warn(`endpoint ${endpoint} failed: ${error?.stack ?? error}`);
      return fail('internal', `技能管理服务执行失败：${error?.message ?? String(error)}`);
    }
  }

  // ------------------------------------------------------- browser transport
  //
  // Two transports share `dispatch`:
  //
  //   1. Preferred: exact `POST /api/skill-market/<name>` routes registered on
  //      Connection's Fetch registry. The framework's `/api` bridge already
  //      fenced the request with `connection.admit()` (trust + browser session)
  //      and tracks the Peer, so no manual admission is needed and no raw
  //      IncomingMessage events are involved.
  //   2. Legacy: a `/skill-market/<name>` prefix route on the web server, kept
  //      only for a page that still runs the previous client bundle. It fences
  //      with `connection.admit()` itself and must never tie request lifetime to
  //      the scan: a normal request emits `close` when its body ends.

  /**
   * Read a request body as text, settling exactly once.
   *
   * @param req - the Node request.
   * @returns the decoded body text (empty string for no body).
   */
  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let settled = false;
      let ended = false;
      const cleanup = () => {
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
        req.off('close', onClose);
        req.off('aborted', onClose);
      };
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };
      const onData = (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          finish(reject, new Error('request body too large'));
          return;
        }
        chunks.push(chunk);
      };
      const onEnd = () => {
        ended = true;
        finish(resolve, Buffer.concat(chunks).toString('utf8'));
      };
      const onError = (error) => finish(reject, error);
      const onClose = () => {
        if (!ended) finish(reject, new Error('request closed before its body was read'));
      };
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
      req.on('close', onClose);
      req.on('aborted', onClose);
    });
  }

  /** Extract the endpoint segment from a channel-prefixed pathname. */
  function endpointOf(pathname, channel) {
    if (!pathname.startsWith(`${channel}/`)) return undefined;
    const endpoint = pathname.slice(channel.length + 1);
    if (endpoint.includes('/')) return undefined;
    return /^[A-Za-z0-9_$.-]+$/.test(endpoint) ? endpoint : undefined;
  }

  /** Decode a JSON body text into the payload object, or throw a coded error. */
  function parsePayload(text) {
    const trimmed = text.trim();
    if (trimmed === '') return {};
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw Object.assign(new Error(`请求体不是 JSON：${error.message}`), { code: 'bad-request', status: 400 });
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw Object.assign(new Error('请求体必须是 JSON 对象'), { code: 'bad-request', status: 400 });
    }
    return parsed;
  }

  /** Exact Fetch-registry route handler. */
  async function fetchRoute(endpoint, request) {
    try {
      const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
      if (!contentType.includes('application/json')) {
        return jsonResponse(415, fail('unsupported-media-type', '请求必须是 application/json'));
      }
      const text = await request.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
        return jsonResponse(413, fail('body-too-large', `请求体超过 ${MAX_BODY_BYTES} 字节`));
      }
      let payload;
      try {
        payload = parsePayload(text);
      } catch (error) {
        return jsonResponse(error.status ?? 400, fail(error.code ?? 'bad-request', error.message));
      }
      return jsonResponse(200, await dispatch(endpoint, payload));
    } catch (error) {
      logger.warn(`/api endpoint ${endpoint} failed: ${error?.stack ?? error}`);
      return jsonResponse(500, fail('internal', `技能管理服务执行失败：${error?.message ?? String(error)}`));
    }
  }

  /** Legacy prefix-route handler for pages from an older client bundle. */
  function legacyRoute(webCtx, req, res) {
    const reply = (status, envelope) => {
      if (res.writableEnded) return;
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(envelope));
    };
    return (async () => {
      try {
        const admission = webCtx.connection.admit(req);
        if ('rejection' in admission) {
          if (res.writableEnded) return;
          res.writeHead(admission.rejection, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden');
          return;
        }
        let pathname;
        try {
          pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        } catch {
          reply(400, fail('bad-request', '请求路径无效'));
          return;
        }
        const endpoint = endpointOf(pathname, CHANNEL);
        if (endpoint === undefined || req.method !== 'POST') {
          reply(405, fail('method-not-allowed', '只接受 POST /skill-market/<endpoint>'));
          return;
        }
        const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
        if (!contentType.includes('application/json')) {
          reply(415, fail('unsupported-media-type', '请求必须是 application/json'));
          return;
        }
        let text;
        try {
          text = await readJsonBody(req);
        } catch (error) {
          if (/too large/.test(error.message)) reply(413, fail('body-too-large', `请求体超过 ${MAX_BODY_BYTES} 字节`));
          else reply(400, fail('bad-request', error.message));
          return;
        }
        let payload;
        try {
          payload = parsePayload(text);
        } catch (error) {
          reply(error.status ?? 400, fail(error.code ?? 'bad-request', error.message));
          return;
        }
        reply(200, await dispatch(endpoint, payload));
      } catch (error) {
        logger.warn(`legacy channel failed: ${error?.stack ?? error}`);
        reply(500, fail('internal', `技能管理服务执行失败：${error?.message ?? String(error)}`));
      }
    })();
  }

  // Preferred transport: the framework's authenticated exact-route registry.
  ctx.inject(['connection'], (connectionCtx) => {
    const registry = connectionCtx.connection?.fetch;
    if (registry === undefined || typeof registry.register !== 'function') {
      logger.debug?.('connection.fetch is unavailable; using the legacy browser route');
      return;
    }
    try {
      for (const endpoint of ENDPOINTS) {
        connectionCtx.effect(
          () => registry.register({
            path: `${API_CHANNEL}/${endpoint}`,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: (request) => fetchRoute(endpoint, request),
          }),
          `skill-market: ${API_CHANNEL}/${endpoint}`,
        );
      }
      transportMode = 'fetch';
    } catch (error) {
      logger.warn(`cannot register /api routes: ${error.message}`);
      transportMode = 'none';
    }
  });

  // Legacy transport: prefix route for the previous client bundle.
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'prefix',
        path: CHANNEL,
        handler: (req, res) => legacyRoute(webCtx, req, res),
      }),
      'skill-market: legacy browser route',
    );
    if (transportMode === 'none') transportMode = 'web';
  });

  syncWatchers();
  logger.info?.(`skill-market ready: state=${options.stateFile}, roots=${allRoots().length}`);
}
