import json, sys, http.server, socketserver, threading, pathlib
from playwright.sync_api import sync_playwright

ROOT='/home/claude/lrmconsortium/frontend'
FIX=json.loads(pathlib.Path('/tmp/fixtures.json').read_text())

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s,*a,**k): super().__init__(*a,directory=ROOT,**k)
    def log_message(s,*a): pass
    def do_GET(s):
        b=s.path.split('?')[0]
        if b in FIX: return s._raw(json.dumps(FIX[b]).encode(),'application/json')
        if b.startswith('/__t/'):
            p=pathlib.Path('/tmp')/b[5:]
            if p.exists():
                ct='text/css' if p.suffix=='.css' else 'application/javascript'
                return s._raw(p.read_bytes(),ct)
        if b=='/page': return s._raw(pathlib.Path('/tmp/hq-under-test.html').read_bytes(),'text/html')
        return super().do_GET()
    def _raw(s,body,ct):
        s.send_response(200); s.send_header('Content-Type',ct)
        s.send_header('Content-Length',str(len(body))); s.end_headers(); s.wfile.write(body)

srv=socketserver.TCPServer(('127.0.0.1',8985),H); srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever,daemon=True).start()

fails=[]
def check(n,c):
    print(('  ok   ' if c else '  FAIL ')+n)
    if not c: fails.append(n)

