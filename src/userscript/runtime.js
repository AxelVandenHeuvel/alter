/*
 * Alter runtime: helpers for user-approved page scripts.
 *
 * Every observer, listener, timer, element, and style a script creates through
 * `alter` is tracked, so turning the change off removes it cleanly. The script runs
 * in its own isolated world whose CSP blocks all network access.
 */
// Called by the code Alter appends after this file (see buildScript).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
var __alterStart = function (meta, main) {
  'use strict';

  var previous = globalThis.__alter;
  if (previous && previous.active) previous.dispose();

  var active = true;
  /** What containment checks: callbacks this run registers stop working once it's false. */
  var run = { active: true };
  var containment = meta.contain === false ? null : globalThis.__alterContainment || installContainment();
  if (containment) containment.current = run;
  /** For Alter's own waits, which must finish even after the script is stopped. */
  var rawSetTimeout = containment ? containment.originals.setTimeout : setTimeout;
  var cleanups = [];
  var created = new Set();
  var errors = [];
  var logs = [];
  var stats = { matched: 0 };
  /** Per-selector match counts, so the panel can say which targets were never found. */
  var watching = [];
  /**
   * One-time actions hand their results to Alter's panel, which saves or copies
   * them; the page usually doesn't have focus while an action runs.
   */
  var isAction = meta.tag === 'action';
  var outputs = { downloads: [], clipboard: null };
  var outputBytes = 0;
  var MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

  function addOutput(text) {
    outputBytes += text.length;
    if (outputBytes > MAX_OUTPUT_BYTES) throw new Error('The output is larger than 5 MB.');
  }
  var stoppedReason = null;
  var watchers = [];
  var observer = null;
  var scanQueued = false;
  var lastHref = location.href;
  var navigationCallbacks = [];

  function describe(error) {
    return error && error.message ? error.message : String(error);
  }

  function record(where, error) {
    errors.push(where + ': ' + describe(error));
    if (errors.length > 20) errors.shift();
  }

  /** Wrap a callback so it stops after dispose and its errors are recorded, not thrown into the page. */
  function guard(where, fn) {
    return function () {
      if (!active) return undefined;
      try {
        return fn.apply(this, arguments);
      } catch (error) {
        record(where, error);
        return undefined;
      }
    };
  }

  function track(dispose) {
    cleanups.push(dispose);
    return dispose;
  }

  // ---- Containment ----
  // Stopping a script (turned off, replaced, or a password field in use) must really stop
  // it, including listeners, timers, and observers it set up without alter's helpers. Each
  // script world gets its own copies of these APIs, so they're wrapped here once per world:
  // every callback remembers the run that registered it and does nothing once that run ends.

  function holderOf(object, key) {
    while (object && !Object.prototype.hasOwnProperty.call(object, key)) object = Object.getPrototypeOf(object);
    return object;
  }

  function installContainment() {
    var state = { current: null, originals: { setTimeout: setTimeout } };
    var gated = new WeakMap();

    function gate(callback) {
      var callable = typeof callback === 'function' || (callback && typeof callback.handleEvent === 'function');
      if (!callable || !state.current) return callback;
      if (gated.has(callback)) return gated.get(callback);
      var owner = state.current;
      var wrapped = function () {
        if (!owner.active) return undefined;
        return typeof callback === 'function' ? callback.apply(this, arguments) : callback.handleEvent.apply(callback, arguments);
      };
      gated.set(callback, wrapped);
      return wrapped;
    }

    // Wherever pages get addEventListener from: EventTarget.prototype in Chrome.
    var holders = new Set([EventTarget.prototype, holderOf(document, 'addEventListener'), holderOf(window, 'addEventListener')]);
    holders.forEach(function (holder) {
      if (!holder) return;
      var add = holder.addEventListener;
      var remove = holder.removeEventListener;
      holder.addEventListener = function (type, listener, options) {
        return add.call(this, type, gate(listener), options);
      };
      holder.removeEventListener = function (type, listener, options) {
        return remove.call(this, type, (listener && gated.get(listener)) || listener, options);
      };
    });

    // onclick = ..., oninput = ..., on elements, the document, and the window.
    [globalThis].concat(
      ['Window', 'Document', 'Element', 'HTMLElement', 'SVGElement'].map(function (name) {
        return globalThis[name] && globalThis[name].prototype;
      }),
    ).forEach(function (target) {
      if (!target) return;
      Object.getOwnPropertyNames(target).forEach(function (key) {
        if (key.slice(0, 2) !== 'on') return;
        var descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (!descriptor || !descriptor.set || !descriptor.configurable) return;
        Object.defineProperty(target, key, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get: descriptor.get,
          set: function (value) {
            descriptor.set.call(this, gate(value));
          },
        });
      });
    });

    ['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback'].forEach(function (name) {
      var original = globalThis[name];
      if (typeof original !== 'function') return;
      globalThis[name] = function (callback) {
        var args = Array.prototype.slice.call(arguments);
        args[0] = gate(callback);
        return original.apply(globalThis, args);
      };
    });

    ['MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver'].forEach(function (name) {
      var Original = globalThis[name];
      if (typeof Original !== 'function') return;
      var Contained = class extends Original {
        constructor(callback, options) {
          super(gate(callback), options);
        }
      };
      Object.defineProperty(Contained, 'name', { value: name });
      globalThis[name] = Contained;
    });

    Object.defineProperty(globalThis, '__alterContainment', { value: state });
    return state;
  }

  // ---- Password fields ----
  // Scripts never run while a password field is in use: showing, focused, or filled in.
  // A sign-in form that's in the page but hidden doesn't count, so shopping sites with a
  // hidden login dialog keep their changes, until the dialog opens.

  function isPasswordField(el) {
    return Boolean(el) && el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'password';
  }

  function passwordInUse() {
    var fields = document.querySelectorAll('input[type="password" i]');
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (field === document.activeElement || field.value !== '') return true;
      // Opacity doesn't count: a transparent field can still be typed into.
      var shown = typeof field.checkVisibility === 'function' ? field.checkVisibility({ visibilityProperty: true }) : field.getClientRects().length > 0;
      if (shown) return true;
    }
    return false;
  }

  function stopForPassword() {
    if (!active) return;
    stoppedReason = 'A password field is showing, so the script stopped until the page reloads.';
    dispose();
  }

  /**
   * Stop the moment a password field comes into use. Focus and input are caught on the
   * way down (capture, on window, registered before the script runs), so the script's own
   * listeners are already dead when the first key reaches the field.
   */
  function watchPasswords() {
    var queued = false;
    var check = function () {
      queued = false;
      if (active && passwordInUse()) stopForPassword();
    };
    var watcher = new MutationObserver(function () {
      if (queued) return;
      queued = true;
      queueMicrotask(check);
    });
    // Dialogs open by changing an attribute as often as by adding elements.
    watcher.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open', 'type', 'inert'],
    });
    var onField = function (event) {
      var target = typeof event.composedPath === 'function' ? event.composedPath()[0] : event.target;
      if (isPasswordField(target)) stopForPassword();
    };
    var events = ['focusin', 'input', 'change'];
    events.forEach(function (type) {
      window.addEventListener(type, onField, true);
    });
    track(function () {
      watcher.disconnect();
      events.forEach(function (type) {
        window.removeEventListener(type, onField, true);
      });
    });
  }

  function scan() {
    scanQueued = false;
    if (!active) return;
    if (location.href !== lastHref) {
      lastHref = location.href;
      navigationCallbacks.slice().forEach(function (callback) {
        callback(lastHref);
      });
    }
    watchers.slice().forEach(function (watcher) {
      watcher();
    });
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    queueMicrotask(scan);
  }

  function ensureObserver() {
    if (observer) return;
    observer = new MutationObserver(queueScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', queueScan);
  }

  function selectorOf(selector) {
    return Array.isArray(selector) ? selector.join(', ') : selector;
  }

  // ---- Data the site has loaded ----
  // Alter keeps copies of the JSON the site's own code receives (in the page's main world,
  // see src/content/page-data.ts) and hands them over as DOM events. Nothing here makes a request.

  var DATA_EVENT = 'alter:page-data';
  var DATA_REPLAY_EVENT = 'alter:page-data-replay';
  var MAX_DATA_ENTRIES = 300;
  var dataEntries = [];
  var dataSeen = new Set();
  var dataListeners = [];
  var dataStarted = false;

  function receiveData(event) {
    if (!active || typeof event.detail !== 'string') return;
    var entry;
    var json;
    try {
      entry = JSON.parse(event.detail);
      if (!entry || typeof entry.id !== 'number' || dataSeen.has(entry.id)) return;
      json = JSON.parse(entry.body);
    } catch {
      return;
    }
    dataSeen.add(entry.id);
    var item = { url: String(entry.url), json: json };
    dataEntries.push(item);
    if (dataEntries.length > MAX_DATA_ENTRIES) dataEntries.shift();
    dataListeners.slice().forEach(function (listener) {
      listener(item.json, item.url);
    });
  }

  /** Listen for data, and ask for everything captured so far (it arrives before this returns). */
  function startData() {
    if (dataStarted) return;
    dataStarted = true;
    document.addEventListener(DATA_EVENT, receiveData);
    track(function () {
      document.removeEventListener(DATA_EVENT, receiveData);
    });
    document.dispatchEvent(new CustomEvent(DATA_REPLAY_EVENT));
  }

  function onData(where, callback) {
    var listener = guard(where, callback);
    dataListeners.push(listener);
    if (dataStarted) {
      dataEntries.slice().forEach(function (item) {
        listener(item.json, item.url);
      });
    } else {
      startData();
    }
    return track(function () {
      dataListeners = dataListeners.filter(function (l) {
        return l !== listener;
      });
    });
  }

  /** Every plain object inside a JSON value, parents before children. */
  function eachObject(json, callback) {
    var stack = [json];
    while (stack.length) {
      var value = stack.pop();
      if (value === null || typeof value !== 'object') continue;
      if (!Array.isArray(value)) callback(value);
      var children = Array.isArray(value) ? value : Object.keys(value).map(function (key) {
        return value[key];
      });
      for (var i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }

  // ---- Prices and quantities, for labels computed from what's on the page ----

  var CURRENCY_SYMBOLS = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₩': 'KRW', 'A$': 'AUD', 'C$': 'CAD', 'CA$': 'CAD', 'NZ$': 'NZD', 'R$': 'BRL', 'CHF': 'CHF', 'kr': 'SEK' };

  /** "1.299,00" or "1,299.00" or "4,29" -> 1299 / 1299 / 4.29. */
  function parseNumber(raw) {
    var text = raw.replace(/\s/g, '');
    var lastComma = text.lastIndexOf(',');
    var lastDot = text.lastIndexOf('.');
    if (lastComma > lastDot) {
      // Comma is the decimal separator unless it groups thousands ("1,299").
      var decimals = text.length - lastComma - 1;
      text = decimals === 3 && lastDot === -1 && /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
    var value = parseFloat(text);
    return isFinite(value) ? value : null;
  }

  function parsePrice(text) {
    var source = String(text || '');
    var match = source.match(/(CA\$|A\$|C\$|NZ\$|R\$|[$€£¥₹₩]|\b(?:USD|EUR|GBP|CAD|AUD|CHF|JPY|INR)\b)\s*(\d[\d.,\s]*\d|\d)/i);
    var symbol;
    var number;
    if (match) {
      symbol = match[1];
      number = match[2];
    } else {
      match = source.match(/(\d[\d.,\s]*\d|\d)\s*([€£¥]|kr|\b(?:USD|EUR|GBP|CAD|AUD|CHF|JPY|INR)\b)/i);
      if (!match) {
        // Cents-only prices like "89¢".
        var cents = source.match(/(\d+)\s*¢/);
        return cents ? { amount: Number(cents[1]) / 100, currency: 'USD' } : null;
      }
      number = match[1];
      symbol = match[2];
    }
    var amount = parseNumber(number);
    if (amount === null) return null;
    var currency = CURRENCY_SYMBOLS[symbol] || CURRENCY_SYMBOLS[symbol.toUpperCase()] || symbol.toUpperCase();
    return { amount: amount, currency: currency };
  }

  /** Units by what they measure, with their size in that dimension's base unit (g, ml, count, bytes, m). */
  var UNITS = [
    ['fl oz', 'volume', 29.5735], ['fl. oz', 'volume', 29.5735], ['floz', 'volume', 29.5735],
    ['oz', 'mass', 28.3495], ['ounce', 'mass', 28.3495], ['lbs', 'mass', 453.592], ['lb', 'mass', 453.592], ['pound', 'mass', 453.592],
    ['kg', 'mass', 1000], ['kilogram', 'mass', 1000], ['mg', 'mass', 0.001], ['g', 'mass', 1], ['gram', 'mass', 1],
    ['ml', 'volume', 1], ['millilit', 'volume', 1], ['cl', 'volume', 10], ['l', 'volume', 1000], ['lit', 'volume', 1000],
    ['gal', 'volume', 3785.41], ['qt', 'volume', 946.353], ['quart', 'volume', 946.353], ['pt', 'volume', 473.176], ['pint', 'volume', 473.176],
    ['tb', 'data', 1e12], ['gb', 'data', 1e9], ['mb', 'data', 1e6],
    ['ct', 'count', 1], ['count', 'count', 1], ['pack', 'count', 1], ['pk', 'count', 1], ['pcs', 'count', 1], ['pieces', 'count', 1], ['piece', 'count', 1], ['each', 'count', 1], ['ea', 'count', 1], ['rolls', 'count', 1], ['roll', 'count', 1], ['eggs', 'count', 1],
    ['km', 'length', 1000], ['cm', 'length', 0.01], ['mm', 'length', 0.001], ['m', 'length', 1], ['ft', 'length', 0.3048], ['in', 'length', 0.0254],
  ];

  function unitFor(name) {
    var key = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
    for (var i = 0; i < UNITS.length; i++) {
      var unit = UNITS[i];
      if (key === unit[0] || key === unit[0] + 's' || (unit[0].length > 3 && key.indexOf(unit[0]) === 0)) return unit;
    }
    return null;
  }

  var UNIT_PATTERN = 'fl\\.?\\s?oz|ounces?|oz|lbs?|pounds?|kilograms?|kg|mg|grams?|g|millilit(?:er|re)s?|ml|cl|lit(?:er|re)s?|l|gal(?:lons?)?|quarts?|qt|pints?|pt|tb|gb|mb|ct|count|packs?|pk|pcs|pieces?|each|ea|rolls?|eggs|km|cm|mm|m|ft|in';

  /**
   * "18 oz" -> 18 oz of mass; "2 x 500 ml" -> 1000 ml; "12-pack" -> 12 count.
   * Returns { value, unit, dimension, base } where base is in g, ml, count, bytes, or m.
   */
  function parseQuantity(text) {
    var source = String(text || '').replace(/(\d),(\d)/g, '$1.$2');
    var multi = source.match(new RegExp('(\\d+)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*(' + UNIT_PATTERN + ')\\b', 'i'));
    var count = multi ? Number(multi[1]) : 1;
    var match = multi
      ? [multi[0], multi[2], multi[3]]
      : source.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*-?\\s*(' + UNIT_PATTERN + ')\\b', 'i'));
    if (!match) return null;
    var unit = unitFor(match[2].replace(/\.\s?/, ' ').replace(/^fl\s*oz$/i, 'fl oz'));
    if (!unit) return null;
    var value = Number(match[1]) * count;
    return { value: value, unit: unit[0], dimension: unit[1], base: value * unit[2] };
  }

  /**
   * The currency's usual decimals (two for dollars, none for yen), so prices line up for
   * comparison; a third only for very small unit prices ($0.042/oz).
   */
  function formatPrice(amount, currency) {
    try {
      var code = currency || 'USD';
      var digits = new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
      if (digits === 2 && amount > 0 && amount < 0.1) digits = 3;
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
    } catch {
      // Unknown currency code.
      return amount.toFixed(2) + ' ' + currency;
    }
  }

  /**
   * Price per unit, e.g. unitPrice('$4.29', 'Oats, 18 oz', 'oz') -> { amount: 0.238, currency: 'USD', unit: 'oz', text: '$0.238/oz' }.
   * Null when either side can't be read or the units measure different things (weight vs volume).
   */
  function unitPrice(priceText, sizeText, per) {
    var price = typeof priceText === 'object' && priceText ? priceText : parsePrice(priceText);
    var size = typeof sizeText === 'object' && sizeText ? sizeText : parseQuantity(sizeText);
    var target = unitFor(per);
    if (!price || !size || !target || target[1] !== size.dimension || size.base <= 0) return null;
    var amount = price.amount / (size.base / target[2]);
    return { amount: amount, currency: price.currency, unit: target[0], text: formatPrice(amount, price.currency) + '/' + target[0] };
  }

  // ---- Currencies ----
  // Daily reference rates Alter downloaded (the European Central Bank's, in euros), handed
  // over with the script. Null when Alter couldn't get them.

  var rates = meta.rates || null;

  /**
   * convert('$129.00', 'JPY') or convert({ amount: 129, currency: 'USD' }, 'JPY') ->
   * { amount, currency, text, date }. Null when the price can't be read or either currency has no rate.
   */
  function convert(price, to) {
    var from = typeof price === 'object' && price ? price : parsePrice(price);
    var target = String(to || '').toUpperCase();
    if (!rates || !from || !isFinite(from.amount)) return null;
    var source = String(from.currency || '').toUpperCase();
    var fromRate = source === 'EUR' ? 1 : rates.perEuro[source];
    var toRate = target === 'EUR' ? 1 : rates.perEuro[target];
    if (!fromRate || !toRate) return null;
    var amount = (from.amount / fromRate) * toRate;
    return { amount: amount, currency: target, text: formatPrice(amount, target), date: rates.date };
  }

  // ---- Labels ----

  /** Whether the background behind an element is dark, so labels stay readable. */
  function isDarkBehind(el) {
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      var color = getComputedStyle(node).backgroundColor;
      var parts = color.match(/[\d.]+/g);
      if (parts && (parts.length < 4 || Number(parts[3]) > 0.5)) {
        return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2] < 110;
      }
    }
    return matchMedia('(prefers-color-scheme: dark)').matches && getComputedStyle(document.documentElement).colorScheme.indexOf('dark') >= 0;
  }

  var BADGE_TONES = {
    light: { neutral: ['#eef0ff', '#3b30b5', '#d9dcff'], good: ['#e6f6ed', '#0f6b3a', '#c4e8d3'], bad: ['#fdeced', '#a02028', '#f6cdd0'] },
    dark: { neutral: ['#262145', '#c9c3ff', '#3a3366'], good: ['#16301f', '#7fdca8', '#24492f'], bad: ['#3a1c1f', '#ff9aa0', '#5a2a2f'] },
  };

  var alter = {
    /** Call `callback(el)` once for every element matching `selector`, now and whenever new ones appear. */
    onElement: function (selector, callback) {
      var css = selectorOf(selector);
      document.querySelectorAll(css); // Throws now on an invalid selector.
      var seen = new WeakSet();
      var entry = { selector: css, matched: 0 };
      watching.push(entry);
      var watcher = guard('onElement(' + css + ')', function () {
        document.querySelectorAll(css).forEach(function (el) {
          if (seen.has(el)) return;
          seen.add(el);
          stats.matched++;
          entry.matched++;
          callback(el);
        });
      });
      watchers.push(watcher);
      ensureObserver();
      watcher();
      return track(function () {
        watchers = watchers.filter(function (w) {
          return w !== watcher;
        });
      });
    },

    /** Resolve with the first element matching `selector`, waiting up to `timeoutMs`. */
    waitFor: function (selector, timeoutMs) {
      var css = selectorOf(selector);
      return new Promise(function (resolve, reject) {
        var stop = alter.onElement(css, function (el) {
          stop();
          clearTimeout(timer);
          resolve(el);
        });
        var timer = setTimeout(function () {
          stop();
          reject(new Error('Timed out waiting for ' + css));
        }, timeoutMs || 10000);
      });
    },

    /** Call `callback(url)` when a single-page app navigates without a reload. */
    onNavigate: function (callback) {
      var wrapped = guard('onNavigate', callback);
      navigationCallbacks.push(wrapped);
      ensureObserver();
      return track(function () {
        navigationCallbacks = navigationCallbacks.filter(function (c) {
          return c !== wrapped;
        });
      });
    },

    /** addEventListener that is removed when the change is turned off. */
    on: function (target, type, handler, options) {
      var wrapped = guard('on(' + type + ')', handler);
      target.addEventListener(type, wrapped, options);
      return track(function () {
        target.removeEventListener(type, wrapped, options);
      });
    },

    /** Repeat `fn` every `ms` milliseconds (at least 100). */
    every: function (ms, fn) {
      var id = setInterval(guard('every', fn), Math.max(100, ms));
      return track(function () {
        clearInterval(id);
      });
    },

    /** Run `fn` once after `ms` milliseconds. */
    after: function (ms, fn) {
      var id = setTimeout(guard('after', fn), ms);
      return track(function () {
        clearTimeout(id);
      });
    },

    /**
     * Create an element. `props` may contain `text`, `class`, `style` (object),
     * `on<Event>` handlers, and any other attribute. Children may be nodes or strings.
     * Elements made this way are removed when the change is turned off.
     */
    h: function (tag, props) {
      var el = document.createElement(tag);
      el.setAttribute('data-alter', meta.tag);
      Object.keys(props || {}).forEach(function (key) {
        var value = props[key];
        if (value === undefined || value === null || value === false) return;
        if (key === 'text') el.textContent = String(value);
        else if (key === 'class') el.className = String(value);
        else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
        else if (/^on[A-Z]/.test(key) && typeof value === 'function') alter.on(el, key.slice(2).toLowerCase(), value);
        else el.setAttribute(key, value === true ? '' : String(value));
      });
      for (var i = 2; i < arguments.length; i++) {
        var child = arguments[i];
        if (child === null || child === undefined || child === false) continue;
        el.append(typeof child === 'string' ? document.createTextNode(child) : child);
      }
      created.add(el);
      return el;
    },

    /**
     * Data the site has loaded (the JSON its own code received), now and as more loads.
     * Includes what the page doesn't show, like a post author's follower count.
     */
    data: {
      /** Call `callback(json, url)` for each response the site has loaded, now and later. */
      onLoad: function (callback) {
        return onData('data.onLoad', callback);
      },
      /** Call `callback(object, url)` for every object inside that data, now and later. */
      each: function (callback) {
        return onData('data.each', function (json, url) {
          eachObject(json, function (object) {
            callback(object, url);
          });
        });
      },
    },

    /** Add CSS that is removed when the change is turned off. */
    css: function (text) {
      var style = document.createElement('style');
      style.className = 'darkreader alter-style';
      style.textContent = text;
      document.documentElement.append(style);
      created.add(style);
      return style;
    },

    /** Save `text` as a file on the user's computer. */
    download: function (filename, text, type) {
      if (isAction) {
        addOutput(String(text));
        outputs.downloads.push({ filename: String(filename), text: String(text), type: type || 'text/plain' });
        return;
      }
      var url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
      var link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
    },

    /** Copy text to the clipboard. */
    copy: function (text) {
      if (isAction) {
        addOutput(String(text));
        outputs.clipboard = String(text);
        return Promise.resolve();
      }
      return navigator.clipboard.writeText(String(text));
    },

    /**
     * Add a small label next to an element, e.g. alter.badge(priceEl, '$0.24/oz').
     * options: tone ('neutral' | 'good' | 'bad'), where ('after' | 'before' | 'append' | 'prepend'), title (hover text).
     * Page styles can't change it; it's removed when the change is turned off. Returns the label.
     */
    badge: function (target, text, options) {
      var opts = options || {};
      var palette = BADGE_TONES[isDarkBehind(target) ? 'dark' : 'light'][opts.tone || 'neutral'] || BADGE_TONES.light.neutral;
      var host = document.createElement('alter-badge');
      host.setAttribute('data-alter', meta.tag);
      if (opts.title) host.setAttribute('title', String(opts.title));
      var root = host.attachShadow({ mode: 'open' });
      var style = document.createElement('style');
      style.textContent =
        ':host{all:initial;display:inline-flex;vertical-align:middle;margin:0 0.35em}' +
        'span{font:600 12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;white-space:nowrap;' +
        'padding:0 7px;border-radius:999px;border:1px solid ' + palette[2] + ';background:' + palette[0] + ';color:' + palette[1] + '}';
      var label = document.createElement('span');
      label.textContent = String(text);
      root.append(style, label);
      var where = opts.where || 'after';
      if (where === 'before') target.before(host);
      else if (where === 'append') target.append(host);
      else if (where === 'prepend') target.prepend(host);
      else target.after(host);
      created.add(host);
      return host;
    },

    /** "$4.29", "4,29 €", "£1.50" -> { amount, currency } (ISO code), or null. */
    parsePrice: parsePrice,

    /** "18 oz", "1.5 lb", "2 x 500 ml", "12-pack" -> { value, unit, dimension, base }, or null. */
    parseQuantity: parseQuantity,

    /** Price per unit: alter.unitPrice('$4.29', 'Oats, 18 oz', 'oz') -> { amount, currency, unit, text: '$0.238/oz' }, or null. */
    unitPrice: unitPrice,

    /** Format an amount in a currency for the user's locale, e.g. alter.formatPrice(0.24, 'USD') -> '$0.24'. */
    formatPrice: formatPrice,

    /** Convert a price to another currency: alter.convert('$129.00', 'JPY') -> { amount, currency, text: '¥14,400', date }, or null. */
    convert: convert,

    /** Where the exchange rates come from and the day they're for: { date: '2026-11-06', source }, or null without rates. */
    rates: rates ? { date: rates.date, source: rates.source } : null,

    /** An element's visible text, whitespace collapsed. */
    text: function (el) {
      return ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
    },

    /** Register extra cleanup to run when the change is turned off. */
    onCleanup: function (fn) {
      track(fn);
    },

    /** Record a message the Alter agent can read after a preview. */
    log: function () {
      logs.push(Array.prototype.map.call(arguments, String).join(' '));
      if (logs.length > 20) logs.shift();
    },
  };

  function dispose() {
    if (!active) return;
    active = false;
    run.active = false;
    if (observer) observer.disconnect();
    window.removeEventListener('popstate', queueScan);
    for (var i = cleanups.length - 1; i >= 0; i--) {
      try {
        cleanups[i]();
      } catch (error) {
        record('cleanup', error);
      }
    }
    created.forEach(function (el) {
      el.remove();
    });
    created.clear();
  }

  /** Labels, buttons, and other elements the script added that are on the page now (not its styles). */
  function shownCount() {
    var count = 0;
    created.forEach(function (el) {
      if (el.isConnected && el.tagName !== 'STYLE') count++;
    });
    return count;
  }

  function report() {
    return {
      errors: errors.slice(),
      logs: logs.slice(),
      matched: stats.matched,
      added: shownCount(),
      rates: rates ? { date: rates.date, source: rates.source } : null,
      watching: watching.map(function (w) {
        return { selector: w.selector, matched: w.matched };
      }),
      active: active,
      stoppedReason: stoppedReason,
      outputs: isAction ? outputs : null,
    };
  }

  globalThis.__alter = {
    version: meta.version,
    get active() {
      return active;
    },
    dispose: dispose,
    report: report,
  };

  if (passwordInUse()) {
    active = false;
    run.active = false;
    stoppedReason = 'A password field is showing, so the script did not run.';
    return Promise.resolve(report());
  }
  watchPasswords();

  return Promise.resolve()
    .then(function () {
      // Passed twice: as `alter`, and under its pre-rename name for scripts saved before then.
      return main(alter, alter);
    })
    .catch(function (error) {
      record('script', error);
    })
    .then(function () {
      // Give observers one tick to process what the script just did.
      return new Promise(function (resolve) {
        rawSetTimeout(resolve, 50);
      });
    })
    .then(report);
};
