/**
 * Shared test harness for the Skill Manager plugin.
 *
 * `mountHost` drives the real Host half (`apply`) against a minimal Cordis
 * stand-in; the React stand-in renders the real Client half without a browser.
 * Both halves are exercised as authored, so a contract drift between them fails
 * a test instead of a page.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';

import { apply } from '../index.js';

/**
 * Mount the Host half and capture its provider, exact Fetch routes, and the
 * legacy prefix route.
 *
 * @param options - plugin configuration (state paths, watch flag, ...).
 * @param hooks - test overrides; `admit` replaces the trust/auth check and
 *   `noFetch` removes the Fetch registry so the legacy fallback is exercised.
 */
export function mountHost(options, hooks = {}) {
  const captured = {
    route: undefined,
    fetchRoutes: new Map(),
    provider: undefined,
    control: undefined,
    invalidated: 0,
    skillCatalog: [],
  };
  const admit = hooks.admit ?? (() => ({ peer: { id: 'test-peer' } }));
  const disposers = [];
  const collect = (disposer) => {
    if (typeof disposer === 'function') disposers.push(disposer);
    return typeof disposer === 'function' ? disposer : () => {};
  };
  const skillsService = {
    async snapshot() {
      return { skills: captured.skillCatalog.map((entry) => ({ ...entry })), complete: true };
    },
    // The real registry delegates list() to snapshot(); mirror that so a gate on
    // snapshot also covers list.
    async list(options = {}) {
      return (await this.snapshot(options)).skills;
    },
    async get(name) {
      const found = captured.skillCatalog.find((entry) => entry.name === name);
      if (found === undefined) return undefined;
      return { ...found, content: `BODY ${name}` };
    },
    registerProvider(create) {
      captured.control = {
        signal: new AbortController().signal,
        invalidate: () => {
          captured.invalidated += 1;
        },
      };
      captured.provider = create(captured.control);
      return () => {};
    },
  };
  captured.skills = skillsService;
  const ctx = {
    logger: () => ({ info() {}, warn() {}, debug() {}, error() {} }),
    effect(callback) {
      return collect(callback());
    },
    skills: skillsService,
    inject(_deps, callback) {
      const scope = {
        effect(effectCallback) {
          return collect(effectCallback());
        },
        connection: {
          admit,
          ...(hooks.noFetch === true ? {} : {
            fetch: {
              register(route) {
                captured.fetchRoutes.set(route.path, route);
                return () => {};
              },
            },
          }),
        },
        webServer: {
          register(route) {
            captured.route = route;
            return () => {};
          },
        },
      };
      callback(scope);
      return () => {};
    },
    get: () => undefined,
  };
  apply(ctx, options);
  assert.equal(captured.route?.path, '/skill-market');
  /** Run every registered effect disposer (closes watchers, routes, …). */
  captured.dispose = () => {
    while (disposers.length > 0) {
      const disposer = disposers.pop();
      try {
        disposer();
      } catch {
        /* best effort */
      }
    }
  };
  return captured;
}

