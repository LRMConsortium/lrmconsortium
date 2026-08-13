#!/usr/bin/env python3
"""LRMC — headless checks for members/properties.html.

The dual-mode page. Two surfaces on one URL, so the first thing this suite
proves is that the *wrong* one is never shown: a tenant with `?mode=list` in
their address bar gets the tenant surface, because the landlord surface would
be a wall of 403s.

After that the theme is **server-side truth**. A filter that looks applied but
is never sent, a count taken from `rows.length` instead of `meta.total`, a
status changed in the DOM instead of by a round trip — each of those produces
a screen that disagrees with the database and nobody notices until somebody
acts on it. The checks below are mostly about what reaches the API and what
comes back.

Run from the frontend/ folder:  python3 verify-members-properties.py
"""
import json, sys, re, time, pathlib, http.server, socketserver, threading
from urllib.parse import parse_qs
from playwright.sync_api import sync_playwright
from lrmc_checks import run_shared_checks

ROOT = pathlib.Path(__file__).parent
DOUBLES = ROOT / 'test-doubles'
BACKEND = ROOT.parent / 'backend'

fails = []
def check(n, c):
    print(('  ok   ' if c else '  FAIL ') + n)
    if not c: fails.append(n)

def _lum(rgb):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast(fg, bg):
    a, b = sorted((_lum(fg), _lum(bg)), reverse=True)
    return (a + 0.05) / (b + 0.05)

def parse_rgb(css):
    nums = [float(x) for x in re.findall(r'[\d.]+', css)]
    return tuple(int(round(n)) for n in nums[:3])

OID = '0' * 24

def prop(n, **over):
    base = {
        "_id": f"{n:024d}", "id": f"{n:024d}", "reference": f"LRMC-GM-{n:04d}",
        "title": f"Listing number {n}", "propertyType": "apartment",
        "city": "Serrekunda", "region": "Kanifing", "bedrooms": 2, "bathrooms": 1,
        "photos": [], "amenities": ["water", "electricity"], "status": "active",
        "occupancyStatus": "vacant",
        "rentAmount": 10000 + n * 500, "rentCurrency": "GMD", "rentPeriod": "monthly",
    }
    base.update(over)
    return base

PUBLIC = [prop(n) for n in range(1, 15)]
OWNED = [prop(n, status='active', occupancyStatus='occupied') for n in range(1, 4)] + \
        [prop(n, status='draft') for n in range(4, 6)]

VIEWINGS = [
    {"id": "v1", "_id": "v1", "requestedFor": "2026-09-01T10:00:00.000Z",
     "localHour": 10, "status": "requested", "note": "Afternoon suits better"},
    {"id": "v2", "_id": "v2", "requestedFor": "2026-08-20T14:00:00.000Z",
     "localHour": 14, "status": "completed"},
]

ASSESSED = {
    "factors": [
        {"factor": "identity", "label": "Identity verification", "status": "pass",
         "points": 25, "max": 25, "reason": "Identity verified by LRMC."},
        {"factor": "paymentHistory", "label": "Payment history with LRMC", "status": "unknown",
         "points": 0, "max": 25, "reason": "No payment history with LRMC yet."},
        {"factor": "employment", "label": "Employment and income", "status": "concern",
         "points": 15, "max": 20, "reason": "Income is 2.5x the rent."},
        {"factor": "disputes", "label": "Open disputes", "status": "pass",
         "points": 10, "max": 10, "reason": "No open disputes."},
        {"factor": "references", "label": "References", "status": "pass",
         "points": 12, "max": 12, "reason": "2 references checked and cleared."},
        {"factor": "ususuContributions", "label": "Ususu contributions", "status": "unknown",
         "points": 0, "max": 8, "reason": "No Ususu contributions on record."},
    ],
    "score": 62, "recommendation": "review",
    "blockedBy": [], "missing": ["paymentHistory", "ususuContributions"],
    "summary": "Scores 62 of 100, with no evidence for payment history with lrmc and ususu contributions.",
    "takenAt": "2026-08-01T09:00:00.000Z",
}

APPLICATIONS = [
    {"id": "a1", "_id": "a1", "status": "submitted", "applicantName": "Awa Ceesay",
     "assessment": ASSESSED},
    {"id": "a2", "_id": "a2", "status": "underReview", "applicantName": "Modou Jallow",
     "assessment": dict(ASSESSED, recommendation="recommend", score=88, missing=[])},
    {"id": "a3", "_id": "a3", "status": "approved", "applicantName": "Fatou Sanneh",
     "assessment": dict(ASSESSED, recommendation="decline", score=30),
     "decision": {"outcome": "approved", "reason": "Long-standing tenant of a sister property.",
                  "againstRecommendation": True}},
]

PAYMENTS = [
    {"_id": "p1", "amount": 12000, "status": "succeeded", "paidAt": "2026-08-01T00:00:00.000Z"},
    {"_id": "p2", "amount": 8000, "status": "succeeded", "paidAt": "2026-07-28T00:00:00.000Z"},
    {"_id": "p3", "amount": 5000, "status": "pending"},
]

JOBS = [{"_id": "m1", "status": "open"}, {"_id": "m2", "status": "closed"}]

# ── Aggregate replies ──────────────────────────────────────────────────────
# Shaped like backend/src/modules/stats/index.ts. The totals are deliberately
# far larger than any page size, so a tile that went back to counting a list
# would read a plainly different number and fail rather than look plausible.
PROPERTY_STATS = {
    "totalProperties": 217, "occupied": 180, "vacant": 30,
    "unavailable": 7, "unclassified": 0, "occupancyRate": 85.7,
}
PAYMENT_STATS = {
    "totalPayments": 940, "settled": 900, "onTime": 870, "late": 30,
    "awaiting": 32, "failed": 8, "reliability": 96.7,
    "collectionWindowDays": 30,
    "collected": [{"currency": "GMD", "amount": 4_250_000, "payments": 880}],
}
PAYMENT_STATS_MULTI = dict(PAYMENT_STATS, collected=[
    {"currency": "GMD", "amount": 4_250_000, "payments": 880},
    {"currency": "USD", "amount": 12_400, "payments": 15},
])
MAINTENANCE_STATS = {
    "totalRequests": 64, "openRequests": 12, "inProgress": 9,
    "completed": 40, "stalled": 3, "unclassified": 0,
}
APPLICATION_STATS = {
    "totalApplications": 48, "underReview": 11, "approved": 25,
    "declined": 9, "withdrawn": 3, "unclassified": 0,
}

