#!/usr/bin/env python3
"""LRMC — headless checks for public/index.html.

The homepage is the only LRMC page a stranger meets before deciding whether
the institution is real. It has to work with no session, with no data, with
the API down, and on a phone — and it has to say prices in dalasi rather than
in a number.

This suite drives all four of the listings section's states, checks that a
section with nothing in it removes itself rather than advertising an empty
institution, and measures every text colour it renders against its actual
background. Contrast here is computed, not eyeballed: LRMC Gold on white is
2.1:1, and it reached the shared layout looking fine to somebody.

Run from the frontend/ folder:  python3 verify-index.py
"""
import json, sys, re, pathlib, http.server, socketserver, threading
from playwright.sync_api import sync_playwright
from lrmc_checks import run_shared_checks

ROOT = pathlib.Path(__file__).parent
DOUBLES = ROOT / 'test-doubles'

fails = []
def check(n, c):
    print(('  ok   ' if c else '  FAIL ') + n)
    if not c: fails.append(n)

# ── contrast, computed the way a browser would ───────────────────────────────
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

# ── the stub API ─────────────────────────────────────────────────────────────
PROPERTIES = [
    {"_id": "p1", "reference": "LRMC-GM-0001", "title": "Two-bedroom apartment, Kairaba Avenue",
     "propertyType": "apartment", "city": "Serrekunda", "region": "Kanifing",
     "bedrooms": 2, "bathrooms": 1, "floorAreaSqm": 78, "photos": ["/assets/img/lrmc-mark.png"],
     "rentAmount": 12000, "rentCurrency": "GMD", "rentPeriod": "monthly"},
    {"_id": "p2", "reference": "LRMC-GM-0002", "title": "Compound house near Westfield",
     "propertyType": "compoundHouse", "city": "Serrekunda", "region": "Kanifing",
     "bedrooms": 4, "bathrooms": 2, "photos": [],
     "rentAmount": 25500, "rentCurrency": "GMD", "rentPeriod": "monthly"},
    {"_id": "p3", "title": "Studio, Banjul waterfront",
     "propertyType": "studio", "city": "Banjul", "region": "Banjul",
     "bedrooms": 1, "bathrooms": 1, "photos": [],
     "rentCurrency": "GMD", "rentPeriod": "monthly"},   # no rent agreed yet
]

NEWS = [
    {"slug": "ususu-launches-banjul", "title": "Ususu begins operating in Banjul",
     "excerpt": "Drivers can now register and take rides across the Greater Banjul Area.",
     "publishedAt": "2026-06-01T09:00:00.000Z", "contentType": "announcement"},
]

STATE = {"properties": "ok", "news": "empty", "tracked": [], "queries": []}

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(s, *a): pass

    def do_POST(s):
        if s.path.split('?')[0] == '/api/v1/public/track':
            n = int(s.headers.get('Content-Length') or 0)
            try: STATE["tracked"].append(json.loads(s.rfile.read(n) or b'{}'))
            except Exception: STATE["tracked"].append(None)
            return s._json({"success": True, "data": {"recorded": True}}, 202)
        s.send_response(404); s.end_headers()

    def do_GET(s):
        base, _, query = s.path.partition('?')

        if base == '/api/v1/properties/public':
            STATE["queries"].append(query)
            mode = STATE["properties"]
            if mode == 'down':
                return s._json({"success": False, "error": {"code": "INTERNAL", "message": "boom"}}, 500)
            rows = [] if mode == 'empty' else (
                [dict(PROPERTIES[0], title='<img src=x onerror="window.__pwned=1">Nasty listing')]
                if mode == 'hostile' else PROPERTIES)
            return s._json({"success": True, "data": rows,
                            "meta": {"page": 1, "limit": 6, "total": len(rows)}})

        if base == '/api/v1/public/content':
            if STATE["news"] == 'down':
                return s._json({"success": False, "error": {"code": "INTERNAL", "message": "boom"}}, 500)
            rows = NEWS if STATE["news"] == 'ok' else []
            return s._json({"success": True, "data": rows,
                            "meta": {"page": 1, "limit": 3, "total": len(rows)}})

        if base.startswith('/__t/'):
            p = DOUBLES / base[5:]
            if p.exists():
                return s._raw(p.read_bytes(), 'text/css' if p.suffix == '.css' else 'application/javascript')

        if base == '/page':
            return s._raw(pathlib.Path('/tmp/index-under-test.html').read_bytes(), 'text/html')

        if base.startswith(('/hq/', '/members/', '/staff/', '/marketplace/')):
            return s._raw(b'<!doctype html><title>landed</title><p>landed</p>', 'text/html')

        return super().do_GET()

    def _json(s, body, code=200):
        return s._raw(json.dumps(body).encode(), 'application/json', code)

    def _raw(s, body, ct, code=200):
        s.send_response(code); s.send_header('Content-Type', ct)
        s.send_header('Content-Length', str(len(body))); s.end_headers(); s.wfile.write(body)

