# LRMC Frontend

The **Legacy Rental Management Consortium** interface. Static HTML, Tailwind,
HTMX, Alpine. No React, no bundler, no build step — open a file in a browser
and it runs.

## What is here

```
assets/css/theme.css       Every colour, radius and font. Change the brand here.
assets/css/utilities.css   Buttons, cards, tables, forms, badges.
assets/js/sdk.js           The only file that calls the LRMC API.
assets/js/auth.js          Session, permissions, HTMX auth wiring.
assets/js/ui.js            Formatting, toasts, shared Alpine components.

layouts/base.html          Script and stylesheet order. Start here.
layouts/dashboard.html     Sidebar + topbar + <main>. All signed-in pages.
layouts/public.html        Marketing pages.
layouts/auth.html          Sign in, register.

components/                Copy-paste blocks. Each explains its own rules.
hq/ members/ staff/        The portals.
pos/ marketplace/ public/
```

## Building a page

Copy the matching layout, then change four things: the `<title>`, the
`data-zone` on `<body>`, the `<h1>`, and the content in `<main>`. Mark the
current sidebar link `active` and give it `aria-current="page"`.

Load data with HTMX and let each panel fill itself:

```html
<div id="target" hx-get="/api/v1/hq/kpis" hx-trigger="load" hx-swap="innerHTML">
  <div class="lrmc-skeleton h-24 w-full"></div>
</div>
```

The shell paints immediately and each card arrives when its endpoint answers.
One slow endpoint delays one card rather than the whole page — which matters
far more on a Ghanaian mobile connection than on office fibre.

The backend returns JSON, so pages turn JSON into HTML in a
`htmx:beforeSwap` handler. `hq/index.html` is the worked example.

## Rules worth not breaking

**Three states per panel, always.** Loading, loaded, and empty. A card that
renders nothing looks broken; a card that says "no entries yet" looks
finished. `emptyState()` in `hq/index.html` is the pattern.

**Status is never colour alone.** Every badge carries a word, every trend
carries an arrow and a word. Roughly one man in twelve cannot reliably tell
your red from your green, and a printed board report has no colour at all.

**Escape anything a person typed** before putting it in HTML. `LrmcUI.esc()`.

**Money goes through `LrmcUI.money()`.** One institution, one way of writing
GH₵. Use `moneyCompact()` for headline tiles only, never for a ledger — an
executive tile can say GH₵1.3M, a payment row cannot.

**Hiding a menu item is a courtesy, not a control.** It stops an honest person
clicking the wrong thing; it stops nobody who opens the network tab. Every
rule is enforced again by the backend, which is where enforcement counts.

**Charts use one hue.** The LRMC gold ramp is sequential by design. The brand
status colours — green, amber, red, blue — are reserved for *state* and must
never become chart series: run as a categorical palette they fail
colour-blindness separation outright (amber against green is ΔE 5.7 for a
protanope, well under the 8 threshold). For more than one series use small
multiples, not a second hue.

## Zone A behaves differently

The Founder Command Center refuses with **HTTP 403 and
`error.code === 'CLEARANCE_REQUIRED'`** when the founder has not entered their
six-digit Founder Authorisation Code recently.

That is not "access denied". `ZONE_RESTRICTED` — same 403 — is access denied.
`CLEARANCE_REQUIRED` means the person is entitled and one step short.
`auth.js` tells them apart and raises `lrmc:clearance-required`; the
`lrmcClearance` component listens. Any Zone A page gets the prompt without
wiring it.

## Self-hosting the libraries

Tailwind, HTMX, Alpine and Lucide load from CDN. For production — and
necessarily if the Accra office ever works offline — download them into
`assets/js/` and swap the commented local `<script>` lines in each layout.
`assets/js/htmx.min.js` and `assets/js/alpine.js` carry the commands.

## Not yet backed by an API

`pos/` and `marketplace/` have no backend endpoints. The other four portals map
onto real routes in `backend/docs/openapi.json`; those two would need modules
building first.
