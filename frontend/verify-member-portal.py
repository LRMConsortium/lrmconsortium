#!/usr/bin/env python3
"""LRMC — the member portal, end to end.

Six pages, one suite, because the interesting failures are *between* pages.
A per-page suite proves each page works; it cannot prove that two of them
agree, and disagreement is the failure mode a member actually meets: a tile on
the overview reading 12 open jobs and a list on the maintenance page showing 9,
both computed correctly, from different questions.

What this proves, in order:

  1. **The chrome is identical.** Generated from one shell by
     `build-member-pages.py`, and asserted byte-identical here so an edit to one
     copy fails rather than drifting. A display utility on an `lrmc-*` class
     already lost silently in six files at once.
  2. **Nothing is counted in a browser.** Every figure comes from an aggregate
     or a summary endpoint. The stubs return totals far larger than any page
     size, so a tile that went back to `rows.length` reads a plainly wrong
     number rather than a plausible one.
  3. **`—` and `0` are different statements**, on every tile on every page.
  4. **Money is never summed across currencies.** There is no exchange rate on
     this platform.
  5. **`unknown` is never red.** An unchecked factor is LRMC's missing
     paperwork, not the applicant's failing, and the whole scoring engine is
     built so an all-unknown application is held rather than declined.
  6. **The browser client and the contract agree** on every path.
  7. Role-mode resolution, AA contrast, canonical URLs, mobile header.

Run from the frontend/ folder:  python3 verify-member-portal.py
"""
import json, sys, re, time, pathlib, http.server, socketserver, threading
from urllib.parse import parse_qs
from playwright.sync_api import sync_playwright
from lrmc_checks import run_shared_checks

ROOT = pathlib.Path(__file__).parent
DOUBLES = ROOT / 'test-doubles'
BACKEND = ROOT.parent / 'backend'

PAGES = ['index', 'properties', 'payments', 'maintenance', 'leases', 'ususu',
         'applications', 'dashboard']
# The four the builder generates. `index` is the shell's source and `properties`
# predates it, so both are held to the chrome rules but not to byte-identity.
GENERATED = ['payments', 'maintenance', 'leases', 'ususu', 'applications', 'dashboard']

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


# ══ Stub replies ════════════════════════════════════════════════════════════
# Shaped exactly like the handlers. Totals are deliberately far larger than any
# page size, so a figure counted from a list is obviously wrong rather than
# plausibly small.

PROPERTY_STATS = {"totalProperties": 217, "occupied": 180, "vacant": 30,
                  "unavailable": 7, "unclassified": 0, "occupancyRate": 85.7,
                  "activeLeases": 174, "leasesPending": 6,
                  "leasesCompleted": 52, "leasesTerminated": 9}
PROPERTY_STATS_EMPTY = {"totalProperties": 0, "occupied": 0, "vacant": 0,
                        "unavailable": 0, "unclassified": 0, "occupancyRate": None,
                        "activeLeases": 0, "leasesPending": 0,
                        "leasesCompleted": 0, "leasesTerminated": 0}

PAYMENT_STATS = {"totalPayments": 940, "settled": 900, "onTime": 870, "late": 30,
                 "awaiting": 32, "failed": 8, "reliability": 96.7,
                 "collectionWindowDays": 30,
                 "collected": [{"currency": "GMD", "amount": 4_250_000, "payments": 880}]}
PAYMENT_STATS_MULTI = dict(PAYMENT_STATS, collected=[
    {"currency": "GMD", "amount": 4_250_000, "payments": 880},
    {"currency": "USD", "amount": 12_400, "payments": 15},
])
PAYMENT_STATS_EMPTY = {"totalPayments": 0, "settled": 0, "onTime": 0, "late": 0,
                       "awaiting": 0, "failed": 0, "reliability": None,
                       "collectionWindowDays": 30, "collected": []}
PAYMENT_STATS_90 = dict(PAYMENT_STATS, collectionWindowDays=90)

MAINTENANCE_STATS = {"totalRequests": 64, "openRequests": 12, "inProgress": 9,
                     "completed": 40, "stalled": 3, "unclassified": 0}
APPLICATION_STATS = {"totalApplications": 48, "underReview": 11, "approved": 25,
                     "declined": 9, "withdrawn": 3, "unclassified": 0}
USUSU_STATS = {"totalMembers": 34, "avgGroupHealth": 92.5,
               "totalContributions": 410, "totalMisses": 18,
               "totalGroups": 6, "activeGroups": 5}
USUSU_STATS_EMPTY = {"totalMembers": 0, "avgGroupHealth": None,
                     "totalContributions": 0, "totalMisses": 0,
                     "totalGroups": 0, "activeGroups": 0}

PAYMENT_SUMMARY = {"total": 41, "settled": 38, "onTime": 36, "late": 2,
                   "failed": 1, "awaiting": 2, "onTimeRate": 94.7,
                   "settledByCurrency": [{"currency": "GMD", "amount": 190000, "payments": 38}],
                   "scope": "all", "partial": False}
PAYMENT_SUMMARY_EMPTY = {"total": 0, "settled": 0, "onTime": 0, "late": 0,
                         "failed": 0, "awaiting": 0, "onTimeRate": None,
                         "settledByCurrency": [], "scope": "all", "partial": False}
PAYMENT_SUMMARY_PARTIAL = dict(PAYMENT_SUMMARY, scope="recordedByMe", partial=True)

PAYMENTS = [
    {"id": f"p{n}", "reference": f"PAY-{n:06X}", "kind": "rent", "amount": 5000 + n,
     "currency": "GMD", "status": "succeeded",
     "paidAt": "2026-07-01T00:00:00.000Z"} for n in range(1, 21)
]
PAYMENTS[0]["recordedBy"] = "u-coord"
PAYMENTS[1]["status"] = "pending"
PAYMENTS[2]["status"] = "failed"

MAINTENANCE_SUMMARY = {"total": 22, "open": 6, "inProgress": 4, "completed": 11,
                       "stalled": 1, "unclassified": 0, "needsEscalation": 3,
                       "averageResolutionHours": 41.5}
MAINTENANCE_SUMMARY_EMPTY = {"total": 0, "open": 0, "inProgress": 0, "completed": 0,
                             "stalled": 0, "unclassified": 0, "needsEscalation": 0,
                             "averageResolutionHours": None}

JOBS = [
    {"id": "m1", "reference": "MNT-0001", "title": "Kitchen tap will not close",
     "status": "open", "priority": "emergency", "createdAt": "2026-08-01T00:00:00.000Z",
     "description": "Water is running constantly."},
    {"id": "m2", "reference": "MNT-0002", "title": "Ceiling fan noise",
     "status": "onHold", "priority": "low", "createdAt": "2026-07-01T00:00:00.000Z"},
    {"id": "m3", "reference": "MNT-0003", "title": "Repaint the stairwell",
     "status": "completed", "priority": "normal", "createdAt": "2026-06-01T00:00:00.000Z"},
]

ASSESSED = {
    "factors": [
        {"factor": "identity", "label": "Identity verification", "status": "pass",
         "points": 25, "max": 25, "reason": "Identity verified by LRMC."},
        {"factor": "paymentHistory", "label": "Payment history with LRMC", "status": "unknown",
         "points": 0, "max": 25, "reason": "No payment history with LRMC yet."},
        {"factor": "employment", "label": "Employment and income", "status": "concern",
         "points": 8, "max": 12, "reason": "Income is 2.5x the rent."},
        {"factor": "disputes", "label": "Open disputes", "status": "pass",
         "points": 15, "max": 15, "reason": "No open disputes."},
        {"factor": "references", "label": "References", "status": "pass",
         "points": 14, "max": 15, "reason": "2 references checked and cleared."},
        {"factor": "ususuContributions", "label": "Ususu contributions", "status": "unknown",
         "points": 0, "max": 8, "reason": "No Ususu contributions on record."},
    ],
    "score": 62, "recommendation": "review",
    "blockedBy": [], "missing": ["paymentHistory", "ususuContributions"],
    "takenAt": "2026-08-01T09:00:00.000Z",
}

