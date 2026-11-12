/**
 * Durable registry for the local skill manager.
 *
 * The plugin owns one small JSON document: the directories the user registered
 * and the skill names the user switched off. It lives under the Harness home
 * (`$DSH_HOME/skill-market/registry.json` by default) so it survives profile
 * restarts and is independent of the Cordis patch layer, which the UI never
 * rewrites.
 *
 * Durability rules:
 *   - a malformed or wrong-shaped document never replaces live state; the
 *     failure surfaces through `loadError` and the snapshot instead;
 *   - a write is persisted (temporary file, fsync, rename) before the new state
 *     is committed to memory, so a failed write leaves memory untouched.
 *
 * @module skill-market/lib/store
 */

import fs from 'node:fs';
import path from 'node:path';

const FORMAT_VERSION = 1;

/** Normalize a user-supplied path into an absolute, comparable form. */
export function normalizeDirectory(input, cwd = process.cwd()) {
  let value = String(input ?? '').trim();
  if (value === '') return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
    if (home !== '') value = path.join(home, value.slice(1));
  }
  const resolved = path.resolve(cwd, value);
  return resolved.endsWith(path.sep) && resolved.length > path.parse(resolved).root.length
    ? resolved.slice(0, -1)
    : resolved;
}

/** Compare two registered directories. */
export function sameDirectory(left, right) {
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

/** Keep the newest N per-session selections; older sessions fall back to "all". */
const MAX_SESSIONS = 200;

/**
 * Normalize the per-session exclusion table.
 *
 * Malformed entries are dropped rather than rejected: a bad session record must
 * never cost the user their directory list or global switches.
 *
 * @param raw - the decoded `sessions` value.
 * @returns the sanitized table.
 */
function normalizeSessions(raw) {
  const sessions = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return sessions;
  for (const [key, value] of Object.entries(raw)) {
    if (key === '' || value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const excluded = Array.isArray(value.excluded)
      ? [...new Set(value.excluded.filter((entry) => typeof entry === 'string' && entry.trim() !== ''))]
      : [];
    if (excluded.length === 0) continue;
    sessions[key] = {
      excluded,
      updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
    };
  }
  const entries = Object.entries(sessions);
  if (entries.length <= MAX_SESSIONS) return sessions;
  entries.sort((left, right) => right[1].updatedAt - left[1].updatedAt);
  return Object.fromEntries(entries.slice(0, MAX_SESSIONS));
}

/**
 * Validate one decoded registry document.
 *
 * @param parsed - the JSON value read from disk.
 * @returns the normalized document, or an error string.
 */
function validateDocument(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'registry document must be a JSON object' };
  }
  if (parsed.version !== undefined && parsed.version !== FORMAT_VERSION) {
    return { error: `unsupported registry version ${JSON.stringify(parsed.version)}` };
  }
  if (parsed.dirs !== undefined && !Array.isArray(parsed.dirs)) {
    return { error: 'registry `dirs` must be an array' };
  }
  if (parsed.disabled !== undefined && !Array.isArray(parsed.disabled)) {
    return { error: 'registry `disabled` must be an array' };
  }
  const dirs = (parsed.dirs ?? []).filter((entry) => typeof entry === 'string' && entry.trim() !== '');
  const disabled = (parsed.disabled ?? []).filter((entry) => typeof entry === 'string' && entry.trim() !== '');
  return {
    data: {
      version: FORMAT_VERSION,
      dirs: [...new Set(dirs)],
      disabled: [...new Set(disabled)],
      sessions: normalizeSessions(parsed.sessions),
    },
  };
}

export class SkillMarketStore {
  /** @type {string} */
  #file;
  /** @type {{ version: number, dirs: string[], disabled: string[], sessions: Record<string, { excluded: string[], updatedAt: number }> }} */
  #data = { version: FORMAT_VERSION, dirs: [], disabled: [], sessions: {} };
  /** @type {{ info: Function, warn: Function }} */
  #logger;
  /** @type {string | undefined} Last load diagnostic (kept until a good load). */
  #loadError;

  /**
   * @param options - the registry file path and an optional logger.
   * @param options.file - absolute path of the JSON registry.
   * @param options.logger - Cordis logger used for diagnostics.
   */
  constructor({ file, logger }) {
    this.#file = file;
    this.#logger = logger ?? { info() {}, warn() {} };
  }

  /** The absolute path of the registry file. */
  get file() {
    return this.#file;
  }

  /** The last load diagnostic, or undefined when the document was usable. */
  get loadError() {
    return this.#loadError;
  }

