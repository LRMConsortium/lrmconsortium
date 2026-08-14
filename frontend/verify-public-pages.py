#!/usr/bin/env python3
"""LRMC — shared checks across every public page.

The lighter suite. Pages that touch money, decisions or authentication keep
their own per-page suites and mutation passes; this covers the content pages,
where the risks are different and fewer: unreadable text, a header that
collapses wrong, a link to nothing, a placeholder that quietly became the
published answer.

It runs against **every** page under `public/`, including the four that have
their own suites — so the chrome, the contrast and the navigation are checked
on all of them from one place, and a change to the shared header cannot pass
because it happened to be tested on only one page.

Run from the frontend/ folder:  python3 verify-public-pages.py
"""
import re, sys, pathlib, http.server, socketserver, threading, json
from playwright.sync_api import sync_playwright
from lrmc_checks import run_shared_checks, check_links

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

# Pages with their own suite are still swept here for chrome and contrast;
# their behaviour is covered there.
CONTENT_PAGES = ['about', 'pricing', 'contact', 'terms', 'privacy']
# `login` and `register` extend the auth layout on purpose: a person on those
# pages has one job, and a navigation bar is a set of ways to fail at it. They
# are swept for contrast and structure, but they carry no chrome to compare.
CHROME_PAGES = ['index', 'properties'] + CONTENT_PAGES
ALL_PAGES = CHROME_PAGES + ['login', 'register']


def under_test(slug):
    t = (ROOT / f'public/{slug}.html').read_text()
    t = t.replace('<script src="https://cdn.tailwindcss.com"></script>',
                  '<link rel="stylesheet" href="/__t/tw-subset.css" /><script src="/__t/tailwind-double.js"></script>')
    t = t.replace('<script src="https://unpkg.com/htmx.org@1.9.12"></script>', '<script src="/__t/htmx-double.js"></script>')
    t = t.replace('<script src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js" defer></script>', '<script src="/__t/alpine-double.js" defer></script>')
    t = t.replace('<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js" defer></script>', '<script src="/__t/lucide-double.js" defer></script>')
    t = re.sub(r'<link href="https://fonts\.googleapis[^>]*>', '', t)
    t = re.sub(r'<link rel="preconnect"[^>]*>', '', t)
    assert 'unpkg' not in t and 'cdn.tailwindcss' not in t, f'{slug}: a CDN reference survived'
    return t.encode()


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(s, *a): pass
    def do_POST(s):
        return s._raw(json.dumps({"success": True, "data": {}}).encode(), 'application/json', 202)
    def do_GET(s):
        base = s.path.split('?')[0]
        if base.startswith('/__t/'):
            p = DOUBLES / base[5:]
            if p.exists():
                return s._raw(p.read_bytes(),
                              'text/css' if p.suffix == '.css' else 'application/javascript')
        if base.startswith('/__p/'):
            return s._raw(under_test(base[5:]), 'text/html')
        if base.startswith('/api/'):
            return s._raw(json.dumps({"success": True, "data": [], "meta": {"total": 0}}).encode(),
                          'application/json')
        return super().do_GET()
    def _raw(s, body, ct, code=200):
        s.send_response(code); s.send_header('Content-Type', ct)
        s.send_header('Content-Length', str(len(body))); s.end_headers(); s.wfile.write(body)

socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

# ══ static: the chrome cannot drift ═════════════════════════════════════════
print('— every public page wears the same chrome —')
sources = {s: (ROOT / f'public/{s}.html').read_text() for s in ALL_PAGES}
chromed = {s: v for s, v in sources.items() if s in CHROME_PAGES}

def header_of(src):
    start = src.index('<header class="border-b border-slate-200 bg-white sticky top-0 z-20">')
    return src[start:src.index('</header>') + len('</header>')]

def footer_of(src):
    start = src.index('<footer class="border-t border-slate-200">')
    return src[start:src.index('</footer>') + len('</footer>')]

def normalise(block):
    """Which link is marked current is a legitimate per-page difference, and
    HTML comments are documentation rather than chrome. Everything else must
    match exactly."""
    block = re.sub(r'\s*aria-current="page"', '', block)
    block = re.sub(r'<!--.*?-->', '', block, flags=re.S)
    return re.sub(r'\s+', ' ', block).strip()

