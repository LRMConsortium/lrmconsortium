#!/usr/bin/env python3
"""LRMC — headless checks for marketplace/index.html.

Renders the page against stubbed LRMC API responses, as a merchant and as a
customer, and asserts what it actually draws. The CDN libraries are replaced
with small stand-ins so this runs with no network.

    python3 verify-marketplace.py
"""
import json, sys, re, time, pathlib, http.server, socketserver, threading, random
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).parent
PORT = random.randint(8600, 8899)

MERCHANT = {"success": True, "data": {
    "side": "merchant",
    "account": {"id": "m1", "name": "Gold Coast Home Goods", "verified": True},
    "orders": {"total": 42, "byStatus": {"paid": 3, "accepted": 2, "fulfilled": 4,
                                          "released": 30, "disputed": 1, "cancelled": 2},
               "escrowHeldCount": 10, "escrowHeldValue": 18450,
               "settledValue": 264300, "commissionPaid": 22980},
    "awaitingAction": [
        {"_id": "o1", "reference": "ORD-2026-0000041", "status": "paid",
         "statusLabel": "Paid — held by LRMC until the order is complete",
         "total": 4500, "currency": "GHS", "createdAt": "2026-08-04T09:00:00Z"},
        {"_id": "o2", "reference": "ORD-2026-0000039", "status": "accepted",
         "statusLabel": "Accepted by the merchant",
         "total": 1200, "currency": "GHS", "createdAt": "2026-08-02T09:00:00Z"}]}}

CUSTOMER = {"success": True, "data": {
    "side": "customer",
    "account": {"id": "c1", "name": "Ridge Road Estates", "verified": True},
    "orders": {"total": 9, "byStatus": {"fulfilled": 2, "released": 6, "pending": 1},
               "escrowHeldCount": 2, "escrowHeldValue": 3200,
               "settledValue": 41000, "commissionPaid": None},
    "awaitingAction": [
        {"_id": "o9", "reference": "ORD-2026-0000009", "status": "fulfilled",
         "statusLabel": "Delivered — awaiting your confirmation",
         "total": 1600, "currency": "GHS", "createdAt": "2026-08-03T09:00:00Z"}]}}

UNVERIFIED = json.loads(json.dumps(MERCHANT))
UNVERIFIED["data"]["account"]["verified"] = False

ORDERS = {"success": True, "data": [
    {"_id": "o1", "reference": "ORD-2026-0000041", "status": "paid", "total": 4500,
     "merchantNet": 4140, "statusLabel": "Paid — held by LRMC", "placedAt": "2026-08-04T09:00:00Z"},
    {"_id": "o3", "reference": "ORD-2026-0000038", "status": "released", "total": 900,
     "merchantNet": 828, "statusLabel": "Complete", "placedAt": "2026-07-28T09:00:00Z"},
    {"_id": "o4", "reference": "ORD-2026-0000037", "status": "disputed", "total": 2200,
     "merchantNet": 2024, "statusLabel": "In dispute", "placedAt": "2026-07-26T09:00:00Z"}],
    "meta": {"page": 1, "limit": 8, "total": 3, "totalPages": 1}}

STATE = {"overview": MERCHANT, "overview_delay": 0.0}

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(s, *a): pass
    def do_GET(s):
        b = s.path.split('?')[0]
        if b == '/api/v1/marketplace/overview':
            # Delaying this is how the SIDE race is actually reproduced: the
            # order table renders first, before anything has said which side
            # is looking, and must redraw itself when the answer arrives.
            if STATE["overview_delay"]: time.sleep(STATE["overview_delay"])
            return s._raw(json.dumps(STATE["overview"]).encode(), 'application/json')
        if b == '/api/v1/orders': return s._raw(json.dumps(ORDERS).encode(), 'application/json')
        if b.startswith('/__t/'):
            p = pathlib.Path('/tmp') / b[5:]
            if p.exists():
                return s._raw(p.read_bytes(), 'text/css' if p.suffix == '.css' else 'application/javascript')
        if b == '/page': return s._raw(pathlib.Path('/tmp/mk-under-test.html').read_bytes(), 'text/html')
        return super().do_GET()
    def _raw(s, body, ct):
        s.send_response(200); s.send_header('Content-Type', ct)
        s.send_header('Content-Length', str(len(body))); s.end_headers(); s.wfile.write(body)

