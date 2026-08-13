#!/usr/bin/env python3
"""Generate the four member-portal pages from one shared chrome.

There is no build step in this project, so the sidebar, the mobile header, the
`<head>` and the sign-out wiring would otherwise be copied four times and drift
four ways. That is not hypothetical: a display utility written onto an
`lrmc-*` class already lost silently once on this platform, in six files at
once, and left the phone menu button visible on every desktop.

The chrome is lifted from `members/index.html`, which is the page it was proved
on. After this runs the generated files are the source of truth and this script
is the record of how they were made — `verify-member-portal.py` asserts the
chrome is still byte-identical across all five member pages, so drift fails the
suite rather than needing this re-run.

Run from the frontend/ folder:  python3 build-member-pages.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
SRC = (ROOT / 'members/index.html').read_text()

# From `<link rel="icon">` to the end of `<head>`. Slicing from the top would
# carry the overview's title and canonical onto all four.
CHROME_HEAD = SRC[SRC.index('  <link rel="icon"'):SRC.index('</head>')]
# `portal.js` is new and the overview predates it; every generated page needs it.
if '/assets/js/portal.js' not in CHROME_HEAD:
    CHROME_HEAD = CHROME_HEAD.replace(
        '  <script src="/assets/js/properties.js" defer></script>\n',
        '  <script src="/assets/js/properties.js" defer></script>\n'
        '  <script src="/assets/js/portal.js" defer></script>\n')

SIDEBAR = SRC[SRC.index('<div class="flex h-full">'):SRC.index('  <!-- ═══ MAIN COLUMN')]

NAV = [
    ('/members/index.html', 'layout-dashboard', 'Overview'),
    ('/members/properties.html', 'home', 'Properties'),
    ('/members/payments.html', 'banknote', 'Payments'),
    ('/members/maintenance.html', 'wrench', 'Maintenance'),
    ('/members/leases.html', 'file-text', 'Leases'),
    ('/members/ususu.html', 'users', 'Ususu'),
    ('/members/applications.html', 'clipboard-list', 'Applications'),
    ('/members/dashboard.html', 'bar-chart-3', 'Performance'),
]


def nav_html(active):
    out = ['      <p class="lrmc-nav-section">Your portal</p>']
    for href, icon, label in NAV:
        cls = 'lrmc-nav-item active' if href == active else 'lrmc-nav-item'
        cur = ' aria-current="page"' if href == active else ''
        out.append(
            f'      <a href="{href}" class="{cls}"{cur}>\n'
            f'        <i data-lucide="{icon}" class="w-[18px] h-[18px]"></i>'
            f'<span>{label}</span>\n'
            f'      </a>'
        )
    return '\n'.join(out)


def sidebar_for(active):
    """The shared rail with one link marked current.

    The nav list is rebuilt rather than string-patched, so adding a page is one
    row in NAV rather than an edit in five files — and so `active` is impossible
    to set on two links at once, which is what a hand-edited copy eventually
    does.
    """
    body = re.sub(
        r'      <p class="lrmc-nav-section">Your portal</p>.*?(?=\n    </nav>)',
        lambda _: nav_html(active),
        SIDEBAR,
        flags=re.S,
    )
    return body


HEADER = '''  <!-- ═══ MAIN COLUMN ═════════════════════════════════════════════════════ -->
  <div class="flex-1 flex flex-col min-w-0">

    <!-- The toggle is wrapped in a plain span. A display utility written
         directly onto an `lrmc-*` class loses silently: same specificity, and
         utilities.css loads after Tailwind — which is how this button stayed
         visible on every desktop across six files. -->
    <header class="h-16 bg-white border-b border-slate-200 flex items-center gap-4
                   px-4 lg:px-6 flex-shrink-0 sticky top-0 z-20">
      <span class="lg:hidden"><button type="button" @click="toggle()"
              class="lrmc-btn lrmc-btn-ghost !min-h-0 !p-2" aria-label="Toggle navigation">
        <i data-lucide="menu" class="w-5 h-5"></i>
      </button></span>

      <div class="min-w-0 flex-1">
        <h1 class="text-base font-bold text-slate-900 truncate">{h1}</h1>
        <p id="reading-caption" class="text-xs text-slate-500 truncate">—</p>
      </div>
{action}
    </header>

    <main id="lrmc-main" class="flex-1 overflow-y-auto p-4 lg:p-6">

      <!-- Only visible when Alpine never arrived. A person whose page is half
           working should be told, not left wondering why a button does nothing. -->
      <p class="lrmc-fallback-note lrmc-card border-amber-500 bg-amber-50 text-sm
                text-amber-700 mb-6" role="status">
        Some of this page could not load. Everything here still works, but menus
        and pop-ups may not open. Reloading on a better connection will fix it.
      </p>

      <!-- ── Reading switch ───────────────────────────────────────────────
           Rendered only when the roles permit more than one, so it is never a
           switch into a surface that would answer 403 to everything. -->
      <div id="reading-switch" hidden class="mb-6" role="tablist"
           aria-label="Which of your roles to show">
        <div class="inline-flex gap-1 p-1 bg-slate-100 rounded-xl">
          <button type="button" id="as-coordinator" role="tab" hidden
                  class="lrmc-btn lrmc-btn-ghost lrmc-btn-sm" aria-selected="false">Region</button>
          <button type="button" id="as-landlord" role="tab" hidden
                  class="lrmc-btn lrmc-btn-ghost lrmc-btn-sm" aria-selected="false">Portfolio</button>
          <button type="button" id="as-tenant" role="tab" hidden
                  class="lrmc-btn lrmc-btn-ghost lrmc-btn-sm" aria-selected="false">My home</button>
        </div>
      </div>

      <p id="reading-resolving" class="text-sm text-slate-500 mb-6">Loading your portal…</p>

'''

TAIL = '''
    </main>
  </div>
</div>

<div id="lrmc-toast" class="fixed bottom-4 right-4 z-50" aria-live="polite" aria-atomic="true"></div>

<script>
/* ═══════════════════════════════════════════════════════════════════════════
 * {title}
 *
 * Zone D. Everything shared with the other member pages — the reading
 * resolver, the tile renderer, the card renderers, the loader — is in
 * `assets/js/portal.js`. What is below is only what this page does that the
 * others do not.
 * ═══════════════════════════════════════════════════════════════════════ */

var READING = null;

/* Bound in `DOMContentLoaded`, not here.
 *
 * This inline script executes while the document is still parsing — which is
 * *before* any `defer`red script runs, including `portal.js`. Reading
 * `window.LrmcPortal` at this point captures `undefined`, and the failure is a
 * blank page with one console line about a property of undefined. The three
 * other globals below (`Lrmc`, `LrmcAuth`, `LrmcUI`) are only ever touched from
 * inside functions that run after load, so they are safe to reference directly;
 * this one is not, because it was captured into a variable. */
var P = null;

function applyReading(reading) {
  READING = reading;
  document.getElementById('reading-resolving').hidden = true;
  document.getElementById('reading-caption').textContent = CAPTIONS[reading] || '';

  P.READING_ORDER.forEach(function (r) {
    var btn = document.getElementById('as-' + r);
    if (!btn || btn.hidden) return;
    btn.setAttribute('aria-selected', String(r === reading));
    btn.classList.toggle('lrmc-btn-primary', r === reading);
    btn.classList.toggle('lrmc-btn-ghost', r !== reading);
  });

  /* The address bar reflects what is on screen, so a reload or a shared link
   * lands on the same reading. `replaceState`, not `pushState`: switching a
   * reading is not a navigation and should not need three Backs to undo. */
  var params = new URLSearchParams(location.search);
  params.set('as', reading);
  history.replaceState(null, '', '?' + params.toString());

  load(reading);
  if (window.lucide) window.lucide.createIcons();
}

{script}

document.addEventListener('DOMContentLoaded', function () {
  P = window.LrmcPortal;

  /* Zone D. An unauthenticated visitor is sent to sign in, remembering where
   * they were, and nothing below runs. */
  if (!LrmcAuth.requireSession('/public/login.html')) return;

  var actor = LrmcAuth.actor();
  if (actor) {
    document.getElementById('lrmc-actor-name').textContent = actor.fullName || '—';
    document.getElementById('lrmc-actor-role').textContent = actor.primaryRole || '—';
  }

  document.getElementById('sign-out').addEventListener('click', function () {
    LrmcAuth.signOut().then(function () { location.replace('/public/login.html'); });
  });

  var available = P.availableReadings();
  if (available.length > 1) {
    document.getElementById('reading-switch').hidden = false;
    available.forEach(function (r) {
      var btn = document.getElementById('as-' + r);
      if (!btn) return;
      btn.hidden = false;
      btn.addEventListener('click', function () { applyReading(r); });
    });
  }

  applyReading(P.resolveReading(new URLSearchParams(location.search).get('as'), available));
  if (window.lucide) window.lucide.createIcons();
{boot}
});
</script>
</body>
</html>
'''


def build(slug, title, h1, description, banner, main, script, action='', boot=''):
    doc = f'''<!DOCTYPE html>
<!--
 ═══════════════════════════════════════════════════════════════════════════
 LEGACY RENTAL MANAGEMENT CONSORTIUM (LRMC)
 {banner}

 Generated by `build-member-pages.py` from the chrome proved on
 members/index.html. The sidebar, mobile header and `<head>` are identical
 across every member page by construction rather than by five people
 remembering — and `verify-member-portal.py` asserts they stay that way, so
 drift fails the suite.
 ═══════════════════════════════════════════════════════════════════════════
-->
<html lang="en" class="h-full">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title} · Legacy Rental Management Consortium</title>
  <meta name="description" content="{description}" />
  <!-- Zone D is behind a session and never indexed. The canonical is here so a
       shared link resolves to one address rather than to whichever `?as=` the
       sharer happened to be reading. -->
  <link rel="canonical" href="https://lrmconsortium.com/members/{slug}.html" />
  <meta name="robots" content="noindex, nofollow" />

{CHROME_HEAD}</head>

{sidebar_for(f'/members/{slug}.html')}
{HEADER.replace('{h1}', h1).replace('{action}', action)}{main}{TAIL.replace('{title}', banner).replace('{script}', script).replace('{boot}', boot)}'''
    (ROOT / f'members/{slug}.html').write_text(doc)
    print(f'  wrote members/{slug}.html')


# ═══════════════════════════════════════════════════════════════════════════
# PAYMENTS
# ═══════════════════════════════════════════════════════════════════════════

PAYMENTS_MAIN = '''      <!-- ── Tiles, from the aggregate endpoint ─────────────────────────
           Never counted from the list below. A page of twenty rows summed in a
           browser reads as a total and is not one. -->
      <section aria-labelledby="tiles-heading" class="mb-8">
        <h2 id="tiles-heading" class="text-lg font-bold text-slate-900 mb-4">At a glance</h2>
        <div id="payment-tiles" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
      </section>

      <!-- ── Recording a payment taken in person ────────────────────────────
           Only rendered for somebody who holds `payment:record`. Hiding it is a
           courtesy: the endpoint refuses everybody else regardless. -->
      <section id="record-section" hidden aria-labelledby="record-heading" class="mb-8">
        <h2 id="record-heading" class="text-lg font-bold text-slate-900 mb-4">Record a payment</h2>
        <form id="record-form" class="lrmc-card" novalidate>
          <!-- The grid is on a child, not on `.lrmc-card`. A display utility
               written onto an `lrmc-*` class loses silently — same
               specificity, and utilities.css loads last. -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="lrmc-label" for="rec-payer">Who paid</label>
            <input class="lrmc-input" id="rec-payer" name="payer" required
                   placeholder="Member id" autocomplete="off" />
            <p class="lrmc-field-error" data-error-for="payer" hidden></p>
          </div>
          <div>
            <label class="lrmc-label" for="rec-amount">Amount</label>
            <input class="lrmc-input" id="rec-amount" name="amount" type="number"
                   min="1" step="1" required inputmode="numeric" />
            <p class="lrmc-field-error" data-error-for="amount" hidden></p>
          </div>
          <div>
            <label class="lrmc-label" for="rec-kind">What for</label>
            <select class="lrmc-input" id="rec-kind" name="kind">
              <option value="rent">Rent</option>
              <option value="deposit">Deposit</option>
            </select>
            <p class="lrmc-field-error" data-error-for="kind" hidden></p>
          </div>
          <div>
            <label class="lrmc-label" for="rec-method">How it arrived</label>
            <select class="lrmc-input" id="rec-method" name="method">
              <option value="cash">Cash</option>
              <option value="mobileMoney">Mobile money</option>
              <option value="bankTransfer">Bank transfer</option>
            </select>
            <p class="lrmc-field-error" data-error-for="method" hidden></p>
          </div>
          <div class="sm:col-span-2">
            <label class="lrmc-label" for="rec-paid">When it changed hands</label>
            <input class="lrmc-input" id="rec-paid" name="paidAt" type="date" />
            <p class="lrmc-field-error" data-error-for="paidAt" hidden></p>
          </div>
          <div class="sm:col-span-2 flex items-center gap-3">
            <button type="submit" class="lrmc-btn lrmc-btn-primary">Record it</button>
            <p id="record-error" class="text-sm text-rose-700" role="alert" hidden></p>
          </div>
          </div>
        </form>
      </section>

      <!-- ── The ledger ───────────────────────────────────────────────────── -->
      <section aria-labelledby="ledger-heading">
        <div class="flex items-center justify-between gap-3 mb-4">
          <h2 id="ledger-heading" class="text-lg font-bold text-slate-900">Payments</h2>
          <p id="ledger-total" class="text-xs text-slate-700"></p>
        </div>
        <p id="partial-notice" class="text-xs text-slate-700 mb-3" hidden></p>
        <ul id="ledger" class="grid grid-cols-1 gap-3"></ul>
      </section>
'''

PAYMENTS_SCRIPT = '''var CAPTIONS = {
  coordinator: 'Receipts you have recorded',
  landlord: 'Rent received through LRMC',
  tenant: 'What you have paid, and when',
};

/* Bumped on every load. A slow reply whose token is stale is dropped rather
 * than allowed to overwrite the answer the person is actually looking at.
 *
 * One counter is enough here because the tiles and the ledger are always
 * loaded together by the same call. On the applications page they are not, and
 * sharing a counter there cancelled the tiles every time the queue reloaded. */
var TOKEN = 0;

function load() {
  var me = (LrmcAuth.actor() || {}).userId;
  var mine = ++TOKEN;
  var current = function () { return mine === TOKEN; };

  var tiles = document.getElementById('payment-tiles');
  P.skeletons(tiles, 4);

  /* Two sources, two questions. `/stats/payments` is the platform-scoped
   * aggregate behind the tiles; `/payments/:userId/summary` is this person's
   * own record. They are not the same number and are not shown as though they
   * were — the tiles say "across your portfolio", the summary row says "your
   * record". */
  Promise.all([
    Lrmc.stats.payments().catch(function () { return null; }),
    Lrmc.payments.summary(me).catch(function () { return null; }),
  ]).then(function (r) {
    if (!current()) return;
    var stats = r[0], mineSummary = r[1];

    P.paint(tiles,
      P.tile(collectedLabel(stats), P.moneyOf(stats && stats.collected),
             P.moneyMeta(stats && stats.collected)) +
      /* Labelled "paid on time", never "reliability". The assessment's
       * `paymentReliability` counts missed instalments too and is a different
       * number; two figures sharing a label is a support ticket nobody can
       * settle. */
      P.tile('Paid on time', mineSummary ? P.pct(mineSummary.onTimeRate) : null,
             mineSummary ? mineSummary.onTime + ' of ' + mineSummary.settled + ' settled' : '') +
      P.tile('Awaiting payment', stats ? P.count(stats.awaiting) : null,
             'Raised, not yet settled') +
      P.tile('Failed', stats ? P.count(stats.failed) : null, 'Attempted and refused'));

    var notice = document.getElementById('partial-notice');
    /* A coordinator's totals cover only the receipts they wrote. Said out loud,
     * because a partial total read as a whole one is worse than no total. */
    if (mineSummary && mineSummary.partial) {
      notice.hidden = false;
      notice.textContent =
        'These cover only the payments you recorded yourself, not this person\\u2019s whole history.';
    } else {
      notice.hidden = true;
    }
  });

  P.fill(document.getElementById('ledger'),
    Lrmc.payments.history(me, { limit: 20 }),
    P.paymentCard,
    'No payments on record yet.',
    current
  ).then(function (res) {
    if (!current()) return;
    /* From `meta.total`, never `rows.length` — the second is a page size
     * wearing a total's clothes. */
    var total = P.totalOf(res);
    document.getElementById('ledger-total').textContent =
      total === null ? '' : total + (total === 1 ? ' payment' : ' payments');
  });
}

function collectedLabel(stats) {
  var days = stats && stats.collectionWindowDays;
  return 'Collected, ' + (days ? days + ' days' : 'recently');
}

/* ── Recording ────────────────────────────────────────────────────────────
 * The form sends and re-reads. It never patches the list in place, so what is
 * on screen after a save is what the server holds — including the reference it
 * derived, which is the string somebody reads back down a phone.
 */
function submitRecord(evt) {
  evt.preventDefault();
  clearErrors();

  var form = evt.target;
  var body = {
    payer: form.payer.value.trim(),
    amount: Number(form.amount.value),
    kind: form.kind.value,
    method: form.method.value,
  };
  if (form.paidAt.value) body.paidAt = new Date(form.paidAt.value).toISOString();

  var btn = form.querySelector('button[type=submit]');
  btn.disabled = true;

  Lrmc.payments.record(body).then(function () {
    form.reset();
    LrmcUI.toast('Payment recorded.', 'success');
    load();
  }).catch(function (err) {
    showErrors(err);
  }).then(function () {
    btn.disabled = false;
  });
}

function clearErrors() {
  document.getElementById('record-error').hidden = true;
  Array.prototype.forEach.call(
    document.querySelectorAll('#record-form [data-error-for]'),
    function (el) { el.hidden = true; el.textContent = ''; });
}

/* Server messages, placed on the field the server named. An error rendered
 * only in a banner makes somebody re-read six inputs to find the one that is
 * wrong; an error with nowhere to go must still be shown rather than dropped. */
function showErrors(err) {
  var details = (err && err.details) || [];
  var placed = 0;
  details.forEach(function (d) {
    var field = d.field || d.path;
    var el = document.querySelector('#record-form [data-error-for="' + field + '"]');
    if (!el) return;
    el.textContent = d.message;
    el.hidden = false;
    placed += 1;
  });
  if (placed < details.length || !details.length) {
    var banner = document.getElementById('record-error');
    banner.textContent = (err && err.message) || 'That could not be recorded.';
    banner.hidden = false;
  }
}'''

PAYMENTS_BOOT = '''
  /* Hidden unless the grant is held. A courtesy only — `POST /payments/record`
   * is gated on `payment:record` server-side and refuses everybody else. */
  if (LrmcAuth.can('payment:record')) {
    document.getElementById('record-section').hidden = false;
    document.getElementById('record-form').addEventListener('submit', submitRecord);
  }'''


# ═══════════════════════════════════════════════════════════════════════════
# MAINTENANCE
# ═══════════════════════════════════════════════════════════════════════════

MAINTENANCE_MAIN = '''      <section aria-labelledby="tiles-heading" class="mb-8">
        <h2 id="tiles-heading" class="text-lg font-bold text-slate-900 mb-4">At a glance</h2>
        <div id="maint-tiles" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
      </section>

      <!-- ── Raising one ────────────────────────────────────────────────────
           Four fields, because a person standing in front of a broken tap can
           supply where, what and how bad — and nothing else. The SLA clock and
           the coordinator are attached server-side. -->
      <section id="raise-section" hidden aria-labelledby="raise-heading" class="mb-8">
        <h2 id="raise-heading" class="text-lg font-bold text-slate-900 mb-4">Report a problem</h2>
        <form id="raise-form" class="lrmc-card" novalidate>
          <!-- Grid on a child; see the note on the record form. -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="sm:col-span-2">
            <label class="lrmc-label" for="raise-property">Which property</label>
            <input class="lrmc-input" id="raise-property" name="property" required
                   placeholder="Property id" autocomplete="off" />
            <p class="lrmc-field-error" data-error-for="property" hidden></p>
          </div>
          <div class="sm:col-span-2">
            <label class="lrmc-label" for="raise-title">What is wrong</label>
            <input class="lrmc-input" id="raise-title" name="title" required maxlength="240" />
            <p class="lrmc-field-error" data-error-for="title" hidden></p>
          </div>
          <div>
            <label class="lrmc-label" for="raise-service">Kind of work</label>
            <select class="lrmc-input" id="raise-service" name="serviceType"></select>
            <p class="lrmc-field-error" data-error-for="serviceType" hidden></p>
          </div>
          <div>
            <label class="lrmc-label" for="raise-priority">How urgent</label>
            <select class="lrmc-input" id="raise-priority" name="priority">
              <option value="low">Low</option>
              <option value="normal" selected>Normal</option>
              <option value="high">High</option>
              <option value="emergency">Emergency</option>
            </select>
            <p class="lrmc-field-error" data-error-for="priority" hidden></p>
          </div>
          <div class="sm:col-span-2">
            <label class="lrmc-label" for="raise-description">Anything else</label>
            <textarea class="lrmc-input" id="raise-description" name="description"
                      rows="3" maxlength="5000"></textarea>
            <p class="lrmc-field-error" data-error-for="description" hidden></p>
          </div>
          <div class="sm:col-span-2 flex items-center gap-3">
            <button type="submit" class="lrmc-btn lrmc-btn-primary">Report it</button>
            <p id="raise-error" class="text-sm text-rose-700" role="alert" hidden></p>
          </div>
          </div>
        </form>
      </section>

      <!-- ── Escalation ─────────────────────────────────────────────────────
           Computed by the server on every read, never a stored flag. A request
           does not become escalated; it becomes somebody's. -->
      <div id="escalation" class="lrmc-card border-amber-500 bg-amber-50 mb-6" hidden>
        <p class="text-sm font-semibold text-amber-700" id="escalation-text"></p>
        <p class="text-xs text-slate-700 mt-1">
          A coordinator is pulled in when an emergency is unassigned, a promised
          response time has passed, or a job has been parked for three days.
        </p>
      </div>

      <section aria-labelledby="jobs-heading">
        <div class="flex items-center justify-between gap-3 mb-4">
          <h2 id="jobs-heading" class="text-lg font-bold text-slate-900">Work orders</h2>
          <p id="jobs-total" class="text-xs text-slate-700"></p>
        </div>
        <ul id="jobs" class="grid grid-cols-1 gap-3"></ul>
      </section>

      <!-- Status changes. Which are legal is decided entirely server-side. -->
      <div id="update-panel" class="lrmc-card mt-6" hidden>
        <h3 class="text-sm font-bold text-slate-900 mb-3" id="update-title">Update</h3>
        <form id="update-form" class="grid grid-cols-1 sm:grid-cols-2 gap-4" novalidate>
          <input type="hidden" id="update-request" name="request" />
          <div>
            <label class="lrmc-label" for="update-status">New status</label>
            <select class="lrmc-input" id="update-status" name="status"></select>
            <p class="lrmc-field-error" data-error-for="status" hidden></p>
          </div>
          <div>
            <label class="lrmc-label" for="update-note">Why</label>
            <input class="lrmc-input" id="update-note" name="note" maxlength="1000" />
            <p class="lrmc-field-error" data-error-for="note" hidden></p>
          </div>
          <div class="sm:col-span-2 flex items-center gap-3">
            <button type="submit" class="lrmc-btn lrmc-btn-primary lrmc-btn-sm">Save</button>
            <button type="button" id="update-cancel"
                    class="lrmc-btn lrmc-btn-ghost lrmc-btn-sm">Close</button>
            <p id="update-error" class="text-sm text-rose-700" role="alert" hidden></p>
          </div>
        </form>
      </div>
'''

MAINTENANCE_SCRIPT = '''var CAPTIONS = {
  coordinator: 'Work orders across your region',
  landlord: 'Work on your properties',
  tenant: 'What you have reported, and where it stands',
};

var TOKEN = 0;

/* Every status the model has. Which of them this person may set is the
 * server's answer, not this page's — the select offers them and the server
 * refuses the ones that are not theirs, with a message saying why. Working it
 * out here would be a second copy of the lifecycle table, and the two would
 * disagree the first time one changed. */
var STATUSES = ['open', 'triaged', 'quoted', 'approved', 'assigned',
                'inProgress', 'onHold', 'completed', 'verified', 'cancelled'];

var SERVICE_TYPES = ['plumbing', 'electrical', 'carpentry', 'painting',
                     'cleaning', 'pestControl', 'roofing', 'general'];

function load() {
  var me = (LrmcAuth.actor() || {}).userId;
  var mine = ++TOKEN;
  var current = function () { return mine === TOKEN; };

  var tiles = document.getElementById('maint-tiles');
  P.skeletons(tiles, 4);

  Promise.all([
    Lrmc.stats.maintenance().catch(function () { return null; }),
    Lrmc.maintenance.summaryForUser(me).catch(function () { return null; }),
  ]).then(function (r) {
    if (!current()) return;
    var stats = r[0], summary = r[1];

    P.paint(tiles,
      P.tile('Open', stats ? P.count(stats.openRequests) : null, 'Not yet started') +
      P.tile('In progress', stats ? P.count(stats.inProgress) : null, 'Somebody is on it') +
      P.tile('Completed', stats ? P.count(stats.completed) : null,
             stats ? stats.stalled + ' stalled' : '') +
      /* Null over nothing resolved, never 0 — a landlord whose first request is
       * still open has not achieved a nought-hour turnaround. */
      P.tile('Average turnaround',
             summary && summary.averageResolutionHours !== null
               && summary.averageResolutionHours !== undefined
               ? summary.averageResolutionHours + ' hrs' : null,
             'From reported to completed'));

    var box = document.getElementById('escalation');
    if (summary && summary.needsEscalation > 0) {
      box.hidden = false;
      document.getElementById('escalation-text').textContent =
        summary.needsEscalation + (summary.needsEscalation === 1
          ? ' request needs a coordinator.' : ' requests need a coordinator.');
    } else {
      box.hidden = true;
    }
  });

  P.fill(document.getElementById('jobs'),
    Lrmc.maintenance.listForUser(me, { limit: 20 }),
    P.maintenanceCard,
    'Nothing reported yet.',
    current
  ).then(function (res) {
    if (!current()) return;
    var total = P.totalOf(res);
    document.getElementById('jobs-total').textContent =
      total === null ? '' : total + (total === 1 ? ' request' : ' requests');
    wireRows();
  });
}

function wireRows() {
  Array.prototype.forEach.call(document.querySelectorAll('#jobs [data-request]'),
    function (li) {
      li.addEventListener('click', function () { openUpdate(li.dataset.request); });
    });
}

function openUpdate(id) {
  var panel = document.getElementById('update-panel');
  document.getElementById('update-request').value = id;
  document.getElementById('update-status').innerHTML = STATUSES.map(function (s) {
    return '<option value="' + s + '">' + LrmcUI.esc(P.MAINTENANCE[s].label) + '</option>';
  }).join('');
  panel.hidden = false;
  document.getElementById('update-status').focus();
}

function submitRaise(evt) {
  evt.preventDefault();
  clearErrors('raise-form', 'raise-error');
  var form = evt.target;
  var body = {
    property: form.property.value.trim(),
    title: form.title.value.trim(),
    serviceType: form.serviceType.value,
    priority: form.priority.value,
  };
  var description = form.description.value.trim();
  if (description) body.description = description;

  var btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  Lrmc.maintenance.request(body).then(function () {
    form.reset();
    LrmcUI.toast('Reported. A coordinator has it.', 'success');
    load();
  }).catch(function (err) {
    showErrors(err, 'raise-form', 'raise-error');
  }).then(function () { btn.disabled = false; });
}

function submitUpdate(evt) {
  evt.preventDefault();
  clearErrors('update-form', 'update-error');
  var form = evt.target;
  var body = {
    request: document.getElementById('update-request').value,
    status: form.status.value,
  };
  var note = form.note.value.trim();
  if (note) body.note = note;

  var btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  /* Sends and re-reads. The row is never patched in place: a request is in a
   * state because the server said so, and a DOM edit that guessed right would
   * be indistinguishable from one that guessed wrong. */
  Lrmc.maintenance.updateStatus(body).then(function () {
    document.getElementById('update-panel').hidden = true;
    form.reset();
    LrmcUI.toast('Updated.', 'success');
    load();
  }).catch(function (err) {
    showErrors(err, 'update-form', 'update-error');
  }).then(function () { btn.disabled = false; });
}

function clearErrors(formId, bannerId) {
  document.getElementById(bannerId).hidden = true;
  Array.prototype.forEach.call(
    document.querySelectorAll('#' + formId + ' [data-error-for]'),
    function (el) { el.hidden = true; el.textContent = ''; });
}

function showErrors(err, formId, bannerId) {
  var details = (err && err.details) || [];
  var placed = 0;
  details.forEach(function (d) {
    var field = d.field || d.path;
    var el = document.querySelector('#' + formId + ' [data-error-for="' + field + '"]');
    if (!el) return;
    el.textContent = d.message;
    el.hidden = false;
    placed += 1;
  });
  if (placed < details.length || !details.length) {
    var banner = document.getElementById(bannerId);
    banner.textContent = (err && err.message) || 'That could not be saved.';
    banner.hidden = false;
  }
}'''

MAINTENANCE_BOOT = '''
  document.getElementById('raise-service').innerHTML = SERVICE_TYPES.map(function (s) {
    return '<option value="' + s + '">' +
      LrmcUI.esc(s.replace(/([a-z])([A-Z])/g, '$1 $2')) + '</option>';
  }).join('');

  if (LrmcAuth.can('maintenanceRequest:create')) {
    document.getElementById('raise-section').hidden = false;
    document.getElementById('raise-form').addEventListener('submit', submitRaise);
  }
  document.getElementById('update-form').addEventListener('submit', submitUpdate);
  document.getElementById('update-cancel').addEventListener('click', function () {
    document.getElementById('update-panel').hidden = true;
  });'''


# ═══════════════════════════════════════════════════════════════════════════
# APPLICATIONS
# ═══════════════════════════════════════════════════════════════════════════

APPLICATIONS_MAIN = '''      <section aria-labelledby="tiles-heading" class="mb-8">
        <h2 id="tiles-heading" class="text-lg font-bold text-slate-900 mb-4">The queue</h2>
        <div id="app-tiles" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
      </section>

      <div class="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label class="lrmc-label" for="queue-filter">Show</label>
          <select class="lrmc-input" id="queue-filter">
            <option value="open">Waiting on a decision</option>
            <option value="submitted">Newly submitted</option>
            <option value="underReview">Under review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Declined</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="">Everything</option>
          </select>
        </div>
        <p id="queue-total" class="text-xs text-slate-700 pb-2"></p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section aria-labelledby="queue-heading">
          <h2 id="queue-heading" class="lrmc-sr-only">Applications</h2>
          <ul id="queue" class="grid grid-cols-1 gap-3"></ul>
        </section>

        <!-- ── Detail ────────────────────────────────────────────────────────
             The assessment is displayed, never computed. LRMC's engine scores
             it server-side and a person decides; a band worked out here would
             be a second opinion nobody asked for and nobody could audit. -->
        <section id="detail" aria-labelledby="detail-heading" hidden>
          <h2 id="detail-heading" class="text-lg font-bold text-slate-900 mb-4">Assessment</h2>
          <div id="detail-body"></div>

          <div id="decision" class="lrmc-card mt-4" hidden>
            <h3 class="text-sm font-bold text-slate-900 mb-3">Decide</h3>
            <form id="decision-form" class="grid grid-cols-1 gap-4" novalidate>
              <div>
                <label class="lrmc-label" for="decision-reason">Reason</label>
                <input class="lrmc-input" id="decision-reason" name="reason" maxlength="600" />
                <p class="lrmc-field-error" data-error-for="reason" hidden></p>
                <!-- An approval needs an author and a reason, not just a
                     refusal. Both outcomes are explained to the applicant. -->
                <p class="text-xs text-slate-700 mt-1">
                  Given to the applicant either way. An approval is explained as
                  well as a refusal.
                </p>
              </div>
              <div class="flex items-center gap-3">
                <button type="submit" name="outcome" value="approve"
                        class="lrmc-btn lrmc-btn-primary lrmc-btn-sm">Approve</button>
                <button type="submit" name="outcome" value="reject"
                        class="lrmc-btn lrmc-btn-ghost lrmc-btn-sm">Decline</button>
                <p id="decision-error" class="text-sm text-rose-700" role="alert" hidden></p>
              </div>
            </form>
          </div>
        </section>
      </div>
'''

APPLICATIONS_SCRIPT = '''var CAPTIONS = {
  coordinator: 'Applications waiting on a decision',
  landlord: 'Applicants for your properties',
  tenant: 'Where your applications stand',
};

/* Three counters, not one.
 *
 * A stale-reply guard has to be per *stream*. Sharing one counter across the
 * tiles, the queue and the detail meant that opening a row, or changing a
 * filter, silently cancelled an unrelated request that was still in flight —
 * so the tiles stayed as skeletons forever because `loadQueue` had bumped the
 * number out from under them. The guard was working perfectly; it was guarding
 * the wrong thing. */
var TILES_TOKEN = 0;
var QUEUE_TOKEN = 0;
var DETAIL_TOKEN = 0;
var OUTCOME = null;

function load() {
  var mine = ++TILES_TOKEN;
  var current = function () { return mine === TILES_TOKEN; };

  var tiles = document.getElementById('app-tiles');
  P.skeletons(tiles, 4);
  Lrmc.stats.applications().catch(function () { return null; }).then(function (s) {
    if (!current()) return;
    P.paint(tiles,
      P.tile('Under review', s ? P.count(s.underReview) : null, 'Waiting on a person') +
      P.tile('Approved', s ? P.count(s.approved) : null, 'Tenancies offered') +
      P.tile('Declined', s ? P.count(s.declined) : null, 'With a reason on file') +
      P.tile('Withdrawn', s ? P.count(s.withdrawn) : null, 'Pulled out by the applicant'));
  });

  loadQueue();
}

/* The queue reloads on every filter change, and the stale-reply guard is why
 * the filter is a select rather than a text box: a slow answer to "rejected"
 * must not land after a fast answer to "open" and leave the wrong rows under
 * the right label. */
function loadQueue() {
  var mine = ++QUEUE_TOKEN;
  var current = function () { return mine === QUEUE_TOKEN; };
  var value = document.getElementById('queue-filter').value;

  /* Filters go to the API, never to a cached array. A list filtered in the
   * browser is a list that disagrees with `meta.total` the moment there is more
   * than one page of it. */
  var query = { limit: 20 };
  if (value === 'open') query.open = true;
  else if (value) query.status = value;

  P.fill(document.getElementById('queue'),
    Lrmc.applications.list(query),
    P.applicationCard,
    'Nothing in this part of the queue.',
    current
  ).then(function (res) {
    if (!current()) return;
    var total = P.totalOf(res);
    document.getElementById('queue-total').textContent =
      total === null ? '' : total + (total === 1 ? ' application' : ' applications');
    Array.prototype.forEach.call(document.querySelectorAll('#queue [data-application]'),
      function (li) {
        li.addEventListener('click', function () { openDetail(li.dataset.application); });
      });
  });
}

function openDetail(id) {
  var panel = document.getElementById('detail');
  var body = document.getElementById('detail-body');
  panel.hidden = false;
  body.innerHTML = '<div class="lrmc-card"><div class="lrmc-skeleton h-6 w-1/2"></div></div>';

  var mine = ++DETAIL_TOKEN;
  Lrmc.applications.read(id).then(function (a) {
    if (mine !== DETAIL_TOKEN) return;
    body.innerHTML = P.evidenceBundle(a.assessment || {});
    body.dataset.application = id;
    var decide = document.getElementById('decision');
    /* Hidden unless the grant is held. The server refuses regardless — and a
     * landlord never decides their own applicant, because LRMC carries the
     * tenancy, holds the deposit and answers for the decision. */
    decide.hidden = !LrmcAuth.can('application:approve');
    if (window.lucide) window.lucide.createIcons();
  }).catch(function (err) {
    if (mine !== DETAIL_TOKEN) return;
    body.innerHTML = '<div class="lrmc-card text-sm text-slate-700">' +
      LrmcUI.esc(P.messageFor(err)) + '</div>';
  });
}

function submitDecision(evt) {
  evt.preventDefault();
  var id = document.getElementById('detail-body').dataset.application;
  var reason = document.getElementById('decision-reason').value.trim();
  var banner = document.getElementById('decision-error');
  banner.hidden = true;

  var call = OUTCOME === 'reject'
    ? Lrmc.applications.reject(id, { reason: reason })
    : Lrmc.applications.approve(id, { reason: reason });

  call.then(function () {
    LrmcUI.toast('Recorded.', 'success');
    document.getElementById('decision-reason').value = '';
    /* Re-read rather than patch. The queue and the detail both come back from
     * the server, so what is on screen is what the server holds. */
    loadQueue();
    openDetail(id);
  }).catch(function (err) {
    var details = (err && err.details) || [];
    var placed = 0;
    details.forEach(function (d) {
      var el = document.querySelector('[data-error-for="' + (d.field || d.path) + '"]');
      if (!el) return;
      el.textContent = d.message; el.hidden = false; placed += 1;
    });
    if (placed < details.length || !details.length) {
      banner.textContent = (err && err.message) || 'That decision could not be recorded.';
      banner.hidden = false;
    }
  });
}'''

APPLICATIONS_BOOT = '''
  document.getElementById('queue-filter').addEventListener('change', loadQueue);
  /* Which button was pressed, captured before submit fires — `submitter` is
   * not available everywhere this platform has to run. */
  Array.prototype.forEach.call(
    document.querySelectorAll('#decision-form button[type=submit]'),
    function (b) {
      b.addEventListener('click', function () { OUTCOME = b.value; });
    });
  document.getElementById('decision-form').addEventListener('submit', submitDecision);'''


# ═══════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════

DASHBOARD_MAIN = '''      <!-- Five aggregates, five sources, one screen. Every figure is computed
           by the database over the whole collection and scoped from the token.
           Nothing on this page is counted in a browser. -->
      <section aria-labelledby="occupancy-heading" class="mb-8">
        <h2 id="occupancy-heading" class="text-lg font-bold text-slate-900 mb-4">Occupancy</h2>
        <div id="occupancy-tiles" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
      </section>

      <section aria-labelledby="rent-heading" class="mb-8">
        <h2 id="rent-heading" class="text-lg font-bold text-slate-900 mb-4">Rent collected</h2>
        <div id="rent-tiles" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
      </section>

      <section aria-labelledby="load-heading" class="mb-8">
        <h2 id="load-heading" class="text-lg font-bold text-slate-900 mb-4">Maintenance load</h2>
        <div id="load-tiles" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
      </section>

      <section aria-labelledby="throughput-heading" class="mb-8">
        <h2 id="throughput-heading" class="text-lg font-bold text-slate-900 mb-4">Application throughput</h2>
        <div id="throughput-tiles" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
      </section>

      <section aria-labelledby="ususu-heading" class="mb-8">
        <h2 id="ususu-heading" class="text-lg font-bold text-slate-900 mb-4">Ususu group health</h2>
        <div id="ususu-tiles" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
        <p class="text-xs text-slate-700 mt-3 max-w-2xl">
          Ususu contributions count in an applicant’s favour. Having none never
          counts against them — an application with no Ususu record is held for a
          person to look at, not declined.
        </p>
      </section>
'''

DASHBOARD_SCRIPT = '''var CAPTIONS = {
  coordinator: 'Your region, measured by the database',
  landlord: 'Your portfolio, measured by the database',
  tenant: 'Your tenancy, measured by the database',
};

var TOKEN = 0;

/* Five aggregates, requested together and rendered independently. One slow or
 * failing endpoint costs its own row of tiles and nothing else — which matters
 * far more on a Gambian mobile connection than on an office line. */
function load() {
  var mine = ++TOKEN;
  var current = function () { return mine === TOKEN; };

  ['occupancy', 'rent', 'load', 'throughput', 'ususu'].forEach(function (name) {
    P.skeletons(document.getElementById(name + '-tiles'), 4);
  });

  Lrmc.stats.properties().catch(function () { return null; }).then(function (s) {
    if (!current()) return;
    P.paint(document.getElementById('occupancy-tiles'),
      P.tile('Occupancy', s ? P.pct(s.occupancyRate) : null, 'Of lettable properties') +
      P.tile('Occupied', s ? P.count(s.occupied) : null, 'Somebody lives there') +
      P.tile('Vacant', s ? P.count(s.vacant) : null, 'Lettable today') +
      /* Reported rather than hidden, so the parts sum to the total. An
       * off-market unit is not a vacancy and must not be counted as one. */
      P.tile('Unavailable', s ? P.count(s.unavailable) : null, 'Off-market or under work'));
  });

  Lrmc.stats.payments().catch(function () { return null; }).then(function (s) {
    if (!current()) return;
    P.paint(document.getElementById('rent-tiles'),
      P.tile(collectedLabel(s), P.moneyOf(s && s.collected), P.moneyMeta(s && s.collected)) +
      P.tile('Paid on time', s ? P.pct(s.reliability) : null,
             s ? s.onTime + ' of ' + s.settled + ' settled' : '') +
      P.tile('Awaiting', s ? P.count(s.awaiting) : null, 'Raised, not yet settled') +
      P.tile('Failed', s ? P.count(s.failed) : null, 'Attempted and refused'));
  });

  Lrmc.stats.maintenance().catch(function () { return null; }).then(function (s) {
    if (!current()) return;
    P.paint(document.getElementById('load-tiles'),
      P.tile('Open', s ? P.count(s.openRequests) : null, 'Not yet started') +
      P.tile('In progress', s ? P.count(s.inProgress) : null, 'Somebody is on it') +
      P.tile('Completed', s ? P.count(s.completed) : null, 'Work finished') +
      P.tile('Stalled', s ? P.count(s.stalled) : null, 'On hold or cancelled'));
  });

  Lrmc.stats.applications().catch(function () { return null; }).then(function (s) {
    if (!current()) return;
    P.paint(document.getElementById('throughput-tiles'),
      P.tile('Total', s ? P.count(s.totalApplications) : null, 'All time') +
      P.tile('Under review', s ? P.count(s.underReview) : null, 'Waiting on a person') +
      P.tile('Approved', s ? P.count(s.approved) : null, 'Tenancies offered') +
      P.tile('Declined', s ? P.count(s.declined) : null, 'With a reason on file'));
  });

  Lrmc.stats.ususu().catch(function () { return null; }).then(function (s) {
    if (!current()) return;
    P.paint(document.getElementById('ususu-tiles'),
      /* Null over an empty ledger, which is the honest answer for somebody who
       * has never contributed — not 0, which reads as a bad record rather than
       * no record. */
      P.tile('Group health', s ? P.pct(s.avgGroupHealth) : null, 'Across contributions') +
      P.tile('Contributions', s ? P.count(s.totalContributions) : null,
             s ? s.totalMisses + ' missed' : '') +
      /* `members`, not `groups`. The ledger records contributions per person
       * and there is no group entity; a group count would be a number on a
       * dashboard that nothing in the database backs. */
      P.tile('Members', s ? P.count(s.totalMembers) : null, 'With a contribution record') +
      P.tile('Missed', s ? P.count(s.totalMisses) : null, 'Contributions not made'));
  });
}

function collectedLabel(stats) {
  var days = stats && stats.collectionWindowDays;
  return 'Collected, ' + (days ? days + ' days' : 'recently');
}'''



LEASES_MAIN = '''      <section aria-labelledby="tiles-heading" class="mb-8">
        <h2 id="tiles-heading" class="text-lg font-bold text-slate-900 mb-4">Tenancies</h2>
        <div id="lease-tiles" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
      </section>

      <div class="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label class="lrmc-label" for="lease-filter">Show</label>
          <select class="lrmc-input" id="lease-filter">
            <option value="">All tenancies</option>
            <option value="draft">Drafts</option>
            <option value="active">Active</option>
            <option value="inArrears">In arrears</option>
            <option value="expiring">Expiring</option>
            <option value="completed">Completed</option>
            <option value="terminated">Terminated</option>
          </select>
        </div>
        <p id="lease-total" class="text-xs text-slate-700 pb-2"></p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section aria-labelledby="list-heading">
          <h2 id="list-heading" class="lrmc-sr-only">Your tenancies</h2>
          <ul id="leases" class="grid grid-cols-1 gap-3"></ul>
        </section>

        <section id="detail" aria-labelledby="detail-heading" hidden>
          <h2 id="detail-heading" class="text-lg font-bold text-slate-900 mb-4">Tenancy</h2>
          <div id="detail-body"></div>

          <!-- ── Lifecycle ──────────────────────────────────────────────────
               Which act a person may perform is decided entirely server-side
               by `leaseLifecycle.TRANSITIONS_BY_PARTY`. The buttons below are
               offered on the grants the token carries and the server refuses
               anything else with a message saying what to do instead — a
               landlord asking to terminate is told to ask their coordinator,
               not given a bare 403.

               A tenant sees none of these, and that is the point: a lifecycle
               a tenant could move is one where "I ended my own lease" and "my
               landlord ended it" are indistinguishable afterwards. -->
          <div id="actions" class="lrmc-card mt-4" hidden>
            <h3 class="text-sm font-bold text-slate-900 mb-3">Lifecycle</h3>
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <button type="button" id="act-activate" hidden
                      class="lrmc-btn lrmc-btn-primary lrmc-btn-sm">Activate</button>
              <button type="button" id="act-complete" hidden
                      class="lrmc-btn lrmc-btn-ghost lrmc-btn-sm">Complete</button>
              <button type="button" id="act-terminate" hidden
                      class="lrmc-btn lrmc-btn-ghost lrmc-btn-sm">Terminate</button>
            </div>
            <div id="reason-row" hidden>
              <label class="lrmc-label" for="act-reason">Why is this tenancy ending</label>
              <input class="lrmc-input" id="act-reason" maxlength="600" />
              <p class="lrmc-field-error" data-error-for="reason" hidden></p>
              <p class="text-xs text-slate-700 mt-1">
                The tenant is told. A termination with no stated reason is a fact
                about somebody\u2019s housing that nobody has to defend.
              </p>
              <button type="button" id="act-terminate-confirm"
                      class="lrmc-btn lrmc-btn-primary lrmc-btn-sm mt-3">Confirm termination</button>
            </div>
            <p id="action-error" class="text-sm text-rose-700 mt-2" role="alert" hidden></p>
            <p class="lrmc-field-error" data-error-for="status" hidden></p>
          </div>
        </section>
      </div>
'''

LEASES_SCRIPT = '''var CAPTIONS = {
  coordinator: 'Tenancies across your region',
  landlord: 'Tenancies on your properties',
  tenant: 'Your tenancy, and what you have held before',
};

var TILES_TOKEN = 0;
var LIST_TOKEN = 0;
var DETAIL_TOKEN = 0;
var CURRENT = null;

function load() {
  var me = (LrmcAuth.actor() || {}).userId;
  var mine = ++TILES_TOKEN;
  var current = function () { return mine === TILES_TOKEN; };

  var tiles = document.getElementById('lease-tiles');
  P.skeletons(tiles, 4);

  Lrmc.stats.properties().catch(function () { return null; }).then(function (s) {
    if (!current()) return;
    P.paint(tiles,
      P.tile('Active tenancies', s ? P.count(s.activeLeases) : null, 'Somebody is housed') +
      /* Both reported, neither derived from the other. A unit marked occupied
       * with no live lease is somebody living there without paperwork, which is
       * exactly the thing an institution needs to see rather than have averaged
       * away. */
      P.tile('Occupied units', s ? P.count(s.occupied) : null,
             s ? 'against ' + s.activeLeases + ' leases' : '') +
      P.tile('Drafts', s ? P.count(s.leasesPending) : null, 'Not yet in force') +
      P.tile('Completed', s ? P.count(s.leasesCompleted) : null,
             s ? s.leasesTerminated + ' ended early' : ''));
  });

  loadList(me);
}

/* Separate counters per stream. Sharing one meant a filter change cancelled the
 * tiles and left them as skeletons forever — the guard worked perfectly, it was
 * guarding the wrong thing. */
function loadList(me) {
  var mine = ++LIST_TOKEN;
  var current = function () { return mine === LIST_TOKEN; };
  var status = document.getElementById('lease-filter').value;

  /* The filter goes to the API, never to a cached array. A list filtered in the
   * browser disagrees with `meta.total` the moment there is more than a page. */
  var query = { limit: 20 };
  if (status) query.status = status;

  P.fill(document.getElementById('leases'),
    Lrmc.leases.forUser(me || '', query),
    P.leaseCard,
    'No tenancies on record yet.',
    current
  ).then(function (res) {
    if (!current()) return;
    var total = P.totalOf(res);
    document.getElementById('lease-total').textContent =
      total === null ? '' : total + (total === 1 ? ' tenancy' : ' tenancies');
    Array.prototype.forEach.call(document.querySelectorAll('#leases [data-lease]'),
      function (li) {
        li.addEventListener('click', function () { openDetail(li.dataset.lease); });
      });
  });
}

function openDetail(id) {
  var panel = document.getElementById('detail');
  var body = document.getElementById('detail-body');
  panel.hidden = false;
  body.innerHTML = '<div class="lrmc-card"><div class="lrmc-skeleton h-6 w-1/2"></div></div>';

  var mine = ++DETAIL_TOKEN;
  Lrmc.leases.read(id).then(function (l) {
    if (mine !== DETAIL_TOKEN) return;
    CURRENT = l;
    body.innerHTML = '<ul class="grid grid-cols-1 gap-3">' + P.leaseCard(l) + '</ul>';
    offerActions(l);
    if (window.lucide) window.lucide.createIcons();
  }).catch(function (err) {
    if (mine !== DETAIL_TOKEN) return;
    body.innerHTML = '<div class="lrmc-card text-sm text-slate-700">' +
      LrmcUI.esc(P.messageFor(err)) + '</div>';
  });
}

/* Which buttons to show.
 *
 * A courtesy only. Every one of these is gated again server-side, and the
 * server is the only place that knows whether this person is the landlord of
 * *this* lease rather than of some other one. Offering a button the server will
 * refuse is a worse experience than hiding one it would have allowed, so the
 * page errs toward hiding — and the refusal, when it comes, explains itself. */
function offerActions(lease) {
  var box = document.getElementById('actions');
  var canWrite = LrmcAuth.can('lease:update') || LrmcAuth.can('lease:updateOwn');
  if (!canWrite) { box.hidden = true; return; }

  var running = ['active', 'inArrears', 'expiring'].indexOf(lease.status) !== -1;
  var draft = ['draft', 'pendingSignature'].indexOf(lease.status) !== -1;
  /* Terminating is a coordinator's act. A landlord who tries is told to ask
   * theirs — but the button is not dangled in front of them either. */
  var mayTerminate = LrmcAuth.can('lease:update');

  document.getElementById('act-activate').hidden = !draft;
  document.getElementById('act-complete').hidden = !running;
  document.getElementById('act-terminate').hidden = !(mayTerminate && (running || draft));
  document.getElementById('reason-row').hidden = true;
  document.getElementById('action-error').hidden = true;

  box.hidden = draft === false && running === false;
}

function act(call, body) {
  clearActionErrors();
  /* Sends and re-reads. A lease is in a state because the server said so; a
   * DOM edit that guessed right would be indistinguishable from one that
   * guessed wrong. */
  return call(body).then(function () {
    LrmcUI.toast('Recorded.', 'success');
    loadList((LrmcAuth.actor() || {}).userId);
    openDetail(body.lease);
  }).catch(showActionError);
}

function clearActionErrors() {
  document.getElementById('action-error').hidden = true;
  Array.prototype.forEach.call(document.querySelectorAll('#actions [data-error-for]'),
    function (el) { el.hidden = true; el.textContent = ''; });
}

function showActionError(err) {
  var details = (err && err.details) || [];
  var placed = 0;
  details.forEach(function (d) {
    var el = document.querySelector('#actions [data-error-for="' + (d.field || d.path) + '"]');
    if (!el) return;
    el.textContent = d.message; el.hidden = false; placed += 1;
  });
  if (placed < details.length || !details.length) {
    var banner = document.getElementById('action-error');
    banner.textContent = (err && err.message) || 'That could not be recorded.';
    banner.hidden = false;
  }
}
'''

LEASES_BOOT = '''
  document.getElementById('lease-filter').addEventListener('change', function () {
    loadList((LrmcAuth.actor() || {}).userId);
  });
  document.getElementById('act-activate').addEventListener('click', function () {
    act(Lrmc.leases.activate, { lease: CURRENT.id || CURRENT._id });
  });
  document.getElementById('act-complete').addEventListener('click', function () {
    act(Lrmc.leases.complete, { lease: CURRENT.id || CURRENT._id });
  });
  /* Two steps, deliberately. Ending somebody's tenancy is not a thing that
   * should happen on one click, and the reason field is required anyway. */
  document.getElementById('act-terminate').addEventListener('click', function () {
    document.getElementById('reason-row').hidden = false;
    document.getElementById('act-reason').focus();
  });
  document.getElementById('act-terminate-confirm').addEventListener('click', function () {
    act(Lrmc.leases.terminate, {
      lease: CURRENT.id || CURRENT._id,
      reason: document.getElementById('act-reason').value.trim(),
    });
  });'''



USUSU_MAIN = '''      <section aria-labelledby="tiles-heading" class="mb-8">
        <h2 id="tiles-heading" class="text-lg font-bold text-slate-900 mb-4">Your circles</h2>
        <div id="ususu-tiles" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
      </section>

      <!-- ── Opening a circle ───────────────────────────────────────────────
           Only rendered for somebody who can. A courtesy: the endpoint refuses
           everybody else, and an ordinary member cannot open a circle on the
           platform because the register needs somebody answerable for it. -->
      <section id="create-section" hidden aria-labelledby="create-heading" class="mb-8">
        <h2 id="create-heading" class="text-lg font-bold text-slate-900 mb-4">Open a circle</h2>
        <form id="create-form" class="lrmc-card" novalidate>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="sm:col-span-2">
              <label class="lrmc-label" for="grp-name">What is it called</label>
              <input class="lrmc-input" id="grp-name" name="name" required maxlength="160" />
              <p class="lrmc-field-error" data-error-for="name" hidden></p>
            </div>
            <div>
              <label class="lrmc-label" for="grp-amount">Contribution each period</label>
              <input class="lrmc-input" id="grp-amount" name="contributionAmount"
                     type="number" min="1" step="1" inputmode="numeric" />
              <p class="lrmc-field-error" data-error-for="contributionAmount" hidden></p>
            </div>
            <div>
              <label class="lrmc-label" for="grp-region">Where it meets</label>
              <input class="lrmc-input" id="grp-region" name="region" maxlength="120" />
              <p class="lrmc-field-error" data-error-for="region" hidden></p>
            </div>
            <div class="sm:col-span-2 flex items-center gap-3">
              <button type="submit" class="lrmc-btn lrmc-btn-primary">Open it</button>
              <p id="create-error" class="text-sm text-rose-700" role="alert" hidden></p>
            </div>
          </div>
        </form>
      </section>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section aria-labelledby="list-heading">
          <div class="flex items-center justify-between gap-3 mb-4">
            <h2 id="list-heading" class="text-lg font-bold text-slate-900">Circles</h2>
            <p id="group-total" class="text-xs text-slate-700"></p>
          </div>
          <ul id="groups" class="grid grid-cols-1 gap-3"></ul>
        </section>

        <!-- ── One circle ────────────────────────────────────────────────────
             The register, the health, the streaks and the history. Everything
             here is computed server-side on every read; the page formats. -->
        <section id="detail" aria-labelledby="detail-heading" hidden>
          <h2 id="detail-heading" class="text-lg font-bold text-slate-900 mb-4">Circle</h2>
          <div id="detail-body"></div>

          <div id="manage" class="lrmc-card mt-4" hidden>
            <h3 class="text-sm font-bold text-slate-900 mb-3">Record a period</h3>
            <form id="record-form" class="grid grid-cols-1 sm:grid-cols-2 gap-4" novalidate>
              <div>
                <label class="lrmc-label" for="rec-member">Who</label>
                <select class="lrmc-input" id="rec-member" name="member"></select>
                <p class="lrmc-field-error" data-error-for="member" hidden></p>
              </div>
              <div>
                <label class="lrmc-label" for="rec-period">Period</label>
                <input class="lrmc-input" id="rec-period" name="period"
                       placeholder="2026-08" maxlength="7" />
                <p class="lrmc-field-error" data-error-for="period" hidden></p>
              </div>
              <div>
                <label class="lrmc-label" for="rec-amount">Amount</label>
                <input class="lrmc-input" id="rec-amount" name="amount"
                       type="number" min="1" step="1" inputmode="numeric" />
                <p class="lrmc-field-error" data-error-for="amount" hidden></p>
              </div>
              <div class="sm:col-span-2 flex flex-wrap items-center gap-3">
                <button type="submit" class="lrmc-btn lrmc-btn-primary lrmc-btn-sm">
                  Record contribution</button>
                <!-- A miss is recorded, never inferred from silence. A period
                     nobody wrote down is a period nobody asked about. -->
                <button type="button" id="rec-miss"
                        class="lrmc-btn lrmc-btn-ghost lrmc-btn-sm">Mark missed</button>
                <p id="record-error" class="text-sm text-rose-700" role="alert" hidden></p>
              </div>
            </form>

            <h3 class="text-sm font-bold text-slate-900 mt-6 mb-3">Who is in it</h3>
            <form id="member-form" class="flex flex-wrap items-end gap-3" novalidate>
              <div class="flex-1 min-w-[12rem]">
                <label class="lrmc-label" for="add-member">Add somebody</label>
                <input class="lrmc-input" id="add-member" name="member"
                       placeholder="Member id" autocomplete="off" />
                <p class="lrmc-field-error" data-error-for="addMember" hidden></p>
              </div>
              <button type="submit" class="lrmc-btn lrmc-btn-primary lrmc-btn-sm">Add</button>
            </form>
            <ul id="register" class="mt-3"></ul>
          </div>
        </section>
      </div>
'''

USUSU_SCRIPT = '''var CAPTIONS = {
  coordinator: 'Savings circles you run',
  landlord: 'Savings circles you are in',
  tenant: 'Your savings circles',
};

var TILES_TOKEN = 0;
var LIST_TOKEN = 0;
var DETAIL_TOKEN = 0;
var CURRENT = null;

function load() {
  var me = (LrmcAuth.actor() || {}).userId;
  var mine = ++TILES_TOKEN;
  var current = function () { return mine === TILES_TOKEN; };

  var tiles = document.getElementById('ususu-tiles');
  P.skeletons(tiles, 4);

  Lrmc.stats.ususu().catch(function () { return null; }).then(function (s) {
    if (!current()) return;
    P.paint(tiles,
      P.tile('Circles', s ? P.count(s.totalGroups) : null,
             s ? s.activeGroups + ' running' : '') +
      /* Null over an empty ledger. A member who has never contributed has no
       * health to report — not 0, which reads as a bad record rather than no
       * record. */
      P.tile('Group health', s ? P.pct(s.avgGroupHealth) : null, 'Across your circles') +
      P.tile('Contributions', s ? P.count(s.totalContributions) : null,
             s ? s.totalMisses + ' missed' : '') +
      P.tile('Members', s ? P.count(s.totalMembers) : null, 'With a record'));
  });

  loadList(me);
}

function loadList(me) {
  var mine = ++LIST_TOKEN;
  var current = function () { return mine === LIST_TOKEN; };

  P.fill(document.getElementById('groups'),
    Lrmc.evidence.groupsForUser(me || ''),
    P.ususuGroupCard,
    'You are not in a savings circle yet.',
    current
  ).then(function (res) {
    if (!current()) return;
    var rows = P.rowsOf(res);
    document.getElementById('group-total').textContent =
      rows.length + (rows.length === 1 ? ' circle' : ' circles');
    Array.prototype.forEach.call(document.querySelectorAll('#groups [data-group]'),
      function (li) {
        li.addEventListener('click', function () { openDetail(li.dataset.group); });
      });
  });
}

function openDetail(id) {
  var panel = document.getElementById('detail');
  var body = document.getElementById('detail-body');
  panel.hidden = false;
  body.innerHTML = '<div class="lrmc-card"><div class="lrmc-skeleton h-6 w-1/2"></div></div>';

  var mine = ++DETAIL_TOKEN;
  Lrmc.evidence.groupSummary(id).then(function (s) {
    if (mine !== DETAIL_TOKEN) return;
    CURRENT = s;
    renderDetail(s);
    if (window.lucide) window.lucide.createIcons();
  }).catch(function (err) {
    if (mine !== DETAIL_TOKEN) return;
    body.innerHTML = '<div class="lrmc-card text-sm text-slate-700">' +
      LrmcUI.esc(P.messageFor(err)) + '</div>';
  });
}

function renderDetail(s) {
  var g = s.group || {};
  var members = g.members || [];
  var health = s.groupHealth === null || s.groupHealth === undefined
    ? null : LrmcUI.percent(s.groupHealth, 0);

  document.getElementById('detail-body').innerHTML =
    '<div class="lrmc-card">' +
      '<div class="flex items-start justify-between gap-3 mb-3">' +
        '<div>' +
          '<p class="lrmc-stat-label">' + LrmcUI.esc(g.name || 'Circle') + '</p>' +
          '<p class="lrmc-stat-value">' + (health === null ? '—' : LrmcUI.esc(health)) + '</p>' +
          '<p class="lrmc-stat-meta">' +
            (health === null
              ? 'No contributions yet, so there is no health to report'
              : s.contributions + ' contributions, ' + s.misses + ' missed') +
          '</p>' +
        '</div>' +
        '<div>' + P.ususuGroup(g.status) + '</div>' +
      '</div>' +
      '<ul id="streaks" class="mt-2">' + members.map(function (m) {
        var streak = (s.streaks || {})[m] || 0;
        return '<li class="flex items-center justify-between py-1.5 text-sm">' +
          '<span class="text-slate-900 truncate">' + LrmcUI.esc(m) + '</span>' +
          '<span class="text-slate-700 tabular-nums">' + streak +
            ' in a row</span></li>';
      }).join('') + '</ul>' +
    '</div>' +
    '<div class="lrmc-card mt-4">' +
      '<h3 class="text-sm font-bold text-slate-900 mb-2">History</h3>' +
      (s.entries && s.entries.length
        ? '<ul id="history">' + s.entries.map(function (e) {
            return P.ususuEntryRow(e, null);
          }).join('') + '</ul>'
        : '<p class="text-sm text-slate-700">Nothing recorded yet.</p>') +
    '</div>';

  /* The register is editable by the steward and LRMC only. Hidden otherwise —
   * a courtesy; the endpoints refuse everybody else regardless. */
  var mayManage = LrmcAuth.can('ususuLedger:create');
  document.getElementById('manage').hidden = !mayManage;
  if (!mayManage) return;

  document.getElementById('rec-member').innerHTML = members.map(function (m) {
    return '<option value="' + LrmcUI.esc(m) + '">' + LrmcUI.esc(m) + '</option>';
  }).join('');
  document.getElementById('register').innerHTML = members.map(function (m) {
    return '<li class="flex items-center justify-between py-1.5 text-sm">' +
      '<span class="text-slate-900 truncate">' + LrmcUI.esc(m) + '</span>' +
      '<button type="button" data-remove="' + LrmcUI.esc(m) + '" ' +
        'class="lrmc-btn lrmc-btn-ghost lrmc-btn-sm">Remove</button></li>';
  }).join('');
  Array.prototype.forEach.call(document.querySelectorAll('#register [data-remove]'),
    function (b) {
      b.addEventListener('click', function () { removeMember(b.dataset.remove); });
    });
}

function groupId() { return CURRENT && CURRENT.group && (CURRENT.group.id || CURRENT.group._id); }

function afterChange() {
  LrmcUI.toast('Recorded.', 'success');
  loadList((LrmcAuth.actor() || {}).userId);
  openDetail(groupId());
}

function submitCreate(evt) {
  evt.preventDefault();
  clearErrors('create-form', 'create-error');
  var form = evt.target;
  var body = { name: form.name.value.trim() };
  if (form.contributionAmount.value) body.contributionAmount = Number(form.contributionAmount.value);
  if (form.region.value.trim()) body.region = form.region.value.trim();

  var btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  Lrmc.evidence.createGroup(body).then(function () {
    form.reset();
    LrmcUI.toast('Circle opened.', 'success');
    loadList((LrmcAuth.actor() || {}).userId);
  }).catch(function (err) {
    showErrors(err, 'create-form', 'create-error');
  }).then(function () { btn.disabled = false; });
}

function submitRecord(evt) {
  evt.preventDefault();
  clearErrors('record-form', 'record-error');
  var form = evt.target;
  /* Sends and re-reads. Health and streaks are computed server-side on every
   * read, so patching them here would be the page inventing a number. */
  Lrmc.evidence.groupContribute({
    group: groupId(),
    member: form.member.value,
    period: form.period.value.trim(),
    amount: Number(form.amount.value),
  }).then(afterChange).catch(function (err) {
    showErrors(err, 'record-form', 'record-error');
  });
}

function markMissed() {
  clearErrors('record-form', 'record-error');
  var form = document.getElementById('record-form');
  Lrmc.evidence.groupMiss({
    group: groupId(),
    member: form.member.value,
    period: form.period.value.trim(),
  }).then(afterChange).catch(function (err) {
    showErrors(err, 'record-form', 'record-error');
  });
}

function addMember(evt) {
  evt.preventDefault();
  clearErrors('member-form', 'record-error');
  var value = document.getElementById('add-member').value.trim();
  Lrmc.evidence.groupAddMember({ group: groupId(), member: value })
    .then(function () {
      document.getElementById('add-member').value = '';
      afterChange();
    })
    .catch(function (err) { showErrors(err, 'member-form', 'record-error'); });
}

function removeMember(member) {
  clearErrors('member-form', 'record-error');
  /* Removing somebody changes the register and NEVER their contributions. A
   * year of paying in is a year of evidence, and the server keeps it. */
  Lrmc.evidence.groupRemoveMember({ group: groupId(), member: member })
    .then(afterChange)
    .catch(function (err) { showErrors(err, 'member-form', 'record-error'); });
}

function clearErrors(formId, bannerId) {
  document.getElementById(bannerId).hidden = true;
  Array.prototype.forEach.call(
    document.querySelectorAll('#' + formId + ' [data-error-for]'),
    function (el) { el.hidden = true; el.textContent = ''; });
}

function showErrors(err, formId, bannerId) {
  var details = (err && err.details) || [];
  var placed = 0;
  details.forEach(function (d) {
    var field = d.field || d.path;
    var el = document.querySelector('#' + formId + ' [data-error-for="' + field + '"]');
    if (!el) return;
    el.textContent = d.message; el.hidden = false; placed += 1;
  });
  if (placed < details.length || !details.length) {
    var banner = document.getElementById(bannerId);
    banner.textContent = (err && err.message) || 'That could not be recorded.';
    banner.hidden = false;
  }
}
'''

USUSU_BOOT = '''
  if (LrmcAuth.can('ususuLedger:create')) {
    document.getElementById('create-section').hidden = false;
    document.getElementById('create-form').addEventListener('submit', submitCreate);
  }
  document.getElementById('record-form').addEventListener('submit', submitRecord);
  document.getElementById('rec-miss').addEventListener('click', markMissed);
  document.getElementById('member-form').addEventListener('submit', addMember);'''


print('Building the member portal pages…')

build('payments', 'Payments', 'Payments',
      'Rent and payments through LRMC — what has settled, what is due.',
      'MEMBER PORTAL — PAYMENTS',
      PAYMENTS_MAIN, PAYMENTS_SCRIPT, boot=PAYMENTS_BOOT)

build('maintenance', 'Maintenance', 'Maintenance',
      'Report a problem and follow the work through to completion.',
      'MEMBER PORTAL — MAINTENANCE',
      MAINTENANCE_MAIN, MAINTENANCE_SCRIPT, boot=MAINTENANCE_BOOT)

build('leases', 'Leases', 'Leases',
      'Your tenancies — rent, term, and where each one stands.',
      'MEMBER PORTAL — LEASES',
      LEASES_MAIN, LEASES_SCRIPT, boot=LEASES_BOOT)

build('ususu', 'Ususu', 'Ususu circles',
      'Savings circles — who is in them, what has been contributed, and how they are doing.',
      'MEMBER PORTAL — USUSU CIRCLES',
      USUSU_MAIN, USUSU_SCRIPT, boot=USUSU_BOOT)

build('applications', 'Applications', 'Applications',
      'Tenancy applications, the evidence behind each, and the decision.',
      'MEMBER PORTAL — APPLICATIONS QUEUE',
      APPLICATIONS_MAIN, APPLICATIONS_SCRIPT, boot=APPLICATIONS_BOOT)

build('dashboard', 'Performance', 'Performance',
      'Occupancy, rent, maintenance load, application throughput and Ususu health.',
      'MEMBER PORTAL — PERFORMANCE DASHBOARD',
      DASHBOARD_MAIN, DASHBOARD_SCRIPT)

print('Done. verify-member-portal.py asserts the chrome stays identical.')
