/* ═══════════════════════════════════════════════════════════════════════════
 * LRMC — API CLIENT
 *
 * Legacy Rental Management Consortium platform. Every call to the LRMC
 * backend goes through this file. Nothing else in the frontend calls `fetch`.
 *
 * Why one file: the backend answers in a single envelope shape and refuses in
 * a small set of documented ways. Unwrapping and refusal handling written
 * once here is written once. Written per page, it is written two hundred
 * times and wrong in about thirty of them.
 *
 * Method names mirror @lrmc/sdk exactly, so a page written against this can
 * be pointed at the generated npm package later without touching the page.
 * ═══════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /* Set once, here, for the whole platform. Per-domain values live in
   * assets/js/config.js if you need HQ and the public site to differ. */
  var API_BASE = global.LRMC_API_BASE || '/api/v1';

  /* ─────────────────────────────────────────────────────────────────────────
   * Errors
   *
   * `code` matters more than `status`. Two refusals share HTTP 403 and mean
   * opposite things — see `isClearanceRequired` below.
   * ──────────────────────────────────────────────────────────────────────── */

  function LrmcError(status, code, message, details) {
    this.name = 'LrmcError';
    this.status = status;
    this.code = code || 'UNKNOWN';
    this.message = message || 'Request failed';
    this.details = details || [];
  }
  LrmcError.prototype = Object.create(Error.prototype);

  /**
   * Is this the Founder Command Center asking for the Founder Authorisation
   * Code?
   *
   * The distinction this exists for: `ZONE_RESTRICTED` and
   * `CLEARANCE_REQUIRED` are both HTTP 403, and they call for opposite
   * responses from the interface. ZONE_RESTRICTED means stop — this person
   * will never be allowed here, and prompting them for a code they cannot
   * obtain is cruel and confusing. CLEARANCE_REQUIRED means they are entitled
   * and one step short: open the code entry.
   *
   * Reading the status code alone cannot tell these apart. Read `code`.
   */
  LrmcError.prototype.isClearanceRequired = function () {
    return this.code === 'CLEARANCE_REQUIRED';
  };

  /** Locked out — a countdown, not a prompt. Three failures, then 24 hours. */
  LrmcError.prototype.isLocked = function () {
    return this.status === 423 || this.code === 'LOCKED';
  };

  /** Why the clearance was refused: 'clearanceRequired' or 'noActiveCode'. */
  LrmcError.prototype.clearanceReason = function () {
    return (this.details[0] && this.details[0].reason) || null;
  };

  /* ─────────────────────────────────────────────────────────────────────────
   * Transport
   * ──────────────────────────────────────────────────────────────────────── */

  function request(path, options) {
    options = options || {};

    var headers = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    var token = global.LrmcAuth && global.LrmcAuth.token();
    if (token) headers.Authorization = 'Bearer ' + token;

    /* The backend reads the acting zone from a header so one account with
     * several roles lands on the right surface. */
    if (options.zone) headers['x-zone'] = options.zone;

    return fetch(API_BASE + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () { return {}; })
          .then(function (envelope) { return { res: res, envelope: envelope }; });
      })
      .then(function (r) {
        var envelope = r.envelope;

        if (!r.res.ok || envelope.success === false) {
          var err = envelope.error || {};
          throw new LrmcError(
            r.res.status,
            err.code,
            err.message || r.res.statusText,
            err.details
          );
        }

        /* Every LRMC response is { success, data, meta }. Pages want the
         * data; paginated pages want meta too, so it rides along. */
        if (envelope.meta && envelope.data) {
          try { envelope.data.__meta = envelope.meta; } catch (e) { /* frozen or primitive */ }
        }
        return envelope.data;
      });
  }

  function qs(params) {
    if (!params) return '';
    var parts = [];
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function seg(v) { return encodeURIComponent(String(v)); }

  var get  = function (p, params) { return request(p + qs(params)); };
  var post = function (p, body) { return request(p, { method: 'POST', body: body || {} }); };
  var patch= function (p, body) { return request(p, { method: 'PATCH', body: body || {} }); };
  var del  = function (p) { return request(p, { method: 'DELETE' }); };

  /* ─────────────────────────────────────────────────────────────────────────
   * The LRMC surface
   *
   * Grouped by module, mirroring @lrmc/sdk. Only the operations the frontend
   * actually reaches for are listed; `Lrmc.request()` is exported for the
   * rest, so an endpoint is never unreachable just because it is not here.
   * ──────────────────────────────────────────────────────────────────────── */

  var Lrmc = {
    request: request,
    LrmcError: LrmcError,
    base: function () { return API_BASE; },

    auth: {
      register: function (b) { return post('/auth/register', b); },
      login:    function (b) { return post('/auth/login', b); },
      refresh:  function (b) { return post('/auth/refresh', b); },
      me:       function ()  { return get('/auth/me'); },
      logout:   function ()  { return post('/auth/logout'); },
      changePassword: function (b) { return post('/auth/change-password', b); },
    },

    hq: {
      commandCenter: function () { return get('/hq/command-center'); },
      dashboard:     function () { return get('/hq/dashboard'); },
      kpis:          function () { return get('/hq/kpis'); },
      systemHealth:  function () { return get('/hq/system-health'); },
      regions:       function () { return get('/hq/regions'); },
      auditLog:      function (q) { return get('/hq/audit-log', q); },
    },

    governance: {
      myVisibility:     function () { return get('/governance/me/visibility'); },
      tiers:            function () { return get('/governance/tiers'); },
      visibilityMatrix: function () { return get('/governance/visibility-matrix'); },
      health:           function () { return get('/governance/health'); },
    },

    /* Founder Authorisation Code. The six digits that open Zone A. */
    fac: {
      clearance:    function () { return get('/fac/me/clearance'); },
      verify:       function (b) { return post('/fac/verify', b); },
      standDown:    function () { return post('/fac/me/clearance/revoke'); },
      issue:        function (b) { return post('/fac-codes', b || {}); },
      listGenerations: function (q) { return get('/fac-codes', q); },
      revoke:       function (id, b) { return post('/fac-code/' + seg(id) + '/revoke', b); },
      attempts:     function (q) { return get('/fac/attempts', q); },
      lockouts:     function () { return get('/fac/lockouts'); },
      lockoutClear: function (id, b) { return post('/fac/lockout/' + seg(id) + '/clear', b); },
      requestReset: function (b) { return post('/fac/reset-requests', b); },
    },

    /* Zone E. No token required, and the backend names what it reveals
     * rather than blacklisting what it hides. */
    publicPortal: {
      content:       function (q) { return get('/public/content', q); },
      contentBySlug: function (slug) { return get('/public/content/' + seg(slug)); },
      track:         function (b) { return post('/public/track', b); },
    },

    properties: {
      /* The public listing search — vacant, publicly listed, price and photos
       * only. Distinct from `list`, which is the authenticated collection. */
      public: function (q) { return get('/properties/public', q); },
      list:   function (q) { return get('/properties', q); },
      read:   function (id) { return get('/property/' + seg(id)); },
      create: function (b) { return post('/properties', b); },
      update: function (id, b) { return patch('/property/' + seg(id), b); },
      archive:function (id) { return del('/property/' + seg(id)); },
    },

    leases:   { list: function (q) { return get('/leases', q); },
                read: function (id) { return get('/lease/' + seg(id)); },
                create: function (b) { return post('/leases', b); } },

    payments: { list: function (q) { return get('/payments', q); },
                mineAsTenant: function () { return get('/tenant/me/payments'); } },

    payouts:  { batches: function (q) { return get('/payout-batches', q); },
                settle: function (id, b) { return post('/payout-batch/' + seg(id) + '/settle', b); } },

    documents:{ queue: function () { return get('/staff/me/document-queue'); },
                mine:  function () { return get('/member/me/documents'); },
                analytics: function () { return get('/hq/documents/analytics'); } },

    maintenance: { list: function (q) { return get('/maintenance-requests', q); },
                   myQueue: function () { return get('/vendor/me/maintenance-queue'); } },

    landlords:   { list: function (q) { return get('/landlords', q); } },
    tenants:     { list: function (q) { return get('/tenants', q); } },
    drivers:     { list: function (q) { return get('/drivers', q); } },
    riders:      { list: function (q) { return get('/riders', q); } },
    staff:       { list: function (q) { return get('/staff-members', q); } },
    coordinators:{ list: function (q) { return get('/coordinators', q); } },
    vendors:     { list: function (q) { return get('/vendors', q); } },

    rides:        { list: function (q) { return get('/rides', q); } },
    notifications:{ mine: function (q) { return get('/notifications/me', q); } },
  };

  global.Lrmc = Lrmc;
})(window);
