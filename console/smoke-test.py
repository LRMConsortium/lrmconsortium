from playwright.sync_api import sync_playwright
import pathlib, sys

url = 'file://' + str(pathlib.Path('governance-console.html').resolve())
fails = []
def check(name, cond):
    print(('  ok  ' if cond else '  FAIL') + ' ' + name)
    if not cond: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    errs = []
    # The sandbox has no network, so the Tailwind/Lucide CDNs fail to load and
    # `tailwind is not defined` fires. That is an environment fact, not a defect;
    # everything else must still be clean.
    NOISE = ('tailwind is not defined', 'Failed to load resource', 'lucide')
    def note(text):
        if not any(n in text for n in NOISE):
            errs.append(text)
    pg.on('pageerror', lambda e: note(str(e)))
    pg.on('console', lambda m: note(m.text) if m.type == 'error' else None)
    pg.goto(url); pg.wait_for_timeout(1200)

    print('\n— boot —')
    check('no page errors', not errs)
    check('dashboard is active', pg.is_visible('#screen-dashboard'))
    check('role chip reads FOUNDER', pg.inner_text('#chip-role-label').strip() == 'FOUNDER')
    check('seal is withheld before clearance', 'withheld' in pg.inner_text('#seal-caption').lower())
    check('offline mode is labelled', 'fixture' in pg.inner_text('#mode-label').lower())

    print('\n— nav gating as founder —')
    for s in ['governance','fac','staff','hq','audit']:
        check(f'{s} nav enabled', not pg.is_disabled(f'[data-screen="{s}"]'))

    print('\n— governance tiers —')
    pg.click('[data-screen="governance"]'); pg.wait_for_timeout(300)
    check('all four tiers render', pg.locator('#tier-stack .tier-card').count() == 4)
    check('subtitle says all visible', 'all 4 tiers' in pg.inner_text('#gov-subtitle'))

    print('\n— FAC: wrong code three times —')
    pg.click('[data-screen="fac"]'); pg.wait_for_timeout(300)
    check('attempts start at 3/3', pg.inner_text('#fac-attempts').strip() == '3/3')
    def enter(code):
        pg.wait_for_selector('.fac-digit[data-index="0"]:not([disabled])', timeout=5000)
        for i, d in enumerate(code):
            pg.fill(f'.fac-digit[data-index="{i}"]', d)
        pg.wait_for_timeout(900)
    enter('111111'); check('after 1 wrong: 2/3', pg.inner_text('#fac-attempts').strip() == '2/3')
    enter('222222'); check('after 2 wrong: 1/3', pg.inner_text('#fac-attempts').strip() == '1/3')
    enter('333333'); pg.wait_for_timeout(600)
    check('third failure opens the lockout modal', pg.is_visible('#lockout-modal'))
    timer = pg.inner_text('#lockout-timer')
    check(f'countdown is a real clock, not a fixed string ({timer})', timer.startswith('23:5'))
    check('inputs are disabled while locked', pg.is_disabled('.fac-digit[data-index="0"]'))
    check('submit is disabled', pg.is_disabled('#fac-submit'))
    pg.click('#lockout-dismiss'); pg.wait_for_timeout(200)

    print('\n— the lockout is per account, not per code —')
    pg.click('[data-lens="hqExecutive"]'); pg.wait_for_timeout(700)
    check('HQ lens is not locked out', not pg.is_disabled('.fac-digit[data-index="0"]'))
    check('and has a full allowance', pg.inner_text('#fac-attempts').strip() == '3/3')

    print('\n— HQ tier gating —')
    check('audit nav disabled for HQ', pg.is_disabled('[data-screen="audit"]'))
    check('hq nav still enabled', not pg.is_disabled('[data-screen="hq"]'))
    pg.click('[data-screen="governance"]'); pg.wait_for_timeout(300)
    check('one tier withheld from HQ', 'withheld' in pg.inner_text('#gov-subtitle'))
    check('and it renders as a locked card', pg.locator('#tier-stack .locked-overlay').count() == 1)

    print('\n— correct code grants clearance —')
    pg.click('[data-screen="fac"]'); pg.wait_for_timeout(300)
    enter('418293'); pg.wait_for_timeout(900)
    check('clearance chip appears', pg.is_visible('#clearance-chip'))
    cd = pg.inner_text('#clearance-countdown')
    check(f'clearance counts down from ~30 min ({cd})', cd.startswith('29:') or cd.startswith('30:'))
    check('HQ is seal-ineligible even with clearance', 'restricted' in pg.inner_text('#seal-caption').lower())

    print('\n— seal needs founder tier AND clearance —')
    pg.click('[data-lens="founder"]'); pg.wait_for_timeout(700)
    check('founder still locked out from earlier', pg.is_disabled('#fac-submit'))
    check('and seal is still withheld', 'withheld' in pg.inner_text('#seal-caption').lower())

    print('\n— member lens —')
    pg.click('[data-lens="tenant"]'); pg.wait_for_timeout(700)
    for s in ['fac','staff','hq','audit','governance']:
        check(f'{s} nav disabled for member', pg.is_disabled(f'[data-screen="{s}"]'))
    check('member portal still reachable', not pg.is_disabled('[data-screen="members"]'))
    pg.click('[data-screen="members"]'); pg.wait_for_timeout(400)
    check('member documents render', pg.locator('#member-documents > div').count() >= 1)

    print('\n— staff lens —')
    pg.click('[data-lens="backOfficeStaff"]'); pg.wait_for_timeout(700)
    pg.click('[data-screen="staff"]'); pg.wait_for_timeout(500)
    check('document queue renders', pg.locator('#staff-queue > div').count() >= 1)
    check('maintenance SLA renders', pg.locator('#staff-maintenance > div').count() >= 1)
    check('fac still gated for staff', pg.is_disabled('[data-screen="fac"]'))

    print('\n— the lockout override —')
    # The founder was locked out earlier in this run, which is exactly the
    # state the override exists for. Drive it through the fixture the same way
    # a second founder would through the SDK.
    pg.click('[data-lens="founder"]'); pg.wait_for_timeout(500)
    locked_before = pg.evaluate("() => api.fac.lockouts().then(r => r.count)")
    check('a lockout is visible to a founder', locked_before >= 1)

    self_clear = pg.evaluate("""() => api.fac.lockoutClear('founder', {reason: 'trying to free myself'})
        .then(() => 'allowed').catch(e => e.code)""")
    check('a founder cannot clear their own lockout', self_clear == 'BAD_REQUEST')

    cleared = pg.evaluate("""() => api.fac.lockoutClear('hqExecutive', {reason: 'mistyped on a bad line from Kumasi'})
        .then(r => r.cleared).catch(() => 'threw')""")
    check('clearing somebody else is refused when they are not locked', cleared is False)

    pg.click('[data-screen="audit"]'); pg.wait_for_timeout(500)
    check('the ledger offers a cleared filter', pg.locator('[data-filter="cleared"]').count() == 1)
    pg.click('[data-filter="cleared"]'); pg.wait_for_timeout(300)
    check('and filtering by it does not error', 'No entries' in pg.inner_text('#audit-body') or pg.locator('#audit-body tr').count() >= 1)

    check('no page errors overall', not errs)
    if errs: print('\nERRORS:', errs[:5])
    b.close()

print('\n' + ('ALL SMOKE CHECKS PASSED' if not fails else f'{len(fails)} FAILED: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