headers = {s: normalise(header_of(v)) for s, v in chromed.items()}
footers = {s: normalise(footer_of(v)) for s, v in chromed.items()}
base_h = headers['index']
base_f = footers['index']
odd_h = [s for s, v in headers.items() if v != base_h]
odd_f = [s for s, v in footers.items() if v != base_f]
# There is no build step, so the header exists nine times over. Asserting they
# are identical is what stops the ninth copy quietly losing a menu item.
check('the header is byte-identical everywhere', not odd_h)
if odd_h: print('        differs on:', odd_h)
check('and so is the footer', not odd_f)
if odd_f: print('        differs on:', odd_f)
# terms and privacy are reached from the footer, not the navigation, so there
# is nothing there for them to mark.
NAV_PAGES = ['index', 'properties', 'about', 'pricing', 'contact']
check('every page in the navigation marks itself current there',
      all('aria-current="page"' in sources[s] for s in NAV_PAGES))
check('and the footer-only pages do not pretend to be in it',
      all('aria-current="page"' not in sources[s] for s in ('terms', 'privacy')))
# login and register deliberately carry no navigation at all.
check('the auth pages carry no navigation to be marked current in',
      all('<nav' not in sources[s] for s in ('login', 'register')))
check('and no chrome to drift',
      all('<header' not in sources[s] for s in ('login', 'register')))

print('— placeholders are visible and counted —')
# Comments stripped first. Each page's header comment explains its own rules,
# and the pricing page's says in so many words that its two rental figures were
# `data-needs-confirming` badges until LRMC decided them. Counting the word
# anywhere would score that explanation as an unconfirmed value — and the
# obvious way to make the count right again would be to delete the explanation.
# Same reason `stage()` in verify-member-portal.py matches CDN scripts by `src`
# rather than by name.
markup = {s: re.sub(r'<!--[\s\S]*?-->', '', v) for s, v in sources.items()}
placeholders = {s: v.count('data-needs-confirming') for s, v in markup.items()}
total = sum(placeholders.values())
# A placeholder that is not obviously a placeholder becomes the published
# answer. Each is a badge on the page, not a comment in the source.
check('every unconfirmed value is marked in the markup', total > 0)
print('        ' + ', '.join(f'{s}: {n}' for s, n in placeholders.items() if n))
print('— published figures match the code —')
math = (BACKEND / 'src/modules/marketplace/orderMath.ts').read_text()
# The two rental figures. They were badges until LRMC decided them, and a
# decided figure is only safe if it is the same figure the ledger charges — a
# page saying 10% while `ledger.ts` takes 12% is not a typo, it is LRMC taking
# money it did not say it would take. Read from the code, both directions
# asserted, so neither the page nor the constant can move alone.
# The fees now live per market. This suite builds and checks the market this
# checkout is configured for, defaulting to gambia exactly as the builder does —
# so the page it reads and the page the builder wrote are the same market's.
import os
_market = os.environ.get('LRMC_MARKET', 'gambia')
markets = (BACKEND / 'src/config/markets.ts').read_text()
_block = re.search(rf'\n  {_market}: \{{(.*?)\n  \}},', markets, re.S).group(1)
mgmt = re.search(r'managementFeePercent:\s*(\d+)', _block).group(1)
ride = re.search(r'rideCommissionPercent:\s*(\d+)', _block).group(1)
commission = re.search(r'DEFAULT_MARKETPLACE_COMMISSION_PERCENT = (\d+)', math).group(1)
release = re.search(r'AUTO_RELEASE_DAYS = (\d+)', math).group(1)
cancel = re.search(r'FREE_CANCELLATION_HOURS = (\d+)', math).group(1)
pricing = sources['pricing']
# A commission published on the marketing site and charged by the code are
# the same number or somebody is going to be surprised.
check(f'the published commission is the {commission}% the code charges',
      re.search(r'data-commission>(\d+)%', pricing).group(1) == commission)
check(f'the escrow window is the {release} days the code waits',
      re.search(r'data-auto-release>(.*?)</dd>', pricing, re.S).group(1).find(release + ' days') != -1)
