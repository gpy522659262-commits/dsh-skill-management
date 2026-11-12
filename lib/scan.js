/**
 * Recursive skill discovery for one registered root directory.
 *
 * DSH's shipped filesystem provider is deliberately one level deep: it sees
 * `<root>/<name>/SKILL.md` and `<root>/<name>.md` only. Real skill packs are
 * usually shipped as a repository or plugin with categories in between
 * (`skills/engineering/tdd/SKILL.md`), so this scanner walks a bounded tree and
 * treats any directory holding a `SKILL.md` as one skill bundle, plus the flat
 * `<name>.md` files at the root itself.
 *
 * It never throws for a broken entry: an unreadable or malformed skill becomes
 * an `invalid` record that the manager UI shows with its reason, so a bad file
 * cannot hide the rest of the pack.
 *
 * @module skill-market/lib/scan
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { readDeclaredName, readSkillMetadata, SKILL_NAME_PATTERN } from './frontmatter.js';

/** Directory names never descended into. */
export const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '.hg', '.svn']);

/** Directory markers that identify a skill-pack root. */
const PACK_MARKERS = ['skills', '.claude-plugin'];

const SKILL_FILE = 'SKILL.md';

/** Default recursion depth for one registered root. */
const DEFAULT_MAX_DEPTH = 8;

/** Immediate subdirectories a flat pack may hold before it stops looking tidy. */
const MAX_FLAT_PACK_DIRECTORIES = 64;

/** Whether a directory entry should be skipped during the walk. */
function skipDirectory(name) {
  return IGNORED_DIRECTORIES.has(name) || name.startsWith('.');
}

/**
 * Decide whether a filesystem watch event can change the skill catalog.
 *
 * A recursive watcher sees every edit below a registered root, including
 * `references/`, `scripts/`, and VCS noise. Only structural events and
 * `SKILL.md` changes can change the catalog, so everything else is filtered
 * before it triggers a rescan and a model-facing catalog replacement.
 *
 * @param eventType - the `fs.watch` event type ('rename' | 'change' | ...).
 * @param filename - the path reported by the watcher, relative to the root.
 * @returns whether the catalog should be refreshed. Unknown paths are treated
 *   as relevant (better a redundant refresh than a stale catalog).
 */
export function isRelevantWatchEvent(eventType, filename) {
  if (filename === null || filename === undefined) return true;
  const normalized = String(filename).split(path.sep).join('/');
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (basename === SKILL_FILE) return true;
  // A direct child of a registered root is a flat skill file or a bundle
  // directory; both are structural.
  if (!normalized.includes('/')) return true;
  // Deeper structural changes (a skill directory added, removed, or renamed)
  // arrive as 'rename'; plain edits below a bundle are resources.
  return eventType === 'rename';
}

/** Read one candidate file into a skill or invalid record. */
async function readCandidate(file, context, { tolerant = false, requireNameMatch = false } = {}) {
  const relative = path.relative(context.root, file).split(path.sep).join('/');
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    return { invalid: { path: file, root: context.root, relative, error: `cannot read file: ${error.message}` } };
  }
  const parsed = readSkillMetadata(raw, file);
  const kind = path.basename(file) === SKILL_FILE ? 'bundle' : 'flat';
  if (requireNameMatch && kind === 'flat') {
    const stem = path.basename(file, '.md');
    // Only a kebab-case file name can be a flat skill claim (README.md cannot).
    if (!SKILL_NAME_PATTERN.test(stem)) return {};
    // A repository README with frontmatter is not a skill claim: a flat skill
    // file must be named after the skill it declares, even when the rest of the
    // document fails validation (e.g. it has no description).
    const declared = parsed.error !== undefined ? readDeclaredName(raw) : parsed.name;
    if (declared !== undefined && declared !== stem) return {};
  }
  if (parsed.error !== undefined) {
    // A plain markdown file beside unrelated docs (CHANGELOG.md, NOTES.md) is
    // not a broken skill, so a missing frontmatter block is not reported.
    if (tolerant && /has no YAML frontmatter block$/.test(parsed.error)) return {};
    return { invalid: { path: file, root: context.root, relative, error: parsed.error } };
  }
  return {
    skill: {
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
      invocation: parsed.invocation,
      ...(parsed.metadata === undefined ? {} : { metadata: parsed.metadata }),
      path: file,
      directory: path.dirname(file),
      root: context.root,
      relative,
      kind,
    },
  };
}

