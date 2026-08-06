#!/usr/bin/env python3
"""LRMC — headless checks for public/login.html.

Renders the sign-in page against a stubbed LRMC auth endpoint and asserts the
behaviour that matters on a door: uniform refusals, role-aware landing, an
open-redirect-proof `?next=`, and that failures are announced rather than
silent.

Run from the frontend/ folder:  python3 verify-login.py
"""
import json, sys, re, pathlib, http.server, socketserver, threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).parent

STATE = {"mode": "ok", "roles": ["landlord"]}

def login_response():
    m = STATE["mode"]
    if m == "ok":
        return 200, {"success": True, "data": {
            "accessToken": "tok-abc", "refreshToken": "ref-abc",
            "user": {"userId": "u1", "email": "person@africalrmc.com",
                     "name": "A Person", "roles": STATE["roles"],
                     "primaryRole": STATE["roles"][0], "grants": []}}}
    if m == "bad":
        return 401, {"success": False, "error": {"code": "UNAUTHENTICATED", "message": "Invalid credentials"}}
    if m == "nouser":
        # The server must not distinguish these two, and neither must we.
        return 401, {"success": False, "error": {"code": "UNAUTHENTICATED", "message": "No account with that email"}}
    if m == "locked":
        return 423, {"success": False, "error": {"code": "LOCKED", "message": "locked"}}
    if m == "throttled":
        return 429, {"success": False, "error": {"code": "RATE_LIMITED", "message": "slow down"}}
    return 500, {"success": False, "error": {"code": "INTERNAL", "message": "boom"}}

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(s, *a): pass
    def do_POST(s):
        if s.path.split('?')[0] == '/api/v1/auth/login':
            code, body = login_response()
            return s._raw(json.dumps(body).encode(), 'application/json', code)
        s.send_response(404); s.end_headers()
    def do_GET(s):
        b = s.path.split('?')[0]
        if b.startswith('/__t/'):
            p = pathlib.Path('/tmp') / b[5:]
            if p.exists():
                return s._raw(p.read_bytes(), 'text/css' if p.suffix == '.css' else 'application/javascript')
        if b == '/page': return s._raw(pathlib.Path('/tmp/login-under-test.html').read_bytes(), 'text/html')
        if b.startswith(('/hq/', '/members/', '/staff/', '/marketplace/')):
            # Landing targets: a bare page so a redirect is observable.
            return s._raw(b'<!doctype html><title>landed</title><p>landed</p>', 'text/html')
        return super().do_GET()
    def _raw(s, body, ct, code=200):
        s.send_response(code); s.send_header('Content-Type', ct)
        s.send_header('Content-Length', str(len(body))); s.end_headers(); s.wfile.write(body)

src = (ROOT / 'public/login.html').read_text()
t = src
t = t.replace('<script src="https://cdn.tailwindcss.com"></script>',
              '<link rel="stylesheet" href="/__t/tw-subset.css" /><script src="/__t/tailwind-double.js"></script>')
t = t.replace('<script src="https://unpkg.com/htmx.org@1.9.12"></script>', '<script src="/__t/htmx-double.js"></script>')
t = t.replace('<script src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js" defer></script>', '<script src="/__t/alpine-double.js" defer></script>')
t = t.replace('<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js" defer></script>', '<script src="/__t/lucide-double.js" defer></script>')
t = re.sub(r'<link href="https://fonts\.googleapis[^>]*>', '', t)
t = re.sub(r'<link rel="preconnect"[^>]*>', '', t)
assert 'unpkg' not in t and 'cdn.tailwindcss' not in t, 'a CDN reference survived'
pathlib.Path('/tmp/login-under-test.html').write_text(t)

socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

