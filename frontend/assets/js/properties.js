/* ═══════════════════════════════════════════════════════════════════════════
 * LRMC — PROPERTY PRESENTATION
 *
 * Shared by `/public/properties.html` (visitors) and
 * `/members/properties.html` (tenants and landlords). Both pages read
 * different endpoints and show the same card, so the card is written once.
 *
 * Nothing here fetches. Nothing here decides who may do what — that is the
 * backend's business, re-enforced on every request. This file turns a property
 * document into markup, and turns the API's vocabulary into a person's.
 * ═══════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /* The API returns `compoundHouse`; a person reads "Compound house". Held as
   * a table rather than derived, because splitting `shortLetUnit` on capitals
   * gives "Short Let Unit", which is not how anybody writes it. */
  var PROPERTY_TYPES = [
    ['apartment', 'Apartment'],
    ['singleFamily', 'House'],
    ['compoundHouse', 'Compound house'],
    ['townhouse', 'Townhouse'],
    ['duplex', 'Duplex'],
    ['studio', 'Studio'],
    ['shortLetUnit', 'Short-let unit'],
    ['hotelRoom', 'Hotel room'],
    ['resortVilla', 'Resort villa'],
    ['commercialSpace', 'Commercial space'],
    ['land', 'Land'],
  ];

  var RENT_PERIODS = { monthly: 'per month', nightly: 'per night', yearly: 'per year' };

  /* The Gambia's administrative regions, ordered by population so the
   * commonest answers sit at the top of a phone dropdown. Mirrors
   * `backend/src/config/registration.ts`. */
  var REGIONS = [
    'Banjul', 'Kanifing', 'Brikama', 'Mansakonko',
    'Kerewan', 'Kuntaur', 'Janjanbureh', 'Basse',
  ];

  /* Amenities a tenant actually filters on. Stored lowercase because the API
   * matches them exactly, and a listing saved as "WiFi" would not match a
   * filter for "wifi". */
  var AMENITIES = [
    ['water', 'Running water'],
    ['electricity', 'Electricity'],
    ['wifi', 'WiFi'],
    ['generator', 'Generator'],
    ['airConditioning', 'Air conditioning'],
    ['parking', 'Parking'],
    ['security', 'Security'],
    ['borehole', 'Borehole'],
  ];

  function labelFrom(pairs, value) {
    for (var i = 0; i < pairs.length; i++) if (pairs[i][0] === value) return pairs[i][1];
    return null;
  }

  var LrmcProperties = {
    PROPERTY_TYPES: PROPERTY_TYPES,
    REGIONS: REGIONS,
    AMENITIES: AMENITIES,

    typeLabel: function (value) { return labelFrom(PROPERTY_TYPES, value) || 'Property'; },
    amenityLabel: function (value) { return labelFrom(AMENITIES, value) || value; },

    /** Wording for an active-filter chip. */
    filterLabel: function (key, value) {
      switch (key) {
        case 'search': return '“' + value + '”';
        case 'region': return value;
        case 'propertyType': return LrmcProperties.typeLabel(value);
        case 'bedrooms': return value + '+ bedrooms';
        case 'minRent': return 'From ' + LrmcUI.moneyWhole(Number(value));
        case 'maxRent': return 'Up to ' + LrmcUI.moneyWhole(Number(value));
        case 'furnished': return value === 'true' ? 'Furnished' : 'Unfurnished';
        default: return key + ': ' + value;
      }
    },

    fillRegions: function (select) {
      if (!select) return;
      REGIONS.forEach(function (r) {
        var o = document.createElement('option');
        o.value = r; o.textContent = r;
        select.appendChild(o);
      });
    },

    fillTypes: function (select) {
      if (!select) return;
      PROPERTY_TYPES.forEach(function (pair) {
        var o = document.createElement('option');
        o.value = pair[0]; o.textContent = pair[1];
        select.appendChild(o);
      });
    },

    fillAmenities: function (box) {
      if (!box) return;
      AMENITIES.forEach(function (pair) {
        var id = 'amenity-' + pair[0];
        var label = document.createElement('label');
        label.className = 'flex items-center gap-2 text-sm text-slate-700';
        label.setAttribute('for', id);

        var input = document.createElement('input');
        input.type = 'checkbox';
        input.id = id;
        input.name = 'amenities';
        input.value = pair[0];
        input.className = 'w-4 h-4 rounded border-slate-300 text-blue-600';

        var span = document.createElement('span');
        span.textContent = pair[1];

        label.appendChild(input);
        label.appendChild(span);
        box.appendChild(label);
      });
    },

    /**
     * The price line.
     *
     * A listing can be published before a price is agreed. `D 0` would be a
     * lie; "Price on application" is not.
     */
    priceLine: function (p) {
      if (typeof p.rentAmount !== 'number') {
        return { amount: 'Price on application', period: '' };
      }
      return {
        amount: LrmcUI.moneyWhole(p.rentAmount, p.rentCurrency),
        period: RENT_PERIODS[p.rentPeriod] || '',
      };
    },

    /**
     * One property, as a list item.
     *
     * Everything interpolated goes through `LrmcUI.esc`. A landlord names
     * their own listing, so a title is user-authored text arriving over the
     * wire — exactly the shape of thing that must never become markup.
     */
    card: function (p, opts) {
      opts = opts || {};
      var esc = LrmcUI.esc;
      var price = LrmcProperties.priceLine(p);
      var where = [p.city, p.region].filter(Boolean).join(', ');

      var rooms = [];
      if (p.bedrooms) rooms.push(p.bedrooms + (p.bedrooms === 1 ? ' bedroom' : ' bedrooms'));
      if (p.bathrooms) rooms.push(p.bathrooms + (p.bathrooms === 1 ? ' bathroom' : ' bathrooms'));
      if (p.floorAreaSqm) rooms.push(p.floorAreaSqm + ' m²');

      /* Decorative: the title beside it already names the property, and a
       * screen reader reading a filename helps nobody. */
      var photo = (p.photos && p.photos.length)
        ? '<img src="' + esc(p.photos[0]) + '" alt="" loading="lazy" ' +
          'class="w-full h-40 object-cover rounded-lg mb-3 bg-slate-100" />'
        : '<div class="w-full h-40 rounded-lg mb-3 bg-slate-100 flex items-center justify-center">' +
          '<i data-lucide="image" class="w-6 h-6 text-slate-400"></i></div>';

      /* Two badges, and both are claims LRMC is making about itself — so
       * neither is shown unless the record says so. A "Verified" badge on
       * every card is a badge that means nothing. */
      var badges = '';
      if (p.isVerified || p.verificationStatus === 'verified') {
        badges += '<span class="lrmc-badge lrmc-badge-success">Verified by LRMC</span>';
      }
      if (p.assignedCoordinator) {
        badges += '<span class="lrmc-badge lrmc-badge-info">Coordinator managed</span>';
      }

      var amenities = (p.amenities || []).slice(0, 4).map(function (a) {
        return '<span class="lrmc-badge lrmc-badge-neutral">' +
          esc(LrmcProperties.amenityLabel(a)) + '</span>';
      }).join('');
      var more = (p.amenities || []).length > 4
        ? '<span class="text-xs text-slate-500">+' + ((p.amenities || []).length - 4) + ' more</span>'
        : '';

      var id = p._id || p.id || '';
      var action = opts.action === false ? '' :
        '<button type="button" class="lrmc-btn lrmc-btn-secondary w-full mt-4" ' +
        'data-property="' + esc(id) + '" data-open-details>' +
        'View details</button>';

      return '<li class="lrmc-card flex flex-col">' + photo +
        '<p class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">' +
          esc(LrmcProperties.typeLabel(p.propertyType)) + '</p>' +
        '<h3 class="font-semibold text-slate-900 mb-1">' +
          esc(p.title || 'Untitled listing') + '</h3>' +
        (where ? '<p class="text-sm text-slate-600 mb-2">' + esc(where) + '</p>' : '') +
        (rooms.length ? '<p class="text-sm text-slate-500 mb-3">' + esc(rooms.join(' · ')) + '</p>' : '') +
        (badges ? '<div class="flex flex-wrap gap-2 mb-3">' + badges + '</div>' : '') +
        (amenities ? '<div class="flex flex-wrap gap-2 items-center mb-3">' + amenities + more + '</div>' : '') +
        '<p class="font-bold text-blue-800 mt-auto">' + esc(price.amount) +
          (price.period ? ' <span class="text-sm font-normal text-slate-500">' +
            esc(price.period) + '</span>' : '') + '</p>' +
        (p.reference ? '<p class="text-[11px] text-slate-500 mt-2">Ref ' + esc(p.reference) + '</p>' : '') +
        action +
      '</li>';
    },
  };

  global.LrmcProperties = LrmcProperties;
})(window);