APPLICATIONS = [
    {"id": "a1", "status": "submitted", "applicantName": "Awa Ceesay",
     "propertyTitle": "2-bed, Serrekunda", "assessment": ASSESSED},
    {"id": "a2", "status": "underReview", "applicantName": "Modou Jallow",
     "propertyTitle": "3-bed, Bakau",
     "assessment": dict(ASSESSED, recommendation="recommend", score=88, missing=[])},
    {"id": "a3", "status": "approved", "applicantName": "Fatou Sanneh",
     "propertyTitle": "Studio, Banjul",
     "assessment": dict(ASSESSED, recommendation="decline", score=30)},
]

LEASES = [
    {"id": "l1", "reference": "LSE-000001", "status": "active", "monthlyRent": 12000,
     "currency": "GMD", "leaseStart": "2026-01-01T00:00:00.000Z",
     "leaseEnd": "2026-12-31T00:00:00.000Z",
     "property": {"title": "2-bed, Serrekunda"}},
    # Open-ended. The page must say "month to month" in words rather than
    # leaving a blank that reads as missing data.
    {"id": "l2", "reference": "LSE-000002", "status": "draft", "monthlyRent": 8000,
     "currency": "GMD", "leaseStart": "2026-09-01T00:00:00.000Z", "leaseEnd": None,
     "property": {"title": "Studio, Banjul"}},
    {"id": "l3", "reference": "LSE-000003", "status": "terminated", "monthlyRent": 15000,
     "currency": "GMD", "leaseStart": "2025-01-01T00:00:00.000Z",
     "leaseEnd": "2026-01-01T00:00:00.000Z", "closedAt": "2025-06-01T00:00:00.000Z",
     "terminationReason": "Property sold",
     "property": {"title": "3-bed, Bakau"}},
    {"id": "l4", "reference": "LSE-000004", "status": "inArrears", "monthlyRent": 9000,
     "currency": "GMD", "leaseStart": "2026-03-01T00:00:00.000Z",
     "leaseEnd": "2027-02-28T00:00:00.000Z",
     "property": {"title": "1-bed, Kanifing"}},
]

GROUPS = [
    {"id": "g1", "name": "Serrekunda Traders", "status": "active",
     "members": ["u3", "u1", "u2"], "region": "Kanifing",
     "createdBy": "u3", "groupHealth": 90},
    # Formed but nothing recorded. Health must render `—`, never 100 and never 0.
    {"id": "g2", "name": "Bakau Market Circle", "status": "forming",
     "members": ["u3"], "region": "Bakau", "createdBy": "u3", "groupHealth": None},
]

GROUP_SUMMARY = {
    "group": GROUPS[0],
    "memberCount": 3, "contributions": 17, "misses": 2,
    "groupHealth": 90,
    "streaks": {"u3": 5, "u1": 0, "u2": 3},
    "contributedByCurrency": [{"currency": "GMD", "amount": 8500, "entries": 17}],
    "hasActivity": True,
    "entries": [
        {"member": "u1", "kind": "contribution", "period": "2026-06", "amount": 500, "currency": "GMD"},
        {"member": "u1", "kind": "miss", "period": "2026-07"},
        {"member": "u2", "kind": "contribution", "period": "2026-07", "amount": 500, "currency": "GMD"},
    ],
}
# A circle formed on Tuesday. `groupHealth: null` is the whole point.
GROUP_SUMMARY_EMPTY = {
    "group": GROUPS[1],
    "memberCount": 1, "contributions": 0, "misses": 0,
    "groupHealth": None, "streaks": {"u3": 0},
    "contributedByCurrency": [], "hasActivity": False, "entries": [],
}