fails = []
def check(n, c):
    print(('  ok   ' if c else '  FAIL ') + n)
    if not c: fails.append(n)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)

    def load(query=''):
        # Clear the session on a *neutral* same-origin page first. Loading the
        # login page while a token is still held triggers its own
        # already-signed-in redirect before any clearing could run — which is
        # correct behaviour, and makes it the wrong place to reset from.
        ctx.clear_cookies()
        pg.goto(f'http://127.0.0.1:{PORT}/members/index.html', wait_until='domcontentloaded')
        pg.evaluate("() => { try { sessionStorage.clear(); } catch (e) {} }")
        pg.goto(f'http://127.0.0.1:{PORT}/page{query}', wait_until='networkidle')
        pg.wait_for_timeout(400)

    def sign_in(email='person@africalrmc.com', password='correct-horse'):
        pg.fill('#email', email); pg.fill('#password', password)
        pg.click('#login-submit'); pg.wait_for_timeout(700)

    print('— structure and branding —')
    load()
    check('one h1', pg.locator('h1').count() == 1)
    check('LRMC full name present', 'Legacy Rental Management Consortium' in pg.content())
    check('logo is decorative', pg.get_attribute('main img', 'alt') == '')
    check('no navigation away from the task',
          pg.locator('nav').count() == 0)
    check('every input has a real label',
          pg.evaluate("""() => [...document.querySelectorAll('input:not([type=checkbox])')]
              .every(i => !!document.querySelector(`label[for="${i.id}"]`))"""))
    check('email field uses the username autocomplete token',
          pg.get_attribute('#email', 'autocomplete') == 'username')
    check('password field uses current-password',
          pg.get_attribute('#password', 'autocomplete') == 'current-password')
    check('the form has a real action so it works before script loads',
          pg.get_attribute('#login-form', 'action').endswith('/api/v1/auth/login'))
    check('and a real POST method', pg.get_attribute('#login-form', 'method').lower() == 'post')

    print('— refusals are uniform —')
    STATE["mode"] = "bad"; load(); sign_in()
    wrong_pw = pg.inner_text('#login-error')
    check('a wrong password is refused', not pg.locator('#login-error').is_hidden())
    STATE["mode"] = "nouser"; load(); sign_in()
    no_user = pg.inner_text('#login-error')
    # The whole point: an unknown email and a wrong password are indistinguishable.
    check('an unknown email gives the identical message', no_user == wrong_pw)
    check('and the server wording is not leaked through', 'No account' not in no_user)

    print('— other refusals say something useful —')
    STATE["mode"] = "locked"; load(); sign_in()
    check('a locked account is named as locked', 'locked' in pg.inner_text('#login-error').lower())
    STATE["mode"] = "throttled"; load(); sign_in()
    check('throttling asks them to wait', 'wait' in pg.inner_text('#login-error').lower())
    STATE["mode"] = "boom"; load(); sign_in()
    msg = pg.inner_text('#login-error').lower()
    check('a server fault does not blame the user',
          'could not sign you in' in msg and 'password' not in msg)

    print('— failure is announced and focus returns —')
    STATE["mode"] = "bad"; load(); sign_in()
    check('the error region is a live alert',
          pg.get_attribute('#login-error', 'role') == 'alert')
    check('and focus moves back to the first field',
          pg.evaluate("() => document.activeElement.id") == 'email')
    check('the button is usable again after a failure',
          not pg.is_disabled('#login-submit'))
    check('and shows its label rather than a spinner',
          pg.locator('#login-spinner').is_hidden())

    print('— role-aware landing —')
    STATE["mode"] = "ok"
    for roles, expected in [
        (['founder'], '/hq/index.html'),
        (['hqExecutive'], '/hq/index.html'),
        (['backOfficeStaff'], '/staff/index.html'),
        (['coordinator'], '/staff/index.html'),
        (['merchant'], '/marketplace/index.html'),
        (['buyer'], '/marketplace/index.html'),
        (['landlord'], '/members/index.html'),
        (['tenant'], '/members/index.html'),
        (['driver'], '/members/index.html'),
    ]:
        STATE["roles"] = roles
        load(); sign_in()
        check(f'{roles[0]} lands on {expected}', pg.url.endswith(expected))

    # Most-privileged wins, so a founder who also owns property is not dropped
    # into the member portal.
    STATE["roles"] = ['landlord', 'founder']
    load(); sign_in()
    check('a founder who is also a landlord lands in HQ', pg.url.endswith('/hq/index.html'))

    print('— the next parameter —')
    STATE["roles"] = ['landlord']
    load('?next=%2Fmembers%2Fpayments.html'); sign_in()
    check('a same-origin path is honoured', pg.url.endswith('/members/payments.html'))

    # An open redirect on a login page is how a phishing link borrows the
    # institution's domain. Each of these must be ignored, not followed.
    for hostile, why in [
        ('https%3A%2F%2Fevil.example%2Fx', 'absolute URL'),
        ('%2F%2Fevil.example%2Fx',         'protocol-relative'),
        ('%2F%5Cevil.example',             'backslash trick'),
        ('%2F%2F%2Fevil.example',          'triple slash'),
        ('javascript%3Aalert(1)',          'javascript scheme'),
    ]:
        load('?next=' + hostile); sign_in()
        check(f'a hostile next is ignored ({why})',
              pg.url.endswith('/members/index.html'))

    print('— already signed in —')
    STATE["roles"] = ['founder']
    load(); sign_in()
    check('signing in landed in HQ', pg.url.endswith('/hq/index.html'))
    # Now go *back* to the login page with the session intact — deliberately
    # not through load(), which clears it.
    pg.goto(f'http://127.0.0.1:{PORT}/page', wait_until='networkidle'); pg.wait_for_timeout(700)
    check('returning to the login page redirects rather than asking again',
          pg.url.endswith('/hq/index.html'))

    print('— responsive —')
    STATE["mode"] = "ok"; load()
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(400)
    check('no horizontal overflow at 390px',
          pg.evaluate('()=>document.documentElement.scrollWidth<=window.innerWidth+1'))
    check('the submit button meets the 44px touch target',
          pg.evaluate("()=>document.getElementById('login-submit').getBoundingClientRect().height >= 44"))
    pg.screenshot(path='/tmp/lrmc-login-mobile.png', full_page=False)
    pg.set_viewport_size({'width': 1280, 'height': 900}); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/lrmc-login.png', full_page=False)

    # "Failed to load resource: … 401" is the browser logging an HTTP status
    # this suite deliberately provoked. Filtering it keeps the check meaning
    # "no JavaScript broke" rather than "no request was ever refused" — which
    # would be a check that can never pass on a login page.
    real = [e for e in errs
            if 'favicon' not in e.lower()
            and 'failed to load resource' not in e.lower()]
    check('no page errors', not real)
    if real: print('   ERRORS:', real[:4])
    b.close()

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} FAILED: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