/* ═══════════════════════════════════════════════════════════════════════════
 * LRMC — SEARCH ENGINE
 *
 * Extracted from `/public/properties.html` so the member-side page uses the
 * same one. Duplicating it would have meant two stale-reply guards, two paging
 * boundaries and two URL-sync implementations, three of which would eventually
 * be wrong.
 *
 * It owns four things that are easy to get subtly wrong and hard to notice:
 *
 *   1. **The URL is the search.** Filters live in the query string, so a
 *      result set can be shared, bookmarked and reloaded.
 *   2. **A stale reply never wins.** A slow answer to a search the person has
 *      already moved on from is discarded, not rendered.
 *   3. **Paging is offered only when there is more than one page**, and a
 *      filter change returns to page one.
 *   4. **Typing waits, choosing does not.** 300ms of quiet is a decision; a
 *      keystroke is not.
 * ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  function LrmcSearch(config) {
    this.fetch = config.fetch;                    // (query) => Promise<rows>
    this.fields = config.fields || [];            // filter input ids, minus the prefix
    this.prefix = config.prefix || 'f-';
    this.amenityBox = config.amenityBox || null;
    this.pageSize = config.pageSize || 12;
    this.syncUrl = config.syncUrl !== false;
    this.onRender = config.onRender || function () {};
    this.onState = config.onState || function () {};
    this.page = 1;
    this.total = 0;
    this.lastQuery = '';
  }

  LrmcSearch.prototype.read = function () {
    var out = {};
    var self = this;
    this.fields.forEach(function (name) {
      var el = document.getElementById(self.prefix + name);
      if (el && el.value !== '') out[name] = el.value;
    });
    if (this.amenityBox) {
      var ticked = [].slice.call(
        document.querySelectorAll('#' + this.amenityBox + ' input:checked')
      ).map(function (i) { return i.value; });
      if (ticked.length) out.amenities = ticked.join(',');
    }
    return out;
  };

  LrmcSearch.prototype.write = function (params) {
    var self = this;
    this.fields.forEach(function (name) {
      var el = document.getElementById(self.prefix + name);
      if (el) el.value = params.get(name) || '';
    });
    if (this.amenityBox) {
      var wanted = (params.get('amenities') || '').split(',').filter(Boolean);
      [].slice.call(document.querySelectorAll('#' + this.amenityBox + ' input'))
        .forEach(function (i) { i.checked = wanted.indexOf(i.value) !== -1; });
    }
    var page = parseInt(params.get('page') || '1', 10);
    this.page = Number.isFinite(page) && page > 0 ? page : 1;
  };

  LrmcSearch.prototype.pushUrl = function (filters) {
    if (!this.syncUrl) return;
    var params = new URLSearchParams(filters);
    if (this.page > 1) params.set('page', String(this.page));
    var extra = this.urlExtra ? this.urlExtra() : null;
    if (extra) Object.keys(extra).forEach(function (k) { params.set(k, extra[k]); });
    var qs = params.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  };

  /** Only the wrong-way-round case; the API is free to find nothing. */
  LrmcSearch.prototype.rangeProblem = function (filters) {
    var lo = filters.minRent === undefined ? null : Number(filters.minRent);
    var hi = filters.maxRent === undefined ? null : Number(filters.maxRent);
    return lo !== null && hi !== null && hi < lo;
  };

  LrmcSearch.prototype.run = function (opts) {
    opts = opts || {};
    if (opts.resetPage !== false) this.page = 1;

    var filters = this.read();
    if (this.rangeProblem(filters)) {
      this.onState({ phase: 'range-error', filters: filters });
      return Promise.resolve();
    }

    this.pushUrl(filters);
    this.onState({ phase: 'loading', filters: filters });

    var query = Object.assign({}, filters, { page: this.page, limit: this.pageSize });
    var stamp = JSON.stringify(query);
    this.lastQuery = stamp;
    var self = this;

    return this.fetch(query)
      .then(function (items) {
        /* A late answer to a search the person has already moved on from must
         * not overwrite the one they are looking at. */
        if (stamp !== self.lastQuery) return;

        var rows = Array.isArray(items) ? items : (items && items.data) || [];
        var meta = (items && items.__meta) || (items && items.meta) || {};
        self.total = typeof meta.total === 'number' ? meta.total : rows.length;

        if (!rows.length) {
          self.onState({ phase: 'empty', filters: filters });
          return;
        }
        self.onRender(rows);
        self.onState({
          phase: 'results', filters: filters, shown: rows.length,
          total: self.total, page: self.page, pages: self.pageCount(),
        });
      })
      .catch(function () {
        if (stamp !== self.lastQuery) return;
        self.onState({ phase: 'error', filters: filters });
      });
  };

  LrmcSearch.prototype.pageCount = function () {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  };

  /**
   * Wire a form to this search.
   *
   * Typing debounces; selects and checkboxes fire at once. `change` also
   * fires on blur for a text input, so those are skipped there — searching
   * twice for one edit doubles the load for nothing.
   */
  LrmcSearch.prototype.bind = function (form) {
    var self = this;
    var timer = null;

    form.addEventListener('submit', function (evt) { evt.preventDefault(); self.run(); });

    form.addEventListener('input', function (evt) {
      var el = evt.target;
      if (!el || el.tagName !== 'INPUT' || el.type === 'checkbox') return;
      clearTimeout(timer);
      timer = setTimeout(function () { self.run(); }, 300);
    });

    form.addEventListener('change', function (evt) {
      var el = evt.target;
      if (el && el.tagName === 'INPUT' && el.type !== 'checkbox') return;
      self.run();
    });
  };

  LrmcSearch.prototype.clear = function () {
    var self = this;
    this.fields.forEach(function (name) {
      var el = document.getElementById(self.prefix + name);
      if (el) el.value = '';
    });
    if (this.amenityBox) {
      [].slice.call(document.querySelectorAll('#' + this.amenityBox + ' input'))
        .forEach(function (i) { i.checked = false; });
    }
    return this.run();
  };

  LrmcSearch.prototype.removeFilter = function (key) {
    if (key.indexOf('amenity:') === 0) {
      var box = document.querySelector(
        '#' + this.amenityBox + ' input[value="' + CSS.escape(key.slice(8)) + '"]');
      if (box) box.checked = false;
    } else {
      var el = document.getElementById(this.prefix + key);
      if (el) el.value = '';
    }
    return this.run();
  };

  /** Chips describing what is currently narrowing the list. */
  LrmcSearch.chips = function (filters) {
    var chips = [];
    Object.keys(filters).forEach(function (key) {
      if (key === 'amenities') {
        filters.amenities.split(',').forEach(function (a) {
          chips.push({ key: 'amenity:' + a, label: LrmcProperties.amenityLabel(a) });
        });
        return;
      }
      chips.push({ key: key, label: LrmcProperties.filterLabel(key, filters[key]) });
    });
    return chips;
  };

  LrmcSearch.chipHtml = function (chips) {
    return chips.map(function (c) {
      return '<button type="button" class="lrmc-badge lrmc-badge-info" data-remove="' +
        LrmcUI.esc(c.key) + '">' + LrmcUI.esc(c.label) +
        ' <span aria-hidden="true">×</span>' +
        '<span class="lrmc-sr-only">Remove this filter</span></button>';
    }).join('');
  };

  global.LrmcSearch = LrmcSearch;
})(window);

