/**
 * Minimal YAML-frontmatter reader for skill files.
 *
 * DSH's shipped filesystem provider parses `SKILL.md` frontmatter with a full
 * YAML library. A workspace plugin cannot import that library (the profile owns
 * no dependency tree, so only `node:` builtins resolve), so this module
 * implements the subset a skill frontmatter actually uses:
 *
 *   - top-level `key: value` scalars (plain, single-quoted, double-quoted)
 *   - block scalars (`|`, `|-`, `>`, `>-`) for multi-line descriptions
 *   - one level of nesting under a key with an empty value (e.g. `metadata:`)
 *   - `#` comments outside quotes
 *
 * Anything it cannot represent is ignored rather than guessed, and every
 * validation failure returns an error string so the caller can drop the skill
 * with a warning instead of loading a half-parsed one.
 *
 * @module skill-market/lib/frontmatter
 */

/** Public skill-name grammar, identical to the skill registry's. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const BOOLEAN_TRUE = new Set(['true', 'yes', 'on', '1']);
const BOOLEAN_FALSE = new Set(['false', 'no', 'off', '0']);
const KEY_LINE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]*:[ \t]*(.*)$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Split a skill file into its raw frontmatter text and its instruction body.
 *
 * Editors on Windows often save "UTF-8 with BOM"; a BOM would otherwise defeat
 * the `^---` anchor and hide an otherwise valid skill. A UTF-16 BOM is reported
 * explicitly because it cannot be decoded as UTF-8 at all.
 *
 * @param raw - the complete file text.
 * @returns the frontmatter source and the body, or an error when the file has
 *   no frontmatter block at all.
 */
export function splitFrontmatter(raw) {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  if (text.startsWith('\uFFFD') && text.length > 1 && /[\u0000-\u001F]/.test(text.slice(1, 3))) {
    // Decoded UTF-16 bytes surface as replacement characters plus control bytes.
    return { error: 'file is not UTF-8 text (UTF-16 BOM?)' };
  }
  const decoded = text.replace(/^\uFEFF/, '');
  const match = FRONTMATTER.exec(decoded);
  if (match === null) return { error: 'file has no YAML frontmatter block' };
  return { yaml: match[1], body: decoded.slice(match[0].length) };
}

/**
 * Read the declared skill name from a file's frontmatter, even when the rest of
 * the document fails validation.
 *
 * Flat `<name>.md` candidates use this to tell a skill file from an unrelated
 * markdown document that happens to carry frontmatter (a repository README).
 *
 * @param raw - the complete file text.
 * @returns the declared name, or undefined when there is none.
 */
export function readDeclaredName(raw) {
  const text = (typeof raw === 'string' ? raw : String(raw ?? '')).replace(/^\uFEFF/, '');
  const match = FRONTMATTER.exec(text);
  if (match === null) return undefined;
  const data = parseYamlSubset(match[1]);
  return typeof data.name === 'string' && data.name.trim() !== '' ? data.name.trim() : undefined;
}

/**
 * Resolve the strict boolean grammar the skill registry documents: YAML
 * booleans plus the case-insensitive `true`/`false`, `yes`/`no`, `on`/`off`,
 * and `1`/`0` forms.
 *
 * @param raw - the raw scalar text.
 * @returns the boolean, or `undefined` when the spelling is not accepted.
 */
export function parseStrictBoolean(raw) {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  if (BOOLEAN_TRUE.has(value)) return true;
  if (BOOLEAN_FALSE.has(value)) return false;
  return undefined;
}

/**
 * Strip a trailing `#` comment from an unquoted scalar.
 *
 * @param text - the scalar text.
 * @returns the text without its comment.
 */
function stripComment(text) {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '#') continue;
    if (index === 0 || /\s/.test(text[index - 1])) return text.slice(0, index);
  }
  return text;
}

/**
 * Find the closing quote of a quoted scalar, honoring YAML escapes.
 *
 * @param text - the trimmed scalar beginning with a quote character.
 * @param quote - the opening quote character.
 * @returns the index of the closing quote, or -1 when the scalar is unterminated.
 */
function findClosingQuote(text, quote) {
  for (let index = 1; index < text.length; index += 1) {
    const character = text[index];
    if (quote === '"' && character === '\\') {
      index += 1;
      continue;
    }
    if (character !== quote) continue;
    if (quote === "'" && text[index + 1] === "'") {
      index += 1;
      continue;
    }
    return index;
  }
  return -1;
}

/**
 * Decode a double-quoted YAML scalar, including its common escapes.
 *
 * @param text - the scalar body without its surrounding quotes.
 * @returns the decoded string.
 */
function decodeDoubleQuoted(text) {
  return text.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (match, escape) => {
    switch (escape[0]) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case '0': return '\0';
      case '\\': return '\\';
      case '"': return '"';
      case '/': return '/';
      default:
        if (escape[0] === 'u' || escape[0] === 'x') {
          const code = Number.parseInt(escape.slice(1), 16);
          return Number.isNaN(code) ? match : String.fromCodePoint(code);
        }
        return escape;
    }
  });
}

/**
 * Decode one scalar value, dropping a trailing comment that sits outside quotes.
 *
 * @param text - the raw text after the key.
 * @returns the decoded scalar string.
 */
function decodeScalar(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0];
    const end = findClosingQuote(trimmed, quote);
    if (end === -1) return trimmed.slice(1);
    const body = trimmed.slice(1, end);
    return quote === '"' ? decodeDoubleQuoted(body) : body.replace(/''/g, "'");
  }
  return stripComment(trimmed).trim();
}

