#!/usr/bin/env python3
"""Generate the five static LRMC public pages from one shared chrome.

There is no build step in this project, so the header, footer and `<head>`
would otherwise be copied five times and drift five ways. This writes them
once from `public/properties.html`, which is the page the chrome was proved on.

Run once from the frontend/ folder:  python3 build-public-pages.py

After that the generated files are the source of truth and this script is a
record of how they were made — `verify-public-pages.py` asserts the chrome is
still identical across every public page, so drift fails the suite rather than
needing this script re-run.

Anything LRMC has not told us is marked `data-needs-confirming`. The suite
counts them, so a placeholder cannot quietly become the published answer.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
SRC = (ROOT / 'public/properties.html').read_text()

# ── Published fees are read, never typed ────────────────────────────────────
# The management fee and the Ususu share were both `data-needs-confirming` until
# they were decided, and a decided figure typed into this file is the same
# problem one step later: the page and the ledger would then be two independent
# claims about what LRMC charges, free to disagree. They are read out of
# `config/currencies.ts`, which is what `ledger.ts` charges from, so changing the
# fee is one edit and the marketing page follows it.
_CURRENCIES = (ROOT.parent / 'backend/src/config/currencies.ts').read_text()


def _percent(name):
    m = re.search(rf'{name}\s*=\s*(\d+)', _CURRENCIES)
    assert m, f'{name} is not in config/currencies.ts — the page cannot publish a fee nobody charges'
    return m.group(1)


MANAGEMENT_FEE_PERCENT = _percent('MANAGEMENT_FEE_PERCENT')
RIDE_COMMISSION_PERCENT = _percent('RIDE_COMMISSION_PERCENT')

# From `<link rel="icon">` onward: everything before it is per-page metadata,
# which `build()` emits itself. Slicing from the top would have carried the
# properties page's title onto all five.
CHROME_HEAD = SRC[SRC.index('  <link rel="icon"'):SRC.index('</head>')]
HEADER = SRC[SRC.index('<body class="h-full antialiased flex flex-col"'):SRC.index('<main id="lrmc-main"')]
FOOTER = SRC[SRC.index('<footer class="border-t border-slate-200">'):SRC.index('<div id="lrmc-toasts"')]

# A content page has no filter panel, so it does not track that breakpoint.
HEADER = re.sub(r'<!-- `wide` is state.*?-->\n', '', HEADER, flags=re.S)
HEADER = re.sub(r'<body class="h-full antialiased flex flex-col"\n      x-data="\{.*?\}">',
                '<body class="h-full antialiased flex flex-col" x-data="{ menu: false }">',
                HEADER, flags=re.S)
HEADER = HEADER.replace(' aria-current="page"', '')
HEADER = HEADER.replace('  <script src="/assets/js/properties.js" defer></script>\n', '')

TAIL = '''<div id="lrmc-toasts" aria-live="polite" class="fixed top-4 right-4 z-50 flex flex-col gap-2 items-end"></div>

<script>
document.querySelectorAll('.lrmc-year').forEach(function (el) {
  el.textContent = new Date().getFullYear();
});

/* Somebody already signed in does not need to be sold an account. */
function lrmcNav() {
  if (!window.LrmcAuth || !LrmcAuth.isSignedIn()) return;
  var signin = document.getElementById('lrmc-nav-signin');
  var cta = document.getElementById('lrmc-nav-cta');
  if (signin) signin.hidden = true;
  if (cta) {
    cta.textContent = 'Go to your dashboard';
    cta.href = LrmcAuth.homeFor(LrmcAuth.actor());
  }
}

document.addEventListener('DOMContentLoaded', function () {
  if (window.lucide) window.lucide.createIcons();
  lrmcNav();
__PAGE_INIT__});
</script>
</body>
</html>
'''


def build(slug, title, description, banner, main, init=''):
    meta = (
        f'  <title>{title} · Legacy Rental Management Consortium</title>\n'
        f'  <meta name="description" content="{description}" />\n\n'
        f'  <link rel="canonical" href="https://lrmconsortium.com/public/{slug}.html" />\n'
        f'  <meta property="og:title" content="{title} — Legacy Rental Management Consortium" />\n'
        f'  <meta property="og:description" content="{description}" />\n'
        f'  <meta property="og:type" content="website" />\n\n'
    )
    head = meta + CHROME_HEAD.replace(
        '  <script src="/assets/js/properties.js" defer></script>\n', '')

    header = HEADER
    header = re.sub(r'(<a href="/public/%s\.html"\s+class="lrmc-btn lrmc-btn-ghost lrmc-btn-sm")' % slug,
                    r'\1 aria-current="page"', header)
    header = re.sub(r'(<a href="/public/%s\.html"\s+class="lrmc-menu-item")' % slug,
                    r'\1 aria-current="page"', header)

    out = ('<!DOCTYPE html>\n<!--\n' + banner + '\n-->\n<html lang="en" class="h-full">\n<head>\n'
           '  <meta charset="utf-8" />\n'
           '  <meta name="viewport" content="width=device-width, initial-scale=1" />\n'
           + head + '</head>\n\n' + header
           + '<main id="lrmc-main" class="flex-1">\n\n' + main + '\n</main>\n\n'
           + FOOTER + TAIL.replace('__PAGE_INIT__', init))
    (ROOT / f'public/{slug}.html').write_text(out)
    print(f'  wrote public/{slug}.html')


def hero(h1, lead):
    return f'''  <section class="bg-blue-800 text-white">
    <div class="max-w-7xl mx-auto px-4 lg:px-6 py-12 lg:py-16">
      <h1 class="text-3xl lg:text-5xl font-extrabold leading-tight mb-4 max-w-3xl">{h1}</h1>
      <p class="text-lg text-blue-100 max-w-2xl">{lead}</p>
    </div>
  </section>
'''


def needs(what):
    """A value LRMC has not supplied. Visible, and counted by the suite."""
    return (f'<span class="lrmc-badge lrmc-badge-warning" data-needs-confirming>'
            f'{what}</span>')


# ══ ABOUT ═══════════════════════════════════════════════════════════════════
build(
    'about',
    'About LRMC',
    'What the Legacy Rental Management Consortium is, how it is governed, and who answers for what.',
    ''' ═══════════════════════════════════════════════════════════════════════════
 LEGACY RENTAL MANAGEMENT CONSORTIUM (LRMC)
 ABOUT

 Generated by build-public-pages.py from the shared public chrome.

 What this page must not do is invent a history. LRMC is a new institution in
 a new market; a page claiming decades of anything would be caught out by the
 first person who asked. Everything here is either something the platform
 actually does — escrow, coordinators, verification, an audit trail — or is
 marked as needing confirming.
 ═══════════════════════════════════════════════════════════════════════════''',
    hero('One institution, answerable for all of it.',
         'LRMC manages rentals, maintenance, a marketplace and Ususu rideshare '
         'across The Gambia — on one account, with one record of who did what.')
    + '''
  <section class="max-w-3xl mx-auto px-4 lg:px-6 py-12" aria-labelledby="what-heading">
    <h2 id="what-heading" class="text-2xl font-bold text-slate-900 mb-4">What LRMC is</h2>
    <p class="text-slate-600 mb-4">
      Renting a home in the region usually means trusting a stranger with a deposit,
      chasing a landlord for a repair, and having no record of either afterwards.
      LRMC exists to put an institution between those parties — one that holds the
      money, dispatches the vendor, and keeps the receipts.
    </p>
    <p class="text-slate-600 mb-4">
      The same machinery serves four things, because they are the same problem in
      different clothes: somebody needs something done, somebody else can do it,
      and both need to be able to prove afterwards what was agreed.
    </p>
  </section>

  <section class="bg-slate-50 border-y border-slate-200" aria-labelledby="how-heading">
    <div class="max-w-3xl mx-auto px-4 lg:px-6 py-12">
      <h2 id="how-heading" class="text-2xl font-bold text-slate-900 mb-6">How it is governed</h2>

      <div class="space-y-6">
        <div>
          <h3 class="font-semibold text-slate-900 mb-1">A coordinator, by name</h3>
          <p class="text-sm text-slate-600">
            Every property is assigned to a coordinator. They are the person a landlord
            rings and the person who dispatches a vendor. Work is not addressed to a
            department.
          </p>
        </div>
        <div>
          <h3 class="font-semibold text-slate-900 mb-1">Money is held, not passed on</h3>
          <p class="text-sm text-slate-600">
            Rent and marketplace payments are held by LRMC and released when the thing
            they paid for has happened. A merchant cannot release their own escrow;
            only Back Office resolves a dispute.
          </p>
        </div>
        <div>
          <h3 class="font-semibold text-slate-900 mb-1">Decisions have authors</h3>
          <p class="text-sm text-slate-600">
            A tenancy application is scored on six factors, and then a named person
            approves or refuses it with a reason. LRMC will not tell somebody a system
            decided; a refusal nobody wrote is a refusal nobody can explain.
          </p>
        </div>
        <div>
          <h3 class="font-semibold text-slate-900 mb-1">Identity is checked once</h3>
          <p class="text-sm text-slate-600">
            One set of documents, verified once, reused for every application. LRMC
            holds those documents, which is why access to them is restricted by role
            and every read is on the audit trail.
          </p>
        </div>
      </div>
    </div>
  </section>

  <section class="max-w-3xl mx-auto px-4 lg:px-6 py-12" aria-labelledby="where-heading">
    <h2 id="where-heading" class="text-2xl font-bold text-slate-900 mb-4">Where LRMC operates</h2>
    <p class="text-slate-600 mb-4">
      The Gambia is the launch market, across all eight regions: Banjul, Kanifing,
      Brikama, Mansakonko, Kerewan, Kuntaur, Janjanbureh and Basse. Prices are in
      dalasi.
    </p>
    <p class="text-slate-600">
      Registered office: ''' + needs('address to confirm') + '''
    </p>
  </section>

  <section class="max-w-3xl mx-auto px-4 lg:px-6 pb-16" aria-labelledby="ask-heading">
    <div class="lrmc-card-institutional text-center py-10">
      <h2 id="ask-heading" class="text-xl font-bold text-slate-900 mb-2">Questions before you commit?</h2>
      <p class="text-slate-600 mb-5">That is a reasonable way to start.</p>
      <div class="flex flex-col sm:flex-row gap-3 justify-center">
        <a href="/public/contact.html" class="lrmc-btn lrmc-btn-primary">Talk to us</a>
        <a href="/public/properties.html" class="lrmc-btn lrmc-btn-secondary">See what is available</a>
      </div>
    </div>
  </section>
''')

# ══ PRICING ═════════════════════════════════════════════════════════════════
build(
    'pricing',
    'Pricing',
    'What LRMC charges, and when. Marketplace commission, escrow terms and cancellation windows.',
    ''' ═══════════════════════════════════════════════════════════════════════════
 LEGACY RENTAL MANAGEMENT CONSORTIUM (LRMC)
 PRICING

 Generated by build-public-pages.py from the shared public chrome.

 **Every figure on this page is read from the code.** Nothing here is typed.

   • marketplace commission, escrow release, free cancellation — `DEFAULT_
     MARKETPLACE_COMMISSION_PERCENT`, `AUTO_RELEASE_DAYS` and
     `FREE_CANCELLATION_HOURS` in `modules/marketplace/orderMath.ts`
   • the management fee and the Ususu share — `MANAGEMENT_FEE_PERCENT` and
     `RIDE_COMMISSION_PERCENT` in `config/currencies.ts`, which is where
     `payment/ledger.ts` charges them from

 `verify-public-pages.py` reads both files and fails if this page and the code
 disagree. A fee published here and a different fee taken from somebody's rent
 is not a formatting bug; it is LRMC charging something it did not say it would.

 The two rental figures were `data-needs-confirming` badges until they were
 decided. A decided figure typed into the page would have been the same problem
 one step later — two independent claims about what LRMC charges, free to drift.
 ═══════════════════════════════════════════════════════════════════════════''',
    hero('What LRMC charges',
         'Stated up front, in dalasi, with no fee that appears at the end.')
    + '''
  <section class="max-w-4xl mx-auto px-4 lg:px-6 py-12" aria-labelledby="tenants-heading">
    <h2 id="tenants-heading" class="text-2xl font-bold text-slate-900 mb-6">If you are renting</h2>
    <div class="lrmc-card">
      <p class="lrmc-stat-value mb-1">Free</p>
      <p class="text-slate-600 mb-4">
        Searching, booking a viewing and applying cost nothing. LRMC does not charge
        tenants a finder's fee or an application fee.
      </p>
      <p class="text-sm text-slate-600">
        You pay rent, and the deposit your lease sets out. Both are held by LRMC and
        both appear on your payment record.
      </p>
    </div>
  </section>

  <section class="bg-slate-50 border-y border-slate-200" aria-labelledby="landlords-heading">
    <div class="max-w-4xl mx-auto px-4 lg:px-6 py-12">
      <h2 id="landlords-heading" class="text-2xl font-bold text-slate-900 mb-6">If you own property</h2>
      <div class="lrmc-card">
        <p class="lrmc-stat-value mb-1" data-management-fee>''' + MANAGEMENT_FEE_PERCENT + '''% of rent collected</p>
        <p class="text-slate-600 mb-4">
          LRMC takes a management fee on rent collected. Listing a property, being
          assigned a coordinator, and having applicants verified are included.
        </p>
        <ul class="space-y-2 text-sm text-slate-600">
          <li>Rent collected, receipted and chased on your behalf</li>
          <li>A named coordinator for every property</li>
          <li>Applicants identity-checked and scored before they reach you</li>
          <li>Maintenance dispatched to vetted vendors</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="max-w-4xl mx-auto px-4 lg:px-6 py-12" aria-labelledby="marketplace-heading">
    <h2 id="marketplace-heading" class="text-2xl font-bold text-slate-900 mb-6">If you sell in the marketplace</h2>
    <div class="lrmc-card">
      <p class="lrmc-stat-value mb-1" data-commission>8%</p>
      <p class="text-slate-600 mb-4">
        Commission on the goods, never on delivery — you keep every dalasi a customer
        pays to have something carried. A refund returns the commission with it,
        proportionally.
      </p>
      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <dt class="font-medium text-slate-900">Escrow release</dt>
          <dd class="text-slate-600" data-auto-release>
            Held until the order completes, and released automatically after 7 days
            if nobody disputes it.
          </dd>
        </div>
        <div>
          <dt class="font-medium text-slate-900">Free cancellation</dt>
          <dd class="text-slate-600" data-free-cancellation>
            A customer may cancel without charge within 24 hours of ordering.
          </dd>
        </div>
      </dl>
    </div>
  </section>

  <section class="bg-slate-50 border-y border-slate-200" aria-labelledby="ususu-heading">
    <div class="max-w-4xl mx-auto px-4 lg:px-6 py-12">
      <h2 id="ususu-heading" class="text-2xl font-bold text-slate-900 mb-6">If you drive with Ususu</h2>
      <div class="lrmc-card">
        <p class="lrmc-stat-value mb-1" data-ride-commission>''' + RIDE_COMMISSION_PERCENT + '''% of each fare</p>
        <p class="text-slate-600">
          Ususu takes a share of each fare. Earnings are visible after every ride and
          withdrawable the same day.
        </p>
      </div>
    </div>
  </section>

  <section class="max-w-4xl mx-auto px-4 lg:px-6 py-12" aria-labelledby="fine-heading">
    <h2 id="fine-heading" class="text-xl font-bold text-slate-900 mb-4">Things that are not charged for</h2>
    <ul class="space-y-2 text-slate-600">
      <li>Creating an account, in any role.</li>
      <li>Having your identity documents verified.</li>
      <li>Reporting a maintenance fault, or tracking one.</li>
      <li>Being told why an application was refused.</li>
    </ul>
    <p class="text-sm text-slate-500 mt-6">
      All figures in Gambian dalasi (D). Fees are taken from money LRMC already holds,
      so nothing is ever separately invoiced to you.
    </p>
  </section>

  <section class="max-w-4xl mx-auto px-4 lg:px-6 pb-16" aria-labelledby="quote-heading">
    <div class="lrmc-card-institutional text-center py-10">
      <h2 id="quote-heading" class="text-xl font-bold text-slate-900 mb-2">Want a figure for your portfolio?</h2>
      <p class="text-slate-600 mb-5">Tell us what you have and we will put it in writing.</p>
      <a href="/public/contact.html" class="lrmc-btn lrmc-btn-primary">Ask for a quote</a>
    </div>
  </section>
''')

# ══ CONTACT ═════════════════════════════════════════════════════════════════
build(
    'contact',
    'Contact LRMC',
    'How to reach the Legacy Rental Management Consortium — by email, by phone, or by asking us to call you.',
    ''' ═══════════════════════════════════════════════════════════════════════════
 LEGACY RENTAL MANAGEMENT CONSORTIUM (LRMC)
 CONTACT

 Generated by build-public-pages.py from the shared public chrome.

 **There is no contact endpoint in the API yet.** Rather than build a form that
 posts into nothing, this page opens the person's own mail client with the
 subject and body already filled in — which works with no backend, works
 offline, and leaves them holding a copy of what they sent.

 It does record the *intent* through `POST /public/track` with the
 `contactForm` conversion goal, so HQ can see that somebody tried. Do Not Track
 and Global Privacy Control are honoured, as everywhere else.

 When a contact module exists, replace `openMail()` with a real submission —
 the form markup does not need to change.
 ═══════════════════════════════════════════════════════════════════════════''',
    hero('Talk to a person',
         'A coordinator, not a queue. Tell us what you need and we will say who is dealing with it.')
    + '''
  <section class="max-w-4xl mx-auto px-4 lg:px-6 py-12" aria-labelledby="reach-heading">
    <h2 id="reach-heading" class="lrmc-sr-only">How to reach LRMC</h2>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">

      <div>
        <h2 class="text-xl font-bold text-slate-900 mb-4">Reach us directly</h2>
        <dl class="space-y-4">
          <div>
            <dt class="text-sm font-medium text-slate-900">Email</dt>
            <dd><a href="mailto:hello@africalrmc.com"
                   class="text-blue-700 hover:text-blue-800">hello@africalrmc.com</a></dd>
          </div>
          <div>
            <dt class="text-sm font-medium text-slate-900">Support</dt>
            <dd><a href="mailto:support@africalrmc.com"
                   class="text-blue-700 hover:text-blue-800">support@africalrmc.com</a></dd>
          </div>
          <div>
            <dt class="text-sm font-medium text-slate-900">Telephone</dt>
            <dd>''' + needs('number to confirm') + '''</dd>
          </div>
          <div>
            <dt class="text-sm font-medium text-slate-900">Office</dt>
            <dd>''' + needs('address to confirm') + '''</dd>
          </div>
        </dl>

        <h2 class="text-xl font-bold text-slate-900 mt-10 mb-3">Already a member?</h2>
        <p class="text-sm text-slate-600 mb-4">
          Sign in first — a coordinator can see your properties, leases and open jobs,
          which makes the conversation a great deal shorter.
        </p>
        <a href="/public/login.html" class="lrmc-btn lrmc-btn-secondary">Sign in</a>
      </div>

      <div>
        <h2 class="text-xl font-bold text-slate-900 mb-4">Send us a message</h2>
        <form id="contact-form" class="lrmc-card space-y-4">
          <div>
            <label class="lrmc-label" for="c-name">Your name</label>
            <input class="lrmc-input" id="c-name" name="name" type="text"
                   autocomplete="name" required maxlength="120" />
          </div>
          <div>
            <label class="lrmc-label" for="c-email">Your email</label>
            <input class="lrmc-input" id="c-email" name="email" type="email"
                   autocomplete="email" required />
          </div>
          <div>
            <label class="lrmc-label" for="c-topic">What is it about?</label>
            <select class="lrmc-select" id="c-topic" name="topic">
              <option value="Renting a home">Renting a home</option>
              <option value="Listing a property">Listing a property</option>
              <option value="Marketplace">Selling in the marketplace</option>
              <option value="Ususu">Driving with Ususu</option>
              <option value="Maintenance">Maintenance or a fault</option>
              <option value="Something else">Something else</option>
            </select>
          </div>
          <div>
            <label class="lrmc-label" for="c-message">Message</label>
            <textarea class="lrmc-textarea" id="c-message" name="message" rows="5"
                      required maxlength="2000"></textarea>
          </div>

          <button type="submit" id="contact-submit" class="lrmc-btn lrmc-btn-primary w-full">
            Open this in your email
          </button>
          <p class="lrmc-field-hint" id="contact-note">
            This opens your own mail app with the message ready to send, so you keep a
            copy of what you sent us.
          </p>
        </form>
      </div>
    </div>
  </section>
''',
    init='''  var form = document.getElementById('contact-form');
  if (form) form.addEventListener('submit', function (evt) {
    evt.preventDefault();
    openMail();
  });
''')

# The contact page needs one extra function; appended rather than templated,
# because no other page has a form.
contact = ROOT / 'public/contact.html'
contact.write_text(contact.read_text().replace(
    "/* Somebody already signed in does not need to be sold an account. */",
    '''/**
 * Hand the message to the person's own mail client.
 *
 * There is no contact endpoint yet, and a form that posts into nothing is
 * worse than no form: it says "sent" and nothing arrives. This works with no
 * backend, works offline, and leaves them holding a copy of what they sent.
 *
 * The intent is recorded through `POST /public/track` so HQ's conversion
 * metrics see it — honouring Do Not Track and Global Privacy Control, as
 * everywhere else on this site.
 */
function openMail() {
  var name = document.getElementById('c-name').value.trim();
  var email = document.getElementById('c-email').value.trim();
  var topic = document.getElementById('c-topic').value;
  var message = document.getElementById('c-message').value.trim();
  if (!name || !email || !message) return;

  var refused = navigator.globalPrivacyControl === true
             || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  if (!refused && window.Lrmc && Lrmc.publicPortal) {
    Lrmc.publicPortal.track({
      domain: location.hostname, path: location.pathname,
      isConversion: true, conversionGoal: 'contactForm',
    }).catch(function () { /* a message still gets sent */ });
  }

  var body = message + '\\n\\n— ' + name + ' (' + email + ')';
  location.href = 'mailto:hello@africalrmc.com'
    + '?subject=' + encodeURIComponent('LRMC enquiry: ' + topic)
    + '&body=' + encodeURIComponent(body);
}

/* Somebody already signed in does not need to be sold an account. */'''))

# ══ TERMS ═══════════════════════════════════════════════════════════════════
LEGAL_NOTE = '''  <div class="max-w-3xl mx-auto px-4 lg:px-6 pt-8">
    <div class="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-50 text-amber-700 text-sm"
         data-needs-confirming>
      <i data-lucide="alert-triangle" class="w-4 h-4 flex-shrink-0 mt-0.5"></i>
      <span>
        <strong>Draft, pending legal review.</strong> This describes accurately how the
        LRMC platform behaves, which is the useful half of the work — but it has not
        been settled by a lawyer against Gambian law and must not be relied on as a
        contract until it has.
      </span>
    </div>
  </div>
'''

build(
    'terms',
    'Terms of service',
    'The terms on which the Legacy Rental Management Consortium platform is provided.',
    ''' ═══════════════════════════════════════════════════════════════════════════
 LEGACY RENTAL MANAGEMENT CONSORTIUM (LRMC)
 TERMS OF SERVICE — DRAFT

 Generated by build-public-pages.py from the shared public chrome.

 **This is a structural draft, not settled legal text**, and it says so at the
 top of the page rather than in a comment nobody reads.

 What it is good for: every clause below describes something the platform
 actually does, taken from the rule modules — escrow release windows, who may
 approve a tenancy, the fact that a refusal carries a reason. That is the part
 a lawyer would otherwise have to reverse-engineer, and getting it in front of
 one is the point.

 What it is not: enforceable wording, checked against Gambian law.
 ═══════════════════════════════════════════════════════════════════════════''',
    hero('Terms of service', 'The basis on which LRMC provides this platform.')
    + LEGAL_NOTE + '''
  <section class="max-w-3xl mx-auto px-4 lg:px-6 py-12 space-y-8"
           aria-labelledby="terms-heading">
    <h2 id="terms-heading" class="lrmc-sr-only">Terms in full</h2>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">1. Who LRMC is</h2>
      <p class="text-slate-600">
        The Legacy Rental Management Consortium ("LRMC", "we") operates a platform for
        renting, managing and maintaining property, for trade between merchants and
        customers, and for the Ususu rideshare service. Registered office and company
        number: ''' + needs('to confirm') + '''.
      </p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">2. Your account</h2>
      <p class="text-slate-600 mb-3">
        You must give accurate information when you register, and keep it accurate.
        You are responsible for what is done under your account. Accounts are for
        people, not shared credentials — a merchant or customer account may add named
        sellers or buyers who act for it, and the account remains responsible for them.
      </p>
      <p class="text-slate-600">
        Some roles require verification before they may act. A merchant may build a
        catalogue before verification but may not publish it; a landlord may list a
        property but LRMC assigns the coordinator.
      </p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">3. Money LRMC holds</h2>
      <p class="text-slate-600 mb-3">
        LRMC holds rent, deposits and marketplace payments and releases them when what
        they paid for has happened. Marketplace funds are released on completion, or
        automatically after 7 days if nobody raises a dispute. A merchant cannot
        release their own escrow; a disputed order is resolved by LRMC Back Office.
      </p>
      <p class="text-slate-600">
        Commission is charged on goods, not on delivery. A refund returns the
        commission with it, proportionally.
      </p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">4. Viewings</h2>
      <p class="text-slate-600">
        A viewing is an appointment at somebody's home. Requests need at least two
        hours' notice, fall between 08:00 and 18:00, and may be made up to 30 days
        ahead. You may cancel your own; LRMC may decline, with a reason. If you do not
        attend a confirmed viewing that may be recorded, and it may count against a
        later application.
      </p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">5. Tenancy applications</h2>
      <p class="text-slate-600 mb-3">
        LRMC assesses applications on six factors: identity verification, payment
        history with LRMC, employment and income, references, open disputes, and Ususu
        contributions. The assessment is a recommendation. <strong>A named person
        decides</strong>, and records a reason — for an approval as much as for a
        refusal.
      </p>
      <p class="text-slate-600">
        Where LRMC has no evidence for a factor, that is recorded as unknown rather
        than counted against you, and the application is reviewed by a person rather
        than declined. You may ask for the reasons behind a decision on your
        application.
      </p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">6. Maintenance</h2>
      <p class="text-slate-600">
        Faults reported through the platform are dispatched by a coordinator to a
        vetted vendor. LRMC does not carry out the work itself and is not the employer
        of the vendor, but it selects them and is answerable for that selection.
      </p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">7. What you may not do</h2>
      <ul class="text-slate-600 space-y-2">
        <li>List a property you have no right to let, or goods you cannot supply.</li>
        <li>Arrange payment outside LRMC for something arranged through it.</li>
        <li>Use another person's identity documents, or your own dishonestly.</li>
        <li>Attempt to reach records that are not yours.</li>
      </ul>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">8. Suspension</h2>
      <p class="text-slate-600">
        LRMC may suspend an account where there is an open dispute, a failed
        verification, or a reasonable belief of the above. Suspension is recorded with
        a reason and you will be told what it is.
      </p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">9. Liability</h2>
      <p class="text-slate-600">''' + needs('liability wording to be settled by counsel') + '''</p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">10. Governing law</h2>
      <p class="text-slate-600">''' + needs('jurisdiction to confirm') + '''</p>
    </div>

    <p class="text-sm text-slate-500 pt-4 border-t border-slate-200">
      Questions about these terms: <a href="/public/contact.html"
      class="text-blue-700 hover:text-blue-800">contact LRMC</a>.
    </p>
  </section>
''')

# ══ PRIVACY ═════════════════════════════════════════════════════════════════
build(
    'privacy',
    'Privacy notice',
    'What the Legacy Rental Management Consortium collects, why, who sees it, and what you can ask for.',
    ''' ═══════════════════════════════════════════════════════════════════════════
 LEGACY RENTAL MANAGEMENT CONSORTIUM (LRMC)
 PRIVACY NOTICE — DRAFT

 Generated by build-public-pages.py from the shared public chrome.

 A structural draft pending legal review, and it says so on the page.

 Unlike most privacy notices, every claim here was checked against what the
 code actually does: the session token really does live in `sessionStorage`
 and die with the tab; traffic tracking really does honour Global Privacy
 Control; documents really are addressed by storage key rather than URL; the
 access token really is the only thing a browser holds.

 If any of that changes, this page becomes untrue — which is exactly the kind
 of untrue that gets an institution in trouble. Keep it in step.
 ═══════════════════════════════════════════════════════════════════════════''',
    hero('Privacy notice',
         'What LRMC collects, why, who inside LRMC can see it, and what you can ask us to do about it.')
    + LEGAL_NOTE + '''
  <section class="max-w-3xl mx-auto px-4 lg:px-6 py-12 space-y-8"
           aria-labelledby="privacy-heading">
    <h2 id="privacy-heading" class="lrmc-sr-only">Privacy notice in full</h2>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">What LRMC collects</h2>
      <ul class="text-slate-600 space-y-2">
        <li><strong>Who you are</strong> — name, email, telephone, and the region you
          operate in. For roles that require it, identity documents.</li>
        <li><strong>What you do here</strong> — properties, leases, applications,
          viewings, orders, rides, maintenance requests and payments.</li>
        <li><strong>Money</strong> — amounts, dates and the method used. LRMC does not
          store card numbers.</li>
        <li><strong>How the site is used</strong> — page views, referring site and
          whether you are on a phone or a computer, tied to a random identifier that
          lives only until you close the tab.</li>
      </ul>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">Tracking, and refusing it</h2>
      <p class="text-slate-600">
        LRMC honours <strong>Global Privacy Control</strong> and <strong>Do Not
        Track</strong>. If your browser sends either, no page view is recorded and
        nothing is sent. Nothing recorded this way identifies you: the session
        identifier is random, held in your browser's session storage, and gone when
        the tab closes.
      </p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">Who inside LRMC can see what</h2>
      <p class="text-slate-600 mb-3">
        Access is by role, not by seniority alone. A coordinator sees the properties
        and people in their region. A landlord sees who applied for their property and
        what LRMC made of them — not the underlying documents. Back Office sees what it
        needs to adjudicate. Every access is recorded on an audit trail.
      </p>
      <p class="text-slate-600">
        Identity documents are held by storage key and are not reachable by a link that
        could be forwarded.
      </p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">What is shared outside LRMC</h2>
      <ul class="text-slate-600 space-y-2">
        <li>With a landlord, when you apply: your name, your assessment and its
          reasons. Not your documents.</li>
        <li>With a vendor, when a job is dispatched: the property and the fault. Not
          your financial record.</li>
        <li>With payment providers, to move money.</li>
        <li>Where the law requires it.</li>
      </ul>
      <p class="text-slate-600 mt-3">LRMC does not sell personal information.</p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">How long it is kept</h2>
      <p class="text-slate-600">''' + needs('retention periods to confirm') + '''</p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">What you can ask for</h2>
      <ul class="text-slate-600 space-y-2">
        <li>A copy of what LRMC holds about you.</li>
        <li>Correction of anything wrong.</li>
        <li>The reasons behind a decision on your application.</li>
        <li>Deletion, where LRMC is not required to keep it — a tenancy record and a
          payment history generally must be kept.</li>
      </ul>
      <p class="text-slate-600 mt-3">
        Ask at <a href="mailto:privacy@africalrmc.com"
        class="text-blue-700 hover:text-blue-800">privacy@africalrmc.com</a>.
      </p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">Keeping it safe</h2>
      <p class="text-slate-600">
        Passwords are stored hashed and are never recoverable, by LRMC or anyone else.
        Your browser holds an access token in session storage, which is cleared when
        you sign out or close the tab. Access to the Founder Command Center requires a
        second authorisation code beyond a password.
      </p>
    </div>

    <div>
      <h2 class="text-xl font-bold text-slate-900 mb-2">Complaints</h2>
      <p class="text-slate-600">''' + needs('supervisory authority to confirm') + '''</p>
    </div>

    <p class="text-sm text-slate-500 pt-4 border-t border-slate-200">
      Questions about this notice: <a href="/public/contact.html"
      class="text-blue-700 hover:text-blue-800">contact LRMC</a>.
    </p>
  </section>
''')

print('\ndone')
