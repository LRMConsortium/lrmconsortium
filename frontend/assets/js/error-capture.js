/* ═══════════════════════════════════════════════════════════════════════════
 * LRMC — ERROR CAPTURE
 *
 * Tells LRMC when a member's page is broken, so nobody has to telephone.
 *
 * ── Why the last of the five kinds is the reason this exists ──────────────
 * Four of what this watches will throw something: an uncaught exception, a
 * rejected promise, a failed request, a script that did not load. The fifth
 * will not. A **dead path** is a control that should do something and does not
 * — and that is the one that cost four weeks: Alpine failing left the sidebar
 * covering the phone with no console error, no failed request and nothing in
 * any log. A member meeting it has no vocabulary beyond "the app is broken",
 * and most will not say even that; they will stop using it.
 *
 * ── What it must never send ───────────────────────────────────────────────
 * Anything about the person. No form values, no input contents, no full URL —
 * a query string on this platform is where somebody's name goes. The stack is
 * truncated and the URL is sent for the server to reduce to a template. The
 * server redacts again on arrival, because one layer of grep is not a defence.
 *
 * ── What it must never do ─────────────────────────────────────────────────
 * Interfere. It never blocks, never retries in a loop, never re-throws, and it
 * gives up permanently after a handful of reports. A page in a render loop must
 * not become a page hammering LRMC, and — far more importantly — the reporting
 * of a fault must never itself become the fault. If this file throws, it
 * swallows it; a member trying to pay their rent is not helped by a diagnostic.
 * ═══════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  var doc = global.document;

  /**
   * The most this browser will ever send.
   *
   * Small on purpose. Twenty identical reports say nothing the first one did
   * not, and a page that is genuinely looping would otherwise send thousands.
   * The server has its own bound; this one exists so the member's own
   * connection — which is the scarce thing — is not spent on it.
   */
  var MAX_REPORTS = 8;

  /** How long a control has to respond before it counts as dead. */
  var DEAD_PATH_MS = 400;

  var sent = 0;
  var seen = {};

  function send(kind, fields) {
    if (sent >= MAX_REPORTS) return;

    /* One report per distinct fault. A loop emits the same message forever and
     * the second copy tells nobody anything. */
    var signature = kind + '|' + (fields.message || '') + '|' + (fields.control || '');
    if (seen[signature]) return;
    seen[signature] = true;
    sent += 1;

    var body = {
      kind: kind,
      message: String(fields.message || 'unknown').slice(0, 900),
      /* The full URL, for the server to reduce to a path template. Sent whole
       * rather than trimmed here because the server does it consistently and a
       * second implementation is a second thing to get wrong. */
      url: global.location ? global.location.href : undefined,
    };
    if (fields.source) body.source = String(fields.source).slice(0, 600);
    if (typeof fields.line === 'number') body.line = fields.line;
    if (typeof fields.column === 'number') body.column = fields.column;
    if (fields.stack) body.stack = String(fields.stack).slice(0, 3500);
    if (fields.control) body.control = String(fields.control).slice(0, 200);

    try {
      /* Through the SDK, so the envelope and the base URL are handled in one
       * place — and `.catch` swallowing everything, because a failure to report
       * a failure is not worth a second failure. */
      if (global.Lrmc && global.Lrmc.errors) {
        global.Lrmc.errors.capture(body).catch(function () {});
      }
    } catch (e) { /* never let reporting become the fault */ }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * The four that throw
   * ──────────────────────────────────────────────────────────────────────── */

  global.addEventListener('error', function (e) {
    /* A resource that did not load fires `error` on the element rather than on
     * the window, with no `message`. Different fault, different kind: a missing
     * script is a deployment problem and an exception is a code problem. */
    var target = e.target;
    if (target && target !== global && (target.src || target.href)) {
      send('assetFailure', {
        message: (target.tagName || 'resource') + ' did not load',
        source: target.src || target.href,
      });
      return;
    }
    send('uncaught', {
      message: e.message,
      source: e.filename,
      line: e.lineno,
      column: e.colno,
      stack: e.error && e.error.stack,
    });
  }, true);

  global.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    send('unhandledRejection', {
      message: (reason && (reason.message || reason.code)) || String(reason),
      stack: reason && reason.stack,
    });
  });

  /* ─────────────────────────────────────────────────────────────────────────
   * The one that does not
   * ──────────────────────────────────────────────────────────────────────── */

  /**
   * Alpine never arrived.
   *
   * `boot.js` already handles this — it marks the document and takes over the
   * chrome, so the member can still use the page. This reports it, which is the
   * part that was missing: the fallback works silently, so without this nobody
   * at LRMC would ever learn how often it is needed.
   */
  function watchForFramework() {
    global.setTimeout(function () {
      if (!global.Alpine) {
        send('frameworkMissing', {
          message: 'Alpine did not load; the page is running on the fallback chrome',
        });
      }
    }, (global.LrmcBoot && global.LrmcBoot.ALPINE_TIMEOUT_MS ? global.LrmcBoot.ALPINE_TIMEOUT_MS : 2500) + 500);
  }

  /**
   * A control that does nothing.
   *
   * The interesting one, and the one nothing else can see. Watches the buttons
   * whose whole job is to change the page, and reports the ones that are tapped
   * and produce no change at all — no DOM mutation, no navigation, no request.
   *
   * A person who meets this has no way to describe it. "I pressed the menu and
   * nothing happened" is not something most people will ring up to say, and it
   * is the exact failure that hid for four weeks.
   */
  function watchForDeadPaths() {
    doc.addEventListener('click', function (e) {
      var el = e.target && e.target.closest
        ? e.target.closest('button, [role="tab"], a[href^="#"]')
        : null;
      if (!el) return;
      /* A submit button's job is to submit; the form's own handling reports its
       * own failures, and a slow save is not a dead control. */
      if (el.type === 'submit') return;

      var label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60);
      var before = snapshot();

      global.setTimeout(function () {
        if (snapshot() !== before) return;          // something changed: fine
        if (global.__lrmcPendingRequests > 0) return; // waiting on the server: fine
        send('deadPath', {
          message: 'A control was tapped and the page did not change',
          control: label || el.tagName,
        });
      }, DEAD_PATH_MS);
    }, true);
  }

  /**
   * A cheap fingerprint of "has the page changed".
   *
   * Deliberately coarse — the size of the body's markup, the URL, and how many
   * elements are on screen. A precise diff would be expensive and would fire on
   * a blinking cursor; this catches "nothing at all happened", which is the
   * only thing being asked.
   */
  function snapshot() {
    try {
      return [
        global.location.href,
        doc.body ? doc.body.innerHTML.length : 0,
        doc.querySelectorAll('*').length,
        /* Attribute state, because `hidden` and `data-open` are how most of
         * this platform's controls express themselves and neither changes the
         * markup length by much. */
        doc.querySelectorAll('[hidden]').length,
        doc.querySelectorAll('[data-open="true"]').length,
      ].join(':');
    } catch (e) {
      return 'unknown';
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Network
   *
   * A request that fails at the transport layer never reaches the SDK's error
   * handling — there is no status and no envelope, only a rejected promise. On
   * the connections LRMC serves this is ordinary rather than alarming, which is
   * why the server grades it as noise; it is worth counting all the same,
   * because the rate is the interesting part.
   * ──────────────────────────────────────────────────────────────────────── */

  function watchNetwork() {
    if (!global.fetch) return;
    var original = global.fetch;
    global.__lrmcPendingRequests = 0;

    global.fetch = function () {
      /* Read the target here, in the wrapper, and not in the rejection handler
       * below. Inside that handler `arguments` is the *handler's* own — one
       * element, the error — so the guard would have been asking the error
       * message whether it was the reporting endpoint, which it never is. The
       * guard would then have been silently absent exactly when it mattered:
       * on a connection bad enough for the report itself to fail. */
      var target = '';
      try {
        var first = arguments[0];
        target = String((first && first.url) || first || '');
      } catch (e) { target = ''; }

      global.__lrmcPendingRequests += 1;
      /* `this || global`: a caller that took a bare reference (`var f = fetch`)
       * hands us `undefined`, and a native fetch invoked without its window
       * throws "Illegal invocation" — the wrapper would have broken the request
       * it exists only to watch. */
      return original.apply(this || global, arguments).then(function (res) {
        global.__lrmcPendingRequests -= 1;
        return res;
      }, function (err) {
        global.__lrmcPendingRequests -= 1;
        /* Not the report endpoint itself. A network failure while reporting a
         * network failure is how a bad connection turns into a loop. */
        if (target.indexOf('/security/errors') === -1) {
          send('networkFailure', { message: (err && err.message) || 'request failed' });
        }
        throw err;
      });
    };
  }

  function start() {
    watchNetwork();
    watchForFramework();
    watchForDeadPaths();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* Exposed so a suite can drive it without waiting, and so a page can report
   * something it knows about that nothing else would see. */
  global.LrmcErrors = {
    MAX_REPORTS: MAX_REPORTS,
    DEAD_PATH_MS: DEAD_PATH_MS,
    report: send,
    sentCount: function () { return sent; },
  };
})(window);