/** Whether a line is blank or a comment. */
function isSkippable(line) {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

/** Count a line's leading whitespace. */
function indentOf(line) {
  return /^\s*/.exec(line)[0].length;
}

/**
 * Parse a block scalar (`|` or `>`) starting at `start`.
 *
 * @param lines - all frontmatter lines.
 * @param start - index of the line holding the block indicator.
 * @param indicator - the raw indicator text.
 * @returns the block text and the index of the first line after the block.
 */
function readBlockScalar(lines, start, indicator) {
  const folded = indicator.startsWith('>');
  const chomp = indicator.includes('-') ? 'strip' : indicator.includes('+') ? 'keep' : 'clip';
  const collected = [];
  let cursor = start + 1;
  let blockIndent;
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line.trim() === '') {
      collected.push('');
      continue;
    }
    const indent = indentOf(line);
    if (indent === 0) break;
    blockIndent ??= indent;
    if (indent < blockIndent) break;
    collected.push(line.slice(blockIndent));
  }
  let text = folded ? collected.join(' ') : collected.join('\n');
  if (chomp === 'strip') text = text.replace(/\n+$/, '');
  else if (text !== '') text = `${text.replace(/\n+$/, '')}\n`;
  return { text, next: cursor };
}

/**
 * Parse the frontmatter subset into a plain object.
 *
 * @param yaml - the frontmatter source without its `---` fences.
 * @returns the parsed top-level keys.
 */
export function parseYamlSubset(yaml) {
  const lines = yaml.split(/\r?\n/);
  const data = {};
  let cursor = 0;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (isSkippable(line)) {
      cursor += 1;
      continue;
    }
    if (indentOf(line) !== 0) {
      cursor += 1;
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (match === null) {
      cursor += 1;
      continue;
    }
    const key = match[1];
    const rest = match[2];
    const indicator = rest.trim();
    if (/^[|>][+-]?\d*$/.test(indicator)) {
      const block = readBlockScalar(lines, cursor, indicator);
      data[key] = block.text;
      cursor = block.next;
      continue;
    }
    if (indicator === '') {
      // Either a nested mapping or an empty value: read the indented lines.
      const nested = {};
      let sawNested = false;
      let plainContinuation = '';
      let lookahead = cursor + 1;
      for (; lookahead < lines.length; lookahead += 1) {
        const child = lines[lookahead];
        if (child.trim() === '') continue;
        if (indentOf(child) === 0) break;
        const childMatch = KEY_LINE.exec(child.trim());
        if (childMatch !== null) {
          sawNested = true;
          nested[childMatch[1]] = decodeScalar(childMatch[2]);
        } else if (!sawNested) {
          plainContinuation = `${plainContinuation} ${stripComment(child.trim())}`.trim();
        }
      }
      data[key] = sawNested ? nested : plainContinuation;
      cursor = lookahead;
      continue;
    }
    let value = decodeScalar(rest);
    // A plain scalar may continue on more-indented following lines.
    if (!rest.trim().startsWith('"') && !rest.trim().startsWith("'")) {
      let lookahead = cursor + 1;
      for (; lookahead < lines.length; lookahead += 1) {
        const child = lines[lookahead];
        if (child.trim() === '') break;
        if (indentOf(child) === 0 || KEY_LINE.test(child.trim())) break;
        value = `${value} ${stripComment(child.trim())}`.trim();
      }
      cursor = lookahead;
    } else {
      cursor += 1;
    }
    data[key] = value;
  }
  return data;
}

/**
 * Read one skill file's metadata.
 *
 * The result mirrors what the skill registry validates: a kebab-case `name`, a
 * non-empty `description`, an optional `whenToUse`, the strict invocation
 * booleans, and any `metadata` mapping.
 *
 * @param raw - the complete file text.
 * @param label - the path used in diagnostics.
 * @returns the parsed metadata, or an error naming the first failure.
 */
export function readSkillMetadata(raw, label) {
  const split = splitFrontmatter(raw);
  if (split.error !== undefined) return { error: `${label}: ${split.error}` };
  const data = parseYamlSubset(split.yaml);
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (name === '') return { error: `${label}: frontmatter has no \`name\`` };
  if (!SKILL_NAME_PATTERN.test(name)) {
    return { error: `${label}: name "${name}" must be kebab-case (lowercase letters, digits and single hyphens)` };
  }
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (description === '') return { error: `${label}: frontmatter has no non-empty \`description\`` };
  const whenToUse = typeof data.whenToUse === 'string' && data.whenToUse.trim() !== ''
    ? data.whenToUse.trim()
    : undefined;
  const invocation = { modelInvocable: true, userInvocable: true };
  for (const [key, field] of [['disable-model-invocation', 'modelInvocable'], ['user-invocable', 'userInvocable']]) {
    if (!(key in data)) continue;
    const value = parseStrictBoolean(data[key]);
    if (value === undefined) {
      return { error: `${label}: \`${key}\` must be a boolean (true/false, yes/no, on/off, 1/0), got ${JSON.stringify(data[key])}` };
    }
    invocation[field] = field === 'modelInvocable' ? !value : value;
  }
  const metadata = data.metadata !== null && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata
    : undefined;
  return {
    name,
    description,
    ...(whenToUse === undefined ? {} : { whenToUse }),
    invocation,
    ...(metadata === undefined ? {} : { metadata }),
    body: split.body,
  };
}