/* ═══════════════════════════════════════════════════════════════════════════
 * LRMC — ADD PROPERTY WIZARD, DECLARED
 *
 * Six steps, described as data rather than as six blocks of markup. The page
 * renders whatever is here; adding a field is a line in this table, not a new
 * `<div>` and a new handler that somebody forgets to validate.
 *
 * **Every field name below must exist in `createPropertySchema`.** The suite
 * reads the Zod schema from the backend source and refuses to pass if this
 * table names something the API would reject as a strict-mode violation — the
 * failure that otherwise appears as "Save did nothing" with no message.
 *
 * The last step is `status`, not a submit button. A property is created as a
 * draft and *published* by moving its lifecycle status to `active` with
 * `listedPublicly`. That is the same `status` vocabulary the rest of the
 * platform uses, and it is why a half-finished listing cannot appear in the
 * public search.
 * ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var F = function (name, label, type, extra) {
    return Object.assign({ name: name, label: label, type: type || 'text' }, extra || {});
  };

  var WIZARD_STEPS = [
    {
      key: 'basics',
      title: 'Basic information',
      blurb: 'What the property is, in the words a tenant would use.',
      fields: [
        F('title', 'Listing title', 'text', { required: true, maxlength: 240,
          hint: 'For example: Two-bedroom apartment on Kairaba Avenue' }),
        F('propertyType', 'Property type', 'select', { required: true, options: 'propertyTypes' }),
        F('bedrooms', 'Bedrooms', 'number', { min: 0, max: 100 }),
        F('bathrooms', 'Bathrooms', 'number', { min: 0, max: 100 }),
        F('floorAreaSqm', 'Floor area (m²)', 'number', { min: 0 }),
      ],
    },
    {
      key: 'location',
      title: 'Where it is',
      blurb: 'A coordinator has to be able to find it.',
      fields: [
        F('region', 'Region', 'select', { required: true, options: 'regions' }),
        F('city', 'Town or city', 'text', { maxlength: 120 }),
        F('address', 'Address', 'textarea', { maxlength: 400 }),
        F('digitalAddress', 'Digital address', 'text', { maxlength: 40,
          hint: 'Optional. Helps a vendor find the property first time.' }),
      ],
    },
    {
      key: 'photos',
      title: 'Photographs',
      blurb: 'A listing with no photograph is passed over. You can add these later.',
      fields: [
        F('photos', 'Photo storage keys', 'photos', {
          hint: 'One per line. LRMC stores photographs by key, never by URL.' }),
      ],
    },
    {
      key: 'amenities',
      title: 'What it has',
      blurb: 'Tenants filter on these, and every one is a requirement they are stating.',
      fields: [
        F('furnished', 'Furnishing', 'select', { options: 'furnished' }),
        F('amenities', 'Amenities', 'amenities'),
      ],
    },
    {
      key: 'pricing',
      title: 'Rent',
      blurb: 'A listing may be published before a price is agreed — leave it blank and it shows as “price on application”.',
      fields: [
        F('rentAmount', 'Rent', 'number', { min: 0, step: 100 }),
        F('rentCurrency', 'Currency', 'select', { options: 'currencies' }),
        F('rentPeriod', 'Per', 'select', { options: 'rentPeriods' }),
      ],
    },
    {
      key: 'publish',
      title: 'Coordinator and publishing',
      blurb: 'LRMC assigns the coordinator. Publishing is yours.',
      fields: [
        F('listedPublicly', 'Show in the public search', 'checkbox', {
          hint: 'Off keeps it as a draft only you and LRMC can see.' }),
        F('status', 'Listing state', 'select', { options: 'lifecycleStatus',
          hint: 'A draft is not searchable. Active publishes it.' }),
      ],
    },
  ];

  /* Option sets the steps refer to by name, so the table stays readable. */
  var OPTION_SETS = {
    propertyTypes: function () { return LrmcProperties.PROPERTY_TYPES; },
    regions: function () {
      return LrmcProperties.REGIONS.map(function (r) { return [r, r]; });
    },
    currencies: function () { return [['GMD', 'Dalasi (D)'], ['USD', 'US dollar'], ['EUR', 'Euro'], ['GBP', 'Pound']]; },
    rentPeriods: function () { return [['monthly', 'Per month'], ['nightly', 'Per night'], ['yearly', 'Per year']]; },
    furnished: function () { return [['false', 'Unfurnished'], ['true', 'Furnished']]; },
    /* Mirrors `lifecycleFields.status` — the platform-wide vocabulary. Only
     * the two a landlord can meaningfully choose between are offered; the
     * rest are LRMC's to set. */
    lifecycleStatus: function () { return [['draft', 'Draft'], ['active', 'Active']]; },
  };

  global.LrmcWizard = {
    STEPS: WIZARD_STEPS,
    OPTION_SETS: OPTION_SETS,

    /** Every field the wizard can send, flattened. */
    fieldNames: function () {
      return WIZARD_STEPS.reduce(function (all, step) {
        return all.concat(step.fields.map(function (f) { return f.name; }));
      }, []);
    },

    /**
     * What is missing from this step, by field name.
     *
     * Returns every problem rather than the first, so a person is told once
     * what to fix instead of discovering it a step at a time.
     */
    missingOn: function (step, values) {
      return step.fields
        .filter(function (f) { return f.required; })
        .filter(function (f) {
          var v = values[f.name];
          return v === undefined || v === null || String(v).trim() === '';
        })
        .map(function (f) { return f.name; });
    },
  };
})(window);