/** Parse a Response into the envelope the browser half expects. */
async function readResponse(response) {
  const text = await response.text();
  let body;
  try {
    body = text === '' ? undefined : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/**
 * Call one endpoint through the preferred exact Fetch route, exactly as the
 * framework's `/api` bridge would: a real Request with a buffered body.
 *
 * @param host - the value returned by {@link mountHost}.
 * @param endpoint - endpoint name.
 * @param payload - JSON body.
 * @param options - overrides (`rawBody`, `contentType`, `method`).
 */
export async function callFetchRoute(host, endpoint, payload = {}, options = {}) {
  const path = `/api/skill-market/${endpoint}`;
  const route = host.fetchRoutes.get(path);
  assert.notEqual(route, undefined, `missing Fetch route ${path}`);
  const method = options.method ?? 'POST';
  const request = new Request(`http://127.0.0.1${path}`, {
    method,
    headers: { 'content-type': options.contentType ?? 'application/json' },
    body: method === 'POST' ? options.rawBody ?? JSON.stringify(payload) : undefined,
  });
  return readResponse(await route.fetch(request));
}

/** Collect a Node request body. */
function readIncoming(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Start a real HTTP server that emulates the framework bridge: `/api/...` goes
 * through admission and the exact Fetch routes, everything else through the
 * legacy prefix route. Real sockets are what catch request-lifecycle bugs.
 *
 * @param host - the value returned by {@link mountHost}.
 * @param options - `admit` override.
 * @returns origin, close(), and a `post()` helper returning status + envelope.
 */
export async function startHttpServer(host, options = {}) {
  const admit = options.admit ?? (() => ({ peer: { id: 'test-peer' } }));
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (pathname.startsWith('/api/')) {
          const admission = admit(req);
          if (admission.rejection !== undefined) {
            res.writeHead(admission.rejection);
            res.end('rejected');
            return;
          }
          const route = host.fetchRoutes.get(pathname);
          const method = req.method ?? 'GET';
          if (route === undefined || route.methods.includes(method) !== true) {
            res.writeHead(404);
            res.end('not found');
            return;
          }
          const body = method === 'POST' ? await readIncoming(req) : undefined;
          const request = new Request(`http://127.0.0.1${pathname}`, {
            method,
            headers: { 'content-type': String(req.headers['content-type'] ?? 'application/json') },
            body,
          });
          const response = await route.fetch(request);
          const text = await response.text();
          res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json' });
          res.end(text);
          return;
        }
        await host.route.handler(req, res);
      } catch (error) {
        if (!res.writableEnded) {
          res.writeHead(500);
          res.end(`harness failure: ${error.message}`);
        }
      }
    })();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => {
      // fetch keeps sockets alive; without this the test process would wait for
      // the idle keep-alive connection instead of finishing.
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
    async post(path, payload, init = {}) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: init.method ?? 'POST',
        headers: { 'content-type': init.contentType ?? 'application/json' },
        body: init.body ?? JSON.stringify(payload ?? {}),
      });
      return readResponse(response);
    },
  };
}

/**
 * Drive the legacy prefix route with a fake request/response pair.
 *
 * @param route - the route object the Host registered.
 * @param endpoint - the endpoint segment to request.
 * @param payload - JSON request body.
 * @param options - request overrides (method, raw body, contentType).
 * @returns the response status and parsed body.
 */
export async function callRoute(route, endpoint, payload = {}, options = {}) {
  const request = new EventEmitter();
  request.method = options.method ?? 'POST';
  request.url = `${route.path}/${endpoint}`;
  request.headers = {
    host: '127.0.0.1:19387',
    'content-type': options.contentType ?? 'application/json',
  };
  const response = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers ?? {});
    },
    end(body) {
      this.body = body ?? '';
    },
  };
  const settled = route.handler(request, response);
  request.emit('data', Buffer.from(options.rawBody ?? JSON.stringify(payload)));
  request.emit('end');
  await settled;
  let body;
  try {
    body = response.body === '' ? undefined : JSON.parse(response.body);
  } catch {
    body = response.body;
  }
  return { status: response.statusCode, body };
}

/** A tiny React stand-in: enough for this plugin's hooks and elements. */
export function createReactStub() {
  const slots = { states: [], effects: [], effectDeps: [], memos: [], cursor: 0 };
  const same = (left, right) => Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const React = {
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false);
      return { type, props: { ...(props ?? {}), children: flat } };
    },
    useState(initial) {
      const index = slots.cursor;
      slots.cursor += 1;
      if (!(index in slots.states)) slots.states[index] = typeof initial === 'function' ? initial() : initial;
      const set = (next) => {
        slots.states[index] = typeof next === 'function' ? next(slots.states[index]) : next;
      };
      return [slots.states[index], set];
    },
    useEffect(callback, deps) {
      const index = slots.cursor;
      slots.cursor += 1;
      if (same(slots.effectDeps[index], deps)) return;
      slots.effectDeps[index] = deps;
      slots.effects.push(callback);
    },
    useCallback(callback, deps) {
      const index = slots.cursor;
      slots.cursor += 1;
      const record = slots.memos[index];
      if (record !== undefined && same(record.deps, deps)) return record.value;
      slots.memos[index] = { deps, value: callback };
      return callback;
    },
    useMemo(factory, deps) {
      const index = slots.cursor;
      slots.cursor += 1;
      const record = slots.memos[index];
      if (record !== undefined && same(record.deps, deps)) return record.value;
      const value = factory();
      slots.memos[index] = { deps, value };
      return value;
    },
    useRef(value) {
      const index = slots.cursor;
      slots.cursor += 1;
      slots.memos[index] ??= { deps: undefined, value: { current: value } };
      return slots.memos[index].value;
    },
  };
  return { React, slots };
}