STATE = {
    "public": "ok", "owned": "ok", "apps": "ok", "viewings": "ok",
    "payments": "ok", "jobs": "ok",
    "paymentStats": PAYMENT_STATS,
    "statsDown": set(),
    "queries": [], "ownedQueries": [], "appQueries": [], "posted": [],
    # Everything the page requested while the performance tiles were loading,
    # so the suite can prove no list endpoint was touched for a figure.
    "perfPaths": [], "statsQueries": [],
}

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(s, *a): pass

    def _body(s):
        n = int(s.headers.get('Content-Length') or 0)
        try: return json.loads(s.rfile.read(n) or b'{}')
        except Exception: return {}

    def do_POST(s):
        base = s.path.split('?')[0]
        body = s._body()
        STATE["posted"].append((base, body))

        if base == '/api/v1/viewings':
            if STATE["viewings"] == 'refuse-slot':
                return s._json({"success": False, "error": {
                    "code": "VALIDATION_FAILED", "message": "Request validation failed",
                    "details": [{"field": "requestedFor", "code": "too-soon",
                                 "message": "Viewings need at least 2 hours' notice so a coordinator can be there."}]}}, 422)
            return s._json({"success": True, "data": {"id": "vNew", "status": "requested"}}, 201)

        if base == '/api/v1/applications':
            return s._json({"success": True, "data": {"id": "aNew", "status": "submitted"}}, 201)

        if base == '/api/v1/properties':
            if STATE["owned"] == 'refuse-create':
                return s._json({"success": False, "error": {
                    "code": "VALIDATION_FAILED", "message": "Request validation failed",
                    "details": [{"field": "title", "message": "Too short", "code": "too_small"},
                                {"field": "WhatsApp", "message": "Unknown field", "code": "custom"}]}}, 422)
            return s._json({"success": True, "data": prop(99)}, 201)

        if re.match(r'^/api/v1/application/[^/]+/(approve|reject|review|withdraw)$', base):
            if STATE["apps"] == 'refuse-decision':
                return s._json({"success": False, "error": {
                    "code": "VALIDATION_FAILED", "message": "Request validation failed",
                    "details": [{"field": "status", "code": "not-your-decision",
                                 "message": "That decision is not yours to make."}]}}, 422)
            return s._json({"success": True, "data": {"id": "a1", "status": "approved"}})

        if re.match(r'^/api/v1/viewing/[^/]+/(confirm|decline|cancel)$', base):
            return s._json({"success": True, "data": {"id": "v1", "status": "confirmed"}})

        s.send_response(404); s.end_headers()

    def do_GET(s):
        base, _, query = s.path.partition('?')
        q = parse_qs(query)

        if base.startswith('/api/v1/'):
            STATE["perfPaths"].append(base)

        if base.startswith('/api/v1/stats/'):
            name = base.rsplit('/', 1)[1]
            STATE["statsQueries"].append((base, q))
            if name in STATE["statsDown"]:
                return s._json({"success": False,
                                "error": {"code": "INTERNAL", "message": "boom"}}, 500)
            table = {
                'properties': PROPERTY_STATS,
                'payments': STATE["paymentStats"],
                'maintenance': MAINTENANCE_STATS,
                'applications': APPLICATION_STATS,
            }
            if name in table:
                return s._json({"success": True, "data": table[name]})
            s.send_response(404); s.end_headers(); return

        if base == '/api/v1/properties/public':
            STATE["queries"].append(q)
            # A search the page has already moved on from, answering late.
            if q.get('region') == ['Kuntaur']:
                time.sleep(0.8)
                return s._json({"success": True, "data": [prop(99, title='STALE ANSWER')],
                                "meta": {"page": 1, "limit": 12, "total": 1}})
            if STATE["public"] == 'down':
                return s._json({"success": False, "error": {"code": "INTERNAL", "message": "boom"}}, 500)
            if STATE["public"] == 'empty':
                return s._json({"success": True, "data": [], "meta": {"page": 1, "limit": 12, "total": 0}})
            page = int(q.get('page', ['1'])[0]); limit = int(q.get('limit', ['12'])[0])
            return s._json({"success": True, "data": PUBLIC[(page - 1) * limit: page * limit],
                            "meta": {"page": page, "limit": limit, "total": len(PUBLIC)}})

        if base == '/api/v1/properties':
            STATE["ownedQueries"].append(q)
            if STATE["owned"] == 'down':
                return s._json({"success": False, "error": {"code": "INTERNAL", "message": "boom"}}, 500)
            rows = OWNED
            if q.get('status'):
                rows = [r for r in OWNED if r['status'] == q['status'][0]]
            if STATE["owned"] == 'manypages':
                return s._json({"success": True, "data": [prop(n) for n in range(1, 13)],
                                "meta": {"page": 1, "limit": 12, "total": 30}})
            return s._json({"success": True, "data": rows,
                            "meta": {"page": 1, "limit": 12, "total": len(rows)}})

        if re.match(r'^/api/v1/property/[^/]+$', base):
            return s._json({"success": True, "data": prop(1, address='12 Kairaba Avenue')})

        if base == '/api/v1/applications':
            STATE["appQueries"].append(q)
            if STATE["apps"] == 'down':
                return s._json({"success": False, "error": {"code": "INTERNAL", "message": "boom"}}, 500)
            if STATE["apps"] == 'empty':
                return s._json({"success": True, "data": [], "meta": {"total": 0}})
            # A queue load the landlord has already moved on from.
            if q.get('status') == ['rejected']:
                time.sleep(0.8)
                # A slow *failure* is as capable of overwriting a newer, good
                # answer as a slow success is.
                if STATE["apps"] == 'slow-error':
                    return s._json({"success": False,
                                    "error": {"code": "INTERNAL", "message": "boom"}}, 500)
                return s._json({"success": True,
                                "data": [dict(APPLICATIONS[0], applicantName='STALE QUEUE')],
                                "meta": {"total": 1}})
            if STATE["apps"] == 'hostile':
                return s._json({"success": True, "data": [dict(APPLICATIONS[0],
                    applicantName='<img src=x onerror="window.__pwned=1">Nasty')],
                    "meta": {"total": 1}})
            rows = APPLICATIONS
            if q.get('status'):
                rows = [r for r in APPLICATIONS if r['status'] == q['status'][0]]
            elif q.get('open') == ['true']:
                rows = [r for r in APPLICATIONS
                        if r['status'] in ('submitted', 'underReview', 'awaitingApplicant')]
            return s._json({"success": True, "data": rows, "meta": {"total": len(rows)}})

        if base == '/api/v1/viewings':
            if STATE["viewings"] == 'empty':
                return s._json({"success": True, "data": [], "meta": {"total": 0}})
            rows = VIEWINGS
            if q.get('open') == ['true']:
                rows = [r for r in VIEWINGS if r['status'] in ('requested', 'confirmed')]
            return s._json({"success": True, "data": rows, "meta": {"total": len(rows)}})

        if base == '/api/v1/landlord/me/payments':
            if STATE["payments"] == 'down':
                return s._json({"success": False, "error": {"code": "INTERNAL", "message": "x"}}, 500)
            return s._json({"success": True, "data": PAYMENTS, "meta": {"total": len(PAYMENTS)}})

        if base == '/api/v1/maintenance-requests':
            if STATE["jobs"] == 'down':
                return s._json({"success": False, "error": {"code": "INTERNAL", "message": "x"}}, 500)
            return s._json({"success": True, "data": JOBS, "meta": {"total": len(JOBS)}})

        if base.startswith('/__t/'):
            p = DOUBLES / base[5:]
            if p.exists():
                return s._raw(p.read_bytes(),
                              'text/css' if p.suffix == '.css' else 'application/javascript')
        if base == '/page':
            return s._raw(pathlib.Path('/tmp/members-properties-under-test.html').read_bytes(), 'text/html')
        if base.startswith(('/hq/', '/members/', '/staff/', '/marketplace/', '/public/')):
            return s._raw(b'<!doctype html><title>landed</title><p>landed</p>', 'text/html')
        return super().do_GET()

    def _json(s, body, code=200):
        return s._raw(json.dumps(body).encode(), 'application/json', code)

    def _raw(s, body, ct, code=200):
        s.send_response(code); s.send_header('Content-Type', ct)
        s.send_header('Content-Length', str(len(body))); s.end_headers(); s.wfile.write(body)