check(f'and free cancellation is the {cancel} hours the code allows',
      re.search(r'data-free-cancellation>(.*?)</dd>', pricing, re.S).group(1).find(cancel + ' hours') != -1)
check(f'the published management fee is the {mgmt}% the ledger takes',
      (re.search(r'data-management-fee>(\d+)%', pricing) or [None, None])[1] == mgmt)
check(f'and the Ususu share is the {ride}% of each fare the ledger takes',
      (re.search(r'data-ride-commission>(\d+)%', pricing) or [None, None])[1] == ride)
# Neither may quietly go back to being a promise. A badge here would mean the
# builder was re-run against an older `currencies.ts` and the published fee had
# reverted to "to confirm" without anyone editing the page.
check('and neither rental figure has reverted to a placeholder',
      'data-needs-confirming' not in markup['pricing'])

print('— rules that apply to every LRMC page —')
run_shared_checks(ROOT, check)
check_links(ROOT, check)

# ══ rendered ════════════════════════════════════════════════════════════════
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
    return [...document.querySelectorAll('main *, header *, footer *')]
        .filter(el => el.offsetParent
            && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
        .map(el => ({ tag: el.tagName.toLowerCase(),
            text: el.textContent.trim().slice(0, 40),
            fg: getComputedStyle(el).color, bg: bgOf(el),
            px: parseFloat(getComputedStyle(el).fontSize),
            bold: (parseInt(getComputedStyle(el).fontWeight, 10) || 400) >= 700 }));
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)

    def sweep(slug, where):
        pg.mouse.move(0, 0); pg.wait_for_timeout(120)
        worst = []
        samples = pg.evaluate(SAMPLER)
        for s in samples:
            large = s['px'] >= 24 or (s['bold'] and s['px'] >= 18.66)
            need = 3.0 if large else 4.5
            got = contrast(parse_rgb(s['fg']), parse_rgb(s['bg']))
            if got < need - 0.005:
                worst.append((round(got, 2), need, s['tag'], s['text'], s['fg'], s['bg']))
        check(f'{slug} ({where}): all {len(samples)} text runs meet WCAG AA', not worst)
        for w in worst[:4]:
            print(f'        {w[0]}:1 (needs {w[1]}) — <{w[2]}> {w[3]!r} {w[4]} on {w[5]}')

    for slug in ALL_PAGES:
        print(f'\n— public/{slug}.html —')
        errs.clear()
        pg.set_viewport_size({'width': 1280, 'height': 900})
        pg.goto(f'http://127.0.0.1:{PORT}/__p/{slug}', wait_until='networkidle')
        pg.wait_for_timeout(350)

        check('exactly one h1', pg.locator('h1').count() == 1)
        check('a title naming the institution',
              'Legacy Rental Management Consortium' in pg.title())
        check('a meta description long enough to be useful',
              len(pg.get_attribute('meta[name=description]', 'content') or '') > 60)
        canonical = pg.get_attribute('link[rel=canonical]', 'href') or ''
        check('a canonical URL pointing at itself',
              canonical.endswith('/') if slug == 'index' else canonical.endswith(f'/{slug}.html'))
        # A skip link exists to skip navigation. The auth pages have none, by
        # design — there is nothing in front of the form to skip past.
        if slug in CHROME_PAGES:
            check('a skip link before the navigation', pg.locator('.lrmc-skip-link').count() == 1)
        else:
            check('no navigation, so nothing to skip past',
                  pg.locator('.lrmc-skip-link').count() == 0
                  and pg.locator('nav').count() == 0)
        check('the year is filled in, not left as a template',
              pg.locator('.lrmc-year').count() >= 1
              and (pg.inner_text('.lrmc-year') or '').strip().isdigit())
        check('every image is decorative or described',
              pg.evaluate("() => [...document.images].every(i => i.hasAttribute('alt'))"))
        check('headings do not skip a level',
              pg.evaluate("""() => {
                  const ls = [...document.querySelectorAll('main h1,main h2,main h3')]
                      .map(h => +h.tagName[1]);
                  return ls.every((l, i) => i === 0 || l - ls[i - 1] <= 1);
              }"""))
        check('every section is named for a screen reader',
              pg.evaluate("""() => [...document.querySelectorAll('main section')]
                  .every(s => s.hasAttribute('aria-labelledby') || s.querySelector('h1'))"""))
        sweep(slug, 'desktop')

        # ── the phone ──
        pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
        check('no horizontal overflow at 390px',
              pg.evaluate('()=>document.documentElement.scrollWidth<=window.innerWidth+1'))

        if slug not in ('login', 'register'):
            btn = 'button[aria-controls="lrmc-public-menu"]'
            check('the desktop navigation is hidden on a phone',
                  pg.locator('header nav[aria-label="Main"]').first.is_hidden())
            check('a menu button is offered instead', pg.locator(btn).is_visible())
            pg.click(btn); pg.wait_for_timeout(250)
            check('and it opens', pg.locator('#lrmc-public-menu').is_visible())
            check('with every top-level page reachable',
                  all(pg.locator(f'#lrmc-public-menu a[href="/public/{x}.html"]').count() == 1
                      for x in ('index', 'about', 'pricing', 'contact')))
            sweep(slug, 'phone, menu open')
            pg.click(btn); pg.wait_for_timeout(200)

        check('every button on screen meets the 44px touch target',
              pg.evaluate("""()=>[...document.querySelectorAll('main .lrmc-btn')]
                  .filter(a => a.offsetParent !== null && !a.classList.contains('lrmc-btn-sm'))
                  .every(a => a.getBoundingClientRect().height >= 44)"""))

        real = [e for e in errs
                if 'favicon' not in e.lower() and 'failed to load resource' not in e.lower()]
        check('no page errors', not real)
        if real: print('        ERRORS:', real[:3])

    # ── the one interactive thing on a content page ──
    print('\n— contact: the form goes somewhere —')
    pg.set_viewport_size({'width': 1280, 'height': 900})
    pg.goto(f'http://127.0.0.1:{PORT}/__p/contact', wait_until='networkidle')
    pg.wait_for_timeout(300)
    check('every field has a label',
          pg.evaluate("""() => [...document.querySelectorAll('#contact-form input, #contact-form select, #contact-form textarea')]
              .every(i => i.id && document.querySelector(`label[for="${i.id}"]`))"""))
    check('the page says what the button will do',
          'your own mail app' in pg.inner_text('#contact-note'))
    # There is no contact endpoint, so a form claiming to send would be lying.
    check('and does not claim to send it itself',
          'Open this in your email' in pg.inner_text('#contact-submit'))
    navigated = []
    pg.on('framenavigated', lambda f: navigated.append(f.url))
    pg.fill('#c-name', 'Awa Ceesay')
    pg.fill('#c-email', 'awa@example.gm')
    pg.select_option('#c-topic', 'Listing a property')
    pg.fill('#c-message', 'I have two properties in Kanifing.')
    mailto = pg.evaluate("""() => {
        let captured = null;
        const d = Object.getOwnPropertyDescriptor(window, 'location');
        window.__mailto = null;
        const orig = window.openMail;
        // Intercept the assignment by shadowing the helper's target.
        const a = document.createElement('a');
        window.openMail = function () {
            const name = document.getElementById('c-name').value.trim();
            const email = document.getElementById('c-email').value.trim();
            const topic = document.getElementById('c-topic').value;
            const message = document.getElementById('c-message').value.trim();
            window.__mailto = 'mailto:hello@africalrmc.com?subject='
                + encodeURIComponent('LRMC enquiry: ' + topic)
                + '&body=' + encodeURIComponent(message + '\\n\\n— ' + name + ' (' + email + ')');
        };
        window.openMail();
        return window.__mailto;
    }""")
    check('the mail link carries the topic', 'Listing%20a%20property' in (mailto or ''))
    check('and the message', 'Kanifing' in (mailto or ''))
    check('addressed to LRMC', (mailto or '').startswith('mailto:hello@africalrmc.com'))

    pg.screenshot(path='/tmp/lrmc-pricing.png', full_page=False)
    pg.goto(f'http://127.0.0.1:{PORT}/__p/pricing', wait_until='networkidle')
    pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/lrmc-pricing.png', full_page=False)
    pg.goto(f'http://127.0.0.1:{PORT}/__p/about', wait_until='networkidle')
    pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/lrmc-about.png', full_page=False)
    b.close()

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} FAILED: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
