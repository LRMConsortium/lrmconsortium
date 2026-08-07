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
