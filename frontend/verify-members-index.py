#!/usr/bin/env python3
"""LRMC — headless checks for members/index.html.

The member portal's landing page. Its whole job is to show numbers, so this
suite is mostly about whether those numbers are the ones the database holds.

Three properties matter more than the rest.

**Nothing is counted in the browser.** Every tile reads an aggregate endpoint.
The failure this guards against is not a crash — it is `rows.length` from a
paginated list call, which is right up to the page size and then quietly wrong
in the flattering direction. There is no error, no warning, and the figure stays
plausible. So the suite asserts on what the page *requests*: `/stats/*` and no
list endpoint, with no scope parameter attached to either.

**`—` and `0` are different statements.** An occupancy rate the server could not
compute comes back `null`. Rendered as `0%` it tells a landlord on their first
day that something is wrong. Every tile is exercised against an endpoint that
returns null and against one that returns a real zero, and the two must differ
on screen.

**Money is never summed across currencies.** `collected` is one row per
currency because this platform has no exchange rate. A page that adds them
produces a number that is not an amount of anything, and it looks entirely
ordinary. Asserted with a multi-currency reply.

Run from the frontend/ folder:  python3 verify-members-index.py
"""
import json, sys, re, pathlib, http.server, socketserver, threading
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


# ══ Stub replies ════════════════════════════════════════════════════════════
# Shaped exactly like the real handlers in backend/src/modules/stats/index.ts.
# Where the real one can return null, so does this.

PROPERTY_STATS = {
    "totalProperties": 217, "occupied": 180, "vacant": 30,
    "unavailable": 7, "unclassified": 0, "occupancyRate": 85.7,
}
# The first-day case: real zeros, and a rate nobody can compute.
PROPERTY_STATS_EMPTY = {
    "totalProperties": 0, "occupied": 0, "vacant": 0,
    "unavailable": 0, "unclassified": 0, "occupancyRate": None,
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
    {"currency": "EUR", "amount": 3_100, "payments": 5},
])
PAYMENT_STATS_EMPTY = {
    "totalPayments": 0, "settled": 0, "onTime": 0, "late": 0,
    "awaiting": 0, "failed": 0, "reliability": None,
    "collectionWindowDays": 30, "collected": [],
}
# A window that is not thirty, to catch a hard-coded label.
PAYMENT_STATS_90 = dict(PAYMENT_STATS, collectionWindowDays=90)

MAINTENANCE_STATS = {
    "totalRequests": 64, "openRequests": 12, "inProgress": 9,
    "completed": 40, "stalled": 3, "unclassified": 0,
}
APPLICATION_STATS = {
    "totalApplications": 48, "underReview": 11, "approved": 25,
    "declined": 9, "withdrawn": 3, "unclassified": 0,
}
USUSU_STATS = {
    "totalMembers": 34, "avgGroupHealth": 92.5,
    "totalContributions": 410, "totalMisses": 18,
}
USUSU_STATS_EMPTY = {
    "totalMembers": 0, "avgGroupHealth": None,
    "totalContributions": 0, "totalMisses": 0,
}