# ── swap the CDN for the doubles ─────────────────────────────────────────────
src = (ROOT / 'public/index.html').read_text()
t = src
t = t.replace('<script src="https://cdn.tailwindcss.com"></script>',
              '<link rel="stylesheet" href="/__t/tw-subset.css" /><script src="/__t/tailwind-double.js"></script>')
t = t.replace('<script src="https://unpkg.com/htmx.org@1.9.12"></script>', '<script src="/__t/htmx-double.js"></script>')
t = t.replace('<script src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js" defer></script>', '<script src="/__t/alpine-double.js" defer></script>')
t = t.replace('<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js" defer></script>', '<script src="/__t/lucide-double.js" defer></script>')
t = re.sub(r'<link href="https://fonts\.googleapis[^>]*>', '', t)
t = re.sub(r'<link rel="preconnect"[^>]*>', '', t)
assert 'unpkg' not in t and 'cdn.tailwindcss' not in t, 'a CDN reference survived'
pathlib.Path('/tmp/index-under-test.html').write_text(t)

socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

# ── artwork placed on a dark band must actually be transparent ──────────────
# `lrmc-logo-white.png` shipped as RGB with an opaque white background — the
# lockup *on* white rather than *in* white. On the blue hero that is a white
# rectangle, and it reads as a rendering fault rather than as a wrong file.
print('— the artwork suits the surface it sits on —')
try:
    from PIL import Image
    hero = Image.open(ROOT / 'assets/img/lrmc-logo-white.png')
    check('the hero lockup carries an alpha channel', hero.mode == 'RGBA')
    _px = hero.convert('RGBA').load()
    _w, _h = hero.size
    check('and its corners are transparent, not a white box',
          all(_px[x, y][3] == 0 for x, y in [(0, 0), (_w - 1, 0), (0, _h - 1), (_w - 1, _h - 1)]))
    _marks = [_px[x, y] for y in range(0, _h, 7) for x in range(0, _w, 7) if _px[x, y][3] > 200]
    check('the marks themselves are white, so they read on LRMC Blue',
          bool(_marks) and all(m[:3] == (255, 255, 255) for m in _marks))
except ImportError:
    print('  skip  Pillow not installed — artwork checks not run')

