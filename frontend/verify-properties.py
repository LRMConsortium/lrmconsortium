#!/usr/bin/env python3
"""LRMC — headless checks for public/properties.html.

The search a stranger uses to decide whether LRMC has anything for them. It
has to work with no session, narrow correctly, say what it is narrowing by,
survive a wrong-way-round price range, and be shareable as a link.

The sharpest checks here are about *what reaches the API*. A filter that looks
applied but is not sent is worse than no filter: it tells somebody there are no
four-bedroom houses in Brikama when nobody ever asked.

Run from the frontend/ folder:  python3 verify-properties.py
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

# ── the stub API ─────────────────────────────────────────────────────────────
def prop(n, **over):
    base = {
        "_id": f"{n:024d}", "reference": f"LRMC-GM-{n:04d}",
        "title": f"Listing number {n}", "propertyType": "apartment",
        "city": "Serrekunda", "region": "Kanifing",
        "bedrooms": 2, "bathrooms": 1, "photos": [],
        "amenities": ["water", "electricity"],
        "rentAmount": 10000 + n * 500, "rentCurrency": "GMD", "rentPeriod": "monthly",
    }
    base.update(over)
    return base

ALL = [prop(n) for n in range(1, 15)]
ALL[0].update({"photos": ["/assets/img/lrmc-mark.png"], "isVerified": True,
               "assignedCoordinator": "c1",
               "amenities": ["water", "electricity", "wifi", "generator", "parking", "security"]})
ALL[1].update({"rentAmount": None, "title": "Studio, price not yet agreed"})
del ALL[1]["rentAmount"]

STATE = {"mode": "ok", "queries": []}

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(s, *a): pass

    def do_GET(s):
        base, _, query = s.path.partition('?')

        if base == '/api/v1/properties/public':
            q0 = parse_qs(query)
            STATE["queries"].append(q0)

            # A search the page has already moved on from, answering late.
            # Keyed on the region select rather than the search box: the box
            # keeps its value, so a marker there would ride along on the
            # overtaking request too and there would be no race to observe.
            if q0.get('region') == ['Kuntaur']:
                time.sleep(0.8)
                return s._json({"success": True,
                                "data": [prop(99, title='STALE ANSWER')],
                                "meta": {"page": 1, "limit": 12, "total": 1}})

            if STATE["mode"] == 'onepage':
                return s._json({"success": True, "data": ALL[:5],
                                "meta": {"page": 1, "limit": 12, "total": 5}})

            if STATE["mode"] == 'down':
                return s._json({"success": False,
                                "error": {"code": "INTERNAL", "message": "boom"}}, 500)
            if STATE["mode"] == 'empty':
                rows, total = [], 0
            elif STATE["mode"] == 'hostile':
                rows = [prop(1, title='<img src=x onerror="window.__pwned=1">Nasty')]
                total = 1
            else:
                q = parse_qs(query)
                page = int(q.get('page', ['1'])[0])
                limit = int(q.get('limit', ['12'])[0])
                total = len(ALL)
                rows = ALL[(page - 1) * limit: page * limit]
            return s._json({"success": True, "data": rows,
                            "meta": {"page": 1, "limit": 12, "total": total}})

        if base.startswith('/__t/'):
            p = DOUBLES / base[5:]
            if p.exists():
                return s._raw(p.read_bytes(),
                              'text/css' if p.suffix == '.css' else 'application/javascript')
        if base == '/page':
            return s._raw(pathlib.Path('/tmp/properties-under-test.html').read_bytes(), 'text/html')
        if base.startswith(('/hq/', '/members/', '/staff/', '/marketplace/')):
            return s._raw(b'<!doctype html><title>landed</title><p>landed</p>', 'text/html')
        return super().do_GET()

    def _json(s, body, code=200):
        return s._raw(json.dumps(body).encode(), 'application/json', code)

    def _raw(s, body, ct, code=200):
        s.send_response(code); s.send_header('Content-Type', ct)
        s.send_header('Content-Length', str(len(body))); s.end_headers(); s.wfile.write(body)

src = (ROOT / 'public/properties.html').read_text()
t = src
t = t.replace('<script src="https://cdn.tailwindcss.com"></script>',
              '<link rel="stylesheet" href="/__t/tw-subset.css" /><script src="/__t/tailwind-double.js"></script>')
t = t.replace('<script src="https://unpkg.com/htmx.org@1.9.12"></script>', '<script src="/__t/htmx-double.js"></script>')
t = t.replace('<script src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js" defer></script>', '<script src="/__t/alpine-double.js" defer></script>')
t = t.replace('<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js" defer></script>', '<script src="/__t/lucide-double.js" defer></script>')
t = re.sub(r'<link href="https://fonts\.googleapis[^>]*>', '', t)
t = re.sub(r'<link rel="preconnect"[^>]*>', '', t)
assert 'unpkg' not in t and 'cdn.tailwindcss' not in t, 'a CDN reference survived'
pathlib.Path('/tmp/properties-under-test.html').write_text(t)

socketserver.TCPServer.allow_reuse_address = True

class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    """Threaded on purpose: the stale-reply test needs one slow request in
    flight while a fast one overtakes it. A single-threaded server serialises
    them and the race cannot occur — which is how a guard against it survived
    a suite that otherwise catches everything."""
    daemon_threads = True

srv = ThreadedServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

# ── the page's filters and the API's query schema must agree ────────────────
print('— the form and the API agree about what can be filtered —')
schema = (BACKEND / 'src/modules/property/property.validation.ts').read_text()
block = re.search(r'publicPropertyQuery = z\s*\.object\(\{(.*?)\n  \}\)', schema, re.S).group(1)
api_filters = set(re.findall(r'^\s{4}(\w+):', block, re.M)) - {'page', 'limit'}
form_html = src[src.index('<form id="property-filters"'):src.index('</form>')]
page_filters = set(re.findall(r'name="(\w+)"', form_html)) - {'amenities'}
check('every filter the page sends is one the API accepts',
      page_filters <= api_filters)
if not page_filters <= api_filters:
    print('   page:', sorted(page_filters), '\n   api :', sorted(api_filters))
check('and amenities is accepted too', 'amenities' in api_filters)

print('— rules that apply to every LRMC page —')
run_shared_checks(ROOT, check)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)

    def load(query=''):
        ctx.clear_cookies()
        pg.goto(f'http://127.0.0.1:{PORT}/members/index.html', wait_until='domcontentloaded')
        pg.evaluate("() => { try { sessionStorage.clear(); } catch (e) {} }")
        STATE["queries"] = []
        pg.goto(f'http://127.0.0.1:{PORT}/page{query}', wait_until='networkidle')
        pg.wait_for_timeout(450)

    def last_query():
        return STATE["queries"][-1] if STATE["queries"] else {}

    print('\n— structure —')
    STATE["mode"] = "ok"
    load()
    check('exactly one h1', pg.locator('h1').count() == 1)
    check('the launch market is in the title', 'Gambia' in pg.title())
    check('the filter panel is a real search landmark',
          pg.get_attribute('#property-filters', 'role') == 'search')
    check('and a real form that works before script loads',
          (pg.get_attribute('#property-filters', 'method') or '').lower() == 'get')
    check('every filter control has a label',
          pg.evaluate("""() => [...document.querySelectorAll('#property-filters input, #property-filters select')]
              .every(i => (i.id && document.querySelector(`label[for="${i.id}"]`)) || i.closest('label'))"""))
    check('the amenity group is a fieldset with a legend',
          pg.locator('#property-filters fieldset legend').count() == 1)
    check('the regions offered are the launch market\'s',
          pg.locator('#f-region option').count() == 9
          and 'Banjul' in pg.inner_text('#f-region'))
    check('and the property types match the API enum',
          pg.locator('#f-propertyType option').count() == 12)

    print('\n— the first load —')
    check('results are shown', pg.locator('#results-grid li').count() == 12)
    check('the skeleton is gone', pg.locator('#results-loading').is_hidden())
    check('the count is announced', 'homes found' in pg.inner_text('#results-count'))
    check('and says how many of the total are on screen',
          '14 homes found' in pg.inner_text('#results-count')
          and 'showing 12' in pg.inner_text('#results-count'))
    check('the count region is a live status',
          pg.get_attribute('#results-count', 'role') == 'status')
    check('a page size is asked for', last_query().get('limit') == ['12'])

    print('\n— a card says what LRMC knows —')
    first = pg.locator('#results-grid li').first
    check('the type is in words a person uses',
          'Apartment' in first.text_content())
    check('rent is in dalasi', 'D 10,500' in first.inner_text())
    check('with the period', 'per month' in first.inner_text())
    check('a verified property says so', 'Verified by LRMC' in first.inner_text())
    check('a coordinator-managed one says so', 'Coordinator managed' in first.inner_text())
    # A badge on every card is a badge that means nothing.
    check('and an unverified property claims neither',
          'Verified by LRMC' not in pg.locator('#results-grid li').nth(2).inner_text())
    check('amenities are shown in words',
          'Running water' in first.inner_text())
    check('with the rest counted rather than listed',
          '+2 more' in first.inner_text())
    check('the photo is decorative', pg.get_attribute('#results-grid img', 'alt') == '')
    check('and lazily loaded', pg.get_attribute('#results-grid img', 'loading') == 'lazy')
    check('a listing with no agreed rent says so, not D 0',
          'Price on application' in pg.inner_text('#results-grid')
          and 'D 0 ' not in pg.inner_text('#results-grid'))

    print('\n— filtering reaches the API —')
    load()
    pg.select_option('#f-region', 'Brikama')
    pg.wait_for_timeout(500)
    check('choosing a region searches at once', last_query().get('region') == ['Brikama'])
    pg.select_option('#f-bedrooms', '4')
    pg.wait_for_timeout(500)
    check('and so does a bedroom count', last_query().get('bedrooms') == ['4'])
    pg.fill('#f-maxRent', '15000')
    pg.wait_for_timeout(500)
    check('a rent ceiling is sent', last_query().get('maxRent') == ['15000'])
    check('and the earlier filters are still there',
          last_query().get('region') == ['Brikama'] and last_query().get('bedrooms') == ['4'])

    print('\n— typing waits, ticking does not —')
    load()
    before = len(STATE["queries"])
    pg.fill('#f-search', 'Kai')
    pg.wait_for_timeout(120)
    check('a keystroke does not fire a search immediately',
          len(STATE["queries"]) == before)
    pg.wait_for_timeout(450)
    check('but a pause does', last_query().get('search') == ['Kai'])

    print('\n— amenities are requirements, not alternatives —')
    load()
    pg.check('#amenity-water')
    pg.wait_for_timeout(450)
    pg.check('#amenity-wifi')
    pg.wait_for_timeout(450)
    check('both ticked amenities are sent together',
          set((last_query().get('amenities') or [''])[0].split(',')) == {'water', 'wifi'})

    print('\n— the URL is the search —')
    check('the address bar carries the filters',
          'water' in pg.url and 'wifi' in pg.url)
    load('?region=Banjul&bedrooms=3&maxRent=20000&amenities=water,generator')
    check('a shared link restores the region', pg.input_value('#f-region') == 'Banjul')
    check('and the bedroom count', pg.input_value('#f-bedrooms') == '3')
    check('and the rent ceiling', pg.input_value('#f-maxRent') == '20000')
    check('and the ticked amenities',
          pg.is_checked('#amenity-water') and pg.is_checked('#amenity-generator'))
    check('and searches with them without being asked',
          last_query().get('region') == ['Banjul']
          and set((last_query().get('amenities') or [''])[0].split(',')) == {'water', 'generator'})

    print('\n— what is narrowing the list is visible —')
    check('each filter shows as a chip',
          pg.locator('#active-filters [data-remove]').count() == 5)
    check('a chip names the filter in words',
          'Banjul' in pg.inner_text('#active-filters')
          and '3+ bedrooms' in pg.inner_text('#active-filters'))
    check('a money chip is in dalasi',
          'Up to D 20,000' in pg.inner_text('#active-filters'))
    check('and each chip says what removing it does, for a screen reader',
          pg.locator('#active-filters .lrmc-sr-only').count() == 5)
    pg.click('#active-filters [data-remove="region"]')
    pg.wait_for_timeout(500)
    check('removing a chip drops that filter', 'region' not in last_query())
    check('and leaves the others alone', last_query().get('bedrooms') == ['3'])
    check('the chip is gone', 'Banjul' not in pg.inner_text('#active-filters'))
    pg.click('#filters-clear')
    pg.wait_for_timeout(500)
    check('clearing drops everything',
          set(last_query()) <= {'page', 'limit'})
    check('and the chips go with it',
          pg.locator('#active-filters [data-remove]').count() == 0)
    check('the clear button hides when there is nothing to clear',
          pg.locator('#filters-clear').is_hidden())

    print('\n— a range the wrong way round —')
    load()
    pg.fill('#f-minRent', '30000')
    pg.wait_for_timeout(450)
    STATE["queries"] = []
    pg.fill('#f-maxRent', '10000')
    pg.wait_for_timeout(500)
    # "Nothing matched" is the wrong thing to tell somebody whose numbers are
    # simply the wrong way round.
    check('it is caught here rather than sent as an empty search',
          len(STATE["queries"]) == 0)
    check('and said beside the field', pg.locator('#rent-range-error').is_visible())
    check('with the field marked invalid',
          pg.get_attribute('#f-maxRent', 'aria-invalid') == 'true')
    pg.fill('#f-maxRent', '40000')
    pg.wait_for_timeout(500)
    check('correcting it searches', last_query().get('maxRent') == ['40000'])
    check('and the message goes', pg.locator('#rent-range-error').is_hidden())

    print('\n— paging —')
    load()
    check('paging is offered when there is more than a page',
          pg.locator('#results-paging').is_visible())
    check('it says where you are', 'Page 1 of 2' in pg.inner_text('#page-status'))
    check('and previous is refused on the first page', pg.is_disabled('#page-prev'))
    pg.click('#page-next')
    pg.wait_for_timeout(500)
    check('next asks for page two', last_query().get('page') == ['2'])
    check('and says so', 'Page 2 of 2' in pg.inner_text('#page-status'))
    check('with next now refused', pg.is_disabled('#page-next'))
    check('the page is in the URL, so it is shareable too', 'page=2' in pg.url)
    # A filter change must not leave somebody on page 4 of a 1-page result.
    pg.select_option('#f-bedrooms', '2')
    pg.wait_for_timeout(500)
    check('changing a filter returns to page one', last_query().get('page') == ['1'])
    check('and the URL no longer claims page two', 'page=2' not in pg.url)

    print('\n— a late answer must not overwrite a newer search —')
    STATE["mode"] = "ok"
    load()
    # Start a search that answers slowly, then overtake it. Without the guard
    # the slow reply lands last and puts stale results on screen.
    pg.select_option('#f-region', 'Kuntaur')    # answers in 800ms
    pg.wait_for_timeout(120)                    # request away, reply not back
    pg.select_option('#f-region', 'Brikama')    # answers at once, overtaking it
    pg.wait_for_timeout(1400)                   # long enough for the slow one to land
    check('the newer results are the ones on screen',
          'STALE ANSWER' not in pg.inner_text('#results-grid'))
    check('and the count belongs to them',
          '14 homes found' in pg.inner_text('#results-count'))

    print('\n— exactly one page of results —')
    STATE["mode"] = "onepage"
    load()
    check('the results are shown', pg.locator('#results-grid li').count() == 5)
    # Paging controls for a single page are two dead buttons and a line of text
    # saying "Page 1 of 1".
    check('but no paging controls are offered', pg.locator('#results-paging').is_hidden())
    check('and the count does not claim to be truncated',
          'showing' not in pg.inner_text('#results-count'))
    STATE["mode"] = "ok"

    print('\n— nothing matched —')
    STATE["mode"] = "empty"
    load('?region=Janjanbureh')
    check('the empty state is shown', pg.locator('#results-empty').is_visible())
    check('the grid is not left as an empty box', pg.locator('#results-grid').is_hidden())
    check('paging is not offered for nothing', pg.locator('#results-paging').is_hidden())
    check('the count says so plainly', 'No homes matched' in pg.inner_text('#results-count'))
    STATE["mode"] = "ok"
    pg.click('#empty-clear')
    pg.wait_for_timeout(500)
    check('clearing from the empty state brings results back',
          pg.locator('#results-grid li').count() == 12)

    print('\n— the API is down —')
    STATE["mode"] = "down"
    load()
    check('the failure is shown', pg.locator('#results-error').is_visible())
    check('the skeleton does not spin forever', pg.locator('#results-loading').is_hidden())
    check('the fault is claimed as ours', 'on our side' in pg.inner_text('#results-error'))
    check('and the filters still work', pg.locator('#property-filters').is_visible())
    STATE["mode"] = "ok"
    pg.click('#results-retry')
    pg.wait_for_timeout(600)
    check('trying again loads results', pg.locator('#results-grid li').count() == 12)
    check('and the error stands down', pg.locator('#results-error').is_hidden())

    print('\n— a listing title cannot become markup —')
    STATE["mode"] = "hostile"
    load()
    check('markup in a title is shown as text, not run',
          pg.evaluate("() => window.__pwned") is None
          and pg.locator('#results-grid img[src="x"]').count() == 0)
    check('and the title still reaches the page', 'Nasty' in pg.inner_text('#results-grid'))

    print('\n— a visitor can look but not act —')
    STATE["mode"] = "ok"
    load()
    check('browsing needs no account', pg.locator('#results-grid li').count() == 12)
    check('and the page says what does need one',
          'does' in pg.inner_text('main').lower()
          and 'account' in pg.inner_text('main').lower())
    check('with a route to getting one',
          pg.locator('main a[href*="/public/register.html"]').count() >= 1)
    check('a visitor is offered sign-in in the header',
          pg.inner_text('#lrmc-nav-cta').strip() == 'Get started')

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
        return [...document.querySelectorAll('main *, header *, footer *')]
            .filter(el => el.offsetParent
                && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
            .map(el => ({
                tag: el.tagName.toLowerCase(),
                text: el.textContent.trim().slice(0, 40),
                fg: getComputedStyle(el).color, bg: bgOf(el),
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
            large = s['px'] >= 24 or (s['bold'] and s['px'] >= 18.66)
            need = 3.0 if large else 4.5
            got = contrast(parse_rgb(s['fg']), parse_rgb(s['bg']))
            if got < need - 0.005:
                worst.append((round(got, 2), need, s['tag'], s['text'], s['fg'], s['bg']))
        check(f'{where}: all {len(samples)} rendered text runs meet WCAG AA', not worst)
        for w in worst[:6]:
            print(f'        {w[0]}:1 (needs {w[1]}) — <{w[2]}> {w[3]!r} {w[4]} on {w[5]}')

    sweep('desktop')

    print('\n— on a phone —')
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(400)
    check('no horizontal overflow at 390px',
          pg.evaluate('()=>document.documentElement.scrollWidth<=window.innerWidth+1'))
    # Eight filter controls above the results would push every home below the
    # fold on the device most of the launch market arrives on.
    check('the filters collapse so results are visible',
          pg.locator('#filter-fields').is_hidden())
    check('with a way to open them',
          pg.locator('button[aria-controls="filter-fields"]').is_visible())
    pg.click('button[aria-controls="filter-fields"]')
    pg.wait_for_timeout(300)
    check('opening them works', pg.locator('#filter-fields').is_visible())
    check('and the state is announced',
          pg.get_attribute('button[aria-controls="filter-fields"]', 'aria-expanded') == 'true')
    sweep('phone, filters open')
    check('every button on screen meets the 44px touch target',
          pg.evaluate("""()=>[...document.querySelectorAll('main .lrmc-btn')]
              .filter(a => a.offsetParent !== null && !a.classList.contains('lrmc-btn-sm'))
              .every(a => a.getBoundingClientRect().height >= 44)"""))
    pg.screenshot(path='/tmp/lrmc-properties-mobile.png', full_page=False)
    pg.set_viewport_size({'width': 1280, 'height': 900}); pg.wait_for_timeout(400)
    pg.screenshot(path='/tmp/lrmc-properties.png', full_page=False)

    real = [e for e in errs
            if 'favicon' not in e.lower() and 'failed to load resource' not in e.lower()]
    check('no page errors', not real)
    if real: print('   ERRORS:', real[:4])
    b.close()

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} FAILED: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
