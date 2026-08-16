#!/usr/bin/env python3
"""LRMC — headless checks for public/register.html.

Registration is the widest door LRMC has: thirteen kinds of member, each
asked for something different, on a form that has to be finishable on a phone
in Banjul. This drives it the way a person would — pick a role, continue, type
a password, submit — and asserts the things that would otherwise only be found
by a member who could not sign up.

The sharpest check here is the first one. The page keeps its own copy of which
roles may register and what each must declare; the API validates against
`backend/src/config/registration.ts`. This suite reads the TypeScript and
refuses to pass if the two have drifted, because that drift shows up as a form
that asks a question the API rejects — with no error anyone can act on.

Run from the frontend/ folder:  python3 verify-register.py
"""
import json, sys, re, pathlib, http.server, socketserver, threading
from playwright.sync_api import sync_playwright
from lrmc_checks import run_shared_checks

ROOT = pathlib.Path(__file__).parent
DOUBLES = ROOT / 'test-doubles'
BACKEND = ROOT.parent / 'backend'

fails = []
def check(n, c):
    print(('  ok   ' if c else '  FAIL ') + n)
    if not c: fails.append(n)

# ── the backend's own table, read from source ────────────────────────────────
cfg = (BACKEND / 'src/config/registration.ts').read_text()

block = re.search(r'SELF_REGISTERABLE_ROLES = \[(.*?)\] as const', cfg, re.S).group(1)
API_ROLES = re.findall(r"'([A-Za-z]+)'", block)

block = re.search(r'REGISTRATION_EXTRAS[^=]*= \{(.*?)\n\};', cfg, re.S).group(1)
API_EXTRAS = {}
for role, fields in re.findall(r'(\w+):\s*\[([^\]]*)\]', block):
    API_EXTRAS[role] = re.findall(r"'(\w+)'", fields)

API_PASSWORD_MIN = int(re.search(r'PASSWORD_MIN_LENGTH = (\d+)', cfg).group(1))

# ── the stub API ─────────────────────────────────────────────────────────────
STATE = {"mode": "ok", "roles": ["tenant"], "body": None}

def register_response():
    m = STATE["mode"]
    if m == "ok":
        return 201, {"success": True, "data": {
            "accessToken": "tok-new", "refreshToken": "ref-new",
            "user": {"userId": "u9", "email": "new@africalrmc.com",
                     "name": "New Member", "roles": STATE["roles"],
                     "primaryRole": STATE["roles"][0], "grants": []}}}
    if m == "duplicate":
        return 409, {"success": False, "error": {
            "code": "DUPLICATE_KEY", "message": "email already exists",
            "details": [{"field": "email", "message": "email already exists", "code": "duplicate"}]}}
    if m == "invalid":
        return 422, {"success": False, "error": {
            "code": "VALIDATION_FAILED", "message": "Request validation failed",
            "details": [
                {"field": "phone", "message": "Phone number looks wrong", "code": "custom"},
                {"field": "fullName", "message": "Name is too short", "code": "too_small"},
            ]}}
    if m == "invalid-unknown":
        return 422, {"success": False, "error": {
            "code": "VALIDATION_FAILED", "message": "Request validation failed",
            "details": [{"field": "WhatsApp", "message": "WhatsApp number looks wrong", "code": "custom"}]}}
    if m == "invalid-markup":
        return 422, {"success": False, "error": {
            "code": "VALIDATION_FAILED", "message": "Request validation failed",
            "details": [{"field": "email",
                         "message": "<img src=x onerror=\"window.__pwned=1\">bad email",
                         "code": "custom"}]}}
    if m == "throttled":
        return 429, {"success": False, "error": {"code": "RATE_LIMITED", "message": "slow down"}}
    return 500, {"success": False, "error": {"code": "INTERNAL", "message": "boom"}}

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(s, *a): pass
    def do_POST(s):
        if s.path.split('?')[0] == '/api/v1/auth/register':
            n = int(s.headers.get('Content-Length') or 0)
            try: STATE["body"] = json.loads(s.rfile.read(n) or b'{}')
            except Exception: STATE["body"] = None
            code, body = register_response()
            return s._raw(json.dumps(body).encode(), 'application/json', code)
        s.send_response(404); s.end_headers()
    def do_GET(s):
        b = s.path.split('?')[0]
        if b.startswith('/__t/'):
            p = DOUBLES / b[5:]
            if p.exists():
                return s._raw(p.read_bytes(), 'text/css' if p.suffix == '.css' else 'application/javascript')
        if b == '/page': return s._raw(pathlib.Path('/tmp/register-under-test.html').read_bytes(), 'text/html')
        if b.startswith(('/hq/', '/members/', '/staff/', '/marketplace/', '/public/login')):
            return s._raw(b'<!doctype html><title>landed</title><p>landed</p>', 'text/html')
        return super().do_GET()
    def _raw(s, body, ct, code=200):
        s.send_response(code); s.send_header('Content-Type', ct)
        s.send_header('Content-Length', str(len(body))); s.end_headers(); s.wfile.write(body)

