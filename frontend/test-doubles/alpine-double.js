/* ═══════════════════════════════════════════════════════════════════════════
 * TEST DOUBLE — Alpine.js stand-in.  NOT SHIPPED.
 *
 * The LRMC sandbox has no access to unpkg, so the verifiers cannot load the
 * real Alpine. This implements the subset the LRMC pages actually use, well
 * enough that a test can drive a page the way a person would — click a radio,
 * type a password, watch fields appear — rather than only asserting that
 * markup exists.
 *
 * Implemented:
 *   x-data (named component or inline object literal, nestable)
 *   x-show · x-cloak · x-text · x-model (text, password, select, radio,
 *   checkbox) · x-for over `item in expr` with :key
 *   : attribute bindings, including boolean attributes and :class
 *   @event handlers with the .prevent modifier
 *   $nextTick, and init() on first render
 *
 * Deliberately NOT implemented: transitions, x-if, x-ref/$refs, x-effect,
 * stores, magics beyond $nextTick, and fine-grained dependency tracking —
 * this re-renders the whole component on any state change, which is correct
 * but not how Alpine does it.
 *
 * **A double is not the library.** A page that passes here can still break on
 * real Alpine. What this buys is that a page which breaks *logically* — a
 * field that never appears, a rule that never ticks — fails the suite instead
 * of shipping.
 * ═══════════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';

  var registry = {};
  var roots = [];
  var queued = false;

  w.Alpine = {
    data: function (name, factory) { registry[name] = factory; },
    /* Real Alpine exposes this; a page calling it should not explode. */
    start: function () { boot(); },
  };

  /* ── expression evaluation ──────────────────────────────────────────────
   * A `with` over a proxy that resolves names through the scope chain,
   * innermost first, and falls back to the global object so an expression may
   * still mention `Math` or `JSON`.
   * ──────────────────────────────────────────────────────────────────── */

  function chainProxy(chain) {
    return new Proxy({}, {
      has: function () { return true; },
      get: function (_t, key) {
        if (key === Symbol.unscopables) return undefined;
        for (var i = chain.length - 1; i >= 0; i--) {
          if (key in chain[i]) return chain[i][key];
        }
        return w[key];
      },
      set: function (_t, key, value) {
        for (var i = chain.length - 1; i >= 0; i--) {
          if (key in chain[i]) { chain[i][key] = value; return true; }
        }
        chain[chain.length - 1][key] = value;
        return true;
      },
    });
  }

  var cache = {};
  function compile(expr) {
    if (!cache[expr]) {
      /* eslint-disable no-new-func */
      cache[expr] = new Function('__scope', 'with (__scope) { return (' + expr + ') }');
    }
    return cache[expr];
  }

  function evaluate(expr, chain, el) {
    try {
      return compile(expr)(chainProxy(chain));
    } catch (err) {
      console.error('[alpine-double] ' + expr + ' — ' + err.message,
                    el ? el.outerHTML.slice(0, 80) : '');
      return undefined;
    }
  }

  function run(expr, chain, el, event) {
    var scope = chainProxy(chain);
    try {
      /* eslint-disable no-new-func */
      new Function('__scope', '$event', 'with (__scope) { ' + expr + ' }')(scope, event);
    } catch (err) {
      console.error('[alpine-double] handler ' + expr + ' — ' + err.message);
    }
  }

  /* ── reactivity ─────────────────────────────────────────────────────────
   * Any write schedules a re-render of every root. Coarse, but a form is not
   * a performance problem, and coarse means a missed dependency cannot cause
   * a stale screen — which would be a bug in the double masquerading as a
   * bug in the page.
   * ──────────────────────────────────────────────────────────────────── */

  function schedule() {
    if (queued) return;
    queued = true;
    Promise.resolve().then(function () { queued = false; render(); });
  }

  function reactive(target) {
    var bound = new Map();
    var proxy = new Proxy(target, {
      get: function (t, key) {
        /* `receiver` is the proxy, so getters and methods see reactive
         * `this` — `this.password` inside `get passwordRules()` must read
         * through the proxy or it would never re-run. */
        var value = Reflect.get(t, key, proxy);
        if (typeof value === 'function') {
          if (!bound.has(key)) bound.set(key, value.bind(proxy));
          return bound.get(key);
        }
        return value;
      },
      set: function (t, key, value) {
        var prior = t[key];
        t[key] = value;
        bound.delete(key);
        if (prior !== value) schedule();
        return true;
      },
    });
    return proxy;
  }

  /* ── directives ─────────────────────────────────────────────────────── */

  var BOOLEAN_ATTRS = ['required', 'disabled', 'checked', 'readonly', 'selected', 'open'];

  function applyBinding(el, attr, expr, chain) {
    var name = attr.slice(1);
    var value = evaluate(expr, chain, el);

    if (name === 'class') {
      var prior = el.__dblClass;
      if (prior) prior.split(/\s+/).forEach(function (c) { if (c) el.classList.remove(c); });
      var next = typeof value === 'string' ? value
        : Array.isArray(value) ? value.join(' ')
        : value && typeof value === 'object'
          ? Object.keys(value).filter(function (k) { return value[k]; }).join(' ')
          : '';
      el.__dblClass = next;
      next.split(/\s+/).forEach(function (c) { if (c) el.classList.add(c); });
      return;
    }

    if (BOOLEAN_ATTRS.indexOf(name) !== -1) {
      if (value) el.setAttribute(name, '');
      else el.removeAttribute(name);
      /* The property, not just the attribute — `disabled` read back from the
       * DOM comes from the property. */
      try { el[name] = Boolean(value); } catch (e) { /* not a form control */ }
      return;
    }

    if (value === null || value === undefined || value === false) {
      el.removeAttribute(name);
      return;
    }
    el.setAttribute(name, String(value));
    if (name === 'value' && 'value' in el) el.value = String(value);
  }

  function applyModel(el, prop, chain) {
    /* The chain is re-read from the element at event time rather than closed
     * over: x-for rebuilds item scopes on every render, so a captured chain
     * would go stale the moment the list changed. */
    el.__dblChain = chain;
    var current = evaluate(prop, chain, el);

    if (el.type === 'radio') {
      el.checked = String(el.value) === String(current == null ? '' : current);
    } else if (el.type === 'checkbox') {
      el.checked = Boolean(current);
    } else if (el.value !== (current == null ? '' : String(current))) {
      el.value = current == null ? '' : String(current);
    }

    if (el.__dblModel) return;
    el.__dblModel = true;
    var event = (el.tagName === 'SELECT' || el.type === 'radio' || el.type === 'checkbox')
      ? 'change' : 'input';
    el.addEventListener(event, function () {
      var next = el.type === 'checkbox' ? el.checked : el.value;
      run(prop + ' = __dblValue', el.__dblChain.concat([{ __dblValue: next }]), el);
      schedule();
    });
  }

  function attachHandlers(el, chain) {
    el.__dblChain = chain;
    if (el.__dblHandlers) return;
    el.__dblHandlers = true;
    Array.prototype.slice.call(el.attributes).forEach(function (a) {
      if (a.name.charAt(0) !== '@' && a.name.indexOf('x-on:') !== 0) return;
      var spec = a.name.charAt(0) === '@' ? a.name.slice(1) : a.name.slice(5);
      var parts = spec.split('.');
      var event = parts[0];
      var modifiers = parts.slice(1);
      var expr = a.value;
      el.addEventListener(event, function (evt) {
        if (modifiers.indexOf('prevent') !== -1) evt.preventDefault();
        if (modifiers.indexOf('stop') !== -1) evt.stopPropagation();
        run(expr, el.__dblChain, el, evt);
        schedule();
      });
    });
  }

  /* ── x-for ──────────────────────────────────────────────────────────────
   * Rendered nodes are reused whenever the key list is unchanged. That is not
   * an optimisation: rebuilding would reset the radio group's checked state
   * on every keystroke elsewhere in the form.
   * ──────────────────────────────────────────────────────────────────── */

  function renderFor(tpl, chain, walkFn) {
    var match = /^\s*(?:\(([^)]+)\)|([\w$]+))\s+in\s+([\s\S]+)$/.exec(tpl.getAttribute('x-for') || '');
    if (!match) return;
    var names = (match[1] || match[2]).split(',').map(function (s) { return s.trim(); });
    var itemName = names[0];
    var indexName = names[1];
    var items = evaluate(match[3], chain, tpl) || [];
    var keyExpr = tpl.getAttribute(':key') || tpl.getAttribute('x-bind:key');

    var scopes = [];
    var keys = [];
    for (var i = 0; i < items.length; i++) {
      var s = {};
      s[itemName] = items[i];
      if (indexName) s[indexName] = i;
      scopes.push(s);
      keys.push(keyExpr ? String(evaluate(keyExpr, chain.concat([s]), tpl)) : String(i));
    }

    var reusable = tpl.__dblKeys && tpl.__dblKeys.join(' ') === keys.join(' ');

    if (!reusable) {
      (tpl.__dblNodes || []).forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      tpl.__dblNodes = [];
      var anchor = tpl;
      for (var j = 0; j < scopes.length; j++) {
        var frag = tpl.content.cloneNode(true);
        var node = frag.firstElementChild;
        if (!node) continue;
        node.__dblFromFor = true;
        anchor.parentNode.insertBefore(node, anchor.nextSibling);
        anchor = node;
        tpl.__dblNodes.push(node);
      }
      tpl.__dblKeys = keys;
    }

    tpl.__dblNodes.forEach(function (node, idx) {
      walkFn(node, chain.concat([scopes[idx]]));
    });
  }

  /* ── the render pass ────────────────────────────────────────────────── */

  function walk(el, chain) {
    if (el.nodeType !== 1) return;

    if (el.tagName === 'TEMPLATE' && el.hasAttribute('x-for')) {
      renderFor(el, chain, walk);
      return;
    }

    if (el.hasAttribute('x-data') && !el.__dblOwnScope) {
      el.__dblOwnScope = makeScope(el.getAttribute('x-data'));
    }
    var localChain = el.__dblOwnScope ? chain.concat([el.__dblOwnScope]) : chain;

    Array.prototype.slice.call(el.attributes).forEach(function (a) {
      if (a.name.charAt(0) === ':') applyBinding(el, a.name, a.value, localChain);
      else if (a.name.indexOf('x-bind:') === 0) applyBinding(el, ':' + a.name.slice(7), a.value, localChain);
    });

    if (el.hasAttribute('x-model')) applyModel(el, el.getAttribute('x-model'), localChain);

    if (el.hasAttribute('x-text')) {
      var t = evaluate(el.getAttribute('x-text'), localChain, el);
      /* textContent, never innerHTML — a role label or an API message must
       * never be able to introduce markup. */
      el.textContent = t === null || t === undefined ? '' : String(t);
    }

    if (el.hasAttribute('x-show')) {
      var visible = evaluate(el.getAttribute('x-show'), localChain, el);
      el.style.display = visible ? '' : 'none';
    }

    if (el.hasAttribute('x-cloak')) el.removeAttribute('x-cloak');

    attachHandlers(el, localChain);

    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      /* Nodes produced by an x-for are walked by renderFor with the item in
       * scope; walking them again here would evaluate `r.label` with no `r`. */
      if (kids[i].__dblFromFor) continue;
      walk(kids[i], localChain);
    }
  }

  function makeScope(expr) {
    var raw;
    var name = (expr || '').trim();
    if (registry[name]) {
      raw = registry[name]();
    } else if (name === '') {
      raw = {};
    } else {
      /* eslint-disable no-new-func */
      try { raw = new Function('return (' + name + ')')() || {}; }
      catch (e) { raw = {}; }
    }
    var scope = reactive(raw);
    raw.$nextTick = function (fn) { Promise.resolve().then(function () { render(); fn.call(scope); }); };
    raw.$el = null;
    if (typeof raw.init === 'function') raw.init.call(scope);
    return scope;
  }

  function render() {
    roots.forEach(function (root) { walk(root, []); });
  }

  function boot() {
    if (roots.length) return;
    var found = d.querySelectorAll('[x-data]');
    /* Only outermost roots; nested x-data is picked up during the walk. */
    Array.prototype.slice.call(found).forEach(function (el) {
      for (var p = el.parentElement; p; p = p.parentElement) {
        if (p.hasAttribute('x-data')) return;
      }
      roots.push(el);
    });
    render();
  }

  /* Dispatched immediately, the way real Alpine does before it initialises,
   * so a page's `alpine:init` listener registers its components in time. */
  d.dispatchEvent(new Event('alpine:init'));

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window, document);

