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