# ── swap the CDN for the doubles ─────────────────────────────────────────────
src = (ROOT / 'public/register.html').read_text()
t = src
t = t.replace('<script src="https://cdn.tailwindcss.com"></script>',
              '<link rel="stylesheet" href="/__t/tw-subset.css" /><script src="/__t/tailwind-double.js"></script>')
t = t.replace('<script src="https://unpkg.com/htmx.org@1.9.12"></script>', '<script src="/__t/htmx-double.js"></script>')
t = t.replace('<script src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js" defer></script>', '<script src="/__t/alpine-double.js" defer></script>')
t = t.replace('<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js" defer></script>', '<script src="/__t/lucide-double.js" defer></script>')
t = re.sub(r'<link href="https://fonts\.googleapis[^>]*>', '', t)
t = re.sub(r'<link rel="preconnect"[^>]*>', '', t)
assert 'unpkg' not in t and 'cdn.tailwindcss' not in t, 'a CDN reference survived'
pathlib.Path('/tmp/register-under-test.html').write_text(t)

socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

# ── the page's own copies of the tables ──────────────────────────────────────
page_roles = re.findall(r"\{ value: '(\w+)'", src)
page_extras = {}
pe = re.search(r'var EXTRAS = \{(.*?)\n\};', src, re.S).group(1)
for role, fields in re.findall(r'(\w+):\s*\[([^\]]*)\]', pe):
    page_extras[role] = re.findall(r"'(\w+)'", fields)
page_password_min = int(re.search(r'var PASSWORD_MIN = (\d+)', src).group(1))

print('— the form and the API agree about who may register —')
check('the page offers exactly the roles the API accepts',
      sorted(page_roles) == sorted(API_ROLES))
if sorted(page_roles) != sorted(API_ROLES):
    print('   page:', sorted(page_roles), '\n   api :', sorted(API_ROLES))
check('and asks each role for exactly what the API requires',
      {k: sorted(v) for k, v in page_extras.items()} == {k: sorted(v) for k, v in API_EXTRAS.items()})
if page_extras != API_EXTRAS:
    print('   page:', page_extras, '\n   api :', API_EXTRAS)
check('and states the same password floor', page_password_min == API_PASSWORD_MIN)
# Every extra the page can ask for must have somewhere to show its error.
check('every extra field has an error slot on the page',
      all(('data-error-for="%s"' % f) in src
          for fields in page_extras.values() for f in fields))

