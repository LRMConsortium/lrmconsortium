"""LRMC — static checks that apply to every page, not just one.

Imported by each `verify-*.py`. A rule that has to be remembered on forty
pages is a rule that will be forgotten on the thirty-first; these run against
the whole tree from every suite, so a page added next month is covered by
checks written today.
"""
import re
import pathlib

# A Tailwind display utility and an LRMC component class have the same CSS
# specificity (0,1,0), so **load order decides** — and `utilities.css` is
# loaded after Tailwind on every LRMC page. That means `.lrmc-btn`'s
# `display: inline-flex` beats `md:hidden`, silently, and the element stays on
# screen at every width.
#
# It shipped eight times before anything caught it: on the public header the
# phone menu button showed on desktop, and on every dashboard the sidebar
# toggle did the same.
#
# The rule: never put a display utility on an element carrying an `lrmc-*`
# component class. Wrap it in a plain element and put the utility there.
DISPLAY_UTILITY = re.compile(
    r'^(?:(?:sm|md|lg|xl|2xl):)?'
    r'(?:hidden|block|inline|inline-block|flex|inline-flex|grid|table|table-cell|contents)$'
)

COMPONENT_CLASS = re.compile(
    r'^lrmc-(btn|card|input|select|textarea|table|badge|nav-item|menu-item|stat|toast|skeleton)'
)

SKIP_DIRS = {'test-doubles', 'node_modules'}


def display_utility_clashes(root: pathlib.Path):
    """Every element that puts a display utility on an LRMC component class."""
    found = []
    for path in sorted(root.rglob('*.html')):
        if SKIP_DIRS & set(path.parts):
            continue
        for match in re.finditer(r'\sclass="([^"]*)"', path.read_text()):
            classes = match.group(1).split()
            component = [c for c in classes if COMPONENT_CLASS.match(c)]
            display = [c for c in classes if DISPLAY_UTILITY.match(c)]
            if component and display:
                found.append((str(path.relative_to(root)), component, display))
    return found


def run_shared_checks(root: pathlib.Path, check):
    """Call from any verifier: `run_shared_checks(ROOT, check)`."""
    clashes = display_utility_clashes(root)
    check('no page puts a display utility on an LRMC component class', not clashes)
    for path, component, display in clashes[:8]:
        print(f'        {path}: {" ".join(display)} on {" ".join(component)}')


# ─────────────────────────────────────────────────────────────────────────────
# Dead links, as tracked debt rather than silence
#
# A link to a page that does not exist yet is normal in a half-built site. A
# link to a page nobody ever intends to build is a typo, and the two look
# identical until somebody clicks. Declaring the pending set separates them:
# a link to something on this list is debt with a name, and a link to anything
# else fails the suite.
#
# The list may only ever shrink. Adding to it should feel like a decision.
# ─────────────────────────────────────────────────────────────────────────────
PLANNED_PAGES = {
    '/public/article.html',
    '/public/reset.html',
    '/members/profile.html',
    '/marketplace/orders.html',
    '/marketplace/products.html',
    '/marketplace/services.html',
    '/marketplace/vendors.html',
    '/marketplace/checkout.html',
    '/hq/analytics.html',
    '/hq/finance.html',
    '/hq/governance.html',
    '/hq/members.html',
    '/hq/operations.html',
    '/hq/settings.html',
    '/hq/staff.html',
}


def _pages(root: pathlib.Path):
    out = set()
    for path in root.rglob('*.html'):
        if SKIP_DIRS & set(path.parts):
            continue
        out.add('/' + str(path.relative_to(root)))
    return out


def link_report(root: pathlib.Path):
    """(unknown, still_pending) — links to nothing planned, and planned pages
    still unbuilt."""
    have = _pages(root)
    linked = {}
    for path in sorted(root.rglob('*.html')):
        if SKIP_DIRS & set(path.parts) or 'layouts' in path.parts or 'components' in path.parts:
            continue
        for href in re.findall(r'href="(/[^"#?]+\.html)', path.read_text()):
            linked.setdefault(href, set()).add(str(path.relative_to(root)))

    unknown = {k: v for k, v in linked.items() if k not in have and k not in PLANNED_PAGES}
    pending = sorted(p for p in PLANNED_PAGES if p not in have)
    return unknown, pending


def check_links(root: pathlib.Path, check):
    unknown, pending = link_report(root)
    check('every internal link goes somewhere built or somewhere planned', not unknown)
    for href, where in sorted(unknown.items())[:8]:
        print(f'        {href} <- {", ".join(sorted(where))}')
    # Not a failure. A number that should go down, printed so it cannot be
    # forgotten about.
    print(f'        ({len(pending)} planned pages still to build)')
    # A page on the list that now exists should be taken off it.
    stale = sorted(p for p in PLANNED_PAGES if p in _pages(root))
    check('nothing on the planned list has quietly been built already', not stale)
    for p in stale:
        print(f'        {p} exists — remove it from PLANNED_PAGES')