  /** Registered directories in priority order. */
  get dirs() {
    return [...this.#data.dirs];
  }

  /** Switched-off skill names. */
  get disabled() {
    return [...this.#data.disabled];
  }

  /** Whether a skill name is switched off. */
  isDisabled(name) {
    return this.#data.disabled.includes(name);
  }

  /** Read the registry from disk, keeping the previous state on failure. */
  load() {
    let raw;
    try {
      raw = fs.readFileSync(this.#file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.#loadError = `cannot read registry: ${error.message}`;
        this.#logger.warn(`${this.#loadError} (${this.#file})`);
      } else {
        this.#loadError = undefined;
      }
      return this.snapshot();
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.#loadError = `registry is not valid JSON: ${error.message}`;
      this.#logger.warn(`${this.#loadError} (${this.#file})`);
      return this.snapshot();
    }
    const validated = validateDocument(parsed);
    if (validated.error !== undefined) {
      this.#loadError = validated.error;
      this.#logger.warn(`ignoring registry: ${validated.error} (${this.#file})`);
      return this.snapshot();
    }
    this.#data = validated.data;
    this.#loadError = undefined;
    return this.snapshot();
  }

  /**
   * Persist a candidate document, then commit it to memory.
   *
   * @param next - the complete next document.
   * @returns the committed snapshot.
   */
  save(next = this.#data) {
    const directory = path.dirname(this.#file);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${this.#file}.${process.pid}.tmp`;
    const handle = fs.openSync(temporary, 'w');
    try {
      fs.writeFileSync(handle, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    try {
      fs.renameSync(temporary, this.#file);
    } catch (error) {
      try {
        fs.unlinkSync(temporary);
      } catch {
        /* best effort */
      }
      throw error;
    }
    this.#data = {
      version: FORMAT_VERSION,
      dirs: [...next.dirs],
      disabled: [...next.disabled],
      sessions: normalizeSessions(next.sessions),
    };
    this.#loadError = undefined;
    return this.snapshot();
  }

  /** A plain copy of the registry state. */
  snapshot() {
    const sessions = {};
    for (const [key, value] of Object.entries(this.#data.sessions)) {
      sessions[key] = { excluded: [...value.excluded], updatedAt: value.updatedAt };
    }
    return {
      version: this.#data.version,
      dirs: [...this.#data.dirs],
      disabled: [...this.#data.disabled],
      sessions,
    };
  }

  /**
   * Skills excluded from one session's catalog.
   *
   * @param sessionId - the session id the agent reports.
   * @returns the excluded names (empty when the session loads everything).
   */
  sessionExclusions(sessionId) {
    const entry = this.#data.sessions[sessionId];
    return entry === undefined ? [] : [...entry.excluded];
  }

  /**
   * Replace one session's exclusions.
   *
   * @param sessionId - the session id the agent reports.
   * @param names - excluded skill names; an empty list removes the entry.
   * @returns the committed snapshot.
   */
  setSessionExclusions(sessionId, names) {
    const excluded = [...new Set((Array.isArray(names) ? names : [])
      .filter((name) => typeof name === 'string' && name.trim() !== ''))];
    const sessions = { ...this.#data.sessions };
    if (excluded.length === 0) delete sessions[sessionId];
    else sessions[sessionId] = { excluded, updatedAt: Date.now() };
    return this.save({ ...this.#data, sessions });
  }

  /**
   * Register a directory.
   *
   * @param directory - the normalized absolute directory.
   * @returns the new state and whether the directory was added.
   */
  addDir(directory) {
    if (this.#data.dirs.some((entry) => sameDirectory(entry, directory))) {
      return { added: false, state: this.snapshot() };
    }
    const next = { ...this.#data, dirs: [...this.#data.dirs, directory] };
    return { added: true, state: this.save(next) };
  }

  /**
   * Unregister a directory. The directory itself is never touched.
   *
   * @param directory - the normalized absolute directory.
   * @returns the new state and whether the directory was removed.
   */
  removeDir(directory) {
    const dirs = this.#data.dirs.filter((entry) => !sameDirectory(entry, directory));
    if (dirs.length === this.#data.dirs.length) return { removed: false, state: this.snapshot() };
    return { removed: true, state: this.save({ ...this.#data, dirs }) };
  }

  /**
   * Switch one skill on or off.
   *
   * @param name - the skill name.
   * @param enabled - whether the skill should load.
   * @returns the new state and whether it changed.
   */
  setEnabled(name, enabled) {
    const disabled = this.#data.disabled.filter((entry) => entry !== name);
    if (enabled === false) disabled.push(name);
    const changed = disabled.length !== this.#data.disabled.length
      || disabled.some((entry, index) => entry !== this.#data.disabled[index]);
    if (!changed) return { changed: false, state: this.snapshot() };
    return { changed: true, state: this.save({ ...this.#data, disabled }) };
  }

  /**
   * Switch every named skill on or off at once.
   *
   * @param names - the skill names to change.
   * @param enabled - whether those skills should load.
   * @returns the new state.
   */
  setAllEnabled(names, enabled) {
    const wanted = new Set(names);
    const keep = this.#data.disabled.filter((entry) => !wanted.has(entry));
    const disabled = enabled ? keep : [...new Set([...keep, ...wanted])];
    return this.save({ ...this.#data, disabled });
  }

  /**
   * Drop switched-off names that no longer exist in the catalog.
   *
   * @param knownNames - every skill name currently discoverable.
   * @returns the removed names and the new state.
   */
  pruneDisabled(knownNames) {
    const known = new Set(knownNames);
    const removed = this.#data.disabled.filter((entry) => !known.has(entry));
    if (removed.length === 0) return { removed, state: this.snapshot() };
    const disabled = this.#data.disabled.filter((entry) => known.has(entry));
    return { removed, state: this.save({ ...this.#data, disabled }) };
  }
}
