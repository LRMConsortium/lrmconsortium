/* ═══════════════════════════════════════════════════════════════════════════
 * LRMC — SESSION AND ACCESS
 *
 * Legacy Rental Management Consortium platform.
 *
 * Holds the access token, decides what the navigation shows, and wires the
 * token into every HTMX request so pages can use plain `hx-get` without
 * thinking about headers.
 *
 * A standing warning about the last of those: **what this file hides is a
 * courtesy, not a control.** Hiding a menu item stops an honest person
 * clicking the wrong thing. It stops nobody who opens the network tab. Every
 * rule below is enforced again by the LRMC backend, which is the only place
 * enforcement counts.
 * ═══════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  var TOKEN_KEY = 'lrmc.token';
  var REFRESH_KEY = 'lrmc.refresh';
  var ACTOR_KEY = 'lrmc.actor';

  var memory = { token: null, refresh: null, actor: null };

  /* sessionStorage where available, memory otherwise. Wrapped because a
   * browser in private mode can throw on access, and a thrown exception here
   * would take down every page on the platform. */
  function store(key, value) {
    try {
      if (value === null) global.sessionStorage.removeItem(key);
      else global.sessionStorage.setItem(key, value);
    } catch (e) { /* fall through to memory */ }
  }

  function load(key) {
    try { return global.sessionStorage.getItem(key); } catch (e) { return null; }
  }

  var LrmcAuth = {

    token: function () {
      if (memory.token) return memory.token;
      memory.token = load(TOKEN_KEY);
      return memory.token;
    },

    /** The signed-in person, as the backend describes them. */
    actor: function () {
      if (memory.actor) return memory.actor;
      var raw = load(ACTOR_KEY);
      if (!raw) return null;
      try { memory.actor = JSON.parse(raw); } catch (e) { memory.actor = null; }
      return memory.actor;
    },

    isSignedIn: function () { return Boolean(LrmcAuth.token()); },

    roles: function () {
      var a = LrmcAuth.actor();
      return (a && a.roles) || [];
    },

    primaryRole: function () {
      var a = LrmcAuth.actor();
      return (a && a.primaryRole) || null;
    },

    hasRole: function (role) { return LrmcAuth.roles().indexOf(role) !== -1; },

    isFounder: function () { return LrmcAuth.hasRole('founder'); },

    /**
     * Does the actor hold this permission?
     *
     * Mirrors the backend matcher including its three wildcard forms, so the
     * navigation and the API agree about what is reachable. Where they
     * disagree the backend wins — and the user sees a refusal instead of a
     * hidden link, which is the less confusing failure of the two.
     */
    can: function (permission) {
      var grants = (LrmcAuth.actor() || {}).grants || [];
      if (grants.indexOf('*:*') !== -1) return true;
      if (grants.indexOf(permission) !== -1) return true;

      var parts = String(permission).split(':');
      var resource = parts[0], action = parts[1];
      return grants.indexOf(resource + ':*') !== -1 || grants.indexOf('*:' + action) !== -1;
    },

    /** May this actor enter this HQ zone? Advisory — the backend re-checks. */
    mayEnterZone: function (zone) {
      var a = LrmcAuth.actor();
      if (!a) return false;
      if ((a.restrictedZones || []).indexOf(zone) !== -1) return false;
      if ((a.allowedZones || []).indexOf(zone) !== -1) return true;
      return false;
    },

    signIn: function (credentials) {
      return global.Lrmc.auth.login(credentials).then(function (data) {
        memory.token = data.accessToken || data.token || null;
        memory.refresh = data.refreshToken || null;
        memory.actor = data.user || data.actor || null;

        store(TOKEN_KEY, memory.token);
        store(REFRESH_KEY, memory.refresh);
        store(ACTOR_KEY, memory.actor ? JSON.stringify(memory.actor) : null);

        return memory.actor;
      });
    },

    signOut: function () {
      /* Clear locally first. If the network call fails the person is still
       * signed out on this device, which is the outcome they asked for. */
      memory = { token: null, refresh: null, actor: null };
      store(TOKEN_KEY, null);
      store(REFRESH_KEY, null);
      store(ACTOR_KEY, null);

      return global.Lrmc.auth.logout().catch(function () { /* best effort */ });
    },

    /** Send an unauthenticated visitor to sign in, remembering where. */
    requireSession: function (loginPath) {
      if (LrmcAuth.isSignedIn()) return true;
      var next = encodeURIComponent(global.location.pathname + global.location.search);
      global.location.replace((loginPath || '/public/login.html') + '?next=' + next);
      return false;
    },
  };

  /* ─────────────────────────────────────────────────────────────────────────
   * HTMX wiring
   *
   * Two listeners, and every `hx-get` on the platform is authenticated and
   * handles refusal correctly. The alternative is remembering to do it on
   * each of several hundred pages.
   * ──────────────────────────────────────────────────────────────────────── */

  global.document.body.addEventListener('htmx:configRequest', function (evt) {
    var token = LrmcAuth.token();
    if (token) evt.detail.headers.Authorization = 'Bearer ' + token;
    evt.detail.headers.Accept = 'application/json, text/html';

    /* Pages declare their zone once on <body data-zone="…">. */
    var zone = global.document.body.getAttribute('data-zone');
    if (zone) evt.detail.headers['x-zone'] = zone;
  });

  global.document.body.addEventListener('htmx:responseError', function (evt) {
    var xhr = evt.detail.xhr;
    var payload = {};
    try { payload = JSON.parse(xhr.responseText) || {}; } catch (e) { /* not JSON */ }
    var error = payload.error || {};

    if (xhr.status === 401) {
      LrmcAuth.signOut();
      global.location.replace('/public/login.html');
      return;
    }

    /* The Founder Command Center asking for the code. Not a dead end — open
     * the entry, do not print "access denied" at somebody who is entitled. */
    if (error.code === 'CLEARANCE_REQUIRED') {
      var reason = (error.details && error.details[0] && error.details[0].reason) || 'clearanceRequired';
      global.document.body.dispatchEvent(
        new CustomEvent('lrmc:clearance-required', { detail: { reason: reason, message: error.message } })
      );
      return;
    }

    if (global.LrmcUI && global.LrmcUI.toast) {
      global.LrmcUI.toast(error.message || 'Something went wrong', 'danger');
    }
  });

  global.LrmcAuth = LrmcAuth;
})(window);