print('— rules that apply to every LRMC page —')
run_shared_checks(ROOT, check)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)

    def load():
        # Clear on a neutral page: loading the register page with a session
        # held triggers its own redirect before any clearing could run.
        ctx.clear_cookies()
        pg.goto(f'http://127.0.0.1:{PORT}/members/index.html', wait_until='domcontentloaded')
        pg.evaluate("() => { try { sessionStorage.clear(); } catch (e) {} }")
        pg.goto(f'http://127.0.0.1:{PORT}/page', wait_until='networkidle')
        pg.wait_for_timeout(350)

    def choose(role):
        pg.check(f'input[name="role"][value="{role}"]')
        pg.wait_for_timeout(120)

    def fill_step_two(**extra):
        pg.fill('#fullName', extra.pop('fullName', 'Awa Ceesay'))
        pg.fill('#email', extra.pop('email', 'awa@africalrmc.com'))
        pg.fill('#phone', extra.pop('phone', '+220 700 0000'))
        pg.fill('#password', extra.pop('password', 'Banjul2026x'))
        for k, v in extra.items():
            if pg.locator('#' + k).evaluate('el => el.tagName') == 'SELECT':
                pg.select_option('#' + k, v)
            else:
                pg.fill('#' + k, v)
        pg.check('#terms')

    def submit():
        pg.click('#register-submit')
        pg.wait_for_timeout(600)

    print('\n— structure and branding —')
    load()
    check('exactly one heading is on screen at a time', pg.locator('h1:visible').count() == 1)
    check('LRMC full name reaches assistive technology',
          pg.locator('.lrmc-sr-only').count() >= 1)
    check('the logo is decorative', pg.get_attribute('main img', 'alt') == '')
    check('and the artwork actually loads',
          pg.evaluate("() => document.querySelector('main img').naturalWidth > 0"))
    check('no navigation away from the task', pg.locator('nav').count() == 0)
    check('the form has a real action so it works before script loads',
          (pg.get_attribute('#register-form', 'action') or '').endswith('/api/v1/auth/register'))
    check('and a real POST method',
          (pg.get_attribute('#register-form', 'method') or '').lower() == 'post')
    check('every field has a label — explicit or wrapping',
          pg.evaluate("""() => [...document.querySelectorAll('input, select')].every(i =>
              (i.id && document.querySelector(`label[for="${i.id}"]`)) || i.closest('label'))"""))
    check('email uses the email autocomplete token',
          pg.get_attribute('#email', 'autocomplete') == 'email')
    check('password asks for a new one, not the saved one',
          pg.get_attribute('#password', 'autocomplete') == 'new-password')
    check('the terms box must be ticked', pg.get_attribute('#terms', 'required') is not None)

    print('\n— step one: who you are —')
    check('every registerable role is offered as a card',
          pg.locator('input[name="role"]').count() == len(API_ROLES))
    check('each card explains what it is for',
          pg.evaluate("""() => [...document.querySelectorAll('input[name=role]')]
              .every(i => i.closest('label').innerText.trim().split('\\n').length >= 2)"""))
    check('continue is refused until a role is chosen', pg.is_disabled('button:has-text("Continue")'))
    check('the details step is not shown yet', pg.locator('#register-form').is_hidden())
    choose('driver')
    check('continue opens once a role is chosen', not pg.is_disabled('button:has-text("Continue")'))
    pg.click('button:has-text("Continue")')
    pg.wait_for_timeout(300)
    check('the details step replaces the role step', pg.locator('#register-form').is_visible())
    check('and the role step is gone', pg.locator('h1:visible').count() == 1)
    check('focus follows into the new step',
          pg.evaluate("() => document.activeElement.id") == 'fullName')
    check('the chosen role is named back to them',
          'Ususu driver' in pg.inner_text('#register-form'))
    check('the progress list marks the step they are on',
          pg.evaluate("""() => {
              const li = [...document.querySelectorAll('ol li')];
              return li.filter(e => e.getAttribute('aria-current') === 'step').length === 1;
          }"""))

    print('\n— going back keeps the answer —')
    pg.click('button:has-text("Change")')
    pg.wait_for_timeout(250)
    check('change returns to the role step', pg.locator('#register-form').is_hidden())
    check('and the earlier choice is still selected',
          pg.is_checked('input[name="role"][value="driver"]'))

    print('\n— each role is asked only what it must declare —')
    ALL_EXTRAS = sorted({f for v in API_EXTRAS.values() for f in v})
    for role in API_ROLES:
        load(); choose(role)
        pg.click('button:has-text("Continue")')
        pg.wait_for_timeout(250)
        wanted = set(API_EXTRAS.get(role, []))
        shown = {f for f in ALL_EXTRAS if pg.locator('#' + f).is_visible()}
        required = {f for f in ALL_EXTRAS
                    if pg.locator('#' + f).is_visible()
                    and pg.get_attribute('#' + f, 'required') is not None}
        check(f'{role} is asked for {sorted(wanted) or "nothing extra"}', shown == wanted)
        check(f'{role}: and every extra shown is required', required == wanted)

    print('\n— the same field, asked the way each role would understand it —')
    load(); choose('merchant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    check('a merchant is asked for a business name',
          pg.inner_text('label[for="businessName"]') == 'Business name')
    load(); choose('customer'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    check('a marketplace customer is asked for an account name instead',
          pg.inner_text('label[for="businessName"]') == 'Account name')
    check('and told their own name will do',
          'own name is fine' in pg.inner_text('#register-form'))
    load(); choose('advertiser'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    check('an advertiser is not offered the household hint',
          'own name is fine' not in pg.inner_text('#register-form'))

    print('\n— the merchant is told they arrive unverified —')
    load(); choose('merchant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    check('a merchant is told listings wait on verification',
          'verifies your business' in pg.inner_text('#register-form'))
    load(); choose('tenant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    check('a tenant is not shown a notice that is not theirs',
          'verifies your business' not in pg.inner_text('#register-form'))

    print('\n— the password rule is stated, not discovered —')
    load(); choose('tenant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)

    def met_rules():
        return pg.evaluate("""() => [...document.querySelectorAll('ul[aria-live] li')]
            .filter(li => li.className.includes('emerald')).map(li => li.innerText.trim())""")

    check('all four rules are visible before typing',
          pg.locator('ul[aria-live] li').count() == 4)
    check('and none is claimed as met', met_rules() == [])
    pg.fill('#password', 'banjul')
    pg.wait_for_timeout(200)
    check('a small letter alone satisfies exactly one rule', met_rules() == ['A small letter'])
    pg.fill('#password', 'Banjul2026x')
    pg.wait_for_timeout(200)
    check('a compliant password satisfies all four', len(met_rules()) == 4)
    check('the field states the same minimum the server enforces',
          int(pg.get_attribute('#password', 'minlength')) == API_PASSWORD_MIN)

    print('\n— the reveal toggle —')
    check('the password starts hidden', pg.get_attribute('#password', 'type') == 'password')
    pg.click('button[aria-label]')
    pg.wait_for_timeout(200)
    check('and can be revealed to check a typo', pg.get_attribute('#password', 'type') == 'text')
    check('the toggle says what it will do next',
          pg.get_attribute('button[aria-label]', 'aria-label') == 'Hide password')

    print('\n— what actually reaches the API —')
    STATE["mode"] = "ok"; STATE["roles"] = ["tenant"]
    load(); choose('tenant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    fill_step_two(); submit()
    body = STATE["body"] or {}
    check('the role is always sent', body.get('role') == 'tenant')
    check('the answers are sent as typed', body.get('email') == 'awa@africalrmc.com')
    # The register schema is `.strict()`: a field this role never saw would be
    # rejected outright, so an empty string is worse than an absent key.
    check('a tenant sends no fields they were never asked for',
          not ({'businessName', 'vehicleType', 'serviceType', 'businessType'} & set(body)))
    check('and no empty values at all', all(v != '' for v in body.values()))

    STATE["roles"] = ["driver"]
    load(); choose('driver'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    fill_step_two(vehicleType='Minibus'); submit()
    body = STATE["body"] or {}
    check('a driver declares a vehicle', body.get('vehicleType') == 'Minibus')

    STATE["roles"] = ["advertiser"]
    load(); choose('advertiser'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    fill_step_two(businessName='Kairaba Media', businessType='Agency'); submit()
    body = STATE["body"] or {}
    check('an advertiser declares both of its extras',
          body.get('businessName') == 'Kairaba Media' and body.get('businessType') == 'Agency')

    # Changing your mind must not smuggle the abandoned answer through.
    STATE["roles"] = ["tenant"]
    load(); choose('driver'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    pg.select_option('#vehicleType', 'Minibus')
    pg.click('button:has-text("Change")'); pg.wait_for_timeout(200)
    choose('tenant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    fill_step_two(); submit()
    body = STATE["body"] or {}
    check('changing role drops the answer the old role needed',
          'vehicleType' not in body)

    print('\n— region is optional and offered —')
    load(); choose('tenant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    check('the launch market regions are offered',
          pg.locator('#region option').count() >= 8
          and 'Banjul' in pg.inner_text('#region'))
    check('region is not compulsory', pg.get_attribute('#region', 'required') is None)
    fill_step_two(); submit()
    check('an unanswered region is left out rather than sent empty',
          'region' not in (STATE["body"] or {}))
    load(); choose('tenant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    fill_step_two(region='Kanifing'); submit()
    check('an answered region is sent', (STATE["body"] or {}).get('region') == 'Kanifing')

    print('\n— the form refuses to post an incomplete answer —')
    STATE["body"] = None
    load(); choose('tenant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    pg.fill('#fullName', 'Awa Ceesay'); pg.fill('#email', 'awa@africalrmc.com')
    pg.fill('#phone', '+220 700 0000'); pg.fill('#password', 'Banjul2026x')
    submit()  # terms deliberately unticked
    check('without agreeing to the terms nothing is sent', STATE["body"] is None)

    print('\n— errors land on the field that is wrong —')
    STATE["mode"] = "invalid"
    load(); choose('tenant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    fill_step_two(); submit()
    check('the phone error is beside the phone field',
          pg.inner_text('[data-error-for="phone"]') == 'Phone number looks wrong')
    check('the name error is beside the name field',
          pg.inner_text('[data-error-for="fullName"]') == 'Name is too short')
    check('both fields are marked invalid for assistive technology',
          pg.get_attribute('#phone', 'aria-invalid') == 'true'
          and pg.get_attribute('#fullName', 'aria-invalid') == 'true')
    check('focus lands on the first field in error',
          pg.evaluate("() => document.activeElement.id") == 'phone')
    check('the button is usable again', not pg.is_disabled('#register-submit'))
    check('and shows its label rather than a spinner',
          pg.locator('#register-spinner').is_hidden())
    # A second attempt must not accumulate stale messages.
    STATE["mode"] = "throttled"; submit()
    check('a later failure clears the earlier field errors',
          pg.locator('[data-error-for="phone"]').is_hidden())

    print('\n— an error with nowhere to go is still shown —')
    STATE["mode"] = "invalid-unknown"
    load(); choose('tenant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    fill_step_two(); submit()
    check('an error for a field not on the form falls back to the banner',
          'WhatsApp number looks wrong' in pg.inner_text('#register-error'))

    print('\n— a server message cannot become markup —')
    STATE["mode"] = "invalid-markup"
    load(); choose('tenant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    fill_step_two(); submit()
    check('markup in an API message is shown as text, not run',
          pg.evaluate("() => window.__pwned") is None
          and pg.locator('[data-error-for="email"] img').count() == 0)
    check('and the message itself still reaches the person',
          'bad email' in pg.inner_text('[data-error-for="email"]'))

    print('\n— the other refusals —')
    for mode, wanted, unwanted in [
        ('duplicate', 'already registered', None),
        ('throttled', 'wait', None),
        ('boom', 'could not create your account', 'password'),
    ]:
        STATE["mode"] = mode
        load(); choose('tenant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
        fill_step_two(); submit()
        msg = pg.inner_text('#register-error').lower()
        check(f'{mode}: says {wanted!r}', wanted in msg)
        if unwanted:
            check(f'{mode}: does not blame the person', unwanted not in msg)
    check('the banner is a live alert',
          pg.get_attribute('#register-error', 'role') == 'alert')
    # Unlike sign-in, registration must say the address is taken — somebody
    # who cannot be told cannot resolve it — and must route them onward.
    STATE["mode"] = "duplicate"
    load(); choose('tenant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
    fill_step_two(); submit()
    check('a taken address points them at signing in',
          'sign in' in pg.inner_text('#register-error').lower())
    check('and a route to sign-in is on the page',
          pg.locator('a[href="/public/login.html"]').count() == 1)

    print('\n— a successful registration is a real session —')
    for role, expected in [
        ('tenant',   '/members/index.html'),
        ('landlord', '/members/index.html'),
        ('driver',   '/members/index.html'),
        ('merchant', '/marketplace/index.html'),
        ('customer', '/marketplace/index.html'),
    ]:
        STATE["mode"] = "ok"; STATE["roles"] = [role]
        load(); choose(role); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(250)
        extras = {f: ('Minibus' if f == 'vehicleType' else 'Kairaba Trading')
                  for f in API_EXTRAS.get(role, [])}
        fill_step_two(**extras); submit()
        check(f'a new {role} lands on {expected}', pg.url.endswith(expected))

    check('the session was kept, so they are not asked to sign in again',
          pg.evaluate("() => sessionStorage.getItem('lrmc.token')") == 'tok-new')
    check('and the actor was kept with it',
          'customer' in (pg.evaluate("() => sessionStorage.getItem('lrmc.actor')") or ''))

    print('\n— already signed in —')
    # The session from the run above is still held; going back must not offer
    # a registration form to somebody who already has an account.
    pg.goto(f'http://127.0.0.1:{PORT}/page', wait_until='networkidle')
    pg.wait_for_timeout(500)
    check('returning to the form sends them to their portal',
          pg.url.endswith('/marketplace/index.html'))

    print('\n— on a phone —')
    STATE["mode"] = "ok"
    load()
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(350)
    check('no horizontal overflow at 390px on the role step',
          pg.evaluate('()=>document.documentElement.scrollWidth<=window.innerWidth+1'))
    # Thirteen cards is a tall list. They scroll *inside* the card, so the
    # Continue button stays on screen — otherwise somebody on a small phone
    # picks a role and sees no way forward.
    check('the role list scrolls inside the card rather than down the page',
          pg.evaluate("""() => {
              const box = document.querySelector('input[name=role]').closest('div');
              return getComputedStyle(box).overflowY === 'auto'
                  && box.scrollHeight > box.clientHeight;
          }"""))
    check('so Continue is on screen without scrolling',
          pg.evaluate("""() => {
              const b = [...document.querySelectorAll('button')]
                  .find(x => x.textContent.trim() === 'Continue');
              const r = b.getBoundingClientRect();
              return r.bottom > 0 && r.bottom <= window.innerHeight;
          }"""))
    pg.screenshot(path='/tmp/lrmc-register-mobile-step1.png', full_page=False)
    choose('driver'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(300)
    check('no horizontal overflow at 390px on the details step',
          pg.evaluate('()=>document.documentElement.scrollWidth<=window.innerWidth+1'))
    check('the submit button meets the 44px touch target',
          pg.evaluate("()=>document.getElementById('register-submit').getBoundingClientRect().height >= 44"))
    # A centred flex container whose content is taller than the screen puts the
    # top of that content *above* scroll position zero, where no amount of
    # scrolling reaches it. On a long form that means the logo and the step
    # indicator simply cannot be seen — and it only shows up on small screens,
    # which is where most of The Gambia will meet this page.
    check('the top of the form can be scrolled to',
          pg.evaluate("""() => {
              window.scrollTo(0, 0);
              return document.querySelector('main img').getBoundingClientRect().top >= -1;
          }"""))
    pg.screenshot(path='/tmp/lrmc-register-mobile-step2.png', full_page=False)
    pg.set_viewport_size({'width': 1280, 'height': 900}); pg.wait_for_timeout(300)
    load()
    pg.screenshot(path='/tmp/lrmc-register-step1.png', full_page=False)
    choose('merchant'); pg.click('button:has-text("Continue")'); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/lrmc-register-step2.png', full_page=False)

    # HTTP statuses this suite deliberately provoked are logged by the browser
    # as "failed to load resource"; filtering them keeps this check meaning
    # "no JavaScript broke".
    real = [e for e in errs
            if 'favicon' not in e.lower()
            and 'failed to load resource' not in e.lower()]
    check('no page errors', not real)
    if real: print('   ERRORS:', real[:4])
    b.close()

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} FAILED: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