STATE = {
    "properties": PROPERTY_STATS, "payments": PAYMENT_STATS,
    "maintenance": MAINTENANCE_STATS, "applications": APPLICATION_STATS,
    "ususu": USUSU_STATS,
    "paymentSummary": PAYMENT_SUMMARY,
    "maintenanceSummary": MAINTENANCE_SUMMARY,
    "down": set(),
    "hostile": False,
    "slowFails": False,
    "recordFails": None,
    "requests": [], "posted": [], "appQueries": [], "leaseQueries": [],
    "leaseActionFails": None,
    "groupSummary": GROUP_SUMMARY,
    "groupActionFails": None,
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
        STATE["requests"].append((base, {}))
        STATE["posted"].append((base, body))

        if base == '/api/v1/auth/logout':
            return s._json({"success": True,
                            "data": {"signedOut": True, "refreshRevoked": True}})
        if base == '/api/v1/payments/record':
            if STATE["recordFails"]:
                return s._json({"success": False, "error": {
                    "code": "VALIDATION_FAILED", "message": "Request validation failed",
                    "details": STATE["recordFails"]}}, 422)
            return s._json({"success": True, "data": {"id": "pNew", "status": "succeeded"}}, 201)
        if base.startswith('/api/v1/ususu/group/'):
            if STATE["groupActionFails"]:
                return s._json({"success": False, "error": {
                    "code": "VALIDATION_FAILED", "message": "Request validation failed",
                    "details": STATE["groupActionFails"]}}, 422)
            return s._json({"success": True, "data": {"id": "gNew"}}, 201)
        if base in ('/api/v1/leases/activate', '/api/v1/leases/complete',
                    '/api/v1/leases/terminate'):
            if base.endswith('terminate') and not body.get('reason'):
                return s._json({"success": False, "error": {
                    "code": "VALIDATION_FAILED", "message": "Request validation failed",
                    "details": [{"field": "reason", "code": "reason-required",
                                 "message": "Say why this tenancy is ending."}]}}, 422)
            if STATE["leaseActionFails"]:
                return s._json({"success": False, "error": {
                    "code": "VALIDATION_FAILED", "message": "Request validation failed",
                    "details": STATE["leaseActionFails"]}}, 422)
            return s._json({"success": True, "data": {"id": body.get('lease'),
                                                     "status": "active"}})
        if base == '/api/v1/maintenance/request':
            return s._json({"success": True, "data": {"id": "mNew", "status": "open"}}, 201)
        if base == '/api/v1/maintenance/update':
            if body.get('status') == 'cancelled' and not body.get('note'):
                return s._json({"success": False, "error": {
                    "code": "VALIDATION_FAILED", "message": "Request validation failed",
                    "details": [{"field": "note", "code": "reason-required",
                                 "message": "Say why: a cancelled request is explained to whoever raised it."}]}}, 422)
            return s._json({"success": True, "data": {"id": body.get('request'),
                                                     "status": body.get('status')}})
        if re.match(r'^/api/v1/application/[^/]+/(approve|reject)$', base):
            return s._json({"success": True, "data": {"id": "a1", "status": "approved"}})
        s.send_response(404); s.end_headers()

    def do_GET(s):
        base, _, query = s.path.partition('?')
        q = parse_qs(query)
        if base.startswith('/api/v1/'):
            STATE["requests"].append((base, q))

        if base.startswith('/api/v1/stats/'):
            name = base.rsplit('/', 1)[1]
            if name in STATE["down"]:
                return s._json({"success": False,
                                "error": {"code": "INTERNAL", "message": "boom"}}, 500)
            if name in STATE:
                return s._json({"success": True, "data": STATE[name]})
            s.send_response(404); s.end_headers(); return

        if re.match(r'^/api/v1/payments/[^/]+/summary$', base):
            if 'paymentSummary' in STATE["down"]:
                return s._json({"success": False, "error": {"code": "INTERNAL", "message": "x"}}, 500)
            return s._json({"success": True, "data": STATE["paymentSummary"]})

        if re.match(r'^/api/v1/payments/[^/]+/history$', base):
            return s._json({"success": True, "data": PAYMENTS,
                            "meta": {"page": 1, "limit": 20, "total": 41}})

        if re.match(r'^/api/v1/maintenance/[^/]+/summary$', base):
            return s._json({"success": True, "data": STATE["maintenanceSummary"]})

        if re.match(r'^/api/v1/maintenance/[^/]+/list$', base):
            return s._json({"success": True, "data": JOBS,
                            "meta": {"page": 1, "limit": 20, "total": 22}})

        if re.match(r'^/api/v1/ususu/group/user/[^/]+$', base):
            return s._json({"success": True, "data": GROUPS})
        if re.match(r'^/api/v1/ususu/group/[^/]+/summary$', base):
            wanted = base.split('/')[-2]
            if wanted == 'g2':
                return s._json({"success": True, "data": GROUP_SUMMARY_EMPTY})
            return s._json({"success": True, "data": STATE["groupSummary"]})

        if re.match(r'^/api/v1/leases/user/[^/]+$', base):
            STATE["leaseQueries"].append(q)
            # A filter the page has already moved on from, answering late.
            if q.get('status') == ['terminated']:
                time.sleep(0.9)
                return s._json({"success": True,
                                "data": [dict(LEASES[0], reference='STALE LEASE')],
                                "meta": {"total": 1}})
            rows = LEASES
            if q.get('status'):
                rows = [r for r in LEASES if r['status'] == q['status'][0]]
            return s._json({"success": True, "data": rows, "meta": {"total": 37}})

        if re.match(r'^/api/v1/lease/[^/]+$', base):
            wanted = base.rsplit('/', 1)[1]
            row = next((r for r in LEASES if r['id'] == wanted), LEASES[0])
            return s._json({"success": True, "data": row})

        if base == '/api/v1/applications':
            STATE["appQueries"].append(q)
            # A search the page has already moved on from, answering late. The
            # marker row is what proves the guard: if it ever reaches the DOM,
            # a slow answer has overwritten a newer one.
            if q.get('status') == ['withdrawn']:
                time.sleep(0.9)
                # A slow *failure* can overwrite a newer good answer just as
                # easily as a slow success can, and the catch path needs its own
                # guard — which is a separate line of code and so a separate bug.
                if STATE["slowFails"]:
                    return s._json({"success": False,
                                    "error": {"code": "INTERNAL", "message": "boom"}}, 500)
                return s._json({"success": True,
                                "data": [dict(APPLICATIONS[0], applicantName='STALE ANSWER')],
                                "meta": {"total": 1}})
            rows = APPLICATIONS
            if STATE["hostile"]:
                rows = [dict(APPLICATIONS[0],
                             applicantName='<img src=x onerror="window.__pwned=1">Nasty')]
            elif q.get('status'):
                rows = [r for r in APPLICATIONS if r['status'] == q['status'][0]]
            elif q.get('open'):
                rows = [r for r in APPLICATIONS
                        if r['status'] in ('submitted', 'underReview', 'awaitingApplicant')]
            return s._json({"success": True, "data": rows, "meta": {"total": 48}})

        if re.match(r'^/api/v1/application/[^/]+$', base):
            return s._json({"success": True, "data": dict(APPLICATIONS[0])})

        if base.startswith('/api/v1/'):
            return s._json({"success": True, "data": [], "meta": {"total": 0}})

        if base.startswith('/__t/'):
            p = DOUBLES / base[5:]
            if p.exists():
                return s._raw(p.read_bytes(),
                              'text/css' if p.suffix == '.css' else 'application/javascript')
        if base.startswith('/page/'):
            name = base[len('/page/'):]
            return s._raw(pathlib.Path(f'/tmp/mp-{name}.html').read_bytes(), 'text/html')
        if base.startswith('/no-alpine/'):
            name = base[len('/no-alpine/'):]
            return s._raw(pathlib.Path(f'/tmp/na-{name}.html').read_bytes(), 'text/html')
        if base.startswith(('/hq/', '/members/', '/staff/', '/marketplace/', '/public/')):
            return s._raw(b'<!doctype html><title>landed</title><p>landed</p>', 'text/html')
        return super().do_GET()

    def _json(s, body, code=200):
        return s._raw(json.dumps(body).encode(), 'application/json', code)

    def _raw(s, body, ct, code=200):
        s.send_response(code); s.send_header('Content-Type', ct)
        s.send_header('Content-Length', str(len(body))); s.end_headers(); s.wfile.write(body)


# ══ Swap the CDNs for local doubles, once per page ══════════════════════════
def stage(name):
    src = (ROOT / f'members/{name}.html').read_text()
    t = src
    t = t.replace('<script src="https://cdn.tailwindcss.com"></script>',
                  '<link rel="stylesheet" href="/__t/tw-subset.css" /><script src="/__t/tailwind-double.js"></script>')
    t = t.replace('<script src="https://unpkg.com/htmx.org@1.9.12"></script>',
                  '<script src="/__t/htmx-double.js"></script>')
    # Alpine now loads from `/assets/vendor/` with a CDN fallback in `onerror`,
    # so the tag spans lines and mentions unpkg. Matched by src rather than by
    # its exact text, or the assertion below would trip on the fallback.
    t = re.sub(r'<script src="/assets/vendor/alpine\.min\.js"[\s\S]*?</script>',
               '<script src="/__t/alpine-double.js" defer></script>', t)
    t = t.replace('<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js" defer></script>',
                  '<script src="/__t/lucide-double.js" defer></script>')
    t = re.sub(r'<link href="https://fonts\.googleapis[^>]*>', '', t)
    t = re.sub(r'<link rel="preconnect"[^>]*>', '', t)
    # Looks for CDN URLs in `src`/`href`, not for the word anywhere. The Alpine
    # tag's comment explains its own unpkg fallback, and an assertion that
    # tripped on prose would push somebody to delete the explanation.
    leftover = re.findall(r'(?:src|href)="(https://(?:unpkg\.com|cdn\.tailwindcss)[^"]*)"', t)
    assert not leftover, f'a CDN reference survived in {name}: {leftover}'
    pathlib.Path(f'/tmp/mp-{name}.html').write_text(t)

    # A second copy with Alpine missing entirely. Not a hypothetical: LRMC
    # launches in The Gambia, and a CDN script is the single most likely
    # request on a page to fail on intermittent mobile data.
    pathlib.Path(f'/tmp/na-{name}.html').write_text(
        t.replace('<script src="/__t/alpine-double.js" defer></script>', ''))
    return src


SOURCES = {name: stage(name) for name in PAGES}

socketserver.TCPServer.allow_reuse_address = True
class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    """Threaded, so a slow reply can be overtaken by a fast one. Serialised, the
    race the stale-reply guards exist for cannot happen at all."""
    daemon_threads = True

srv = ThreadedServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()


# ══ Source-level ════════════════════════════════════════════════════════════
print('— the chrome is identical across the portal —')

def head_of(src):
    return src[src.index('  <link rel="icon"'):src.index('</head>')]

def sidebar_of(src):
    return src[src.index('<div class="flex h-full">'):src.index('<!-- ═══ MAIN COLUMN')]

base_head = head_of(SOURCES['index'])
for name in GENERATED:
    check(f'{name}: the <head> chrome is byte-identical to the shell',
          head_of(SOURCES[name]) == base_head)

# The rail must offer the same six links, in the same order, everywhere — and
# exactly one of them may be marked current.
NAV_ORDER = ['/members/index.html', '/members/properties.html', '/members/payments.html',
             '/members/maintenance.html', '/members/leases.html', '/members/ususu.html',
             '/members/applications.html', '/members/dashboard.html']
for name in PAGES:
    links = re.findall(r'<a href="(/members/[^"]+)" class="lrmc-nav-item', SOURCES[name])
    check(f'{name}: the rail offers all six pages in order', links == NAV_ORDER)
    current = re.findall(r'class="lrmc-nav-item active" aria-current="page"', SOURCES[name])
    check(f'{name}: exactly one link is marked current', len(current) == 1)
    check(f'{name}: and it is this page',
          f'<a href="/members/{name}.html" class="lrmc-nav-item active"' in SOURCES[name])

for name in PAGES:
    check(f'{name}: has a canonical URL',
          f'<link rel="canonical" href="https://lrmconsortium.com/members/{name}.html" />'
          in SOURCES[name])
    # Zone D is behind a session; a search engine indexing it would be indexing
    # a login redirect.
    check(f'{name}: is not indexed', 'noindex' in SOURCES[name])
    check(f'{name}: loads the shared portal layer',
          '/assets/js/portal.js' in SOURCES[name])
    # The bug that cost a phone menu button on every desktop, in six files.
    check(f'{name}: the phone toggle is wrapped, not utility-classed',
          '<span class="lg:hidden"><button' in SOURCES[name])

print('\n— nothing is counted in a browser —')
# The *resolved* contract, not the source. Profile endpoints are generated by
# `moduleFactory` and never appear as a literal `path:` in apiBlueprint.ts, so
# reading the source under-reports by around 140 endpoints and calls perfectly
# good client paths missing.
spec = json.loads((BACKEND / 'docs/openapi.json').read_text())
contract_paths = {re.sub(r'\{(\w+)\}', r':\1', p) for p in spec['paths']}

client = (ROOT / 'assets/js/sdk.js').read_text()
literals = [m[1] for m in re.finditer(r"(?:get|post|patch|del|request)\(\s*'(/[^']*)'(?!\s*\+)", client)]
built = [m[1] for m in re.finditer(r"'(/[^']*/)'\s*\+\s*seg\(", client)]
prefixes = {p[:p.index(':')] for p in contract_paths if ':' in p}

for p in literals:
    check(f'browser client path {p} is in the contract', p in contract_paths)
for p in built:
    check(f'browser client path {p}:id is in the contract', p in prefixes)

for name in PAGES:
    src = SOURCES[name]
    if name == 'properties':
        continue   # the portfolio grid legitimately lists properties
    for banned in ['properties.list(', 'maintenance.list(', 'payments.list(']:
        check(f'{name}: never calls {banned}', banned not in src)
    check(f'{name}: never takes a count from rows.length',
          not re.search(r'rows\.length\s*\+\s*[\'"]', src))

print('\n— the shared layer holds the rules that were got wrong before —')
portal = (ROOT / 'assets/js/portal.js').read_text()
check('null renders a dash, zero renders zero',
      "var unknown = value === null || value === undefined;" in portal)
check('a null rate is not passed to percent()',
      "if (value === null || value === undefined) return null;" in portal)
check('currencies are never summed in the shared renderer',
      '.reduce(' not in portal.split('function moneyOf')[1].split('function moneyMeta')[0])
check('a total comes from meta, never from rows.length',
      'res.__meta.total' in portal and 'rows.length' not in portal.split('function totalOf')[1][:200])
# The single most important line in the file.
check('an unchecked factor is shown as "Not checked", never as a failure',
      "f.status === 'unknown'" in portal and "'Not checked'" in portal)
check('and a job on hold is neutral, not danger',
      "onHold:     { label: 'On hold',     tone: 'neutral' }" in portal)

print('\n— rules that apply to every LRMC page —')
run_shared_checks(ROOT, check)


# ══ In the browser ══════════════════════════════════════════════════════════
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)

    TENANT = {"userId": "u1", "fullName": "Awa Ceesay", "roles": ["tenant"],
              "primaryRole": "tenant",
              "grants": ["payment:readOwn", "maintenanceRequest:create",
                         "maintenanceRequest:readOwn", "application:create",
                         "lease:readOwn"]}
    LANDLORD = {"userId": "u2", "fullName": "Modou Jallow", "roles": ["landlord"],
                "primaryRole": "landlord",
                "grants": ["property:create", "property:updateOwn", "payment:readOwn",
                           "maintenanceRequest:create", "application:readOwn",
                           "lease:readOwn", "lease:create", "lease:updateOwn"]}
    COORD = {"userId": "u3", "fullName": "Binta Sowe", "roles": ["coordinator"],
             "primaryRole": "coordinator",
             "grants": ["analytics:read", "property:read", "payment:record",
                        "payment:readOwn", "maintenanceRequest:assign",
                        "maintenanceRequest:update", "application:approve",
                        "application:read", "lease:read", "lease:update",
                        "lease:create", "ususuLedger:create", "ususuLedger:read"]}

    def load(page, actor=None, query=''):
        ctx.clear_cookies()
        pg.goto(f'http://127.0.0.1:{PORT}/members/{page}.html', wait_until='domcontentloaded')
        pg.evaluate("() => { try { sessionStorage.clear(); } catch (e) {} }")
        if actor:
            pg.evaluate("""(a) => {
                sessionStorage.setItem('lrmc.token', 'tok-x');
                sessionStorage.setItem('lrmc.refresh', 'refresh-x');
                sessionStorage.setItem('lrmc.actor', JSON.stringify(a));
            }""", actor)
        for k in ('requests', 'posted', 'appQueries'):
            STATE[k] = []
        pg.goto(f'http://127.0.0.1:{PORT}/page/{page}{query}', wait_until='networkidle')
        pg.wait_for_timeout(500)

    def tiles():
        return pg.evaluate("""() => [...document.querySelectorAll('main .lrmc-card')]
            .filter(c => c.querySelector('.lrmc-stat-label'))
            .map(c => ({
                label: c.querySelector('.lrmc-stat-label').textContent.trim(),
                value: c.querySelector('.lrmc-stat-value').textContent.trim(),
                meta: (c.querySelector('.lrmc-stat-meta') || {}).textContent?.trim() || '',
            }))""")

    def tile_named(label):
        for t in tiles():
            if t['label'] == label: return t
        return None

    print('\n— every page needs a session —')
    for page in GENERATED:
        load(page, None)
        check(f'{page}: a visitor is sent to sign in', '/public/login.html' in pg.url)
        check(f'{page}: remembering where they were', 'next=' in pg.url)

    print('\n— role-mode resolution, on every page —')
    for page in GENERATED:
        load(page, TENANT)
        check(f'{page}: a tenant gets the tenant reading', 'as=tenant' in pg.url)
        check(f'{page}: with no switch to offer them',
              pg.locator('#reading-switch').is_hidden())
        check(f'{page}: the resolving placeholder is gone',
              pg.locator('#reading-resolving').is_hidden())
        load(page, COORD)
        check(f'{page}: a coordinator gets the regional reading', 'as=coordinator' in pg.url)
        # Not a control — the endpoints are gated again server-side — but a
        # tenant shown the coordinator reading gets a screen of refusals.
        load(page, TENANT, '?as=coordinator')
        check(f'{page}: and a tenant asking for it is clamped back', 'as=tenant' in pg.url)

    print('\n— payments —')
    load('payments', LANDLORD)
    t = tile_named('Collected, 30 days')
    check('the collected tile is labelled from the reply', t is not None)
    check('and shows the launch currency', t and '4,250,000' in t['value'])
    check('paid on time comes from this person\'s own summary',
          (tile_named('Paid on time') or {}).get('value') == '94.7%')
    # Two figures, two labels. `paymentReliability` in an assessment counts
    # missed instalments and is a different number; sharing a label would be a
    # support ticket nobody can settle.
    check('and is labelled "paid on time", never "reliability"',
          tile_named('Reliability') is None)
    check('the ledger lists the payments', pg.locator('#ledger li').count() == 20)
    check('a total comes from meta, not from the twenty rows on screen',
          '41 payments' in pg.inner_text('#ledger-total'))
    check('a recorded receipt says a person typed it in',
          'Recorded in person' in pg.inner_text('#ledger'))
    check('the reference is on the row, so somebody can quote it',
          'PAY-' in pg.inner_text('#ledger'))

    # The form is a courtesy gate; the server refuses regardless.
    check('a landlord is not offered the record form',
          pg.locator('#record-section').is_hidden())
    load('payments', TENANT)
    check('nor a tenant', pg.locator('#record-section').is_hidden())
    load('payments', COORD)
    check('but a coordinator is', pg.locator('#record-section').is_visible())

    print('\n— a coordinator is told their totals are partial —')
    STATE["paymentSummary"] = PAYMENT_SUMMARY_PARTIAL
    load('payments', COORD)
    check('the partial notice appears', pg.locator('#partial-notice').is_visible())
    check('and says what it covers',
          'only the payments you recorded' in pg.inner_text('#partial-notice'))
    STATE["paymentSummary"] = PAYMENT_SUMMARY
    load('payments', COORD)
    check('and is gone when the totals are whole',
          pg.locator('#partial-notice').is_hidden())

    print('\n— recording a payment —')
    load('payments', COORD)
    pg.fill('#rec-payer', '0' * 24)
    pg.fill('#rec-amount', '5000')
    pg.click('#record-form button[type=submit]')
    pg.wait_for_timeout(400)
    posted = [b for p_, b in STATE["posted"] if p_ == '/api/v1/payments/record']
    check('the receipt reaches the API', len(posted) == 1)
    check('with the amount as a number', posted and posted[0].get('amount') == 5000)
    # The server derives these. A client that sent them would be asserting that
    # money moved, which is the whole class of bug the ledger forbids.
    for forbidden in ['status', 'recordedBy', 'reference']:
        check(f'and never sends a {forbidden}', posted and forbidden not in posted[0])
    check('the list is re-read rather than patched in place',
          any(p_.endswith('/history') for p_, _ in STATE["requests"][-6:]))

    STATE["recordFails"] = [{"field": "payer", "code": "self-dealing",
                             "message": "You cannot record a payment you made yourself."}]
    load('payments', COORD)
    pg.fill('#rec-payer', '0' * 24)
    pg.fill('#rec-amount', '5000')
    pg.click('#record-form button[type=submit]')
    pg.wait_for_timeout(400)
    check('a server refusal lands on the field it names',
          not pg.locator('[data-error-for="payer"]').is_hidden())
    check('and says why', 'yourself' in pg.inner_text('[data-error-for="payer"]'))
    STATE["recordFails"] = [{"field": "somethingElse", "message": "Nowhere to put this"}]
    load('payments', COORD)
    pg.fill('#rec-payer', '0' * 24)
    pg.fill('#rec-amount', '5000')
    pg.click('#record-form button[type=submit]')
    pg.wait_for_timeout(400)
    # An error with nowhere to go must still be shown rather than dropped.
    check('an error with no field still reaches the banner',
          not pg.locator('#record-error').is_hidden())
    STATE["recordFails"] = None

    print('\n— maintenance —')
    load('maintenance', TENANT)
    check('the tiles come from the aggregate',
          (tile_named('Open') or {}).get('value') == '12')
    check('turnaround comes from this person\'s summary',
          '41.5 hrs' in (tile_named('Average turnaround') or {}).get('value', ''))
    check('the work orders are listed', pg.locator('#jobs li').count() == 3)
    check('an emergency is marked as one', 'Emergency' in pg.inner_text('#jobs'))
    # Neutral, not red. A job on hold is waiting on a decision, not a failure,
    # and colouring it red makes a queue unreadable.
    check('a job on hold is neutral, not a failure',
          pg.evaluate("""() => {
              const el = [...document.querySelectorAll('#jobs .lrmc-badge')]
                  .find(e => e.textContent.trim() === 'On hold');
              return el ? el.className.includes('neutral') : false;
          }"""))
    check('escalation is surfaced', pg.locator('#escalation').is_visible())
    check('and says how many', '3 requests need a coordinator' in pg.inner_text('#escalation'))

    STATE["maintenanceSummary"] = MAINTENANCE_SUMMARY_EMPTY
    load('maintenance', TENANT)
    check('a landlord with nothing resolved sees a dash, not nought hours',
          (tile_named('Average turnaround') or {}).get('value') == '—')
    check('and no escalation banner', pg.locator('#escalation').is_hidden())
    STATE["maintenanceSummary"] = MAINTENANCE_SUMMARY

    load('maintenance', TENANT)
    check('a tenant is offered the report form', pg.locator('#raise-section').is_visible())
    pg.fill('#raise-property', '0' * 24)
    pg.fill('#raise-title', 'Kitchen tap will not close')
    pg.click('#raise-form button[type=submit]')
    pg.wait_for_timeout(400)
    raised = [b for p_, b in STATE["posted"] if p_ == '/api/v1/maintenance/request']
    check('the report reaches the API', len(raised) == 1)
    # A form that asked for these would be filled in with guesses that then look
    # like commitments.
    for forbidden in ['slaHours', 'assignedVendor', 'status', 'quotedAmount']:
        check(f'and never sends a {forbidden}', raised and forbidden not in raised[0])

    load('maintenance', COORD)
    pg.click('#jobs [data-request]')
    pg.wait_for_timeout(200)
    check('a row opens the update panel', pg.locator('#update-panel').is_visible())
    pg.select_option('#update-status', 'cancelled')
    pg.click('#update-form button[type=submit]')
    pg.wait_for_timeout(400)
    # "Your request was cancelled" with nothing after it is how people stop
    # reporting things.
    check('cancelling without a reason is refused by the server',
          not pg.locator('[data-error-for="note"]').is_hidden())
    check('and the message says why', 'Say why' in pg.inner_text('[data-error-for="note"]'))
    pg.fill('#update-note', 'Tenant fixed it themselves')
    pg.click('#update-form button[type=submit]')
    pg.wait_for_timeout(400)
    check('with a reason it goes through', pg.locator('#update-panel').is_hidden())
    check('and the list is re-read, not patched',
          any(p_.endswith('/list') for p_, _ in STATE["requests"][-6:]))

    print('\n— leases —')
    load('leases', LANDLORD)
    check('the tiles come from the property aggregate',
          (tile_named('Active tenancies') or {}).get('value') == '174')
    # Both reported, neither derived from the other. A unit marked occupied with
    # no live lease is somebody living there without paperwork.
    check('occupancy and tenancies are shown side by side, not reconciled',
          '174 leases' in (tile_named('Occupied units') or {}).get('meta', ''))
    check('the list shows the tenancies', pg.locator('#leases li').count() == 4)
    check('a total comes from meta, not the four rows on screen',
          '37 tenancies' in pg.inner_text('#lease-total'))
    check('rent is shown per month', '/ mo' in pg.inner_text('#leases'))
    check('and the term is on the row', 'LSE-000001' in pg.inner_text('#leases'))
    # A blank where an end date goes reads as missing data. Month-to-month is a
    # choice, and the page says so in words.
    check('an open-ended tenancy says month to month',
          'month to month' in pg.inner_text('#leases'))
    check('and a terminated one says why',
          'Property sold' in pg.inner_text('#leases'))
    # Amber, not red. A tenant behind on rent is a tenant with a problem, not a
    # failed tenancy, and a queue where every late payment is red is unreadable.
    check('a lease in arrears is a warning, not a failure',
          pg.evaluate("""() => {
              const el = [...document.querySelectorAll('#leases .lrmc-badge')]
                  .find(e => e.textContent.trim() === 'In arrears');
              return el ? el.className.includes('warning') : false;
          }"""))

    STATE["leaseQueries"] = []
    pg.select_option('#lease-filter', 'active')
    pg.wait_for_timeout(400)
    check('a filter change reaches the API',
          any(q.get('status') == ['active'] for q in STATE["leaseQueries"]))

    print('\n— lease lifecycle —')
    load('leases', LANDLORD)
    pg.click('#leases [data-lease]')
    pg.wait_for_timeout(400)
    check('a row opens the tenancy', pg.locator('#detail').is_visible())
    check('a landlord is offered the lifecycle', pg.locator('#actions').is_visible())
    check('and can complete a running tenancy',
          pg.locator('#act-complete').is_visible())
    # The asymmetry the module exists for. Ending a tenancy early is eviction by
    # another name, and LRMC carries the tenancy and answers for the outcome.
    # A landlord evicting on one click is the thing this module exists to
    # prevent.
    check('but is NOT offered terminate', pg.locator('#act-terminate').is_hidden())

    STATE["posted"] = []
    pg.click('#act-complete')
    pg.wait_for_timeout(400)
    completed = [b for p_, b in STATE["posted"] if p_ == '/api/v1/leases/complete']
    check('completing reaches the API', len(completed) == 1)
    check('with the lease id and nothing else',
          completed and list(completed[0].keys()) == ['lease'])
    check('and the list is re-read rather than patched',
          any(p_.startswith('/api/v1/leases/user/') for p_, _ in STATE["requests"][-6:]))

    load('leases', COORD)
    pg.click('#leases [data-lease]')
    pg.wait_for_timeout(400)
    check('a coordinator IS offered terminate', pg.locator('#act-terminate').is_visible())
    # Two steps, deliberately: ending somebody's tenancy should not happen on
    # one click.
    check('and the reason field is not shown until they ask',
          pg.locator('#reason-row').is_hidden())
    pg.click('#act-terminate')
    pg.wait_for_timeout(200)
    check('asking for it reveals the reason field', pg.locator('#reason-row').is_visible())
    STATE["posted"] = []
    pg.click('#act-terminate-confirm')
    pg.wait_for_timeout(400)
    check('terminating without a reason is refused by the server',
          not pg.locator('[data-error-for="reason"]').is_hidden())
    pg.fill('#act-reason', 'Property sold to a new owner')
    pg.click('#act-terminate-confirm')
    pg.wait_for_timeout(400)
    terminated = [b for p_, b in STATE["posted"] if p_ == '/api/v1/leases/terminate']
    check('with a reason it goes through', any(b.get('reason') for b in terminated))

    # A tenant moves nothing. The page hides it; the server refuses it anyway.
    load('leases', TENANT)
    pg.wait_for_timeout(300)
    if pg.locator('#leases [data-lease]').count():
        pg.click('#leases [data-lease]')
        pg.wait_for_timeout(400)
        check('a tenant is offered no lifecycle action at all',
              pg.locator('#actions').is_hidden())

    # A refusal must explain what to do instead, not just say no.
    STATE["leaseActionFails"] = [{
        "field": "status", "code": "not-yours",
        "message": "Ending a tenancy early is LRMC's decision, not the landlord's. Ask your coordinator to terminate it."}]
    load('leases', COORD)
    pg.click('#leases [data-lease]')
    pg.wait_for_timeout(400)
    pg.click('#act-complete')
    pg.wait_for_timeout(400)
    check('a server refusal lands on the field it names',
          not pg.locator('#actions [data-error-for="status"]').is_hidden())
    check('and says what to do instead',
          'coordinator' in pg.inner_text('#actions [data-error-for="status"]'))
    STATE["leaseActionFails"] = None

    print('\n— a slow lease reply never overwrites a newer one —')
    load('leases', LANDLORD)
    pg.select_option('#lease-filter', 'terminated')   # slow
    pg.wait_for_timeout(60)
    pg.select_option('#lease-filter', 'active')       # fast, overtakes it
    pg.wait_for_timeout(1400)
    check('the slow reply is dropped rather than painted',
          'STALE LEASE' not in pg.inner_text('#leases'))
    check('and the newer answer is on screen',
          'LSE-000001' in pg.inner_text('#leases'))

    print('\n— ususu circles —')
    load('ususu', COORD)
    check('the tiles come from the aggregate',
          (tile_named('Circles') or {}).get('value') == '6')
    check('and say how many are running',
          '5 running' in (tile_named('Circles') or {}).get('meta', ''))
    check('the circles are listed', pg.locator('#groups li').count() == 2)
    check('with their member counts', '3 members' in pg.inner_text('#groups'))
    # A circle being put together is the ordinary first state of every circle.
    # An amber badge would make a list of new groups read like a list of problems.
    check('a forming circle is neutral, not a warning',
          pg.evaluate("""() => {
              const el = [...document.querySelectorAll('#groups .lrmc-badge')]
                  .find(e => e.textContent.trim() === 'Forming');
              return el ? el.className.includes('neutral') : false;
          }"""))

    # The CARD, not just the detail panel. A circle nobody has paid into shows
    # a dash on the list too — the list is where a steward with six circles
    # actually looks, and a 0% there would read as six failing circles.
    check('a circle with no contributions shows a dash on its card',
          pg.evaluate("""() => {
              const li = document.querySelectorAll('#groups li')[1];
              const v = li ? li.querySelector('.tabular-nums') : null;
              return v ? v.textContent.trim() === '\u2014' : false;
          }"""))
    check('and one that has been paid into shows its health',
          pg.evaluate("""() => {
              const li = document.querySelectorAll('#groups li')[0];
              const v = li ? li.querySelector('.tabular-nums') : null;
              return v ? v.textContent.trim() === '90%' : false;
          }"""))

    pg.click('#groups [data-group]')
    pg.wait_for_timeout(400)
    check('a row opens the circle', pg.locator('#detail').is_visible())
    detail = pg.inner_text('#detail-body')
    check('health is shown', '90%' in detail)
    check('and the streaks per member', '5 in a row' in detail)
    # A history that only listed contributions would make every circle look
    # perfect and make the health figure unexplainable.
    check('a missed period is shown, not hidden', 'Missed' in detail)
    check('and contributions show the amount', 'D 500' in detail)

    # The one that matters: a circle nobody has paid into has no health to
    # report. 100% would be a claim LRMC cannot make; 0% would be an accusation.
    load('ususu', COORD)
    pg.wait_for_timeout(300)
    pg.click('#groups li:nth-child(2)')
    pg.wait_for_timeout(400)
    empty = pg.inner_text('#detail-body')
    check('a circle with no contributions shows a dash, not a percentage',
          '—' in empty and '100%' not in empty and '0%' not in empty)
    check('and says why', 'no health to report' in empty)

    print('\n— ususu: who may keep the register —')
    load('ususu', COORD)
    check('a coordinator is offered the create form',
          pg.locator('#create-section').is_visible())
    load('ususu', TENANT)
    # An ordinary member cannot open a circle: the register needs somebody
    # answerable for it.
    check('a tenant is not', pg.locator('#create-section').is_hidden())
    pg.wait_for_timeout(300)
    if pg.locator('#groups [data-group]').count():
        pg.click('#groups [data-group]')
        pg.wait_for_timeout(400)
        check('and cannot record against a circle either',
              pg.locator('#manage').is_hidden())

    print('\n— ususu: recording —')
    load('ususu', COORD)
    pg.click('#groups [data-group]')
    pg.wait_for_timeout(400)
    STATE["posted"] = []
    pg.fill('#rec-period', '2026-08')
    pg.fill('#rec-amount', '500')
    pg.click('#record-form button[type=submit]')
    pg.wait_for_timeout(400)
    contributed = [b for p_, b in STATE["posted"]
                   if p_ == '/api/v1/ususu/group/contribute']
    check('a contribution reaches the API', len(contributed) == 1)
    check('carrying the period', contributed and contributed[0].get('period') == '2026-08')
    # Derived on every read. A page that sent them would be inventing a number.
    for forbidden in ['groupHealth', 'streak', 'status']:
        check(f'and never a {forbidden}', contributed and forbidden not in contributed[0])
    check('the circle is re-read rather than patched',
          any(p_.endswith('/summary') for p_, _ in STATE["requests"][-6:]))

    STATE["posted"] = []
    pg.click('#rec-miss')
    pg.wait_for_timeout(400)
    missed = [b for p_, b in STATE["posted"] if p_ == '/api/v1/ususu/group/miss']
    check('a miss reaches its own endpoint', len(missed) == 1)
    # Nothing was contributed, so there is nothing to record an amount for.
    check('and carries no amount', missed and 'amount' not in missed[0])

    STATE["posted"] = []
    pg.click('#register [data-remove]')
    pg.wait_for_timeout(400)
    removed = [b for p_, b in STATE["posted"]
               if p_ == '/api/v1/ususu/group/remove-member']
    check('removing somebody reaches the API', len(removed) == 1)

    # The server's refusals must reach the field they name.
    STATE["groupActionFails"] = [{
        "field": "member", "code": "self-recording",
        "message": "You cannot record your own contribution."}]
    load('ususu', COORD)
    pg.click('#groups [data-group]')
    pg.wait_for_timeout(400)
    pg.fill('#rec-period', '2026-08')
    pg.fill('#rec-amount', '500')
    pg.click('#record-form button[type=submit]')
    pg.wait_for_timeout(400)
    check('a self-recording refusal lands on the member field',
          not pg.locator('#record-form [data-error-for="member"]').is_hidden())
    check('and says why', 'your own' in pg.inner_text('#record-form [data-error-for="member"]'))
    STATE["groupActionFails"] = None

    print('\n— applications —')
    load('applications', COORD)
    check('the queue tiles come from the aggregate',
          (tile_named('Under review') or {}).get('value') == '11')
    check('the queue lists applications', pg.locator('#queue li').count() >= 1)
    check('a recommendation is shown', 'Hold for review' in pg.inner_text('#queue')
          or 'review' in pg.inner_text('#queue').lower())
    # A score of 62 with three factors unchecked is a different fact from a
    # score of 62 with everything checked, and only one is about the applicant.
    check('and how many factors are still unchecked',
          'not yet checked' in pg.inner_text('#queue'))

    # Filters go to the API, never to a cached array.
    STATE["appQueries"] = []
    pg.select_option('#queue-filter', 'approved')
    pg.wait_for_timeout(400)
    check('a filter change reaches the API',
          any(q.get('status') == ['approved'] for q in STATE["appQueries"]))
    check('and the total still comes from meta', '48 applications' in pg.inner_text('#queue-total'))

    pg.select_option('#queue-filter', 'open')
    pg.wait_for_timeout(400)
    pg.click('#queue [data-application]')
    pg.wait_for_timeout(400)
    check('a row opens the assessment', pg.locator('#detail').is_visible())
    detail = pg.inner_text('#detail-body')
    check('every factor is listed', pg.locator('#detail-body li').count() == 6)
    check('the score is shown', '62' in detail)
    # The whole point of the fairness engineering, said on screen.
    check('an unchecked factor says "Not checked"', 'Not checked' in detail)
    check('and the ceiling is stated', 'still unchecked' in detail)
    check('so an unchecked factor is not read as a failed one',
          'not a failed one' in detail)
    check('an unchecked factor is never coloured as danger',
          pg.evaluate("""() => [...document.querySelectorAll('#detail-body .lrmc-badge')]
              .filter(e => e.textContent.trim() === 'Not checked')
              .every(e => !e.className.includes('danger'))"""))

    check('a coordinator is offered the decision', pg.locator('#decision').is_visible())
    # An approval needs an author and a reason, not just a refusal.
    check('and told the reason reaches the applicant either way',
          'either way' in pg.inner_text('#decision'))
    load('applications', TENANT)
    pg.wait_for_timeout(300)
    if pg.locator('#queue [data-application]').count():
        pg.click('#queue [data-application]')
        pg.wait_for_timeout(400)
        check('a tenant is not offered the decision', pg.locator('#decision').is_hidden())

    print('\n— a slow answer never overwrites a newer one —')
    # The filter is a select rather than a text box precisely so this race is
    # reproducible: the control keeps its value, so a marker cannot ride along
    # on the overtaking request the way it did the first time this was written.
    load('applications', COORD)
    pg.select_option('#queue-filter', 'withdrawn')   # slow
    pg.wait_for_timeout(60)
    pg.select_option('#queue-filter', 'approved')    # fast, overtakes it
    pg.wait_for_timeout(1400)
    check('the slow reply is dropped rather than painted',
          'STALE ANSWER' not in pg.inner_text('#queue'))
    check('and the newer answer is what is on screen',
          'Fatou Sanneh' in pg.inner_text('#queue'))
    # A slow *failure* can overwrite a newer good answer just as easily.
    STATE["slowFails"] = True
    load('applications', COORD)
    pg.select_option('#queue-filter', 'withdrawn')
    pg.wait_for_timeout(60)
    pg.select_option('#queue-filter', 'approved')
    pg.wait_for_timeout(1400)
    check('and the queue is not left showing an error from a stale request',
          'Could not load' not in pg.inner_text('#queue')
          and 'boom' not in pg.inner_text('#queue'))
    check('the newer answer survives the stale failure',
          'Fatou Sanneh' in pg.inner_text('#queue'))
    STATE["slowFails"] = False

    print('\n— nothing rendered can become markup —')
    STATE["hostile"] = True
    load('applications', COORD)
    check('markup in an applicant name is text, not script',
          pg.evaluate("() => window.__pwned") is None
          and pg.locator('#queue img').count() == 0)
    check('and the name still reaches the page', 'Nasty' in pg.inner_text('#queue'))
    STATE["hostile"] = False

    print('\n— the dashboard —')
    load('dashboard', COORD)
    check('occupancy comes from /stats/properties',
          (tile_named('Occupancy') or {}).get('value') == '85.7%')
    check('rent collected from /stats/payments',
          '4,250,000' in (tile_named('Collected, 30 days') or {}).get('value', ''))
    check('maintenance load from /stats/maintenance',
          (tile_named('Open') or {}).get('value') == '12')
    check('application throughput from /stats/applications',
          (tile_named('Total') or {}).get('value') == '48')
    check('Ususu health from /stats/ususu',
          (tile_named('Group health') or {}).get('value') == '92.5%')
    # `members`, not `groups`: the ledger records contributions per person and
    # there is no group entity to count.
    check('and members, not groups', tile_named('Members') is not None)
    paths = [p_ for p_, _ in STATE["requests"]]
    for name in ['properties', 'payments', 'maintenance', 'applications', 'ususu']:
        check(f'the dashboard called /stats/{name}', f'/api/v1/stats/{name}' in paths)
    lists = [p_ for p_ in paths if p_ in ('/api/v1/properties', '/api/v1/payments',
                                          '/api/v1/applications', '/api/v1/maintenance-requests')]
    check('and no list endpoint at all', not lists)
    scoped = [q for p_, q in STATE["requests"]
              if p_.startswith('/api/v1/stats/')
              and ({'owner', 'region', 'landlordId', 'userId'} & set(q))]
    check('no stats request carries a scope parameter', not scoped)

    print('\n— null is a dash, and zero is zero, on every page —')
    STATE["properties"] = PROPERTY_STATS_EMPTY
    STATE["payments"] = PAYMENT_STATS_EMPTY
    STATE["ususu"] = USUSU_STATS_EMPTY
    load('dashboard', COORD)
    check('a rate nobody could compute renders a dash',
          (tile_named('Occupancy') or {}).get('value') == '—')
    check('and says so rather than showing a plausible zero',
          'Not available' in (tile_named('Occupancy') or {}).get('meta', ''))
    check('a real zero still renders as zero',
          (tile_named('Occupied') or {}).get('value') == '0')
    check('group health over an empty ledger is a dash',
          (tile_named('Group health') or {}).get('value') == '—')
    check('but a real count of no contributions is zero',
          (tile_named('Contributions') or {}).get('value') == '0')

    STATE["paymentSummary"] = PAYMENT_SUMMARY_EMPTY
    load('payments', TENANT)
    check('a tenant on their first day is not told they pay late',
          (tile_named('Paid on time') or {}).get('value') == '—')
    STATE["paymentSummary"] = PAYMENT_SUMMARY
    STATE["properties"] = PROPERTY_STATS
    STATE["payments"] = PAYMENT_STATS
    STATE["ususu"] = USUSU_STATS

    print('\n— money is never summed across currencies —')
    STATE["payments"] = PAYMENT_STATS_MULTI
    for page in ['payments', 'dashboard']:
        load(page, COORD)
        t = tile_named('Collected, 30 days')
        # 4,250,000 + 12,400 = 4,262,400, which is not an amount of anything.
        check(f'{page}: currencies are not added together',
              t and '4,250,000' in t['value'] and '4,262,400' not in t['value'])
        check(f'{page}: and the others are named rather than hidden',
              t and 'other currenc' in t['meta'])
    STATE["payments"] = PAYMENT_STATS_90
    load('dashboard', COORD)
    check('a different window changes the label',
          tile_named('Collected, 90 days') is not None
          and tile_named('Collected, 30 days') is None)
    STATE["payments"] = PAYMENT_STATS

    print('\n— one endpoint failing costs one row of tiles —')
    STATE["down"] = {'ususu'}
    load('dashboard', COORD)
    check('the failing row says so', (tile_named('Group health') or {}).get('value') == '—')
    check('and the others still render',
          (tile_named('Occupancy') or {}).get('value') == '85.7%')
    STATE["down"] = set()

    print('\n— signing out revokes the session, from every page —')
    for page in GENERATED:
        load(page, COORD)
        STATE["requests"] = []
        pg.click('#sign-out')
        pg.wait_for_timeout(300)
        check(f'{page}: sign-out reaches the backend',
              any(p_ == '/api/v1/auth/logout' for p_, _ in STATE["requests"]))

    print('\n— the page still works when Alpine never loads —')
    # Measured before this fallback existed: on a 390px viewport the sidebar sat
    # at left:0 across the whole screen with the content underneath it, and the
    # toggle did nothing — because an unevaluated Alpine binding leaves the
    # element with its static classes. No console error. Just a page a member
    # cannot use, and no way for them to know why.
    def load_without_alpine(page, actor):
        ctx.clear_cookies()
        pg.goto(f'http://127.0.0.1:{PORT}/members/{page}.html', wait_until='domcontentloaded')
        pg.evaluate("() => { try { sessionStorage.clear(); } catch (e) {} }")
        pg.evaluate("""(a) => {
            sessionStorage.setItem('lrmc.token', 'tok-x');
            sessionStorage.setItem('lrmc.actor', JSON.stringify(a));
        }""", actor)
        pg.goto(f'http://127.0.0.1:{PORT}/no-alpine/{page}', wait_until='networkidle')
        # Drive the fallback rather than waiting out its timer.
        pg.evaluate("() => window.LrmcBoot && window.LrmcBoot.enterFallback()")
        pg.wait_for_timeout(250)

    pg.set_viewport_size({'width': 390, 'height': 844})
    load_without_alpine('ususu', COORD)
    check('Alpine is genuinely absent', not pg.evaluate("() => !!window.Alpine"))
    check('the document is marked as running without it',
          pg.evaluate("() => document.documentElement.classList.contains('lrmc-no-alpine')"))
    # The failure this fixes.
    check('the sidebar is off-canvas on a phone rather than covering it',
          pg.evaluate("""() => {
              const a = document.querySelector('aside');
              return a ? a.getBoundingClientRect().right <= 1 : false;
          }"""))
    # The rail slides over 200ms. Measuring straight after the click reads a
    # mid-transition position and fails a working control.
    pg.click('header button[aria-label="Toggle navigation"]')
    pg.wait_for_timeout(400)
    check('the toggle opens it',
          pg.evaluate("() => document.querySelector('aside').getBoundingClientRect().left > -1"))
    pg.click('header button[aria-label="Toggle navigation"]')
    pg.wait_for_timeout(400)
    check('and closes it again',
          pg.evaluate("() => document.querySelector('aside').getBoundingClientRect().right <= 1"))
    # A person whose page is half working should be told, not left wondering.
    check('and the person is told something did not load',
          pg.locator('.lrmc-fallback-note').is_visible())
    # The content itself must still be there — everything below the chrome is
    # plain DOM and does not need Alpine at all.
    check('the page content still renders', pg.locator('#ususu-tiles .lrmc-card').count() >= 1)
    check('and nothing is permanently hidden behind x-cloak',
          pg.evaluate("""() => {
              const main = document.getElementById('lrmc-main');
              return main ? main.getBoundingClientRect().height > 100 : false;
          }"""))

    pg.set_viewport_size({'width': 1280, 'height': 900})
    pg.wait_for_timeout(200)
    check('on a desktop the rail is part of the layout, as it should be',
          pg.evaluate("""() => {
              const a = document.querySelector('aside');
              return a ? a.getBoundingClientRect().right > 100 : false;
          }"""))

    # Every generated page carries the same fallback, because they share chrome.
    for page in GENERATED:
        pg.set_viewport_size({'width': 390, 'height': 844})
        load_without_alpine(page, COORD)
        check(f'{page}: survives Alpine not loading',
              pg.evaluate("""() => {
                  const a = document.querySelector('aside');
                  return a ? a.getBoundingClientRect().right <= 1 : false;
              }"""))
    pg.set_viewport_size({'width': 1280, 'height': 900})

    print('\n— contrast, measured —')
    def measured(sel):
        return pg.evaluate("""(s) => {
            const el = document.querySelector(s);
            if (!el) return null;
            const cs = getComputedStyle(el);
            let bgEl = el, bg = 'rgba(0, 0, 0, 0)';
            while (bgEl) {
                const c = getComputedStyle(bgEl).backgroundColor;
                if (c && !c.startsWith('rgba(0, 0, 0, 0')) { bg = c; break; }
                bgEl = bgEl.parentElement;
            }
            return { fg: cs.color, bg, opacity: cs.opacity };
        }""", sel)

    for page in GENERATED:
        load(page, COORD)
        worst = None
        for sel in ['.lrmc-stat-value', '.lrmc-stat-label', '.lrmc-stat-meta',
                    '#reading-caption', 'main h2']:
            m = measured(sel)
            if not m: continue
            fg, bg = parse_rgb(m['fg']), parse_rgb(m['bg'])
            op = float(m['opacity'] or 1)
            eff = tuple(round(f * op + b * (1 - op)) for f, b in zip(fg, bg))
            r = contrast(eff, bg)
            if worst is None or r < worst[0]: worst = (r, sel)
        check(f'{page}: every measured text run meets AA ({worst[0]:.2f}:1 on {worst[1]})',
              worst is not None and worst[0] >= 4.5)

    print('\n— on a phone —')
    for page in GENERATED:
        load(page, COORD)
        pg.set_viewport_size({'width': 390, 'height': 844})
        pg.wait_for_timeout(300)
        check(f'{page}: nothing overflows at 390px',
              pg.evaluate('()=>document.documentElement.scrollWidth<=window.innerWidth+1'))
        check(f'{page}: the navigation toggle appears',
              pg.locator('header button[aria-label="Toggle navigation"]').is_visible())
        pg.set_viewport_size({'width': 1280, 'height': 900})
        pg.wait_for_timeout(250)
        check(f'{page}: and is gone on a desktop',
              pg.locator('header button[aria-label="Toggle navigation"]').is_hidden())

    for page in GENERATED:
        load(page, COORD)
        pg.screenshot(path=f'/tmp/lrmc-member-{page}.png', full_page=False)

    real = [e for e in errs
            if 'favicon' not in e.lower() and 'failed to load resource' not in e.lower()]
    check('no page errors anywhere in the portal', not real)
    if real: print('   ERRORS:', real[:6])
    b.close()

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} FAILED: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
