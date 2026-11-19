import { parse, type Node } from 'acorn';
import { ancestor } from 'acorn-walk';

/**
 * Static checks on model-written scripts, run before the user is asked to
 * approve them. Chrome enforces the hard network boundary (each script world's
 * CSP blocks every request); this layer blocks what CSP can't see (navigation,
 * cookies, storage, password fields, code generation) and explains to the
 * user, in plain words, what the script does.
 */

export interface JsCheck {
  ok: boolean;
  /** Reasons the script is refused outright. */
  problems: string[];
  /** Allowed but worth the user's attention. */
  warnings: string[];
  /** Plain-language list of what the script does. */
  capabilities: string[];
}

/**
 * How every patch is wrapped at runtime; parsing the same shape catches attempts to break out of it.
 * The helper is also passed as `vb`, its name before the extension was renamed, so scripts saved then keep working.
 */
export function wrapScript(js: string): string {
  return `(async function (alter, vb) {\n'use strict';\n${js}\n})`;
}

/** The helper's current name and its pre-rename alias. */
const HELPER_NAMES = new Set(['alter', 'vb']);

const BLOCKED_NAMES: Record<string, string> = {
  fetch: 'network requests',
  XMLHttpRequest: 'network requests',
  WebSocket: 'network connections',
  EventSource: 'network connections',
  WebTransport: 'network connections',
  RTCPeerConnection: 'network connections',
  sendBeacon: 'network requests',
  importScripts: 'loading code',
  Worker: 'background workers',
  SharedWorker: 'background workers',
  serviceWorker: 'background workers',
  eval: 'generating code',
  Function: 'generating code',
  cookie: 'reading cookies',
  cookieStore: 'reading cookies',
  localStorage: 'reading site storage',
  sessionStorage: 'reading site storage',
  indexedDB: 'reading site storage',
  caches: 'reading site storage',
  credentials: 'reading saved credentials',
  readText: 'reading the clipboard',
  geolocation: 'reading your location',
  postMessage: 'messaging other frames',
  BroadcastChannel: 'messaging other tabs',
  chrome: 'extension APIs',
  browser: 'extension APIs',
  submit: 'submitting forms',
  requestSubmit: 'submitting forms',
  write: 'rewriting the document',
  writeln: 'rewriting the document',
};

/**
 * Methods that act on the site for the user. Alter changes how pages look and
 * read; it does not click, submit, or interact on the user's behalf.
 */
const AUTOMATION_METHODS: Record<string, string> = {
  click: 'clicking things automatically',
  dispatchEvent: 'simulating user input',
};

const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self', 'top', 'parent', 'frames', 'document', 'navigator']);

type AnyNode = Node & Record<string, unknown>;

function propertyName(member: AnyNode): string | null {
  const property = member.property as AnyNode;
  if (!member.computed && property.type === 'Identifier') return property.name as string;
  if (property.type === 'Literal' && typeof property.value === 'string') return property.value;
  return null;
}

function objectName(member: AnyNode): string | null {
  const object = member.object as AnyNode;
  return object.type === 'Identifier' ? (object.name as string) : null;
}

/** `location`, `window.location`, `document.location`, and their properties. */
function isLocationTarget(node: AnyNode): boolean {
  if (node.type === 'Identifier') return node.name === 'location';
  if (node.type !== 'MemberExpression') return false;
  if (propertyName(node) === 'location') return true;
  return isLocationTarget(node.object as AnyNode);
}

function calleeName(call: AnyNode): string | null {
  const callee = call.callee as AnyNode;
  if (callee.type === 'Identifier') return callee.name as string;
  if (callee.type === 'MemberExpression') return propertyName(callee);
  return null;
}

function isVbCall(call: AnyNode, method: string): boolean {
  const callee = call.callee as AnyNode;
  return callee.type === 'MemberExpression' && HELPER_NAMES.has(objectName(callee) ?? '') && propertyName(callee) === method;
}

function stringArgument(call: AnyNode, index: number): string | null {
  const arg = (call.arguments as AnyNode[])[index];
  return arg && arg.type === 'Literal' && typeof arg.value === 'string' ? arg.value : null;
}

