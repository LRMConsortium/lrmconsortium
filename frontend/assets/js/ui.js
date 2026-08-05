/* ═══════════════════════════════════════════════════════════════════════════
 * LRMC — SHARED INTERFACE HELPERS
 *
 * Legacy Rental Management Consortium platform.
 *
 * Formatting, toasts, and the small Alpine components every dashboard uses.
 * Formatting in particular belongs in one place: a currency printed three
 * different ways across three pages makes an institution look careless, and
 * this one handles other people's rent.
 * ═══════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  var doc = global.document;

  /* ─────────────────────────────────────────────────────────────────────────
   * Formatting
   * ──────────────────────────────────────────────────────────────────────── */

  /* Ghana Cedi, Ghanaian conventions. Set once so no page invents its own. */
  var MONEY = new Intl.NumberFormat('en-GH', {
    style: 'currency', currency: 'GHS', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  var MONEY_COMPACT = new Intl.NumberFormat('en-GH', {
    style: 'currency', currency: 'GHS', notation: 'compact', maximumFractionDigits: 1,
  });
  var NUM = new Intl.NumberFormat('en-GH');

  var LrmcUI = {

    /** Money, in full. Use in tables and anywhere a figure is acted on. */
    money: function (value) {
      if (value === null || value === undefined || isNaN(value)) return '—';
      return MONEY.format(Number(value));
    },

    /** Money, abbreviated — GH₵1.2M. Headline tiles only, never a ledger. */
    moneyCompact: function (value) {
      if (value === null || value === undefined || isNaN(value)) return '—';
      return MONEY_COMPACT.format(Number(value));
    },

    number: function (value) {
      if (value === null || value === undefined || isNaN(value)) return '—';
      return NUM.format(Number(value));
    },

    percent: function (value, digits) {
      if (value === null || value === undefined || isNaN(value)) return '—';
      return Number(value).toFixed(digits === undefined ? 1 : digits) + '%';
    },

    date: function (value) {
      if (!value) return '—';
      var d = new Date(value);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('en-GH', { day: '2-digit', month: 'short', year: 'numeric' });
    },

    dateTime: function (value) {
      if (!value) return '—';
      var d = new Date(value);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString('en-GH', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    },

    /** "3 days ago". For activity feeds, never for anything legally dated. */
    relative: function (value) {
      if (!value) return '—';
      var then = new Date(value).getTime();
      if (isNaN(then)) return '—';
      var secs = Math.round((Date.now() - then) / 1000);
      if (secs < 60) return 'just now';
      var mins = Math.round(secs / 60);
      if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
      var hrs = Math.round(mins / 60);
      if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
      var days = Math.round(hrs / 24);
      if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
      return LrmcUI.date(value);
    },

    /** Escape before injecting anything a user typed into HTML. */
    esc: function (value) {
      return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /* ───────────────────────────────────────────────────────────────────────
     * Status
     *
     * One mapping from a backend status string to its badge. Colour is the
     * fast read; the word beside it is what works in greyscale and for a
     * colour-blind reader, so the badge always carries both.
     * ────────────────────────────────────────────────────────────────────── */

    badgeTone: function (status) {
      var s = String(status || '').toLowerCase();
      if (['active', 'verified', 'paid', 'settled', 'completed', 'approved', 'resolved'].indexOf(s) !== -1) return 'success';
      if (['pending', 'inreview', 'in_review', 'processing', 'scheduled', 'partial'].indexOf(s) !== -1) return 'warning';
      if (['overdue', 'rejected', 'failed', 'suspended', 'cancelled', 'breached', 'expired'].indexOf(s) !== -1) return 'danger';
      if (['draft', 'archived', 'inactive'].indexOf(s) !== -1) return 'neutral';
      return 'info';
    },

    badge: function (status) {
      var tone = LrmcUI.badgeTone(status);
      var label = String(status || 'unknown').replace(/([a-z])([A-Z])/g, '$1 $2');
      return '<span class="lrmc-badge lrmc-badge-' + tone + '">' + LrmcUI.esc(label) + '</span>';
    },

    /* ───────────────────────────────────────────────────────────────────────
     * Toasts
     * ────────────────────────────────────────────────────────────────────── */

    toast: function (message, tone, ms) {
      var host = doc.getElementById('lrmc-toasts');
      if (!host) {
        host = doc.createElement('div');
        host.id = 'lrmc-toasts';
        host.setAttribute('aria-live', 'polite');
        host.className = 'fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end';
        doc.body.appendChild(host);
      }

      var el = doc.createElement('div');
      el.className = 'lrmc-toast lrmc-toast-' + (tone || 'info');
      el.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
      el.innerHTML = '<span>' + LrmcUI.esc(message) + '</span>';
      host.appendChild(el);

      global.setTimeout(function () {
        el.style.opacity = '0';
        global.setTimeout(function () { el.remove(); }, 200);
      }, ms || 4500);
    },

    /** Placeholder rows while HTMX is fetching. Height matched to real rows. */
    skeletonRows: function (count, columns) {
      var out = '';
      for (var r = 0; r < (count || 5); r++) {
        out += '<tr>';
        for (var c = 0; c < (columns || 4); c++) {
          out += '<td class="p-3"><div class="lrmc-skeleton h-4 w-full"></div></td>';
        }
        out += '</tr>';
      }
      return out;
    },
  };

  /* ─────────────────────────────────────────────────────────────────────────
   * Alpine components
   *
   * Registered on `alpine:init` so any page can use them with x-data.
   * ──────────────────────────────────────────────────────────────────────── */

  doc.addEventListener('alpine:init', function () {
    var Alpine = global.Alpine;

    /* Sidebar.
     *
     * Open by default on a wide screen, closed on a narrow one — and, the
     * part that is easy to miss, re-decided when the viewport changes. A
     * tablet rotated from landscape to portrait would otherwise keep a
     * 260px drawer sitting on top of the content, with the backdrop
     * swallowing every tap. Deciding once at load is a bug that only shows
     * up on the devices field staff actually use.
     *
     * Only crossing the breakpoint changes anything, so a deliberate toggle
     * is never undone by the browser's address bar sliding away and firing
     * a resize.
     */
    Alpine.data('lrmcShell', function () {
      var WIDE = 1024;
      return {
        sidebarOpen: global.innerWidth >= WIDE,
        wasWide: global.innerWidth >= WIDE,
        init: function () {
          var self = this;
          global.addEventListener('resize', function () {
            var isWide = global.innerWidth >= WIDE;
            if (isWide === self.wasWide) return;
            self.wasWide = isWide;
            self.sidebarOpen = isWide;
          });
        },
        open: function () { this.sidebarOpen = true; },
        close: function () { this.sidebarOpen = false; },
        toggle: function () { this.sidebarOpen = !this.sidebarOpen; },
      };
    });

    /* Modal. Escape closes, focus returns to whatever opened it — a modal
     * you cannot leave by keyboard is a trap, and screen-reader users hit it
     * first. */
    Alpine.data('lrmcModal', function () {
      return {
        open: false,
        opener: null,
        show: function () { this.opener = doc.activeElement; this.open = true; },
        hide: function () {
          this.open = false;
          if (this.opener && this.opener.focus) this.opener.focus();
        },
      };
    });

    /* The Founder Authorisation Code prompt.
     *
     * Listens for the event auth.js raises on a CLEARANCE_REQUIRED refusal,
     * so any Zone A page gets the prompt without wiring it per page. */
    Alpine.data('lrmcClearance', function () {
      return {
        open: false,
        reason: null,
        message: '',
        init: function () {
          var self = this;
          doc.body.addEventListener('lrmc:clearance-required', function (e) {
            self.reason = e.detail.reason;
            self.message = e.detail.message;
            self.open = true;
          });
        },
        /* Two refusals, two different instructions. Telling a founder to
         * "enter the code" when no code has been issued sends them looking
         * for something that does not exist. */
        get instruction() {
          return this.reason === 'noActiveCode'
            ? 'No Founder Authorisation Code is in force. Issue one to open the Command Center.'
            : 'Enter your six-digit Founder Authorisation Code to continue.';
        },
        hide: function () { this.open = false; },
      };
    });
  });

  global.LrmcUI = LrmcUI;
})(window);