# Swap the CDN scripts for local stand-ins. The page itself is not modified.
src = (ROOT / 'marketplace/index.html').read_text()
t = src
t = t.replace('<script src="https://cdn.tailwindcss.com"></script>',
              '<link rel="stylesheet" href="/__t/tw-subset.css" /><script src="/__t/tailwind-double.js"></script>')
t = t.replace('<script src="https://unpkg.com/htmx.org@1.9.12"></script>', '<script src="/__t/htmx-double.js"></script>')
t = t.replace('<script src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js" defer></script>', '<script src="/__t/alpine-double.js" defer></script>')
t = t.replace('<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js" defer></script>', '<script src="/__t/lucide-double.js" defer></script>')
t = re.sub(r'<link href="https://fonts\.googleapis[^>]*>', '', t)
t = re.sub(r'<link rel="preconnect"[^>]*>', '', t)
assert 'unpkg' not in t and 'cdn.tailwindcss' not in t, 'a CDN reference survived'
pathlib.Path('/tmp/mk-under-test.html').write_text(t)

srv = socketserver.TCPServer(('127.0.0.1', PORT), H); srv.allow_reuse_address = True
threading.Thread(target=srv.serve_forever, daemon=True).start()

fails = []
def check(n, c):
    print(('  ok   ' if c else '  FAIL ') + n)
    if not c: fails.append(n)

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1440, 'height': 1000})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)

    def load():
        pg.goto(f'http://127.0.0.1:{PORT}/page', wait_until='networkidle'); pg.wait_for_timeout(1000)

    print('— merchant view —')
    load()
    head = pg.inner_text('#mk-headline')
    check('four tiles', pg.locator('#mk-headline .lrmc-stat').count() == 4)
    check('escrow is the first figure', 'ESCROW' in head.upper().split('\n')[0])
    check('and shows the held value', 'GH₵' in head)
    check('merchant sees commission paid', 'commission' in head.lower())
    check('no skeletons left', pg.locator('#mk-headline .lrmc-skeleton').count() == 0)
    check('account named in the header', 'Gold Coast' in pg.inner_text('#hdr-account'))
    check('and identified as a merchant', 'Merchant' in pg.inner_text('#hdr-account'))

    check('catalogue nav is visible to a merchant',
          not pg.locator('a[href="/marketplace/products.html"].lrmc-nav-item').first.is_hidden())
    check('browse-merchants nav is hidden from a merchant',
          pg.locator('a[href="/marketplace/vendors.html"]').first.is_hidden())
    check('net column is labelled for a merchant', 'net' in pg.inner_text('#th-net').lower())

    check('two actions listed', pg.locator('#mk-actions > a').count() == 2)
    check('actions name the order', 'ORD-2026-0000041' in pg.inner_text('#mk-actions'))
    check('pipeline drawn', pg.locator('#mk-pipeline > div').count() >= 5)
    fills = pg.eval_on_selector_all('#mk-pipeline [style*="background"]',
        'els=>[...new Set(els.map(e=>e.style.background))]')
    check('pipeline is single-hue', len(fills) == 1)

    check('three order rows', pg.locator('#mk-orders tr').count() == 3)
    body = pg.inner_text('#mk-orders')
    check('escrow orders say the money is held by LRMC', 'held by LRMC' in body)
    check('a released order does not', body.count('held by LRMC') == 2)
    check('merchant net shown in the table', '4,140' in body or '4140' in body)
    check('statuses carry words', 'PAID' in body.upper() and 'DISPUTED' in body.upper())

    print('— customer view —')
    STATE["overview"] = CUSTOMER
    load()
    chead = pg.inner_text('#mk-headline')
    check('customer sees "Committed", not "Held in escrow"',
          'COMMITTED' in chead.upper() and 'ESCROW' not in chead.upper())
    check('customer sees total spent', 'spent' in chead.lower())
    check('and never sees commission paid', 'commission' not in chead.lower())
    check('catalogue nav hidden from a customer',
          pg.locator('a[href="/marketplace/products.html"]').first.is_hidden())
    check('browse-merchants nav shown to a customer',
          not pg.locator('a[href="/marketplace/vendors.html"]').first.is_hidden())
    check('the last column is relabelled for a customer',
          'net' not in pg.inner_text('#th-net').lower())
    check('header identifies the customer account', 'Customer' in pg.inner_text('#hdr-account'))

    print('— unverified merchant —')
    STATE["overview"] = UNVERIFIED
    load()
    check('an unverified merchant is told why nothing can go live',
          'Verification pending' in pg.inner_text('#verify-notice'))
    check('and the notice explains the consequence',
          'until LRMC verifies' in pg.inner_text('#verify-notice'))

    STATE["overview"] = MERCHANT
    load()
    check('a verified merchant sees no such notice', pg.locator('#verify-notice').is_hidden()
          or pg.inner_text('#verify-notice').strip() == '')

    pg.screenshot(path='/tmp/lrmc-marketplace.png', full_page=False)
    pg.set_viewport_size({'width': 390, 'height': 900}); pg.wait_for_timeout(500)
    pg.screenshot(path='/tmp/lrmc-marketplace-mobile.png', full_page=False)
    pg.set_viewport_size({'width': 1440, 'height': 1000}); pg.wait_for_timeout(400)

    print('— the slow-overview race —')
    # Orders resolve first and render with SIDE still 'observer'. The final
    # column would silently show the wrong thing for every merchant whose
    # overview happened to be the slower of the two requests.
    STATE["overview_delay"] = 0.6
    load(); pg.wait_for_timeout(1400)
    check('the order table redraws once the side is known',
          '4,140' in pg.inner_text('#mk-orders'))
    check('and the header still names the account', 'Merchant' in pg.inner_text('#hdr-account'))
    STATE["overview_delay"] = 0.0
    load()

    print('— empty and failure states —')
    check('empty actions state', 'Nothing needs your attention' in
          pg.evaluate("()=>{renderActions([]);return document.getElementById('mk-actions').innerText}"))
    check('empty pipeline state', 'No orders yet' in
          pg.evaluate("()=>{renderPipeline({},0);return document.getElementById('mk-pipeline').innerText}"))
    check('empty order table', 'No orders yet' in pg.evaluate("()=>renderOrders([])"))
    check('missing figures render as a dash, not NaN',
          pg.evaluate("()=>renderOverview({side:'merchant',orders:{}})").count('—') >= 2)

    print('— escaping —')
    xss = pg.evaluate("()=>renderOrders([{reference:'<img src=x onerror=alert(1)>',status:'paid',total:1}])")
    check('user content is escaped', '<img' not in xss and '&lt;img' in xss)

    print('— accessibility —')
    check('one h1 only', pg.locator('h1').count() == 1)
    check('every section is labelled',
          pg.evaluate("()=>[...document.querySelectorAll('main section')].every(s=>s.getAttribute('aria-labelledby'))"))
    check('the table has a caption', pg.locator('table caption').count() == 1)
    check('skip link is first focusable',
          pg.evaluate("()=>document.querySelector('a,button').classList.contains('lrmc-skip-link')"))

    print('— responsive —')
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(600)
    check('sidebar retracts when narrow',
          '-translate-x-full' in (pg.get_attribute('#lrmc-sidebar', 'class') or ''))
    check('no horizontal overflow at 390px',
          pg.evaluate('()=>document.documentElement.scrollWidth<=window.innerWidth+1'))
    pg.set_viewport_size({'width': 1440, 'height': 1000}); pg.wait_for_timeout(400)

    real = [e for e in errs if 'favicon' not in e.lower()]
    check('no page errors', not real)
    if real: print('   ERRORS:', real[:4])
    b.close()

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} FAILED: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
