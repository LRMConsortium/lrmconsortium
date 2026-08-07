/* TEST DOUBLE — icon library stand-in. createIcons() is a no-op; the page
 * only ever calls it, never reads from it. */
window.lucide = { createIcons: function () {} };