src = (ROOT / 'members/properties.html').read_text()
t = src
t = t.replace('<script src="https://cdn.tailwindcss.com"></script>',
              '<link rel="stylesheet" href="/__t/tw-subset.css" /><script src="/__t/tailwind-double.js"></script>')
t = t.replace('<script src="https://unpkg.com/htmx.org@1.9.12"></script>', '<script src="/__t/htmx-double.js"></script>')
t = re.sub(r'<script src="/assets/vendor/alpine\.min\.js"[\s\S]*?</script>',
           '<script src="/__t/alpine-double.js" defer></script>', t)
t = t.replace('<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js" defer></script>', '<script src="/__t/lucide-double.js" defer></script>')
t = re.sub(r'<link href="https://fonts\.googleapis[^>]*>', '', t)
t = re.sub(r'<link rel="preconnect"[^>]*>', '', t)
_left = re.findall(r'(?:src|href)="(https://(?:unpkg\.com|cdn\.tailwindcss)[^"]*)"', t)
assert not _left, f'a CDN reference survived: {_left}'
pathlib.Path('/tmp/members-properties-under-test.html').write_text(t)

socketserver.TCPServer.allow_reuse_address = True

class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    """Threaded so a slow reply can be overtaken by a fast one. Serialised,
    the race the stale-reply guard exists for cannot happen at all."""
    daemon_threads = True

srv = ThreadedServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

# ══ the wizard and the API must agree ═══════════════════════════════════════
# A field the wizard sends that `createPropertySchema` does not accept is a
# strict-mode rejection, which reaches the landlord as "Save did nothing".
print('— the wizard and the create schema agree —')
schema = (BACKEND / 'src/modules/property/property.validation.ts').read_text()
create = re.search(r'createPropertySchema = z\s*\.object\(\{(.*?)\n  \}\)\n  \.strict\(\)', schema, re.S).group(1)
api_fields = set(re.findall(r'^\s{4}(\w+):', create, re.M))
# Spread fragments contribute their own names.
frag = (BACKEND / 'src/shared/validationFragments.ts').read_text()
for name in re.findall(r'\.\.\.(\w+),', create):
    block = re.search(name + r' = \{(.*?)\n\};', frag, re.S)
    if block:
        api_fields |= set(re.findall(r'^\s{2}(\w+):', block.group(1), re.M))

props_js = (ROOT / 'assets/js/properties.js').read_text()
wizard_block = props_js[props_js.index('var WIZARD_STEPS = ['):props_js.index('/* Option sets')]
wizard_fields = set(re.findall(r"F\('(\w+)'", wizard_block))
check('every field the wizard collects is one the API accepts',
      wizard_fields <= api_fields)
if not wizard_fields <= api_fields:
    print('   wizard:', sorted(wizard_fields - api_fields))
check('the wizard has exactly six steps',
      len(re.findall(r"^\s+key: '", wizard_block, re.M)) == 6)
