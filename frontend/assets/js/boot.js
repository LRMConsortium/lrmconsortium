/* ═══════════════════════════════════════════════════════════════════════════
 * LRMC — BOOT
 *
 * Loaded first, before anything else, and deliberately tiny: this file has to
 * work on the connection where everything else did not.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Every LRMC page drives its chrome with Alpine — the sidebar, the mobile
 * menu, the modals. Alpine comes from a CDN. On a good connection that is
 * invisible; on intermittent Gambian mobile data it is the single most likely
 * request on the page to fail, and when it does the failure is silent.
 *
 * Measured, not guessed: with Alpine absent, on a 390px viewport, the sidebar
 * sat at `left: 0` across the whole screen with the content underneath it, and
 * the toggle button did nothing — because `:class="sidebarOpen ? … : '-translate-x-full'"`
 * is an Alpine binding and an unevaluated binding leaves the element with its
 * static classes. No console error. No visible fault. Just a page a member
 * cannot use, and no way for them to know why.
 *
 * ── What it does ──────────────────────────────────────────────────────────
 * Waits a moment for Alpine. If it does not arrive, marks the document and
 * takes over the two jobs Alpine was doing for the chrome: keeping the rail
 * off-canvas on a phone, and opening it when asked. `utilities.css` holds the
 * matching rules.
 *
 * It does NOT try to reimplement Alpine. Everything else on a page degrades to
 * "not interactive", which is survivable; a navigation rail that covers the
 * screen is not.
 * ═══════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  var doc = global.document;

  /**
   * How long to wait before deciding Alpine is not coming.
   *
   * Generous on purpose. Two and a half seconds is a long time on fibre and a
   * short time on a 2G handover, and the cost of waiting is nothing — the
   * fallback only takes effect if Alpine is genuinely absent, and if Alpine
   * arrives late the marker is removed again.
   */
  var ALPINE_TIMEOUT_MS = 2500;

  var HTML = doc.documentElement;

  function alpineIsHere() {
    return Boolean(global.Alpine);
  }

  function enterFallback() {
    if (alpineIsHere()) return;
    HTML.classList.add('lrmc-no-alpine');
    wireSidebar();
  }

  /**
   * The rail, without Alpine.
   *
   * `data-open` on the aside and the scrim, flipped by the same button Alpine
   * would have used. Deliberately reads the DOM rather than holding state in a
   * variable: if Alpine arrives late and takes over, the attribute is inert
   * and nothing has to be unwound.
   */
  function wireSidebar() {
    var aside = doc.querySelector('aside');
    var toggle = doc.querySelector('[aria-label="Toggle navigation"]');
    var scrim = doc.querySelector('.lrmc-scrim');
    if (!aside || !toggle) return;

    var set = function (open) {
      aside.setAttribute('data-open', String(open));
      if (scrim) scrim.setAttribute('data-open', String(open));
      /* Assistive technology is told, because a rail that is off-canvas is not
       * a rail somebody should be able to tab into. */
      aside.setAttribute('aria-hidden', String(!open && global.innerWidth < 1024));
    };

    set(false);
    toggle.addEventListener('click', function () {
      set(aside.getAttribute('data-open') !== 'true');
    });
    if (scrim) scrim.addEventListener('click', function () { set(false); });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') set(false);
    });
  }

  /* If Alpine turns up after the timeout — a slow connection rather than a
   * failed one — hand control back. The CSS rules are keyed on the class, so
   * removing it is the whole handover. */
  function watchForLateArrival() {
    var checks = 0;
    var timer = global.setInterval(function () {
      checks += 1;
      if (alpineIsHere()) {
        HTML.classList.remove('lrmc-no-alpine');
        global.clearInterval(timer);
      } else if (checks > 20) {
        global.clearInterval(timer);
      }
    }, 1000);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function () {
      global.setTimeout(function () { enterFallback(); watchForLateArrival(); }, ALPINE_TIMEOUT_MS);
    });
  } else {
    global.setTimeout(function () { enterFallback(); watchForLateArrival(); }, ALPINE_TIMEOUT_MS);
  }

  /* Exposed so a suite can drive it without waiting two and a half seconds. */
  global.LrmcBoot = {
    ALPINE_TIMEOUT_MS: ALPINE_TIMEOUT_MS,
    alpineIsHere: alpineIsHere,
    enterFallback: enterFallback,
  };
})(window);