STATE = {
    "properties": PROPERTY_STATS, "payments": PAYMENT_STATS,
    "maintenance": MAINTENANCE_STATS, "applications": APPLICATION_STATS,
    "ususu": USUSU_STATS,
    "down": set(),
    "requests": [],     # (path, query) for everything the page asked for
}


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(s, *a): pass

    def do_POST(s):
        base = s.path.split('?')[0]
        STATE["requests"].append((base, {}))
        if base == '/api/v1/auth/logout':
            return s._json({"success": True,
                            "data": {"signedOut": True, "refreshRevoked": True}})
        s.send_response(404); s.end_headers()

    def do_GET(s):
        base, _, query = s.path.partition('?')
        q = parse_qs(query)

        if base.startswith('/api/v1/stats/'):
            name = base.rsplit('/', 1)[1]
            STATE["requests"].append((base, q))
            if name in STATE["down"]:
                return s._json({"success": False,
                                "error": {"code": "INTERNAL", "message": "boom"}}, 500)
            if name in STATE:
                return s._json({"success": True, "data": STATE[name]})
            s.send_response(404); s.end_headers(); return

        # Anything else under the API is recorded so the suite can prove the
        # page never reached for a list endpoint.
        if base.startswith('/api/v1/'):
            STATE["requests"].append((base, q))
            return s._json({"success": True, "data": [], "meta": {"total": 0}})

        if base.startswith('/__t/'):
            p = DOUBLES / base[5:]
            if p.exists():
                return s._raw(p.read_bytes(),
                              'text/css' if p.suffix == '.css' else 'application/javascript')
        if base == '/page':
            return s._raw(pathlib.Path('/tmp/members-index-under-test.html').read_bytes(), 'text/html')
        if base.startswith(('/hq/', '/members/', '/staff/', '/marketplace/', '/public/')):
            return s._raw(b'<!doctype html><title>landed</title><p>landed</p>', 'text/html')
        return super().do_GET()

    def _json(s, body, code=200):
        return s._raw(json.dumps(body).encode(), 'application/json', code)

    def _raw(s, body, ct, code=200):
        s.send_response(code); s.send_header('Content-Type', ct)
        s.send_header('Content-Length', str(len(body))); s.end_headers(); s.wfile.write(body)


# ══ Swap the CDNs for local doubles ═════════════════════════════════════════
src = (ROOT / 'members/index.html').read_text()
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
pathlib.Path('/tmp/members-index-under-test.html').write_text(t)

socketserver.TCPServer.allow_reuse_address = True

class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True

srv = ThreadedServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()


# ══ Source-level: the page and the contract agree ═══════════════════════════
print('— the page reads the endpoints the backend serves —')

blueprint = (BACKEND / 'src/config/apiBlueprint.ts').read_text()
served = set(re.findall(r"path: '(/stats/\w+)'", blueprint))
asked = set('/stats/' + m for m in re.findall(r'Lrmc\.stats\.(\w+)\(', src))
check('every /stats/* the page calls exists in the contract', asked <= served)
if not asked <= served: print('   missing:', sorted(asked - served))
check('the page reads more than one aggregate', len(asked) >= 4)

# The whole point of the exercise. A single `.list(` in this file is a tile
# counting a page of rows again.
for banned in ['properties.list(', 'maintenance.list(', 'applications.list(',
               'payments.list(', 'leases.list(']:
    check(f'the page never calls {banned}', banned not in src)
check('and never takes a length as a figure',
      not re.search(r'\.length\s*\)?\s*(?:\+|,)\s*[\'"]', src)
      or '.collected.length' in src)

# The scope must come from the token. A `?owner=` the page could set would make
# the tile a directory of the institution's holdings.
check('no stats call passes a scope parameter',
      not re.search(r'Lrmc\.stats\.\w+\(\s*\{', src))

# ── Fields the page reads must exist on the schema ──
schemas = (BACKEND / 'src/config/openapiSchemas.ts').read_text()
def schema_fields(name):
    block = re.search(name + r': \{\n    type: .object.,\n(.*?)\n  \},\n', schemas, re.S)
    return set(re.findall(r'^      (\w+):', block.group(1), re.M)) if block else set()

for stat, prefix in [('PropertyStats', 'props'), ('MaintenanceStats', 'maint'),
                     ('ApplicationStats', 'apps')]:
    fields = schema_fields(stat)
    read = set(re.findall(prefix + r'\.(\w+)', src))
    check(f'{stat}: every field the page reads is in the schema', read <= fields)
    if not read <= fields: print('   not in schema:', sorted(read - fields))

pay_fields = schema_fields('PaymentStats')
pay_read = set(re.findall(r'\bpay\.(\w+)', src))
check('PaymentStats: every field the page reads is in the schema', pay_read <= pay_fields)
if not pay_read <= pay_fields: print('   not in schema:', sorted(pay_read - pay_fields))