titles = re.findall(r"title: '([^']+)'", wizard_block)
blurbs = re.findall(r"blurb: '([^']+)'", wizard_block)
check('every step has a title and a sentence explaining it',
      len(titles) == 6 and len(blurbs) == 6 and all(t.strip() for t in titles))
# A step named after a schema field tells a landlord nothing.
check('and none of them is named after a database column',
      not any(re.search(r'[a-z][A-Z]', t) for t in titles))

# The status vocabulary must cover every state the rule tables can produce, or
# a real record renders as a grey "unknown" badge.
print('— the page can name every state the server can return —')
vr = (BACKEND / 'src/modules/viewing/viewingRules.ts').read_text()
api_viewing = set(re.findall(r"'(\w+)',", re.search(r'VIEWING_STATUSES = \[(.*?)\] as const', vr, re.S).group(1)))
al = (BACKEND / 'src/modules/application/applicationLifecycle.ts').read_text()
api_app = set(re.findall(r"'(\w+)',", re.search(r'APPLICATION_STATUSES = \[(.*?)\] as const', al, re.S).group(1)))
page_viewing = set(re.findall(r'^\s{4}(\w+):\s*\{ label', props_js[props_js.index('var VIEWING = {'):props_js.index('var APPLICATION = {')], re.M))
page_app = set(re.findall(r'^\s{4}(\w+):\s*\{ label', props_js[props_js.index('var APPLICATION = {'):props_js.index('var RECOMMENDATION = {')], re.M))
check('every viewing status has wording', api_viewing <= page_viewing)
if not api_viewing <= page_viewing: print('   missing:', sorted(api_viewing - page_viewing))
check('every application status has wording', api_app <= page_app)
if not api_app <= page_app: print('   missing:', sorted(api_app - page_app))
# `unknown` in red would tell an applicant that LRMC's missing paperwork is
# their failing.
check('an unchecked factor is never shown as a failure',
      "unknown: { label: 'Not checked',   tone: 'neutral' }" in props_js)