export function checkJs(js: string): JsCheck {
  const problems = new Set<string>();
  const warnings = new Set<string>();
  const capabilities = new Set<string>();

  if (js.length > 50_000) problems.add('The script is too long (limit 50,000 characters).');

  let program: AnyNode;
  try {
    program = parse(wrapScript(js), { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as AnyNode;
  } catch (error) {
    return {
      ok: false,
      problems: [`Syntax error: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
      capabilities: [],
    };
  }

  const body = program.body as AnyNode[];
  if (body.length !== 1 || body[0]!.type !== 'ExpressionStatement' || (body[0]!.expression as AnyNode).type !== 'FunctionExpression') {
    return { ok: false, problems: ['The script must not close its wrapper function.'], warnings: [], capabilities: [] };
  }

  const block = (name: string, why: string) => problems.add(`Uses ${name} (${why} is not allowed).`);

  ancestor(program as unknown as Node, {
    Identifier(node, _state, ancestors) {
      const n = node as unknown as AnyNode;
      const name = n.name as string;
      const parent = ancestors[ancestors.length - 2] as AnyNode | undefined;
      // `obj.fetch` is handled by MemberExpression; `{ fetch: 1 }` keys are harmless.
      if (parent?.type === 'MemberExpression' && parent.property === n && !parent.computed) return;
      if (parent?.type === 'Property' && parent.key === n && !parent.computed) return;
      if (Object.hasOwn(BLOCKED_NAMES, name)) block(name, BLOCKED_NAMES[name]!);
    },
    MemberExpression(node) {
      const n = node as unknown as AnyNode;
      const name = propertyName(n);
      if (name && Object.hasOwn(BLOCKED_NAMES, name)) block(name, BLOCKED_NAMES[name]!);
      if (name && Object.hasOwn(AUTOMATION_METHODS, name)) block(`.${name}()`, AUTOMATION_METHODS[name]!);
      const object = objectName(n);
      if (n.computed && name === null && object && GLOBAL_OBJECTS.has(object)) {
        problems.add(`Accesses ${object}[…] with a computed name, which hides what it uses.`);
      }
      if (name === 'textContent' || name === 'innerText') capabilities.add('Changes text on the page');
      if (name === 'style' || name === 'classList') capabilities.add('Changes how elements look');
      if (name === 'playbackRate' || name === 'currentTime' || name === 'volume' || name === 'muted') {
        capabilities.add('Controls video or audio');
      }
    },
    ImportExpression() {
      block('import()', 'loading code');
    },
    WithStatement() {
      problems.add('Uses a with statement.');
    },
    NewExpression(node) {
      const n = node as unknown as AnyNode;
      const callee = n.callee as AnyNode;
      if (callee.type === 'Identifier' && (callee.name === 'Image' || callee.name === 'Audio')) {
        warnings.add('Creates media elements');
      }
    },
    AssignmentExpression(node) {
      const n = node as unknown as AnyNode;
      const target = n.left as AnyNode;
      if (isLocationTarget(target)) problems.add('Navigates the page (assigning location) is not allowed.');
      if (target.type === 'MemberExpression') {
        const name = propertyName(target);
        if (name === 'innerHTML' || name === 'outerHTML') warnings.add('Writes raw HTML into the page');
        if (name === 'href' || name === 'src' || name === 'srcset' || name === 'action' || name === 'formAction') {
          warnings.add('Changes links or sources');
        }
        if (name === 'textContent' || name === 'innerText') capabilities.add('Changes text on the page');
      }
    },
    CallExpression(node) {
      const n = node as unknown as AnyNode;
      const name = calleeName(n);
      const callee = n.callee as AnyNode;

      if ((name === 'setTimeout' || name === 'setInterval') && (n.arguments as AnyNode[])[0]?.type === 'Literal') {
        block(`${name} with a string`, 'generating code');
      }
      if (callee.type === 'MemberExpression' && isLocationTarget(callee.object as AnyNode) && (name === 'assign' || name === 'replace')) {
        problems.add('Navigates the page (location.assign/replace) is not allowed.');
      }
      if (name === 'open' && callee.type === 'MemberExpression' && GLOBAL_OBJECTS.has(objectName(callee) ?? '')) {
        block('window.open', 'opening new pages');
      }
      if (name === 'open' && callee.type === 'Identifier') block('open()', 'opening new pages');
      if (name === 'insertAdjacentHTML') warnings.add('Writes raw HTML into the page');
      if (name === 'setAttribute') {
        const attr = stringArgument(n, 0)?.toLowerCase();
        if (attr === null || attr === undefined) warnings.add('Sets attributes chosen at runtime');
        else if (['href', 'src', 'srcset', 'action', 'formaction'].includes(attr)) warnings.add('Changes links or sources');
        else if (attr.startsWith('on')) problems.add('Sets inline event handler attributes.');
      }

      if (name === 'remove' || name === 'removeChild' || name === 'replaceWith') capabilities.add('Removes elements');
      if (name === 'createElement' || isVbCall(n, 'h')) capabilities.add('Adds elements to the page');
      if (isVbCall(n, 'onElement') || isVbCall(n, 'waitFor') || name === 'MutationObserver') {
        capabilities.add('Watches the page for changes');
      }
      if (isVbCall(n, 'every') || name === 'setInterval') capabilities.add('Runs on a timer');
      if (isVbCall(n, 'download')) capabilities.add('Downloads files');
      if (isVbCall(n, 'copy')) capabilities.add('Copies to the clipboard');
      if (isVbCall(n, 'css')) capabilities.add('Changes how elements look');
      if (isVbCall(n, 'badge')) capabilities.add('Adds labels to the page');
      if (isVbCall(n, 'onNavigate')) capabilities.add('Reacts to page navigation');
      if (name === 'addEventListener' || isVbCall(n, 'on')) {
        const event = stringArgument(n, isVbCall(n, 'on') ? 1 : 0);
        capabilities.add(event?.startsWith('key') ? 'Adds keyboard shortcuts' : 'Responds to clicks and other events');
      }
    },
    Literal(node) {
      const n = node as unknown as AnyNode;
      if (typeof n.value === 'string' && /type\s*=\s*["']?password/i.test(n.value)) {
        problems.add('Touches password fields.');
      }
    },
  });

  return {
    ok: problems.size === 0,
    problems: Array.from(problems),
    warnings: Array.from(warnings),
    capabilities: Array.from(capabilities),
  };
}
