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

  /* ─────────────────────────────────────────────────────────────────────────
   * Where does a person belong once they have a session?
   *
   * Read from the actor the server returned, never from anything the client
   * decided. A tenant dropped on the HQ dashboard meets a permission error on
   * their first ever screen and concludes the platform is broken — a support
   * call, and a bad first impression that is hard to undo.
   *
   * Ordered most-privileged first, so somebody who is both a founder and a
   * landlord lands on the surface that subsumes the other.
   *
   * It lives here rather than on the sign-in page because sign-in is not the
   * only door: registration lands people too, and so will "go to my
   * dashboard" links. Two copies of this list would drift.
   * ──────────────────────────────────────────────────────────────────────── */
  var ROLE_HOME = [
    ['founder',         '/hq/index.html'],
    ['hqExecutive',     '/hq/index.html'],
    /* ── Both land on the member portal, and that is not a stopgap ────────
     * These pointed at `/staff/index.html`, and `frontend/staff/` is an empty
     * directory. Every coordinator and every back-office person — the people
     * who actually run this platform — signed in successfully and was sent to
     * a 404. On launch day that is the entire operations team.
     *
     * The member portal is one surface read three ways, and `portal.js`
     * resolves the **coordinator reading** from grants rather than from a role
     * name. Both of these roles hold `analytics:read`, `property:read` and
     * `maintenanceRequest:assign`, so both get that reading; both list
     * `MEMBER_PORTAL` in `allowedZones`, so both may enter. The portal's own
     * suite covers that reading in 446 assertions.
     *
     * A dedicated `/staff/` surface is still worth building — Back Office does
     * things the portal has no screen for, chiefly document review and
     * marketplace adjudication. But it is a project, and it must not be what
     * stands between a coordinator and a working login. */
    ['backOfficeStaff', '/members/index.html'],
    ['coordinator',     '/members/index.html'],
    ['merchant',        '/marketplace/index.html'],
    ['seller',          '/marketplace/index.html'],
    ['customer',        '/marketplace/index.html'],
    ['buyer',           '/marketplace/index.html'],
  ];

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

    /**
     * The landing page for an actor.
     *
     * Everyone not named above — landlords, tenants, drivers, riders, vendors
     * — is a member. That is the largest group, so it is the fallback rather
     * than a second list that has to be kept in step with `config/roles.ts`.
     */
    homeFor: function (actor) {
      var roles = (actor && actor.roles) || [];
      for (var i = 0; i < ROLE_HOME.length; i++) {
        if (roles.indexOf(ROLE_HOME[i][0]) !== -1) return ROLE_HOME[i][1];
      }
      return '/members/index.html';
    },

    /**
     * Take a session from an auth response and hold it.
     *
     * Separate from `signIn` because sign-in is not the only thing that
     * returns tokens: `POST /auth/register` returns the same shape, and a
     * person who has just typed a password twice should not be asked for it a
     * third time. Both doors store the session the same way, which is what
     * makes them behave the same afterwards.
     */
    adopt: function (data) {
      memory.token = (data && (data.accessToken || data.token)) || null;
      memory.refresh = (data && data.refreshToken) || null;
      memory.actor = (data && (data.user || data.actor)) || null;

      store(TOKEN_KEY, memory.token);
      store(REFRESH_KEY, memory.refresh);
      store(ACTOR_KEY, memory.actor ? JSON.stringify(memory.actor) : null);

      return memory.actor;
    },

    signIn: function (credentials) {
      return global.Lrmc.auth.login(credentials).then(LrmcAuth.adopt);
    },

    signOut: function () {
      /* Read the tokens BEFORE clearing them.
       *
       * This used to clear first and then call `logout()` with no body, on the
       * reasoning that a failed network call should still leave the person
       * signed out locally — which is right, and is still how it works below.
       * But it meant the server was never told *which* session had ended, and
       * for a while it meant nothing at all: there was no `/auth/logout` route,
       * the 404 was swallowed by this very `.catch`, and the thirty-day refresh
       * token stayed valid for anybody holding a copy long after the person
       * believed they had signed out.
       *
       * The refresh token is the thing worth revoking, so it has to survive
       * long enough to be sent. The access token authenticates the request. */
      var refresh = memory.refresh || load(REFRESH_KEY);
      var revoke = global.Lrmc.auth.logout(refresh ? { refreshToken: refresh } : {})
        .catch(function () { /* best effort — see below */ });

      /* Cleared regardless of what the server says. The person asked to leave;
       * a network failure must not keep them signed in on this device. */
      memory = { token: null, refresh: null, actor: null };
      store(TOKEN_KEY, null);
      store(REFRESH_KEY, null);
      store(ACTOR_KEY, null);

      return revoke;
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