print('— rules that apply to every LRMC page —')
run_shared_checks(ROOT, check)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)

    def load(signed_in=None, dnt=False):
        ctx.clear_cookies()
        pg.goto(f'http://127.0.0.1:{PORT}/members/index.html', wait_until='domcontentloaded')
        pg.evaluate("() => { try { sessionStorage.clear(); } catch (e) {} }")
        if signed_in:
            pg.evaluate("""(actor) => {
                sessionStorage.setItem('lrmc.token', 'tok-x');
                sessionStorage.setItem('lrmc.actor', JSON.stringify(actor));
            }""", signed_in)
        if dnt:
            pg.add_init_script("Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true });")
        pg.goto(f'http://127.0.0.1:{PORT}/page', wait_until='networkidle')
        pg.wait_for_timeout(500)

        print('— it says who it is and what it does —')
    STATE["properties"] = "ok"; STATE["news"] = "empty"
    load()
    check('exactly one h1', pg.locator('h1').count() == 1)
    check('the institution is named in the title',
          'Legacy Rental Management Consortium' in pg.title())
    check('and the launch market is named in the title', 'Gambia' in pg.title())
    check('there is a meta description for search results',
          len(pg.get_attribute('meta[name=description]', 'content') or '') > 60)
    check('the mark in the header is decorative',
          pg.get_attribute('header img', 'alt') == '')
    check('but the header link still says where it goes',
          pg.locator('header .lrmc-sr-only').count() >= 1)
    check('the hero lockup is decorative too',
          pg.get_attribute('main img', 'alt') == '')
    check('and the artwork loads',
          pg.evaluate("() => document.querySelector('main img').naturalWidth > 0"))
    check('there is a skip link before the navigation',
          pg.locator('.lrmc-skip-link').count() == 1)
    check('every section is labelled for a screen reader',
          pg.evaluate("""() => [...document.querySelectorAll('main section')]
              .every(s => s.hasAttribute('aria-labelledby') || s.querySelector('h1'))"""))
    check('headings do not skip a level',
          pg.evaluate("""() => {
              const ls = [...document.querySelectorAll('main h1,main h2,main h3')]
                  .map(h => +h.tagName[1]);
              return ls.every((l, i) => i === 0 || l - ls[i - 1] <= 1);
          }"""))

    print('\n— the header at desktop width —')
    check('the full navigation is shown',
          pg.locator('header nav[aria-label="Main"]').first.is_visible())
    # `md:hidden` and `.lrmc-btn` have the same specificity, so load order
    # decides — and utilities.css loads after Tailwind. A display utility on an
    # LRMC component class silently loses. Asserted here because it is
    # invisible until somebody looks at a wide screen.
    check('and the phone menu button is not',
          pg.locator('button[aria-controls="lrmc-public-menu"]').is_hidden())
    check('the collapsed menu stays collapsed',
          pg.locator('#lrmc-public-menu').is_hidden())

    print('\n— the doors out of the page —')
    check('a visitor is offered registration', pg.locator('a[href="/public/register.html"]').count() >= 1)
    check('and sign-in', pg.locator('a[href="/public/login.html"]').count() >= 1)
    check('the landlord door pre-selects nothing it cannot honour',
          pg.locator('a[href*="/public/register.html?role="]').count() >= 1)
    check('no link points at a page that does not exist yet without being planned',
          pg.evaluate("""() => [...document.querySelectorAll('a[href^="/"]')]
              .every(a => /^\\/(public|members|staff|hq|marketplace|pos)\\//.test(a.getAttribute('href'))
                        || a.getAttribute('href') === '/')"""))

    print('\n— homes: the ordinary case —')
    check('the loading skeleton is gone once data arrives',
          pg.locator('#homes-loading').is_hidden())
    check('the listings that came back are shown', pg.locator('#homes-grid li').count() == 3)
    check('a listing names its type in words a person uses',
          'Compound house' in pg.inner_text('#homes-grid'))
    check('rent is shown in dalasi, not a bare number',
          'D 12,000' in pg.inner_text('#homes-grid'))
    check('and says what period it covers', 'per month' in pg.inner_text('#homes-grid'))
    # A listing can be published before a price is agreed. "D 0" would be a lie.
    check('a listing with no agreed rent says so rather than showing zero',
          'Price on application' in pg.inner_text('#homes-grid')
          and 'D 0' not in pg.inner_text('#homes-grid'))
    check('a listing with a photo shows it',
          pg.locator('#homes-grid img').count() == 1)
    check('the photo is decorative, since the title is beside it',
          pg.get_attribute('#homes-grid img', 'alt') == '')
    check('and it is lazily loaded, so a phone does not fetch six at once',
          pg.get_attribute('#homes-grid img', 'loading') == 'lazy')
    check('a listing with no photo gets a placeholder, not a broken image',
          pg.evaluate("""() => [...document.querySelectorAll('#homes-grid li')]
              .every(li => li.querySelector('img') || li.querySelector('[data-lucide]'))"""))
    check('the count is announced to a screen reader',
          '3 homes listed' in pg.inner_text('#homes-status'))
    check('only six are asked for, so the homepage is not the whole database',
          any('limit=6' in q for q in STATE["queries"]))
    check('neither the empty nor the error state is showing',
          pg.locator('#homes-empty').is_hidden() and pg.locator('#homes-error').is_hidden())

    print('\n— homes: nothing available —')
    STATE["properties"] = "empty"
    load()
    check('the empty state is shown', pg.locator('#homes-empty').is_visible())
    check('the grid is not left as an empty box', pg.locator('#homes-grid').is_hidden())
    check('and it leaves the visitor something to do',
          pg.locator('#homes-empty a[href*="register"]').count() == 1)
    check('the empty case is announced too',
          'No homes' in pg.inner_text('#homes-status'))

    print('\n— homes: the API is down —')
    STATE["properties"] = "down"
    load()
    check('the failure is shown', pg.locator('#homes-error').is_visible())
    check('the loading skeleton does not spin forever',
          pg.locator('#homes-loading').is_hidden())
    check('the fault is claimed as ours',
          'on our side' in pg.inner_text('#homes-error'))
    check('and the rest of the page still works',
          pg.locator('#services-heading').is_visible()
          and pg.locator('a[href="/public/register.html"]').count() >= 1)
    # Retry must actually retry, not just re-show the same failure.
    STATE["properties"] = "ok"
    pg.click('#homes-retry')
    pg.wait_for_timeout(600)
    check('trying again loads the listings', pg.locator('#homes-grid li').count() == 3)
    check('and the error state stands down', pg.locator('#homes-error').is_hidden())

    print('\n— a listing title cannot become markup —')
    STATE["properties"] = "hostile"
    load()
    check('markup in a listing title is shown as text, not run',
          pg.evaluate("() => window.__pwned") is None
          and pg.locator('#homes-grid img[src="x"]').count() == 0)
    check('and the title itself still reaches the page',
          'Nasty listing' in pg.inner_text('#homes-grid'))

    print('\n— announcements —')
    STATE["properties"] = "ok"; STATE["news"] = "empty"
    load()
    # An empty "Latest news" box says the institution is dormant.
    check('with nothing published, the section removes itself',
          pg.locator('#news').is_hidden())
    STATE["news"] = "ok"
    load()
    check('with something published, the section appears', pg.locator('#news').is_visible())
    check('and shows it', 'Ususu begins operating in Banjul' in pg.inner_text('#news'))
    check('with the date it was published', '2026' in pg.inner_text('#news'))
    STATE["news"] = "down"
    load()
    check('a news feed that fails does not take the page with it',
          pg.locator('#news').is_hidden() and pg.locator('#homes-grid li').count() == 3)

    print('\n— somebody who already has an account —')
    STATE["news"] = "empty"
    load()
    check('a visitor is asked to get started',
          pg.inner_text('#lrmc-nav-cta').strip() == 'Get started')
    load(signed_in={"userId": "u1", "roles": ["merchant"], "primaryRole": "merchant"})
    check('a signed-in merchant is offered their dashboard instead',
          pg.inner_text('#lrmc-nav-cta').strip() == 'Go to your dashboard')
    check('pointed at the portal their role belongs to',
          (pg.get_attribute('#lrmc-nav-cta', 'href') or '').endswith('/marketplace/index.html'))
    check('and is not asked to sign in again',
          pg.locator('#lrmc-nav-signin').is_hidden())
    load(signed_in={"userId": "u2", "roles": ["tenant"], "primaryRole": "tenant"})
    check('a tenant is pointed at the member portal',
          (pg.get_attribute('#lrmc-nav-cta', 'href') or '').endswith('/members/index.html'))

    print('\n— the visit is counted, and can refuse to be —')
    STATE["tracked"] = []
    load()
    check('the visit is recorded, so HQ traffic metrics are not empty',
          len(STATE["tracked"]) == 1)
    sent = STATE["tracked"][0] if STATE["tracked"] else {}
    check('with the path it was on', sent.get('path') == '/page')
    check('and how the person is reading it', sent.get('device') in ('mobile', 'tablet', 'desktop'))
    check('nothing identifying a person is sent',
          not ({'email', 'name', 'userId', 'ip', 'phone'} & set(sent)))
    STATE["tracked"] = []
    load(dnt=True)
    check('Global Privacy Control is honoured — nothing is sent',
          len(STATE["tracked"]) == 0)
    check('and the page still works for somebody who refused',
          pg.locator('#homes-grid li').count() == 3)

    print('\n— contrast, measured rather than assumed —')
    # LRMC Gold is 2.1:1 on white. It reached the shared layout looking fine to
    # somebody, so this is measured on every rendered pairing rather than
    # checked once by eye.
    pg.mouse.move(0, 0)
    pg.wait_for_timeout(150)
    SAMPLER = """() => {
        // Composite translucent layers down onto what is behind them. Stopping
        // at the first non-transparent background reports `rgba(255,255,255,.12)`
        // as if it were opaque white — which is both wrong and alarming.
        function rgba(c) {
            const n = (c.match(/[\d.]+/g) || []).map(Number);
            return { r: n[0] || 0, g: n[1] || 0, b: n[2] || 0, a: n.length > 3 ? n[3] : 1 };
        }
        function bgOf(el) {
            const layers = [];
            for (let n = el; n; n = n.parentElement) {
                const c = rgba(getComputedStyle(n).backgroundColor);
                if (c.a > 0) layers.push(c);
                if (c.a >= 1) break;
            }
            let out = { r: 255, g: 255, b: 255 };            // the page beneath
            for (let i = layers.length - 1; i >= 0; i--) {
                const l = layers[i];
                out = {
                    r: l.r * l.a + out.r * (1 - l.a),
                    g: l.g * l.a + out.g * (1 - l.a),
                    b: l.b * l.a + out.b * (1 - l.a),
                };
            }
            return `rgb(${Math.round(out.r)}, ${Math.round(out.g)}, ${Math.round(out.b)})`;
        }
        return [...document.querySelectorAll('main *, header *, footer *')]
            .filter(el => {
                if (!el.offsetParent && el.tagName !== 'BODY') return false;
                const t = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
                return t;
            })
            .map(el => ({
                tag: el.tagName.toLowerCase(),
                text: el.textContent.trim().slice(0, 40),
                fg: getComputedStyle(el).color,
                bg: bgOf(el),
                px: parseFloat(getComputedStyle(el).fontSize),
                bold: (parseInt(getComputedStyle(el).fontWeight, 10) || 400) >= 700,
            }));
    }"""

    def sweep(where):
        pg.mouse.move(0, 0)
        pg.wait_for_timeout(150)
        samples = pg.evaluate(SAMPLER)
        worst = []
        for s in samples:
            # WCAG AA: 4.5:1 for body text, 3:1 for large (>=24px, or >=18.66px bold).
            large = s['px'] >= 24 or (s['bold'] and s['px'] >= 18.66)
            need = 3.0 if large else 4.5
            got = contrast(parse_rgb(s['fg']), parse_rgb(s['bg']))
            if got < need - 0.005:
                worst.append((round(got, 2), need, s['tag'], s['text'], s['fg'], s['bg']))
        check(f'{where}: all {len(samples)} rendered text runs meet WCAG AA', not worst)
        for w in worst[:6]:
            print(f'        {w[0]}:1 (needs {w[1]}) — <{w[2]}> {w[3]!r} {w[4]} on {w[5]}')

    sweep('desktop')

    # The mobile menu is display:none at desktop width, so the sweep above
    # cannot see it. It shipped using `.lrmc-nav-item` — a dark-sidebar token,
    # slate-300, 1.7:1 on white — and nothing caught it until this ran here.
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
    sweep('phone')
    pg.click('button[aria-controls="lrmc-public-menu"]')
    pg.wait_for_timeout(300)
    sweep('phone, menu open')
    check('every menu item is a 44px touch target',
          pg.evaluate("""()=>[...document.querySelectorAll('#lrmc-public-menu a')]
              .every(a => a.getBoundingClientRect().height >= 44)"""))
    pg.click('button[aria-controls="lrmc-public-menu"]')
    pg.wait_for_timeout(250)
    pg.set_viewport_size({'width': 1280, 'height': 900}); pg.wait_for_timeout(300)

    print('\n— on a phone —')
    load()
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(400)
    check('no horizontal overflow at 390px',
          pg.evaluate('()=>document.documentElement.scrollWidth<=window.innerWidth+1'))
    # The desktop nav is hidden below md. Without a menu button the whole of
    # the navigation would be unreachable on the device most of the launch
    # market arrives on.
    check('the desktop navigation is hidden',
          pg.locator('header nav[aria-label="Main"]').first.is_hidden())
    check('a menu button is offered instead',
          pg.locator('button[aria-controls="lrmc-public-menu"]').is_visible())
    check('and the menu starts closed',
          pg.get_attribute('button[aria-controls="lrmc-public-menu"]', 'aria-expanded') == 'false'
          and pg.locator('#lrmc-public-menu').is_hidden())
    pg.click('button[aria-controls="lrmc-public-menu"]')
    pg.wait_for_timeout(300)
    check('opening it reveals the navigation', pg.locator('#lrmc-public-menu').is_visible())
    check('the state is announced to assistive technology',
          pg.get_attribute('button[aria-controls="lrmc-public-menu"]', 'aria-expanded') == 'true')
    check('and every top-level page is reachable from it',
          all(pg.locator(f'#lrmc-public-menu a[href="/public/{p}.html"]').count() == 1
              for p in ('index', 'about', 'pricing', 'contact')))
    # A destination that exists only in the collapsed header is a destination
    # a phone cannot reach.
    check('no header destination is lost when the header collapses',
          pg.evaluate("""() => {
              const inMenu = new Set([...document.querySelectorAll('#lrmc-public-menu a')]
                  .map(a => a.getAttribute('href')));
              return [...document.querySelectorAll('header a[href^="/public/"]')]
                  .every(a => inMenu.has(a.getAttribute('href')));
          }"""))
    pg.click('button[aria-controls="lrmc-public-menu"]')
    pg.wait_for_timeout(300)
    check('and it closes again', pg.locator('#lrmc-public-menu').is_hidden())
    # Only what is actually on screen: a hidden button measures zero, and a
    # check that fails on the empty state's button while the empty state is
    # not showing is a check reporting the wrong thing.
    check('every button on screen meets the 44px touch target',
          pg.evaluate("""()=>[...document.querySelectorAll('main a.lrmc-btn, main button.lrmc-btn')]
              .filter(a => a.offsetParent !== null)
              .every(a => a.getBoundingClientRect().height >= 44)"""))
    # And the states that were not on screen when that ran.
    check('so do the buttons in the states not currently showing',
          pg.evaluate("""() => {
              const hidden = ['homes-empty', 'homes-error'];
              hidden.forEach(id => { document.getElementById(id).hidden = false; });
              const ok = [...document.querySelectorAll('#homes-empty .lrmc-btn, #homes-error .lrmc-btn')]
                  .every(a => a.getBoundingClientRect().height >= 44);
              hidden.forEach(id => { document.getElementById(id).hidden = true; });
              return ok;
          }"""))
    check('the listings stack rather than squeezing',
          pg.evaluate("""() => {
              const li = [...document.querySelectorAll('#homes-grid li')];
              return li.length > 1 && li[0].getBoundingClientRect().bottom
                     <= li[1].getBoundingClientRect().top + 1;
          }"""))
    pg.screenshot(path='/tmp/lrmc-home-mobile.png', full_page=False)

    pg.set_viewport_size({'width': 1280, 'height': 900}); pg.wait_for_timeout(400)
    pg.screenshot(path='/tmp/lrmc-home.png', full_page=False)
    pg.screenshot(path='/tmp/lrmc-home-full.png', full_page=True)

    real = [e for e in errs
            if 'favicon' not in e.lower()
            and 'failed to load resource' not in e.lower()]
    check('no page errors', not real)
    if real: print('   ERRORS:', real[:4])
    b.close()

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} FAILED: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