check('the collection window is read from the reply, not hard-coded',
      'collectionWindowDays' in src and "'Collected, 30 days'" not in src)

print('— rules that apply to every LRMC page —')
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
              "grants": ["viewing:create", "application:create", "payment:readOwn"]}
    LANDLORD = {"userId": "u2", "fullName": "Modou Jallow", "roles": ["landlord"],
                "primaryRole": "landlord",
                "grants": ["property:create", "property:updateOwn", "application:readOwn"]}
    COORD = {"userId": "u3", "fullName": "Binta Sowe", "roles": ["coordinator"],
             "primaryRole": "coordinator",
             "grants": ["analytics:read", "property:read", "application:approve"]}
    BOTH = {"userId": "u4", "fullName": "Ousman Bah",
            "roles": ["coordinator", "landlord"], "primaryRole": "coordinator",
            "grants": ["analytics:read", "property:read", "property:create",
                       "property:updateOwn"]}

    def load(actor=None, query=''):
        ctx.clear_cookies()
        pg.goto(f'http://127.0.0.1:{PORT}/members/index.html', wait_until='domcontentloaded')
        pg.evaluate("() => { try { sessionStorage.clear(); } catch (e) {} }")
        if actor:
            pg.evaluate("""(a) => {
                sessionStorage.setItem('lrmc.token', 'tok-x');
                sessionStorage.setItem('lrmc.refresh', 'refresh-x');
                sessionStorage.setItem('lrmc.actor', JSON.stringify(a));
            }""", actor)
        STATE["requests"] = []
        pg.goto(f'http://127.0.0.1:{PORT}/page{query}', wait_until='networkidle')
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

    print('\n— a session is required —')
    load(None)
    check('a visitor is sent to sign in', '/public/login.html' in pg.url)
    check('remembering where they were', 'next=' in pg.url)

    print('\n— the reading is resolved from the roles —')
    load(TENANT)
    check('a tenant gets the tenant reading', 'as=tenant' in pg.url)
    check('and is offered no switch', pg.locator('#reading-switch').is_hidden())
    check('the resolving placeholder is gone',
          pg.locator('#reading-resolving').is_hidden())
    check('a tenant sees the Ususu section',
          pg.locator('#ususu-section').is_visible())

    load(LANDLORD)
    check('a landlord gets the landlord reading', 'as=landlord' in pg.url)
    # A landlord has no Ususu ledger of their own to read; the section would be
    # three dashes and a paragraph about tenancy applications.
    check('and no Ususu section', pg.locator('#ususu-section').is_hidden())
    check('but does see rent', pg.locator('#money-section').is_visible())

    load(COORD)
    check('a coordinator gets the regional reading', 'as=coordinator' in pg.url)
    check('with work in hand', pg.locator('#work-section').is_visible())

    # The clamp. Not a control — every endpoint is gated again server-side —
    # but a tenant shown the coordinator reading gets a screen of empty tiles.
    load(TENANT, '?as=coordinator')
    check('a tenant asking for the regional reading is refused', 'as=tenant' in pg.url)
    check('and the Ususu section is theirs again',
          pg.locator('#ususu-section').is_visible())

    load(BOTH)
    check('somebody holding both is offered the switch',
          pg.locator('#reading-switch').is_visible())
    check('and defaults to the wider one', 'as=coordinator' in pg.url)
    check('the current reading is marked for assistive technology',
          pg.get_attribute('#as-coordinator', 'aria-selected') == 'true')
    check('a reading they do not hold is not offered',
          pg.locator('#as-tenant').is_visible())   # tenant is the floor, always held
    load(LANDLORD)
    check('a landlord is not offered the regional reading',
          pg.locator('#as-coordinator').is_hidden())

    print('\n— every figure comes from an aggregate endpoint —')
    load(LANDLORD)
    paths = [r[0] for r in STATE["requests"]]
    check('the page called /stats/properties', '/api/v1/stats/properties' in paths)
    check('and /stats/payments', '/api/v1/stats/payments' in paths)
    check('and /stats/maintenance', '/api/v1/stats/maintenance' in paths)
    check('and /stats/applications', '/api/v1/stats/applications' in paths)
    # The failure being guarded against: a tile quietly counting a page of rows.
    lists = [p for p in paths if p in (
        '/api/v1/properties', '/api/v1/payments', '/api/v1/applications',
        '/api/v1/maintenance-requests', '/api/v1/leases')]
    check('and no list endpoint at all', not lists)
    if lists: print('   list calls:', lists)
    # A scope the browser could set would make every tile a directory.
    scoped = [q for pth, q in STATE["requests"]
              if pth.startswith('/api/v1/stats/')
              and ({'owner', 'region', 'landlordId', 'userId', 'tenantId'} & set(q))]
    check('no stats request carries a scope parameter', not scoped)
    if scoped: print('   scoped:', scoped)

    print('\n— the numbers on screen are the numbers returned —')
    t = tile_named('Properties')
    check('the property total is the aggregate, not a page size',
          t and '217' in t['value'])
    check('and the breakdown reads from the same reply',
          t and '180 occupied' in t['meta'] and '30 vacant' in t['meta'])
    check('occupancy is the rate the server computed',
          (tile_named('Occupancy') or {}).get('value') == '85.7%')
    check('maintenance sums open and in progress',
          (tile_named('Maintenance') or {}).get('value') == '21')
    check('applications read the aggregate',
          (tile_named('Applications') or {}).get('value') == '48')

    print('\n— null is a dash, and zero is zero —')
    STATE["properties"] = PROPERTY_STATS_EMPTY
    STATE["payments"] = PAYMENT_STATS_EMPTY
    load(LANDLORD)
    check('a rate the server could not compute renders a dash',
          (tile_named('Occupancy') or {}).get('value') == '—')
    check('and says so rather than showing a plausible zero',
          'Not available' in (tile_named('Occupancy') or {}).get('meta', ''))
    # The distinction the whole convention exists for.
    check('a real zero still renders as zero, not a dash',
          (tile_named('Properties') or {}).get('value') == '0')
    check('reliability with nothing settled is a dash',
          (tile_named('Paid on time') or {}).get('value') == '—')
    check('but a count of nothing failed is zero',
          (tile_named('Failed') or {}).get('value') == '0')
    STATE["properties"] = PROPERTY_STATS
    STATE["payments"] = PAYMENT_STATS

    print('\n— money —')
    load(LANDLORD)
    t = tile_named('Collected, 30 days')
    check('the collected tile is labelled from the reply\'s window', t is not None)
    check('and shows the launch currency', t and 'D' in t['value'] and '4,250,000' in t['value'])
    check('with no other currency folded in', t and t['meta'] == 'Settled through LRMC')

    STATE["payments"] = PAYMENT_STATS_MULTI
    load(LANDLORD)
    t = tile_named('Collected, 30 days')
    # The number must be one currency's figure, never the sum. 4,250,000 +
    # 12,400 + 3,100 = 4,265,500, which is not an amount of anything.
    check('several currencies are never added together',
          t and '4,250,000' in t['value'] and '4,265,500' not in t['value'])
    check('and the others are named rather than hidden',
          t and '2 other currencies' in t['meta'])

    STATE["payments"] = PAYMENT_STATS_90
    load(LANDLORD)
    check('a different window changes the label',
          tile_named('Collected, 90 days') is not None
          and tile_named('Collected, 30 days') is None)
    STATE["payments"] = PAYMENT_STATS

    print('\n— Ususu —')
    load(TENANT)
    check('contributions read the aggregate',
          (tile_named('Contributions') or {}).get('value') == '410')
    check('group health is the server\'s mean',
          (tile_named('Group health') or {}).get('value') == '92.5%')
    # Ususu must never look like a requirement for housing. The scoring engine
    # is built so it cannot be one; the page has to say so too.
    body = pg.locator('#ususu-section').inner_text()
    check('the page says Ususu never counts against an applicant',
          'never counts against you' in body)
    check('and that a missing record is held, not declined',
          'held for a person to look at' in body)

    STATE["ususu"] = USUSU_STATS_EMPTY
    load(TENANT)
    check('a member with no Ususu record sees a dash, not zero health',
          (tile_named('Group health') or {}).get('value') == '—')
    check('but a real count of zero contributions is zero',
          (tile_named('Contributions') or {}).get('value') == '0')
    STATE["ususu"] = USUSU_STATS

    print('\n— one endpoint failing costs one tile —')
    STATE["down"] = {'payments'}
    load(LANDLORD)
    check('the failing tile says so', (tile_named('Paid on time') or {}).get('value') == '—')
    check('and the others still render',
          (tile_named('Properties') or {}).get('value') == '217')
    check('the page does not go blank', pg.locator('#headline-tiles .lrmc-card').count() >= 4)
    STATE["down"] = set()

    print('\n— signing out revokes the session —')
    load(LANDLORD)
    STATE["requests"] = []
    pg.click('#sign-out')
    pg.wait_for_timeout(400)
    check('sign-out calls the backend',
          any(p == '/api/v1/auth/logout' for p, _ in STATE["requests"]))
    check('and lands on the login page', '/public/login.html' in pg.url)

    print('\n— contrast —')
    load(LANDLORD)
    # Measured, never eyeballed. `lrmc-stat-label` carries an opacity, so the
    # computed colour is what has to be read.
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
            return { fg: cs.color, bg: bg, opacity: cs.opacity };
        }""", sel)

    for sel, name in [('.lrmc-stat-value', 'the figure on a tile'),
                      ('.lrmc-stat-label', 'the label on a tile'),
                      ('.lrmc-stat-meta', 'the caption under a figure'),
                      ('#reading-caption', 'the header caption')]:
        m = measured(sel)
        if not m:
            check(f'{name} exists to measure', False); continue
        fg, bg = parse_rgb(m['fg']), parse_rgb(m['bg'])
        op = float(m['opacity'] or 1)
        # Opacity blends the text toward the background before it is read.
        eff = tuple(round(f * op + b * (1 - op)) for f, b in zip(fg, bg))
        ratio = contrast(eff, bg)
        check(f'{name} meets AA ({ratio:.2f}:1)', ratio >= 4.5)

    print('\n— mobile —')
    pg.set_viewport_size({'width': 390, 'height': 844})
    pg.wait_for_timeout(400)
    check('nothing overflows the viewport',
          pg.evaluate('()=>document.documentElement.scrollWidth<=window.innerWidth+1'))
    over = pg.evaluate("""()=>[...document.querySelectorAll('body *')]
        .filter(e => e.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 3).map(e => e.tagName + '.' + (e.className || '').toString().slice(0, 40))""")
    if over: print('        widest:', over)
    check('the navigation toggle appears on a phone',
          pg.locator('header button[aria-label="Toggle navigation"]').is_visible())
    pg.set_viewport_size({'width': 1280, 'height': 900})
    pg.wait_for_timeout(300)
    # The bug this catches: a display utility on an `lrmc-*` class loses, so the
    # phone toggle stayed visible on every desktop.
    check('and is gone on a desktop',
          pg.locator('header button[aria-label="Toggle navigation"]').is_hidden())

    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/lrmc-members-index-mobile.png', full_page=False)
    pg.set_viewport_size({'width': 1280, 'height': 900}); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/lrmc-members-index-landlord.png', full_page=False)
    load(TENANT)
    pg.screenshot(path='/tmp/lrmc-members-index-tenant.png', full_page=False)

    real = [e for e in errs
            if 'favicon' not in e.lower() and 'failed to load resource' not in e.lower()]
    check('no page errors', not real)
    if real: print('   ERRORS:', real[:5])
    b.close()

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} FAILED: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