with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':1000})
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto('http://127.0.0.1:8985/page',wait_until='networkidle'); pg.wait_for_timeout(1200)

    print('— headline tiles —')
    check('four tiles',pg.locator('#hq-headline .lrmc-stat').count()==4)
    head=pg.inner_text('#hq-headline')
    check('Ghana Cedi formatting','GH₵' in head or '₵' in head)
    check('compact form for headline figures',any(x in head for x in ['1.3M','1.28M','1.2M']))
    check('no skeleton left',pg.locator('#hq-headline .lrmc-skeleton').count()==0)
    check('trend shows arrow + word','▲' in head and 'vs last month' in head)
    check('counts rendered','342' in head)

    print('— chart —')
    check('svg rendered',pg.locator('#hq-collections svg').count()==1)
    check('twelve bars',pg.locator('#hq-collections svg rect').count()==12)
    check('every bar has a hover title',pg.locator('#hq-collections svg title').count()==12)
    check('aria-label present',bool(pg.get_attribute('#hq-collections svg','aria-label')))
    texts=[t or '' for t in pg.locator('#hq-collections svg text').all_text_contents()]
    money=[t for t in texts if 'GH' in t or '₵' in t]
    check('axis ticks + exactly one bar figure (4 money labels)',len(money)==4)
    check('month labels present',sum(1 for t in texts if t.strip() in
        ['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul'])==12)
    check('table view has twelve rows',pg.locator('#hq-collections-table tbody tr').count()==12)
    check('table has a screen-reader caption',pg.locator('#hq-collections-table caption').count()==1)
    fills=pg.eval_on_selector_all('#hq-collections svg rect',
        'els=>[...new Set(els.map(e=>e.getAttribute("fill")))]')
    check('single-hue chart, no categorical palette',len(fills)<=2)
    check('bars anchored to the baseline',pg.evaluate("""() => {
        const rs=[...document.querySelectorAll('#hq-collections svg rect')];
        const bases=rs.map(r=>+r.getAttribute('y')+ +r.getAttribute('height'));
        return Math.max(...bases)-Math.min(...bases) < 1; }"""))

    print('— governance —')
    g=pg.inner_text('#hq-governance')
    check('score rendered','82' in g)
    # The badge is uppercased by CSS, so compare case-insensitively — the
    # point of the check is that a *word* accompanies the colour, not its case.
    check('status carries a word, not colour alone',
          any(w in g.lower() for w in ['healthy','attention','action']))
    check('weakest component named','document verification' in g)
    check('four component meters',pg.locator('#hq-governance [style*="width"]').count()==4)

    print('— activity & health —')
    check('three activity rows',pg.locator('#hq-activity > div').count()==3)
    check('relative time rendered','ago' in pg.inner_text('#hq-activity'))
    check('four health rows',pg.locator('#hq-health > div').count()==4)
    check('health badges carry status words','active' in pg.inner_text('#hq-health').lower())

    pg.screenshot(path='/tmp/lrmc-hq-desktop.png', full_page=False)
    pg.set_viewport_size({'width':390,'height':900}); pg.wait_for_timeout(400)
    pg.screenshot(path='/tmp/lrmc-hq-mobile.png', full_page=False)
    pg.set_viewport_size({'width':1440,'height':1000}); pg.wait_for_timeout(300)

    print('— failure and empty states —')
    pg.evaluate("""() => { const t=document.getElementById('hq-activity');
        const d={xhr:{status:500,responseText:'boom'},target:t,serverResponse:'boom'};
        document.body.dispatchEvent(new CustomEvent('htmx:beforeSwap',{detail:d,bubbles:true}));
        t.innerHTML=d.serverResponse; }""")
    check('a failed panel says so in place',"Could not load" in pg.inner_text('#hq-activity'))
    check('empty chart states it','No collection history' in pg.evaluate("()=>renderCollections({rentByMonth:[]})"))
    check('empty activity states it','No recent activity' in pg.evaluate("()=>renderActivity([])"))
    check('empty health states it','No health data' in pg.evaluate("()=>renderHealth({checks:[]})"))
    check('missing numbers render as an em dash, not NaN',
          pg.evaluate("()=>renderHeadline({})").count('—')>=4)

    print('— escaping —')
    xss=pg.evaluate("()=>renderActivity([{summary:'<img src=x onerror=alert(1)>',actorLabel:'a'}])")
    check('user content is escaped','<img' not in xss and '&lt;img' in xss)

    print('— accessibility —')
    check('one h1 only',pg.locator('h1').count()==1)
    check('every section is labelled',pg.evaluate("""() => [...document.querySelectorAll('main section')]
        .every(s=>s.getAttribute('aria-labelledby'))"""))
    check('skip link is first focusable',pg.evaluate("""() => {
        const a=document.querySelector('a,button'); return a && a.classList.contains('lrmc-skip-link'); }"""))
    check('logo img has empty alt where decorative',pg.evaluate("""() => {
        const i=document.querySelector('aside img'); return i && i.getAttribute('alt')===''; }"""))

    print('— responsive —')
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(600)
    # The bug this catches: sidebarOpen decided once at load leaves a 260px
    # drawer on top of the content after a rotation, with the backdrop eating
    # every tap.
    check('sidebar retracts when the viewport narrows',
          '-translate-x-full' in (pg.get_attribute('#lrmc-sidebar','class') or ''))
    check('menu button is reachable', pg.locator('button[aria-label="Toggle navigation"]').is_visible())
    pg.click('button[aria-label="Toggle navigation"]'); pg.wait_for_timeout(300)
    check('and opens the drawer',
          'translate-x-0' in (pg.get_attribute('#lrmc-sidebar','class') or ''))
    pg.set_viewport_size({'width':1440,'height':1000}); pg.wait_for_timeout(600)
    check('sidebar returns when the viewport widens',
          'translate-x-0' in (pg.get_attribute('#lrmc-sidebar','class') or ''))
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(600)
    check('no horizontal overflow at 390px',
          pg.evaluate('()=>document.documentElement.scrollWidth<=window.innerWidth+1'))
    pg.set_viewport_size({'width':1440,'height':1000}); pg.wait_for_timeout(300)
    pg.screenshot(path='/tmp/hq-index.png',full_page=True)

    real=[e for e in errs if 'favicon' not in e.lower()]
    check('no page errors',not real)
    if real: print('   ERRORS:',real[:4])
    b.close()
print('\n'+('ALL CHECKS PASSED' if not fails else f'{len(fails)} FAILED: '+', '.join(fails)))
sys.exit(1 if fails else 0)
