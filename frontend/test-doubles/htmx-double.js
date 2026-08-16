/* TEST DOUBLE — not shipped. Implements only the HTMX subset /hq/index.html
 * relies on: hx-get + hx-trigger="load", the htmx:beforeSwap event with a
 * mutable detail.serverResponse, hx-swap="innerHTML", and htmx:afterSwap.
 * Enough to exercise the page's real integration path offline. */
(function (w) {
  var htmx = { version: 'double' };
  function fire(el, name, detail) {
    var e = new CustomEvent(name, { detail: detail, bubbles: true, cancelable: true });
    el.dispatchEvent(e); return e;
  }
  function load(el) {
    var url = el.getAttribute('hx-get'); if (!url) return;
    var target = el.getAttribute('hx-target');
    var dest = target ? document.querySelector(target) : el;
    var cfg = { headers: {}, path: url };
    fire(document.body, 'htmx:configRequest', cfg);
    fetch(url, { headers: cfg.headers }).then(function (res) {
      return res.text().then(function (text) {
        var detail = { xhr: { status: res.status, responseText: text }, target: dest, serverResponse: text };
        if (res.status >= 400) fire(document.body, 'htmx:responseError', detail);
        fire(document.body, 'htmx:beforeSwap', detail);
        dest.innerHTML = detail.serverResponse;
        fire(document.body, 'htmx:afterSwap', { target: dest });
      });
    });
  }
  w.htmx = htmx;
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[hx-get][hx-trigger~="load"]').forEach(load);
  });
})(window);