/**
 * Walk one directory tree collecting skill bundles.
 *
 * @param directory - the absolute directory to scan.
 * @param depth - current depth below the registered root.
 * @param context - shared scan state (`root`, limits, results, visited set).
 * @returns a promise resolving when the subtree is scanned.
 */
async function walk(directory, depth, context) {
  if (context.signal?.aborted === true) {
    context.truncated = true;
    return;
  }
  if (context.skills.length + context.invalid.length >= context.maxSkills) {
    context.truncated = true;
    return;
  }
  let real;
  try {
    real = await fs.realpath(directory);
  } catch {
    return;
  }
  if (context.visited.has(real)) return;
  context.visited.add(real);

  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (depth === 0) context.error = `cannot list directory: ${error.message}`;
    return;
  }
  context.directories += 1;

  // A directory holding SKILL.md is one bundle; its subdirectories are
  // resources (references/, scripts/, assets/) and are not scanned. A symlinked
  // SKILL.md counts as the same claim.
  const skillEntry = entries.find((entry) => entry.name === SKILL_FILE && (entry.isFile() || entry.isSymbolicLink()));
  if (skillEntry !== undefined) {
    const result = await readCandidate(path.join(directory, SKILL_FILE), context);
    if (result.skill !== undefined) context.skills.push(result.skill);
    else if (result.invalid !== undefined) context.invalid.push(result.invalid);
    return;
  }

  if (depth === 0) {
    for (const entry of entries) {
      if (!entry.name.toLowerCase().endsWith('.md')) continue;
      if (entry.name === SKILL_FILE) continue;
      if (!(entry.isFile() || entry.isSymbolicLink())) continue;
      const result = await readCandidate(path.join(directory, entry.name), context, {
        tolerant: true,
        requireNameMatch: true,
      });
      if (result.skill !== undefined) context.skills.push(result.skill);
      else if (result.invalid !== undefined) context.invalid.push(result.invalid);
    }
  }

  const childDirectories = [];
  for (const entry of entries) {
    if (entry.isDirectory() && !skipDirectory(entry.name)) childDirectories.push(entry.name);
    else if (entry.isSymbolicLink() && !skipDirectory(entry.name)) childDirectories.push(entry.name);
  }
  childDirectories.sort();
  if (childDirectories.length > 0 && context.directories >= context.maxDirectories) {
    context.truncated = true;
    return;
  }
  if (depth >= context.maxDepth) {
    if (childDirectories.length > 0) context.truncated = true;
    return;
  }
  for (const name of childDirectories) {
    await walk(path.join(directory, name), depth + 1, context);
  }
}

/**
 * Whether a directory carries a strong pack marker.
 *
 * @param directory - the absolute directory to test.
 * @returns whether a `skills/` subtree or a plugin manifest sits here.
 */
export async function hasPackMarker(directory) {
  for (const marker of PACK_MARKERS) {
    try {
      if ((await fs.stat(path.join(directory, marker))).isDirectory()) return true;
    } catch {
      /* marker absent */
    }
  }
  return false;
}

/**
 * Whether a directory groups at least two skills directly below it.
 *
 * This is the weaker signal: a category folder inside a pack and a flat pack
 * root look the same, so it is only used for the folder a picked skill sits in.
 * The bounded directory count keeps a broad scratch directory (a temp folder
 * with hundreds of children) from passing as a tidy flat pack.
 *
 * @param directory - the absolute directory to test.
 * @returns whether two immediate subdirectories each hold a `SKILL.md`.
 */
export async function looksLikeFlatPack(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return false;
  }
  const directories = entries.filter((entry) => entry.isDirectory() && !skipDirectory(entry.name));
  if (directories.length < 2 || directories.length > MAX_FLAT_PACK_DIRECTORIES) return false;
  let withSkill = 0;
  for (const entry of directories) {
    try {
      if ((await fs.stat(path.join(directory, entry.name, SKILL_FILE))).isFile()) withSkill += 1;
    } catch {
      /* not a skill directory */
    }
    if (withSkill >= 2) return true;
  }
  return false;
}

/**
 * Whether a directory looks like the root of a multi-skill pack.
 *
 * @param directory - the absolute directory to test.
 * @returns whether the directory is a plausible pack root.
 */
export async function looksLikePackRoot(directory) {
  return (await hasPackMarker(directory)) || looksLikeFlatPack(directory);
}