/* ═══════════════════════════════════════════════════════════════════════════
 * LRMC — STATUS VOCABULARY
 *
 * The words a person reads for each server-side state. Mirrors the rule
 * tables in `viewingRules.ts` and `applicationLifecycle.ts`. What a status
 * *permits* is never decided here — the server returns the record and the
 * server refuses the move; this only names things.
 * ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var VIEWING = {
    requested:  { label: 'Awaiting LRMC',  tone: 'warning' },
    confirmed:  { label: 'Confirmed',      tone: 'success' },
    declined:   { label: 'Declined',       tone: 'danger'  },
    completed:  { label: 'Completed',      tone: 'neutral' },
    cancelled:  { label: 'Cancelled',      tone: 'neutral' },
    noShow:     { label: 'Not attended',   tone: 'danger'  },
  };

  var APPLICATION = {
    submitted:         { label: 'Submitted',            tone: 'info'    },
    underReview:       { label: 'Under review',         tone: 'warning' },
    awaitingApplicant: { label: 'Waiting on you',       tone: 'warning' },
    approved:          { label: 'Approved',             tone: 'success' },
    rejected:          { label: 'Not successful',       tone: 'danger'  },
    withdrawn:         { label: 'Withdrawn',            tone: 'neutral' },
    leaseIssued:       { label: 'Lease issued',         tone: 'success' },
  };

  var RECOMMENDATION = {
    recommend: { label: 'Recommended',    tone: 'success' },
    review:    { label: 'Needs a look',   tone: 'warning' },
    decline:   { label: 'Not supported',  tone: 'danger'  },
  };

  var FACTOR_STATUS = {
    pass:    { label: 'Met',           tone: 'success' },
    concern: { label: 'Some concern',  tone: 'warning' },
    fail:    { label: 'Not met',       tone: 'danger'  },
    /* Never 'fail'. LRMC having no evidence is not the applicant's failing,
     * and showing it in red would tell them otherwise. */
    unknown: { label: 'Not checked',   tone: 'neutral' },
  };

  function badge(table, key) {
    var e = table[key] || { label: key || 'Unknown', tone: 'neutral' };
    return '<span class="lrmc-badge lrmc-badge-' + e.tone + '">' +
      LrmcUI.esc(e.label) + '</span>';
  }

  global.LrmcStatus = {
    VIEWING: VIEWING,
    APPLICATION: APPLICATION,
    RECOMMENDATION: RECOMMENDATION,
    FACTOR_STATUS: FACTOR_STATUS,
    viewing: function (s) { return badge(VIEWING, s); },
    application: function (s) { return badge(APPLICATION, s); },
    recommendation: function (s) { return badge(RECOMMENDATION, s); },
    factor: function (s) { return badge(FACTOR_STATUS, s); },
    label: function (table, key) {
      var e = global.LrmcStatus[table][key];
      return e ? e.label : key;
    },
  };
})(window);