/** Render an element tree to HTML with a minimal serializer. */
export function renderToHtml(node, slots) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((child) => renderToHtml(child, slots)).join('');
  if (typeof node.type === 'function') {
    const savedCursor = slots.cursor;
    slots.cursor = 0;
    const rendered = node.type({ ...node.props });
    slots.cursor = savedCursor;
    return renderToHtml(rendered, slots);
  }
  const attributes = Object.entries(node.props)
    .filter(([key, value]) => key !== 'children' && value !== undefined && value !== null && typeof value !== 'function' && typeof value !== 'object')
    .map(([key, value]) => ` ${key}="${String(value).replace(/"/g, '&quot;')}"`)
    .join('');
  return `<${node.type}${attributes}>${renderToHtml(node.props.children, slots)}</${node.type}>`;
}

/**
 * Collect every element whose props satisfy a predicate, materializing function
 * components the same way the renderer does so nested cards are reachable.
 */
export function collectElements(node, predicate, slots, found = []) {
  if (node === null || node === undefined || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, predicate, slots, found);
    return found;
  }
  if (typeof node.type === 'function') {
    const savedCursor = slots.cursor;
    slots.cursor = 0;
    const rendered = node.type({ ...node.props });
    slots.cursor = savedCursor;
    collectElements(rendered, predicate, slots, found);
    return found;
  }
  if (predicate(node)) found.push(node);
  collectElements(node.props?.children, predicate, slots, found);
  return found;
}

/** Materialize the browser bundle and return its Cordis plugin object. */
let cachedDefinition;
export async function loadClientHalf(React) {
  if (cachedDefinition === undefined) {
    globalThis.window = {
      __ModuleLoader__: { load: (value) => { cachedDefinition = value; } },
      confirm: () => true,
    };
    try {
      // ESM evaluation happens once per process, so the bundle is cached too.
      await import('../client.js');
    } finally {
      delete globalThis.window;
    }
  }
  assert.equal(cachedDefinition.id, '@local/dsh-skill-market');
  return cachedDefinition.factory(() => React);
}

/** Register the Client half against a fake browser context. */
export function mountClient(plugin, respond, options = {}) {
  const registrations = [];
  const calls = [];
  const dictionaries = new Map();
  const ctx = {
    effect(callback) {
      const disposer = callback();
      return typeof disposer === 'function' ? disposer : () => {};
    },
    locale: {
      register(namespace, dicts) {
        dictionaries.set(namespace, dicts);
        return () => {};
      },
      bind(namespace) {
        return (key) => dictionaries.get(namespace)?.zh?.[key] ?? key;
      },
    },
    slots: {
      inject(key, callback) {
        callback();
        return () => {};
      },
      register(options, Component) {
        registrations.push({ options, Component });
        return () => {};
      },
    },
    get: () => undefined,
  };
  // The browser bundle reaches the host with a same-origin fetch; the stub must
  // stay installed while the component effects run, so the caller restores it.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const endpoint = String(url).split('/').pop();
    const payload = JSON.parse(init?.body ?? '{}');
    calls.push({ url: String(url), endpoint, payload });
    const status = typeof options.statusFor === 'function' ? options.statusFor(String(url)) : 200;
    if (status !== 200) {
      return {
        ok: false,
        status,
        async json() {
          return {};
        },
      };
    }
    const result = respond(endpoint, payload);
    return {
      ok: true,
      status: 200,
      async json() {
        return result;
      },
    };
  };
  plugin.apply(ctx);
  return {
    registrations,
    calls,
    ctx,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}