/**
 * Find the nearest ancestor directory that looks like a skill-pack root.
 *
 * A `skills/` subtree or a plugin manifest wins over the weaker "two skills
 * side by side" shape, so pointing at one skill inside
 * `<pack>/skills/<category>/<skill>` resolves to `<pack>` rather than to the
 * category folder that happens to hold several skills. Without a marker, only
 * the folder the skill sits in can be that flat pack.
 *
 * @param directory - the absolute directory to start from.
 * @param options - `maxLevels` bounds how far up the tree is inspected.
 * @returns the pack root, or undefined when no ancestor looks like one.
 */
export async function findPackRoot(directory, options = {}) {
  const maxLevels = Number.isInteger(options.maxLevels) ? Math.max(1, options.maxLevels) : 6;
  const start = path.dirname(path.resolve(directory));
  let current = start;
  for (let level = 0; level < maxLevels; level += 1) {
    if (await hasPackMarker(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (await looksLikeFlatPack(start)) return start;
  return undefined;
}

/**
 * Discover every skill below one registered directory.
 *
 * @param root - the absolute registered directory.
 * @param options - scan limits and an optional abort signal.
 * @param options.maxDepth - deepest directory level searched (default 8).
 * @param options.maxDirectories - directory budget per root (default 4000).
 * @param options.maxSkills - skill budget per root (default 500).
 * @param options.signal - cancels the scan between directories.
 * @returns discovered skills, malformed entries, and root-level diagnostics.
 */
export async function scanRoot(root, options = {}) {
  const context = {
    root,
    maxDepth: Number.isInteger(options.maxDepth) ? Math.max(0, options.maxDepth) : DEFAULT_MAX_DEPTH,
    maxDirectories: Number.isInteger(options.maxDirectories) ? options.maxDirectories : 4000,
    maxSkills: Number.isInteger(options.maxSkills) ? options.maxSkills : 500,
    signal: options.signal,
    skills: [],
    invalid: [],
    directories: 0,
    visited: new Set(),
    truncated: false,
    error: undefined,
  };

  let stats;
  try {
    stats = await fs.stat(root);
  } catch {
    return { root, exists: false, skills: [], invalid: [], truncated: false, error: 'directory does not exist' };
  }
  if (!stats.isDirectory()) {
    return { root, exists: false, skills: [], invalid: [], truncated: false, error: 'path is not a directory' };
  }
  if (options.signal?.aborted === true) {
    return { root, exists: true, skills: [], invalid: [], truncated: true, error: 'cancelled' };
  }

  await walk(root, 0, context);
  context.skills.sort((left, right) => left.name.localeCompare(right.name) || left.relative.localeCompare(right.relative));
  context.invalid.sort((left, right) => left.relative.localeCompare(right.relative));
  return {
    root,
    exists: true,
    skills: context.skills,
    invalid: context.invalid,
    truncated: context.truncated,
    ...(context.error === undefined ? {} : { error: context.error }),
  };
}

/**
 * Discover skills across every registered directory.
 *
 * Every root yields exactly one result, in the given order: roots skipped after
 * an abort get a synthetic truncated result so callers can keep result and root
 * aligned by index.
 *
 * @param roots - absolute registered directories, in priority order.
 * @param options - scan limits, an optional abort signal, and the root check.
 * @param options.signal - cancels between roots.
 * @returns one result per root, in the given order.
 */
export async function scanRoots(roots, options = {}) {
  const results = [];
  for (const root of roots) {
    if (options.signal?.aborted === true) {
      results.push({ root, exists: false, skills: [], invalid: [], truncated: true, error: 'cancelled' });
      continue;
    }
    results.push(await scanRoot(root, options));
  }
  return results;
}

/**
 * Merge per-root scan results into the manager's catalog.
 *
 * Earlier roots win a duplicate name, matching the provider order the skill
 * registry uses; a later entry with the same name is reported as shadowed so
 * the UI can say why it is not the one that loads.
 *
 * @param results - the per-root results from {@link scanRoots}.
 * @returns the ordered skills and malformed entries with shadowing resolved.
 */
export function mergeCatalog(results) {
  const byName = new Map();
  const skills = [];
  for (const result of results) {
    for (const skill of result.skills) {
      const owner = byName.get(skill.name);
      if (owner !== undefined) {
        skills.push({ ...skill, shadowedBy: owner.path });
        continue;
      }
      const entry = { ...skill, shadowedBy: undefined };
      byName.set(skill.name, entry);
      skills.push(entry);
    }
  }
  const invalid = results.flatMap((result) => result.invalid);
  return { skills, invalid, byName };
}
