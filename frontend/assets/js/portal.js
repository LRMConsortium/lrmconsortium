/* ═══════════════════════════════════════════════════════════════════════════
 * LRMC — MEMBER PORTAL, SHARED LAYER
 *
 * Five pages read from this file: the overview, payments, maintenance,
 * applications and the performance dashboard. Everything they have in common
 * lives here exactly once — the reading resolver, the tile renderer, the card
 * renderers, the status vocabularies, and the loader that keeps a slow endpoint
 * from costing a whole screen.
 *
 * ── Why one file and not five copies ─────────────────────────────────────
 * Not tidiness. Every rule in here is one that has already been got wrong once
 * on this platform, and a copy is a place for it to be got wrong again:
 *
 *   • `null` renders `—`, `0` renders `0`. Five copies of `value || '—'` is
 *     four future tiles telling a landlord on their first day that their
 *     occupancy is nought per cent.
 *   • Money is never summed across currencies. There is no exchange rate on
 *     this platform; a page that adds dalasi to dollars produces a figure that
 *     is not an amount of anything and looks entirely ordinary.
 *   • `unknown` is neutral, never danger. An unchecked factor is LRMC's missing
 *     paperwork, and colouring it red tells an applicant it is their failing.
 *   • Everything a server sends is escaped before it reaches innerHTML.
 *
 * ── What this file never does ────────────────────────────────────────────
 * It never decides anything. No status transition is computed here, no
 * eligibility is scored here, no scope is chosen here. A record is in a state
 * because the server said so, and this file draws it. `LrmcStatus` names
 * states; `applicationLifecycle` and `maintenanceLifecycle` on the server
 * decide which are reachable.
 * ═══════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  var esc = function (v) { return global.LrmcUI.esc(v); };

  /* ─────────────────────────────────────────────────────────────────────────
   * Readings
   *
   * The member portal is one surface read three ways: as a coordinator with a
   * region, a landlord with a portfolio, or a tenant with a home. The same
   * account can hold several — a coordinator who also lets a flat is ordinary —
   * so a page resolves a *reading* rather than routing to a different page.
   *
   * The clamp below is a courtesy, not a control. Every endpoint behind it is
   * gated again server-side; the reason a tenant is not shown the coordinator
   * reading is that it would be a screen of empty tiles and refusals, which
   * tells them nothing and looks broken.
   * ──────────────────────────────────────────────────────────────────────── */

  /* Widest first. Somebody holding two lands on the larger responsibility,
   * which is the one they are more likely to have opened the page for. */
  var READING_ORDER = ['coordinator', 'landlord', 'tenant'];

  /**
   * Which readings this person's grants support.
   *
   * Grants, not role names. `LrmcAuth.can` reads what the token actually
   * carries, and the permission strings are the same ones the backend gates on
   * — so a role gaining or losing a permission changes this without an edit
   * here, and the page and the server cannot drift into disagreeing.
   */
  function availableReadings() {
    var out = [];
    if (global.LrmcAuth.can('analytics:read')
        || global.LrmcAuth.can('property:read')
        || global.LrmcAuth.can('maintenanceRequest:assign')) {
      out.push('coordinator');
    }
    if (global.LrmcAuth.can('property:create')
        || global.LrmcAuth.can('property:updateOwn')) {
      out.push('landlord');
    }
    /* Anybody with a session has a tenant reading: their own payments, their
     * own applications, their own home. It is the floor, never absent. */
    out.push('tenant');
    return out;
  }

  function resolveReading(requested, available) {
    if (requested && available.indexOf(requested) !== -1) return requested;
    for (var i = 0; i < READING_ORDER.length; i += 1) {
      if (available.indexOf(READING_ORDER[i]) !== -1) return READING_ORDER[i];
    }
    return 'tenant';
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Tiles
   * ──────────────────────────────────────────────────────────────────────── */

  /**
   * One figure.
   *
   * `value === null` is a distinct state from `'0'` and renders `—` with "Not
   * available yet" beneath it. Callers pass null deliberately: either the
   * server returned null for a rate it could not compute, or the request
   * failed. Both mean "LRMC has not measured this", which is a different
   * statement from "the answer is nought" and must not look the same.
   */
  function tile(label, value, meta) {
    var unknown = value === null || value === undefined;
    return '<div class="lrmc-card">' +
      '<p class="lrmc-stat-label">' + esc(label) + '</p>' +
      '<p class="lrmc-stat-value">' + (unknown ? '—' : esc(value)) + '</p>' +
      '<p class="lrmc-stat-meta">' +
        esc(unknown ? 'Not available yet' : (meta || '')) + '</p>' +
      '</div>';
  }

  /**
   * A percentage the server may not have been able to compute.
   *
   * Passing a null straight to `LrmcUI.percent` prints `0.0%`. This keeps null
   * as null so `tile` renders the dash.
   */
  function pct(value) {
    if (value === null || value === undefined) return null;
    return global.LrmcUI.percent(value, 1);
  }

  /** A count, or null. Same distinction as `pct`, for integers. */
  function count(value) {
    if (value === null || value === undefined) return null;
    return String(value);
  }

  function skeletons(box, n) {
    var out = '';
    for (var i = 0; i < n; i += 1) {
      out += '<div class="lrmc-card"><div class="lrmc-skeleton h-4 w-1/2 mb-3"></div>' +
        '<div class="lrmc-skeleton h-7 w-2/3"></div></div>';
    }
    box.innerHTML = out;
  }

  function paint(box, html) {
    box.innerHTML = html;
    if (global.lucide) global.lucide.createIcons();
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Money
   *
   * `collected` and `settledByCurrency` come back as one row per currency,
   * deliberately not summed, because there is no exchange rate anywhere on this
   * platform. These two functions are the only place a page turns that into
   * something to look at, and neither of them adds the rows together.
   * ──────────────────────────────────────────────────────────────────────── */

  var LAUNCH_CURRENCY = 'GMD';

  /** The launch currency's figure, or the largest if there is none. */
  function moneyOf(rows) {
    if (!Array.isArray(rows)) return null;
    if (!rows.length) return global.LrmcUI.moneyWhole(0, LAUNCH_CURRENCY);
    var launch = rows.filter(function (r) { return r.currency === LAUNCH_CURRENCY; })[0];
    var first = launch || rows[0];
    return global.LrmcUI.moneyWhole(first.amount, first.currency);
  }

  /** How many other currencies exist, said out loud rather than folded in. */
  function moneyMeta(rows, whenSingle) {
    if (!Array.isArray(rows)) return '';
    if (!rows.length) return 'Nothing settled in this period';
    var others = rows.length - 1;
    return others > 0
      ? 'Plus ' + others + ' other ' + (others === 1 ? 'currency' : 'currencies')
      : (whenSingle || 'Settled through LRMC');
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Status vocabularies
   *
   * Names only. Which states are reachable is the server's business — see
   * `maintenanceLifecycle.ts` and `applicationLifecycle.ts`. A page that
   * decided a transition was allowed would be a page that disagrees with the
   * database the moment a rule changes.
   * ──────────────────────────────────────────────────────────────────────── */

  var PAYMENT = {
    succeeded:  { label: 'Settled',    tone: 'success' },
    pending:    { label: 'Due',        tone: 'warning' },
    processing: { label: 'In flight',  tone: 'warning' },
    failed:     { label: 'Failed',     tone: 'danger'  },
    refunded:   { label: 'Refunded',   tone: 'neutral' },
    cancelled:  { label: 'Cancelled',  tone: 'neutral' },
  };

  var MAINTENANCE = {
    open:       { label: 'Reported',    tone: 'warning' },
    triaged:    { label: 'Triaged',     tone: 'info'    },
    quoted:     { label: 'Quoted',      tone: 'info'    },
    approved:   { label: 'Approved',    tone: 'info'    },
    assigned:   { label: 'Assigned',    tone: 'info'    },
    inProgress: { label: 'In progress', tone: 'info'    },
    /* Neutral, not danger. A job on hold is waiting on a decision, not a
     * failure, and colouring it red makes a queue unreadable. */
    onHold:     { label: 'On hold',     tone: 'neutral' },
    completed:  { label: 'Completed',   tone: 'success' },
    verified:   { label: 'Verified',    tone: 'success' },
    cancelled:  { label: 'Cancelled',   tone: 'neutral' },
  };

  /**
   * Leases.
   *
   * `inArrears` is amber, not red. A tenant behind on rent is a tenant with a
   * problem, not a failed tenancy — and a queue where every late payment is red
   * is one nobody reads. `terminated` is neutral for the same reason it is not
   * scored against an applicant: tenancies end early for many reasons and only
   * some of them are about the tenant.
   */
  var LEASE = {
    draft:            { label: 'Draft',      tone: 'neutral' },
    pendingSignature: { label: 'Unsigned',   tone: 'warning' },
    active:           { label: 'Active',     tone: 'success' },
    inArrears:        { label: 'In arrears', tone: 'warning' },
    expiring:         { label: 'Expiring',   tone: 'warning' },
    completed:        { label: 'Completed',  tone: 'success' },
    terminated:       { label: 'Terminated', tone: 'neutral' },
  };

  /**
   * Ususu circles.
   *
   * `forming` is neutral, not a warning. A circle being put together is the
   * ordinary first state of every circle, and an amber badge on it would make
   * a coordinator's list of new groups read like a list of problems.
   */
  var USUSU_GROUP = {
    forming: { label: 'Forming', tone: 'neutral' },
    active:  { label: 'Active',  tone: 'success' },
    paused:  { label: 'Paused',  tone: 'warning' },
    closed:  { label: 'Closed',  tone: 'neutral' },
  };

  var PRIORITY = {
    low:       { label: 'Low',       tone: 'neutral' },
    normal:    { label: 'Normal',    tone: 'info'    },
    high:      { label: 'High',      tone: 'warning' },
    emergency: { label: 'Emergency', tone: 'danger'  },
  };

  function badge(table, key) {
    var e = table[key] || { label: key || 'Unknown', tone: 'neutral' };
    return '<span class="lrmc-badge lrmc-badge-' + e.tone + '">' + esc(e.label) + '</span>';
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Card renderers
   *
   * One per record type, shared by every page that shows that record. The
   * payments page and the overview draw a payment the same way because they
   * call the same function, not because two people remembered to.
   * ──────────────────────────────────────────────────────────────────────── */

  /**
   * A payment.
   *
   * Shows the ledger's own reference, because that is the string a person reads
   * back down a phone when something is wrong. A row nobody can quote is a row
   * nobody can query.
   */
  function paymentCard(p) {
    p = p || {};
    var when = p.paidAt || p.dueDate;
    return '<li class="lrmc-card">' +
      '<div class="flex items-start justify-between gap-3">' +
        '<div class="min-w-0">' +
          '<p class="text-sm font-semibold text-slate-900 truncate">' +
            esc(kindLabel(p.kind)) + '</p>' +
          '<p class="text-xs text-slate-700 mt-0.5">' +
            esc(p.reference || '') +
            (when ? ' · ' + esc(global.LrmcUI.date(when)) : '') + '</p>' +
        '</div>' +
        '<div class="text-right flex-shrink-0">' +
          '<p class="text-sm font-bold text-slate-900 tabular-nums">' +
            esc(global.LrmcUI.moneyWhole(p.amount, p.currency)) + '</p>' +
          '<div class="mt-1">' + badge(PAYMENT, p.status) + '</div>' +
        '</div>' +
      '</div>' +
      /* Said on the row rather than inferred from a blank space. A receipt
       * somebody typed in is a different kind of record from one the platform
       * generated, and the person reading it should be able to tell. */
      (p.recordedBy
        ? '<p class="text-xs text-slate-700 mt-2">Recorded in person by a coordinator</p>'
        : '') +
      '</li>';
  }

  var KIND_LABELS = {
    rent: 'Rent', deposit: 'Deposit', ride: 'Ususu fare',
    driverPayout: 'Driver payout', landlordPayout: 'Payout to you',
    adSpend: 'Advertising', vendorInvoice: 'Vendor invoice',
    managementFee: 'Management fee', refund: 'Refund',
  };
  function kindLabel(kind) { return KIND_LABELS[kind] || kind || 'Payment'; }

  /**
   * A lease.
   *
   * The rent and the term are the two things a person opens this page to check,
   * so both are on the row rather than behind a click. An open-ended tenancy
   * says so in words — a blank where an end date goes reads as missing data,
   * and month-to-month is a choice rather than an omission.
   */
  function leaseCard(l) {
    l = l || {};
    var start = l.leaseStart ? global.LrmcUI.date(l.leaseStart) : '—';
    var end = l.leaseEnd ? global.LrmcUI.date(l.leaseEnd) : 'month to month';
    return '<li class="lrmc-card" data-lease="' + esc(l.id || l._id || '') + '">' +
      '<div class="flex items-start justify-between gap-3">' +
        '<div class="min-w-0">' +
          '<p class="text-sm font-semibold text-slate-900 truncate">' +
            esc(propertyTitle(l)) + '</p>' +
          '<p class="text-xs text-slate-700 mt-0.5">' +
            esc(l.reference || '') + ' · ' + esc(start) + ' — ' + esc(end) + '</p>' +
        '</div>' +
        '<div class="text-right flex-shrink-0">' +
          '<p class="text-sm font-bold text-slate-900 tabular-nums">' +
            esc(global.LrmcUI.moneyWhole(l.monthlyRent, l.currency)) +
            '<span class="text-xs font-medium text-slate-700"> / mo</span></p>' +
          '<div class="mt-1">' + badge(LEASE, l.status) + '</div>' +
        '</div>' +
      '</div>' +
      /* Said on the row. A terminated tenancy with no visible reason is the
       * thing somebody will ring up about. */
      (l.terminationReason
        ? '<p class="text-xs text-slate-700 mt-2">Ended early: ' + esc(l.terminationReason) + '</p>'
        : '') +
      '</li>';
  }

  /** The property's name if it was populated, its id if it was not. */
  function propertyTitle(l) {
    var p = l.property;
    if (p && typeof p === 'object') return p.title || p.reference || 'Property';
    return l.propertyTitle || 'Property';
  }

  /**
   * A savings circle.
   *
   * Health is the number a steward opens this page for, so it sits where the
   * rent sits on a lease card. `null` renders `—`: a circle formed on Tuesday
   * has no health to report, and showing 100% would be a claim LRMC cannot make
   * while showing 0% would be an accusation.
   */
  function ususuGroupCard(g) {
    g = g || {};
    var health = g.groupHealth === null || g.groupHealth === undefined
      ? null : global.LrmcUI.percent(g.groupHealth, 0);
    return '<li class="lrmc-card" data-group="' + esc(g.id || g._id || '') + '">' +
      '<div class="flex items-start justify-between gap-3">' +
        '<div class="min-w-0">' +
          '<p class="text-sm font-semibold text-slate-900 truncate">' +
            esc(g.name || 'Circle') + '</p>' +
          '<p class="text-xs text-slate-700 mt-0.5">' +
            esc((g.members || []).length) + ' member' +
            ((g.members || []).length === 1 ? '' : 's') +
            (g.region ? ' · ' + esc(g.region) : '') + '</p>' +
        '</div>' +
        '<div class="text-right flex-shrink-0">' +
          '<p class="text-sm font-bold text-slate-900 tabular-nums">' +
            (health === null ? '—' : esc(health)) + '</p>' +
          '<div class="mt-1">' + badge(USUSU_GROUP, g.status) + '</div>' +
        '</div>' +
      '</div>' +
      '</li>';
  }

  /**
   * One line of a circle's ledger.
   *
   * A miss is shown, never hidden. A history that only listed contributions
   * would make every circle look perfect and would make the health figure
   * unexplainable.
   */
  function ususuEntryRow(e, names) {
    e = e || {};
    var who = (names && names[e.member]) || 'Member';
    var missed = e.kind === 'miss';
    return '<li class="py-2 border-b border-slate-200 last:border-0 ' +
      'flex items-center justify-between gap-3">' +
      '<div class="min-w-0">' +
        '<p class="text-sm text-slate-900 truncate">' + esc(who) + '</p>' +
        '<p class="text-xs text-slate-700">' + esc(e.period) + '</p>' +
      '</div>' +
      '<div class="text-right flex-shrink-0">' +
        (missed
          ? '<span class="lrmc-badge lrmc-badge-warning">Missed</span>'
          : '<span class="text-sm font-semibold text-slate-900 tabular-nums">' +
            esc(global.LrmcUI.moneyWhole(e.amount, e.currency)) + '</span>') +
      '</div>' +
      '</li>';
  }

  /**
   * A maintenance request.
   *
   * The SLA state is shown when the server sent one and omitted when it did
   * not — a page that computed "overdue" itself would disagree with the server
   * the first time the grace period changed, and the tenant would be told two
   * different things by two screens.
   */
  function maintenanceCard(m) {
    m = m || {};
    return '<li class="lrmc-card" data-request="' + esc(m.id || m._id || '') + '">' +
      '<div class="flex items-start justify-between gap-3">' +
        '<div class="min-w-0">' +
          '<p class="text-sm font-semibold text-slate-900 truncate">' +
            esc(m.title || 'Untitled request') + '</p>' +
          '<p class="text-xs text-slate-700 mt-0.5">' +
            esc(m.reference || '') +
            (m.createdAt ? ' · ' + esc(global.LrmcUI.relative(m.createdAt)) : '') +
          '</p>' +
        '</div>' +
        '<div class="flex flex-col items-end gap-1 flex-shrink-0">' +
          badge(MAINTENANCE, m.status) +
          badge(PRIORITY, m.priority) +
        '</div>' +
      '</div>' +
      (m.description
        ? '<p class="text-xs text-slate-700 mt-2 line-clamp-2">' + esc(m.description) + '</p>'
        : '') +
      '</li>';
  }

  /**
   * An application in a queue.
   *
   * The recommendation is displayed, never computed. LRMC's engine scores it
   * server-side and a person decides; a page that worked out its own band would
   * be a second opinion nobody asked for and nobody could audit.
   */
  function applicationCard(a) {
    a = a || {};
    var assessment = a.assessment || {};
    return '<li class="lrmc-card" data-application="' + esc(a.id || a._id || '') + '">' +
      '<div class="flex items-start justify-between gap-3">' +
        '<div class="min-w-0">' +
          '<p class="text-sm font-semibold text-slate-900 truncate">' +
            esc(a.applicantName || 'Applicant') + '</p>' +
          '<p class="text-xs text-slate-700 mt-0.5">' +
            esc(a.propertyTitle || a.reference || '') + '</p>' +
        '</div>' +
        '<div class="flex flex-col items-end gap-1 flex-shrink-0">' +
          global.LrmcStatus.application(a.status) +
          (assessment.recommendation
            ? global.LrmcStatus.recommendation(assessment.recommendation)
            : '') +
        '</div>' +
      '</div>' +
      (typeof assessment.score === 'number'
        ? '<p class="text-xs text-slate-700 mt-2">Scores ' + esc(assessment.score) +
          ' of 100' +
          /* Said explicitly. A score of 62 with three factors unchecked and a
           * score of 62 with everything checked are very different facts, and
           * only one of them is about the applicant. */
          (Array.isArray(assessment.missing) && assessment.missing.length
            ? ' · ' + assessment.missing.length + ' not yet checked'
            : '') +
          '</p>'
        : '') +
      '</li>';
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Evidence
   *
   * The five things LRMC looks up about an applicant, drawn as the server sent
   * them. Nothing here decides anything; the scoring engine already did.
   * ──────────────────────────────────────────────────────────────────────── */

  /**
   * One factor row.
   *
   * `unknown` is rendered neutral, and this is the single most important line
   * in the file. An unchecked factor means LRMC has not looked — not that the
   * applicant failed — and a red badge tells somebody that LRMC's own missing
   * paperwork is their fault. The whole scoring engine is built so an
   * all-unknown application is held for a person rather than declined; the
   * interface has to say the same thing.
   */
  function factorRow(f) {
    f = f || {};
    var max = Number(f.max) || 0;
    var pointsText = f.status === 'unknown'
      ? 'Not checked'
      : esc(f.points) + ' of ' + esc(max);
    return '<li class="py-3 border-b border-slate-200 last:border-0">' +
      '<div class="flex items-start justify-between gap-3">' +
        '<div class="min-w-0">' +
          '<p class="text-sm font-medium text-slate-900">' + esc(f.label || f.factor) + '</p>' +
          (f.reason ? '<p class="text-xs text-slate-700 mt-0.5">' + esc(f.reason) + '</p>' : '') +
        '</div>' +
        '<div class="text-right flex-shrink-0">' +
          global.LrmcStatus.factor(f.status) +
          '<p class="text-xs text-slate-700 mt-1 tabular-nums">' + pointsText + '</p>' +
        '</div>' +
      '</div>' +
      '</li>';
  }

  /**
   * The whole bundle.
   *
   * The ceiling is stated because it is the difference between "this person
   * scored badly" and "LRMC has not finished looking". An application sitting
   * at 40 with 35 points still unchecked is not a weak application.
   */
  function evidenceBundle(assessment) {
    assessment = assessment || {};
    var factors = Array.isArray(assessment.factors) ? assessment.factors : [];
    var unchecked = factors.filter(function (f) { return f.status === 'unknown'; });
    var headroom = unchecked.reduce(function (s, f) { return s + (Number(f.max) || 0); }, 0);

    return '<div class="lrmc-card">' +
      '<div class="flex items-start justify-between gap-3 mb-3">' +
        '<div>' +
          '<p class="lrmc-stat-label">LRMC’s assessment</p>' +
          '<p class="lrmc-stat-value">' +
            (typeof assessment.score === 'number' ? esc(assessment.score) : '—') +
            '<span class="text-base font-medium text-slate-700"> of 100</span></p>' +
        '</div>' +
        '<div>' + (assessment.recommendation
          ? global.LrmcStatus.recommendation(assessment.recommendation) : '') + '</div>' +
      '</div>' +
      (headroom > 0
        ? '<p class="text-xs text-slate-700 mb-3">' + esc(headroom) +
          ' points are still unchecked, so this could reach ' +
          esc((Number(assessment.score) || 0) + headroom) +
          ' once LRMC has looked. An unchecked factor is not a failed one.</p>'
        : '') +
      '<ul class="mt-1">' + factors.map(factorRow).join('') + '</ul>' +
      '</div>';
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Loading
   * ──────────────────────────────────────────────────────────────────────── */

  /**
   * Fill a list from a promise, with the three states written out.
   *
   * A card that renders nothing looks broken; a card that says "no requests
   * yet" looks finished. The empty state is a string the caller supplies
   * because only they know what the absence means.
   *
   * `token` is the stale-reply guard. A slow answer to a filter the person has
   * already moved on from must not overwrite the fast answer to the one they
   * are looking at now — the caller bumps a counter and passes it, and a reply
   * whose token is no longer current is dropped on the floor.
   */
  function fill(box, promise, render, emptyText, isCurrent) {
    box.innerHTML = '<li class="lrmc-card"><div class="lrmc-skeleton h-5 w-2/3"></div></li>';
    return promise.then(function (res) {
      if (isCurrent && !isCurrent()) return null;
      var rows = rowsOf(res);
      if (!rows.length) {
        box.innerHTML = '<li class="lrmc-card text-sm text-slate-700">' +
          esc(emptyText) + '</li>';
        return res;
      }
      box.innerHTML = rows.map(render).join('');
      if (global.lucide) global.lucide.createIcons();
      return res;
    }).catch(function (err) {
      /* A slow *failure* can overwrite a newer good answer just as easily as a
       * slow success can. Guarded on the same token. */
      if (isCurrent && !isCurrent()) return null;
      box.innerHTML = '<li class="lrmc-card text-sm text-slate-700">' +
        esc(messageFor(err)) + '</li>';
      return null;
    });
  }

  /** Rows out of a reply, whatever shape it arrived in. */
  function rowsOf(res) {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    return Array.isArray(res.data) ? res.data : [];
  }

  /** The total the *server* counted, never `rows.length`. */
  function totalOf(res) {
    if (res && res.__meta && typeof res.__meta.total === 'number') return res.__meta.total;
    return null;
  }

  function messageFor(err) {
    if (!err) return 'Could not load this.';
    if (err.status === 403) return 'You do not have access to this.';
    return err.message || 'Could not load this.';
  }

  global.LrmcPortal = {
    READING_ORDER: READING_ORDER,
    availableReadings: availableReadings,
    resolveReading: resolveReading,

    tile: tile,
    pct: pct,
    count: count,
    skeletons: skeletons,
    paint: paint,

    moneyOf: moneyOf,
    moneyMeta: moneyMeta,
    LAUNCH_CURRENCY: LAUNCH_CURRENCY,

    PAYMENT: PAYMENT,
    LEASE: LEASE,
    USUSU_GROUP: USUSU_GROUP,
    MAINTENANCE: MAINTENANCE,
    PRIORITY: PRIORITY,
    payment: function (s) { return badge(PAYMENT, s); },
    lease: function (s) { return badge(LEASE, s); },
    ususuGroup: function (s) { return badge(USUSU_GROUP, s); },
    maintenance: function (s) { return badge(MAINTENANCE, s); },
    priority: function (s) { return badge(PRIORITY, s); },

    paymentCard: paymentCard,
    leaseCard: leaseCard,
    ususuGroupCard: ususuGroupCard,
    ususuEntryRow: ususuEntryRow,
    maintenanceCard: maintenanceCard,
    applicationCard: applicationCard,
    factorRow: factorRow,
    evidenceBundle: evidenceBundle,

    fill: fill,
    rowsOf: rowsOf,
    totalOf: totalOf,
    messageFor: messageFor,
  };
})(window);
