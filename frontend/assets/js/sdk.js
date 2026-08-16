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
      /* Send the refresh token. It is the only thing the server can revoke —
       * the access token is a stateless JWT and expires on its own schedule —
       * so a logout with an empty body clears this browser and leaves the
       * session alive everywhere else. `LrmcAuth.signOut` reads it before
       * clearing storage for exactly this reason. */
      logout:   function (b) { return post('/auth/logout', b || {}); },
      changePassword: function (b) { return post('/auth/change-password', b); },
    },

    /* Fault reports from a browser.
     *
     * Zone E and unauthenticated on purpose: the most valuable report is the
     * one from a page that broke before the member could sign in, and requiring
     * a token would discard exactly those.
     *
     * Nothing about the outcome comes back. A caller learns that LRMC received
     * the report and nothing about what was done with it — an intake that
     * echoed its own grading would be a way to discover the thresholds. */
    errors: {
      capture: function (b) { return post('/security/errors', b); },
      recent:  function (q) { return get('/security/errors', q); },
      anomalies: function () { return get('/security/anomalies'); },
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

    /* Aggregates.
     *
     * Every dashboard tile used to count a page of list results. That is right
     * at ten properties and wrong at two hundred, and wrong in the direction
     * nobody notices: the number stays plausible, it just gets too small. Each
     * of these is one aggregation over the whole collection.
     *
     * There is no `owner` or `region` argument and there must never be one.
     * The scope is derived server-side from the token — a landlord gets their
     * portfolio, a coordinator their region, Back Office everything — because
     * a parameter a page could set would turn each of these into a directory
     * of the institution's holdings.
     *
     * Rates come back `null` rather than `0` when there is nothing to measure.
     * Render `—`; a landlord reading "0% reliability" on their first day
     * reasonably concludes something is broken. */
    stats: {
      properties:   function () { return get('/stats/properties'); },
      payments:     function () { return get('/stats/payments'); },
      maintenance:  function () { return get('/stats/maintenance'); },
      applications: function () { return get('/stats/applications'); },
      ususu:        function () { return get('/stats/ususu'); },
    },

    /* The five things LRMC looks up about an applicant. Reading somebody
     * else's is staff-only; the server narrows on the subject, not on what
     * the caller asks for. */
    evidence: {
      requestReference: function (b) { return post('/references/request', b); },
      respondToReference: function (b) { return post('/references/respond', b); },
      referencesFor: function (id) { return get('/references/' + seg(id)); },

      openDispute: function (b) { return post('/disputes/open', b); },
      resolveDispute: function (id, b) { return post('/dispute/' + seg(id) + '/resolve', b); },
      disputesFor: function (id) { return get('/disputes/' + seg(id)); },

      /* Ususu circles.
       *
       * The group routes are mounted before `/ususu/:subjectId` on the server,
       * because `/ususu/group/x` matches that pattern with `subjectId="group"`.
       * Nothing here depends on that — these are literal paths — but it is why
       * the two families can coexist. */
      createGroup:       function (b) { return post('/ususu/group/create', b); },
      groupAddMember:    function (b) { return post('/ususu/group/add-member', b); },
      groupRemoveMember: function (b) { return post('/ususu/group/remove-member', b); },
      groupContribute:   function (b) { return post('/ususu/group/contribute', b); },
      groupMiss:         function (b) { return post('/ususu/group/miss', b); },
      readGroup:         function (id) { return get('/ususu/group/' + seg(id)); },
      groupSummary:      function (id) { return get('/ususu/group/' + seg(id) + '/summary'); },
      groupsForUser:     function (id) { return get('/ususu/group/user/' + seg(id)); },

      ususuContribute: function (b) { return post('/ususu/contribute', b); },
      ususuMiss: function (b) { return post('/ususu/miss', b); },
      ususuFor: function (id) { return get('/ususu/' + seg(id)); },
    },

    /* Asking to see a property. Every rule about *when* is server-side in
     * `viewingRules` — this is only the wire. */
    viewings: {
      list:     function (q) { return get('/viewings', q); },
      read:     function (id) { return get('/viewing/' + seg(id)); },
      request:  function (b) { return post('/viewings', b); },
      update:   function (id, b) { return patch('/viewing/' + seg(id), b); },
      confirm:  function (id, b) { return post('/viewing/' + seg(id) + '/confirm', b || {}); },
      decline:  function (id, b) { return post('/viewing/' + seg(id) + '/decline', b || {}); },
      cancel:   function (id, b) { return post('/viewing/' + seg(id) + '/cancel', b || {}); },
      complete: function (id, b) { return post('/viewing/' + seg(id) + '/complete', b || {}); },
      noShow:   function (id, b) { return post('/viewing/' + seg(id) + '/no-show', b || {}); },
    },

    /* Asking to live in one. `assess` recommends; `approve` and `reject` are
     * the only calls that decide, and both require a reason. */
    applications: {
      list:    function (q) { return get('/applications', q); },
      read:    function (id) { return get('/application/' + seg(id)); },
      apply:   function (b) { return post('/applications', b); },
      update:  function (id, b) { return patch('/application/' + seg(id), b); },
      assess:  function (id) { return post('/application/' + seg(id) + '/assess', {}); },
      review:  function (id) { return post('/application/' + seg(id) + '/review', {}); },
      requestInformation: function (id, b) {
        return post('/application/' + seg(id) + '/request-information', b);
      },
      approve:  function (id, b) { return post('/application/' + seg(id) + '/approve', b); },
      reject:   function (id, b) { return post('/application/' + seg(id) + '/reject', b); },
      withdraw: function (id) { return post('/application/' + seg(id) + '/withdraw', {}); },
      recordLease: function (id, b) { return post('/application/' + seg(id) + '/lease', b); },
    },

    /* Tenancies.
     *
     * The three lifecycle acts are separate calls rather than one `update`
     * with a status, because they are separate *powers*: a landlord holds
     * activate and complete, a coordinator holds terminate, and a tenant holds
     * none. One endpoint taking a status would hide that behind a parameter.
     *
     * Which of them this person may actually use is decided entirely
     * server-side by `leaseLifecycle` — the page offers what the grants
     * suggest and re-reads whatever the server allowed. */
    leases:   { list: function (q) { return get('/leases', q); },
                read: function (id) { return get('/lease/' + seg(id)); },
                create: function (b) { return post('/leases', b); },
                draft:  function (b) { return post('/leases/create', b); },
                activate: function (b) { return post('/leases/activate', b); },
                complete: function (b) { return post('/leases/complete', b); },
                terminate: function (b) { return post('/leases/terminate', b); },
                forUser: function (id, q) { return get('/leases/user/' + seg(id), q); },
                forProperty: function (id, q) { return get('/leases/property/' + seg(id), q); } },

    /* The ledger.
     *
     * `record` is the only write, and it is deliberately the only one. See the
     * note on the `record` action in the backend's permissions config: writing
     * down cash taken in a compound is a different power from starting a
     * payment, and only a coordinator or Back Office holds it.
     *
     * `history` and `summary` are scoped server-side from the token. A
     * coordinator gets back only the receipts they wrote themselves, and the
     * reply says so in `scope` and `partial` — show it, because a partial total
     * read as a whole one is worse than no total. */
    payments: { list: function (q) { return get('/payments', q); },
                mineAsTenant: function () { return get('/tenant/me/payments'); },
                mineAsLandlord: function () { return get('/landlord/me/payments'); },
                history: function (id, q) { return get('/payments/' + seg(id) + '/history', q); },
                summary: function (id) { return get('/payments/' + seg(id) + '/summary'); },
                record: function (b) { return post('/payments/record', b); } },

    payouts:  { batches: function (q) { return get('/payout-batches', q); },
                settle: function (id, b) { return post('/payout-batch/' + seg(id) + '/settle', b); } },

    documents:{ queue: function () { return get('/staff/me/document-queue'); },
                mine:  function () { return get('/member/me/documents'); },
                analytics: function () { return get('/hq/documents/analytics'); } },

    /* Work orders.
     *
     * `updateStatus` sends the id in the body because that is the shape the
     * route takes — see its contract note. Which changes are legal is decided
     * entirely server-side by `maintenanceLifecycle`: this page never works out
     * whether a transition is allowed, it asks and re-reads the answer. */
    maintenance: { list: function (q) { return get('/maintenance-requests', q); },
                   myQueue: function () { return get('/vendor/me/maintenance-queue'); },
                   request: function (b) { return post('/maintenance/request', b); },
                   updateStatus: function (b) { return post('/maintenance/update', b); },
                   listForUser: function (id, q) { return get('/maintenance/' + seg(id) + '/list', q); },
                   summaryForUser: function (id) { return get('/maintenance/' + seg(id) + '/summary'); } },

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