print('— rules that apply to every LRMC page —')
run_shared_checks(ROOT, check)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)

    TENANT = {"userId": "u1", "name": "Awa Ceesay", "roles": ["tenant"],
              "primaryRole": "tenant", "grants": ["viewing:create", "application:create"]}
    LANDLORD = {"userId": "u2", "name": "Modou Jallow", "roles": ["landlord"],
                "primaryRole": "landlord",
                "grants": ["property:create", "property:updateOwn", "application:readOwn"]}
    COORD = {"userId": "u3", "name": "Binta Sowe", "roles": ["coordinator"],
             "primaryRole": "coordinator",
             "grants": ["application:approve", "viewing:approve", "property:update"]}

    def load(actor=None, query=''):
        ctx.clear_cookies()
        pg.goto(f'http://127.0.0.1:{PORT}/members/index.html', wait_until='domcontentloaded')
        pg.evaluate("() => { try { sessionStorage.clear(); } catch (e) {} }")
        if actor:
            pg.evaluate("""(a) => {
                sessionStorage.setItem('lrmc.token', 'tok-x');
                sessionStorage.setItem('lrmc.actor', JSON.stringify(a));
            }""", actor)
        for k in ('queries', 'ownedQueries', 'appQueries', 'posted',
                  'perfPaths', 'statsQueries'):
            STATE[k] = []
        pg.goto(f'http://127.0.0.1:{PORT}/page{query}', wait_until='networkidle')
        pg.wait_for_timeout(600)

    print('\n— a session is required —')
    load(None)
    check('a visitor is sent to sign in', '/public/login.html' in pg.url)
    check('remembering where they were', 'next=' in pg.url)

    print('\n— the mode is clamped to the roles —')
    load(TENANT)
    check('a tenant lands on the find surface', pg.locator('#find-mode').is_visible())
    check('and never sees the landlord surface', pg.locator('#list-mode').is_hidden())
    check('with no mode switch to offer them', pg.locator('#mode-switch').is_hidden())
    # `?mode=list` in a tenant's address bar must not paint a surface where
    # every control answers 403.
    load(TENANT, '?mode=list')
    check('a tenant asking for the landlord surface is refused',
          pg.locator('#list-mode').is_hidden() and pg.locator('#find-mode').is_visible())
    check('and the URL is corrected to what they actually got', 'mode=find' in pg.url)

    load(LANDLORD)
    check('a landlord lands on their portfolio', pg.locator('#list-mode').is_visible())
    check('and the find surface is not painted underneath', pg.locator('#find-mode').is_hidden())
    check('a landlord is offered both', pg.locator('#mode-switch').is_visible())
    load(LANDLORD, '?mode=find')
    check('and can ask for the find surface', pg.locator('#find-mode').is_visible())
    check('the resolving placeholder is gone either way',
          pg.locator('#mode-resolving').is_hidden())
    check('the current mode is marked for assistive technology',
          pg.get_attribute('#mode-find', 'aria-selected') == 'true')

    print('\n— find: search reaches the API —')
    load(TENANT)
    check('results are shown', pg.locator('#results-grid li').count() == 12)
    check('the count comes from the server total, not the row count',
          '14 homes found' in pg.inner_text('#results-count'))
    pg.select_option('#f-region', 'Brikama')
    pg.wait_for_timeout(500)
    check('a filter is sent rather than applied to a cached array',
          STATE["queries"][-1].get('region') == ['Brikama'])
    check('the mode survives in the URL alongside the filters',
          'mode=find' in pg.url and 'region=Brikama' in pg.url)

    print('\n— find: a late answer never wins —')
    load(TENANT)
    pg.select_option('#f-region', 'Kuntaur')
    pg.wait_for_timeout(120)
    pg.select_option('#f-region', 'Brikama')
    pg.wait_for_timeout(1400)
    check('the newer results are the ones on screen',
          'STALE ANSWER' not in pg.inner_text('#results-grid'))

    print('\n— find: what the tenant has in motion —')
    load(TENANT)
    check('their viewings are listed', 'Awaiting LRMC' in pg.inner_text('#my-viewings'))
    check('a completed one is named as completed', 'Completed' in pg.inner_text('#my-viewings'))
    # The button is an affordance; the server refuses the move regardless.
    check('an open viewing offers to be cancelled',
          pg.locator('#my-viewings [data-cancel-viewing]').count() == 1)
    check('a closed one does not',
          pg.locator('#my-viewings [data-cancel-viewing]').count() < 2)
    check('their applications are listed', 'Submitted' in pg.inner_text('#my-applications'))

    print('\n— find: requesting a viewing —')
    load(TENANT)
    pg.click('#results-grid [data-open-details]')
    pg.wait_for_timeout(500)
    check('the detail panel opens', pg.locator('#panel').is_visible())
    check('it is a real dialog', pg.get_attribute('#panel', 'aria-modal') == 'true')
    check('with both actions offered',
          pg.locator('[data-request-viewing]').count() == 1
          and pg.locator('[data-apply]').count() == 1)
    pg.click('[data-request-viewing]')
    pg.wait_for_timeout(400)
    # The server runs in UTC and the tenant does not.
    check('the form asks for the hour they meant', pg.locator('#v-hour').count() == 1)
    check('and only offers hours LRMC actually shows properties',
          pg.locator('#v-hour option').count() == 10)
    pg.fill('#v-date', '2026-12-01')
    pg.select_option('#v-hour', '14')
    pg.click('#viewing-submit')
    pg.wait_for_timeout(600)
    posted = [b for (u, b) in STATE["posted"] if u == '/api/v1/viewings']
    check('a viewing request is sent', len(posted) == 1)
    check('carrying the local hour', posted and posted[0].get('localHour') == 14)
    check('and the property it is for', posted and posted[0].get('property') == PUBLIC[0]['_id'])
    check('the panel closes on success', pg.locator('#panel').is_hidden())

    print('\n— find: the server refuses a slot, in its own words —')
    STATE["viewings"] = 'refuse-slot'
    load(TENANT)
    pg.click('#results-grid [data-open-details]'); pg.wait_for_timeout(400)
    pg.click('[data-request-viewing]'); pg.wait_for_timeout(300)
    pg.fill('#v-date', '2026-12-01'); pg.select_option('#v-hour', '9')
    pg.click('#viewing-submit'); pg.wait_for_timeout(600)
    check("the server's own wording is shown",
          "at least 2 hours' notice" in pg.inner_text('#viewing-error'))
    check('the refusal is announced', pg.get_attribute('#viewing-error', 'role') == 'alert')
    check('and the panel stays open so they can fix it', pg.locator('#panel').is_visible())
    check('with the button usable again', not pg.is_disabled('#viewing-submit'))
    STATE["viewings"] = 'ok'

    print('\n— find: applying —')
    load(TENANT)
    pg.click('#results-grid [data-open-details]'); pg.wait_for_timeout(400)
    pg.click('[data-apply]'); pg.wait_for_timeout(300)
    check('the form says a person decides, not a score',
          'a person decides' in pg.inner_text('#apply-form'))
    pg.fill('#a-rent', '12000')
    pg.fill('#a-income', '40000')
    pg.click('#apply-submit'); pg.wait_for_timeout(600)
    body = [b for (u, b) in STATE["posted"] if u == '/api/v1/applications']
    check('an application is sent', len(body) == 1)
    check('with what was answered', body and body[0].get('monthlyIncome') == 40000)
    # `.strict()` means an empty string for an unanswered field is a rejection.
    check('and nothing that was left blank',
          body and all(v not in ('', None) for v in body[0].values()))
    check('no assessment is sent — LRMC scores, the applicant does not',
          body and 'assessment' not in body[0] and 'score' not in body[0])

    print('\n— list: the portfolio is the authenticated collection —')
    load(LANDLORD)
    check('the owned properties are shown', pg.locator('#portfolio-grid li').count() == 5)
    check('read from the scoped collection, not the public one',
          len(STATE["ownedQueries"]) >= 1 and len(STATE["queries"]) == 0)
    check('the count is announced', '5 properties' in pg.inner_text('#portfolio-count'))
    pg.click('[data-state="draft"]')
    pg.wait_for_timeout(500)
    check('a state filter is sent to the API',
          STATE["ownedQueries"][-1].get('status') == ['draft'])
    check('and the server decides what comes back',
          pg.locator('#portfolio-grid li').count() == 2)
    check('the chosen state is marked for assistive technology',
          pg.get_attribute('[data-state="draft"]', 'aria-selected') == 'true')

    print('\n— list: paging boundaries —')
    check('no paging for a single page', pg.locator('#portfolio-paging').is_hidden())
    STATE["owned"] = 'manypages'
    load(LANDLORD)
    check('paging appears when there is more than one page',
          pg.locator('#portfolio-paging').is_visible())
    check('and says where you are', 'Page 1 of 3' in pg.inner_text('#portfolio-page-status'))
    check('with previous refused on page one', pg.is_disabled('#portfolio-prev'))
    STATE["owned"] = 'ok'

    print('\n— list: the applications queue shows LRMC’s reasoning —')
    load(LANDLORD)
    queue = pg.inner_text('#applications-queue')
    check('open applications are listed by default', 'Awa Ceesay' in queue)
    check('and the default filter is sent as such',
          STATE["appQueries"][-1].get('open') == ['true'])
    check('a decided one is not in the open list', 'Fatou Sanneh' not in queue)
    check('the recommendation is shown', 'Needs a look' in queue)
    check('with the summary in words', 'Scores 62 of 100' in queue)
    check('and every factor named', 'Identity verification' in queue and 'References' in queue)
    # `unknown` must never read as the applicant's failing.
    check('an unchecked factor reads as unchecked, not failed',
          'Not checked' in queue and queue.count('Not met') == 0)
    pg.click('[data-appfilter=""]')
    pg.wait_for_timeout(500)
    check('asking for all sends no status filter',
          'status' not in STATE["appQueries"][-1] and 'open' not in STATE["appQueries"][-1])
    check('and a decision taken against the score is flagged',
          'against LRMC' in pg.inner_text('#applications-queue'))

    print('\n— list: a late queue answer never wins —')
    load(LANDLORD)
    pg.click('[data-appfilter="rejected"]')   # answers in 800ms
    pg.wait_for_timeout(120)
    pg.click('[data-appfilter="open"]')       # answers at once, overtaking it
    pg.wait_for_timeout(1400)
    check('the newer queue is the one on screen',
          'STALE QUEUE' not in pg.inner_text('#applications-queue'))
    check('and it is the filter that was actually asked for last',
          'Awa Ceesay' in pg.inner_text('#applications-queue'))

    # A slow failure must not replace a fast success either. Guarding only the
    # success path leaves "could not be loaded" landing on a list that loaded.
    STATE["apps"] = 'slow-error'
    load(LANDLORD)
    pg.click('[data-appfilter="rejected"]')
    pg.wait_for_timeout(120)
    pg.click('[data-appfilter="open"]')
    pg.wait_for_timeout(1400)
    check('a late failure does not replace a list that loaded',
          'could not be loaded' not in pg.inner_text('#applications-queue'))
    check('and the good answer is still there',
          'Awa Ceesay' in pg.inner_text('#applications-queue'))
    STATE["apps"] = 'ok'

    print('\n— nothing blank reaches a strict schema —')
    load(TENANT)
    pg.click('#results-grid [data-open-details]'); pg.wait_for_timeout(400)
    pg.click('[data-apply]'); pg.wait_for_timeout(300)
    pg.fill('#a-rent', '12000')
    pg.fill('#a-message', '   ')
    STATE["posted"] = []
    pg.click('#apply-submit'); pg.wait_for_timeout(600)
    blank = [b for (u, b) in STATE["posted"] if u == '/api/v1/applications']
    # `.strict()` with a minimum length turns three spaces into a 422 the
    # applicant cannot act on.
    check('a whitespace-only answer is not sent at all',
          bool(blank) and 'message' not in blank[0])
    check('and what was answered still is',
          bool(blank) and blank[0].get('proposedRent') == 12000)

    print('\n— list: a landlord sees but does not decide —')
    check('no approve button for a landlord',
          pg.locator('#applications-queue [data-decide="approve"]').count() == 0)
    check('nor a reject button',
          pg.locator('#applications-queue [data-decide="reject"]').count() == 0)
    load(COORD)
    check('a coordinator is offered the decision',
          pg.locator('#applications-queue [data-decide="approve"]').count() >= 1)

    print('\n— list: a decision needs a reason —')
    pg.click('#applications-queue [data-decide="approve"]')
    pg.wait_for_timeout(400)
    check('the form asks for one', pg.locator('#d-reason').count() == 1)
    check('and says it is needed for an approval too',
          'as much as for a refusal' in pg.inner_text('#decide-form'))
    check('the field is required', pg.get_attribute('#d-reason', 'required') is not None)
    STATE["posted"] = []
    pg.click('#decide-submit')
    pg.wait_for_timeout(400)
    check('an empty reason is not sent', len(STATE["posted"]) == 0)
    pg.fill('#d-reason', 'References cleared and income evidenced.')
    pg.click('#decide-submit')
    pg.wait_for_timeout(700)
    sent = [b for (u, b) in STATE["posted"] if u.endswith('/approve')]
    check('a reasoned approval is sent', len(sent) == 1)
    check('carrying the reason', sent and sent[0].get('reason', '').startswith('References'))
    check('the panel closes', pg.locator('#panel').is_hidden())
    # Re-read, not patch: the screen must be what the server holds.
    check('and the queue is re-read from the server',
          len(STATE["appQueries"]) >= 2)

    print('\n— list: the server refuses a decision, in its own words —')
    STATE["apps"] = 'refuse-decision'
    load(COORD)
    pg.click('#applications-queue [data-decide="reject"]'); pg.wait_for_timeout(400)
    pg.fill('#d-reason', 'Not suitable.')
    pg.click('#decide-submit'); pg.wait_for_timeout(600)
    check('the refusal is shown as the server worded it',
          'not yours to make' in pg.inner_text('#decide-error'))
    check('and nothing is claimed to have happened',
          pg.locator('#panel').is_visible())
    STATE["apps"] = 'ok'

    print('\n— list: the six-step wizard —')
    load(LANDLORD)
    check('a landlord holding property:create is offered it',
          pg.locator('#add-property').is_visible())
    pg.click('#add-property'); pg.wait_for_timeout(400)
    check('it opens on step one', 'Basic information' in pg.inner_text('#panel-body'))
    check('all six steps are named up front',
          pg.locator('#panel-body ol li').count() == 6)
    check('the current step is marked',
          pg.locator('#panel-body ol li[aria-current="step"]').count() == 1)
    check('there is no way back from the first step',
          pg.locator('#wizard-back').count() == 0)
    # Required fields are declared in the step table, so this is the table
    # being enforced rather than a hand-written check.
    pg.click('#wizard-next'); pg.wait_for_timeout(300)
    check('a required field blocks the step',
          not pg.locator('[data-error-for="title"]').is_hidden())
    check('and focus lands on it', pg.evaluate("() => document.activeElement.id") == 'w-title')
    check('the step has not advanced', 'Basic information' in pg.inner_text('#panel-body'))

    pg.fill('#w-title', 'Two-bedroom apartment on Kairaba Avenue')
    pg.select_option('#w-propertyType', 'apartment')
    pg.fill('#w-bedrooms', '2')
    pg.click('#wizard-next'); pg.wait_for_timeout(400)
    check('a complete step advances', 'Where it is' in pg.inner_text('#panel-body'))
    check('and back is now offered', pg.locator('#wizard-back').count() == 1)
    pg.click('#wizard-back'); pg.wait_for_timeout(400)
    check('going back keeps what was typed',
          pg.input_value('#w-title') == 'Two-bedroom apartment on Kairaba Avenue')
    pg.click('#wizard-next'); pg.wait_for_timeout(400)

    pg.select_option('#w-region', 'Kanifing')
    pg.click('#wizard-next'); pg.wait_for_timeout(400)   # photos
    check('the photo step names storage keys, never URLs',
          'key' in pg.inner_text('#panel-body').lower())
    pg.click('#wizard-next'); pg.wait_for_timeout(400)   # amenities
    check('amenities are offered as the search filters on them',
          pg.locator('#w-amenities input').count() == len(re.findall(r"\['(\w+)', '", props_js[props_js.index('var AMENITIES = ['):props_js.index('function labelFrom')])))
    pg.check('#w-amenities input[value="water"]')
    pg.click('#wizard-next'); pg.wait_for_timeout(400)   # pricing
    check('rent may be left blank', pg.get_attribute('#w-rentAmount', 'required') is None)
    pg.fill('#w-rentAmount', '12000')
    pg.click('#wizard-next'); pg.wait_for_timeout(400)   # publish
    check('the last step is about publishing, not a bare save',
          'listedPublicly' in pg.content() and pg.locator('#w-status').count() == 1)
    check('and it uses the platform lifecycle vocabulary',
          pg.locator('#w-status option[value="draft"]').count() == 1
          and pg.locator('#w-status option[value="active"]').count() == 1)
    check('the final button says what it does',
          'Save property' in pg.inner_text('#wizard-next'))

    STATE["posted"] = []
    pg.click('#wizard-next'); pg.wait_for_timeout(700)
    created = [b for (u, b) in STATE["posted"] if u == '/api/v1/properties']
    check('the property is sent', len(created) == 1)
    body = created[0] if created else {}
    check('with what was answered', body.get('title', '').startswith('Two-bedroom'))
    check('numbers as numbers, not strings', body.get('bedrooms') == 2 and body.get('rentAmount') == 12000)
    check('amenities as an array', body.get('amenities') == ['water'])
    check('the lifecycle status the landlord chose', body.get('status') in ('draft', 'active'))
    check('and nothing left blank, because the schema is strict',
          all(v not in ('', None) for v in body.values()))
    check('the panel closes on success', pg.locator('#panel').is_hidden())
    check('and the portfolio is re-read', len(STATE["ownedQueries"]) >= 2)

    print('\n— list: the server refuses the save —')
    STATE["owned"] = 'refuse-create'
    load(LANDLORD)
    pg.click('#add-property'); pg.wait_for_timeout(400)
    pg.fill('#w-title', 'x'); pg.select_option('#w-propertyType', 'apartment')
    for _ in range(5):
        pg.click('#wizard-next'); pg.wait_for_timeout(350)
        if pg.locator('#w-region').count(): pg.select_option('#w-region', 'Banjul')
    pg.click('#wizard-next'); pg.wait_for_timeout(700)
    # The landlord was on step six; `title` belongs to step one. Sending them
    # back to the step that owns the error beats a banner naming a field they
    # cannot see.
    check('the wizard returns to the step that owns the error',
          'Basic information' in pg.inner_text('#panel-body'))
    check('and the error lands on its field',
          not pg.locator('[data-error-for="title"]').is_hidden())
    # An error for a field the wizard has no slot for must not vanish.
    check('an error with nowhere to go still reaches the banner',
          'Unknown field' in pg.inner_text('#wizard-error'))
    STATE["owned"] = 'ok'

    print('\n— performance is aggregated by the database, not counted here —')
    # These tiles used to fetch `properties.list({ limit: 100 })` and count the
    # occupied ones in the browser. Correct at ten properties, wrong at two
    # hundred — and wrong in the flattering direction, because the percentage
    # stays entirely plausible and is simply computed over the first hundred
    # rows. The stub now returns a total far larger than any page, so a tile
    # reading a page size fails here.
    load(LANDLORD)
    perf = pg.inner_text('#performance')
    check('the portfolio total is the aggregate, not a page of rows',
          '217' in perf)
    check('and not the page size the list call would have returned',
          '100' not in perf and '12' not in perf)
    check('occupancy is the rate the server computed', '85.7%' in perf)
    check('rent collected is in dalasi', 'D 4,250,000' in perf)
    check('open maintenance is counted', 'Open maintenance' in perf)

    check('all three aggregates were requested',
          {'/api/v1/stats/properties', '/api/v1/stats/payments',
           '/api/v1/stats/maintenance'} <= set(STATE["perfPaths"]))
    # These two were fetched *only* to compute tiles. The portfolio grid
    # legitimately lists properties, so the check names what the tiles used to
    # pull rather than banning list calls outright.
    for gone in ['/api/v1/landlord/me/payments', '/api/v1/maintenance-requests']:
        check(f'the tiles no longer pull {gone}', gone not in STATE["perfPaths"])
    # A `limit=100` anywhere means somebody is counting a page again.
    check('and nothing asks for a hundred rows to count them',
          not any(q.get('limit') == ['100'] for q in STATE["ownedQueries"]))
    # A scope the browser could set would turn the tile into a directory of the
    # institution's holdings.
    check('and no stats call carries a scope parameter',
          not any(q for p, q in STATE["statsQueries"] if q))

    # An occupancy of 0% and an occupancy LRMC has not measured look identical
    # on a tile, and only one of them is a reason to worry.
    STATE["statsDown"] = {'payments'}
    load(LANDLORD)
    check('a figure LRMC cannot compute says so rather than showing zero',
          'Not available yet' in pg.inner_text('#performance'))
    check('and does not print a plausible D 0',
          'D 0' not in pg.inner_text('#performance'))
    check('while the tiles that did answer still render',
          '217' in pg.inner_text('#performance'))
    STATE["statsDown"] = set()

    # Several currencies must never be added: 4,250,000 + 12,400 is not an
    # amount of anything, and it would look completely ordinary on a tile.
    STATE["paymentStats"] = PAYMENT_STATS_MULTI
    load(LANDLORD)
    perf = pg.inner_text('#performance')
    check('currencies are never summed together',
          'D 4,250,000' in perf and '4,262,400' not in perf)
    check('and the others are named rather than folded in', 'other currenc' in perf)
    STATE["paymentStats"] = PAYMENT_STATS

    print('\n— nothing rendered can become markup —')
    STATE["apps"] = 'hostile'
    load(LANDLORD)
    check('markup in an applicant name is shown as text, not run',
          pg.evaluate("() => window.__pwned") is None
          and pg.locator('#applications-queue img').count() == 0)
    check('and the name still reaches the page', 'Nasty' in pg.inner_text('#applications-queue'))
    STATE["apps"] = 'ok'

    print('\n— the panel behaves like a dialog —')
    load(TENANT)
    pg.click('#results-grid [data-open-details]'); pg.wait_for_timeout(500)
    check('escape closes it', True)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('and it did', pg.locator('#panel').is_hidden())
    check('focus returns to what opened it',
          pg.evaluate("() => document.activeElement.hasAttribute('data-open-details')"))

    print('\n— every list survives its endpoint failing —')
    STATE["public"] = 'down'; STATE["viewings"] = 'empty'
    load(TENANT)
    check('a failed search says so', pg.locator('#results-error').is_visible())
    check('and the rest of the page still works',
          'You have not asked to view anything yet' in pg.inner_text('#my-viewings'))
    STATE["public"] = 'ok'; STATE["viewings"] = 'ok'
    STATE["apps"] = 'down'
    load(LANDLORD)
    check('a failed queue claims the fault as ours',
          'on our side' in pg.inner_text('#applications-queue'))
    check('and the portfolio is unaffected', pg.locator('#portfolio-grid li').count() == 5)
    STATE["apps"] = 'ok'

    print('\n— contrast, measured —')
    SAMPLER = """() => {
        function rgba(c) {
            const n = (c.match(/[\\d.]+/g) || []).map(Number);
            return { r: n[0] || 0, g: n[1] || 0, b: n[2] || 0, a: n.length > 3 ? n[3] : 1 };
        }
        function bgOf(el) {
            const layers = [];
            for (let n = el; n; n = n.parentElement) {
                const c = rgba(getComputedStyle(n).backgroundColor);
                if (c.a > 0) layers.push(c);
                if (c.a >= 1) break;
            }
            let out = { r: 255, g: 255, b: 255 };
            for (let i = layers.length - 1; i >= 0; i--) {
                const l = layers[i];
                out = { r: l.r * l.a + out.r * (1 - l.a),
                        g: l.g * l.a + out.g * (1 - l.a),
                        b: l.b * l.a + out.b * (1 - l.a) };
            }
            return `rgb(${Math.round(out.r)}, ${Math.round(out.g)}, ${Math.round(out.b)})`;
        }
        return [...document.querySelectorAll('main *, header *, #panel *')]
            .filter(el => el.offsetParent
                && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
            .map(el => ({ tag: el.tagName.toLowerCase(),
                text: el.textContent.trim().slice(0, 40),
                fg: getComputedStyle(el).color, bg: bgOf(el),
                px: parseFloat(getComputedStyle(el).fontSize),
                bold: (parseInt(getComputedStyle(el).fontWeight, 10) || 400) >= 700 }));
    }"""

    def sweep(where):
        pg.mouse.move(0, 0); pg.wait_for_timeout(150)
        samples = pg.evaluate(SAMPLER)
        worst = []
        for s in samples:
            large = s['px'] >= 24 or (s['bold'] and s['px'] >= 18.66)
            need = 3.0 if large else 4.5
            got = contrast(parse_rgb(s['fg']), parse_rgb(s['bg']))
            if got < need - 0.005:
                worst.append((round(got, 2), need, s['tag'], s['text'], s['fg'], s['bg']))
        check(f'{where}: all {len(samples)} rendered text runs meet WCAG AA', not worst)
        for w in worst[:6]:
            print(f'        {w[0]}:1 (needs {w[1]}) — <{w[2]}> {w[3]!r} {w[4]} on {w[5]}')

    load(LANDLORD)
    sweep('landlord')
    load(TENANT)
    sweep('tenant')
    pg.click('#results-grid [data-open-details]'); pg.wait_for_timeout(500)
    sweep('detail panel')
    pg.keyboard.press('Escape')

    print('\n— on a phone —')
    load(LANDLORD)
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(400)
    over = pg.evaluate("""() => [...document.querySelectorAll('main *, header *')]
        .filter(el => el.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 5).map(el => el.tagName + '.' + (el.className || '').toString().slice(0, 60)
                              + ' w=' + Math.round(el.getBoundingClientRect().width))""")
    check('no horizontal overflow at 390px',
          pg.evaluate('()=>document.documentElement.scrollWidth<=window.innerWidth+1'))
    if over: print('        widest:', over)
    check('every button on screen meets the 44px touch target',
          pg.evaluate("""()=>[...document.querySelectorAll('main .lrmc-btn')]
              .filter(a => a.offsetParent !== null && !a.classList.contains('lrmc-btn-sm'))
              .every(a => a.getBoundingClientRect().height >= 44)"""))
    pg.screenshot(path='/tmp/lrmc-members-properties-mobile.png', full_page=False)
    pg.set_viewport_size({'width': 1280, 'height': 900}); pg.wait_for_timeout(400)
    pg.screenshot(path='/tmp/lrmc-members-properties-landlord.png', full_page=False)
    load(TENANT)
    pg.screenshot(path='/tmp/lrmc-members-properties-tenant.png', full_page=False)

    real = [e for e in errs
            if 'favicon' not in e.lower() and 'failed to load resource' not in e.lower()]
    check('no page errors', not real)
    if real: print('   ERRORS:', real[:5])
    b.close()

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} FAILED: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
