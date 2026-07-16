/* MB Storage - shared site JS */

// Mobile navigation
document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', nav.classList.contains('open'));
    });
  }
  initQuoteForm();
  initContactForm();
  initReveal();
  initCounters();
});

/* Generic AJAX form submit → serverless function → thank-you page. */
function ajaxForm(formId, statusId, endpoint) {
  var form = document.getElementById(formId);
  if (!form) return;
  var status = document.getElementById(statusId);
  var btn = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = v; });
    if (status) { status.className = 'status-msg ok'; status.textContent = 'Sending…'; }
    if (btn) { btn.disabled = true; }
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) {
      if (!r.ok) throw new Error('Request failed (' + r.status + ')');
      return r.json();
    }).then(function () {
      window.location.href = 'thank-you.html';
    }).catch(function () {
      if (status) {
        status.className = 'status-msg err';
        status.innerHTML = "Sorry, something went wrong. Please call us on " +
          "<a href=\"tel:+447375355233\">07375 355233</a> or email " +
          "<a href=\"mailto:info@mbstorage.co.uk\">info@mbstorage.co.uk</a>.";
      }
      if (btn) { btn.disabled = false; }
    });
  });
}

function initContactForm() {
  ajaxForm('contact-form', 'contact-status', '/.netlify/functions/contact');
}

var prefersReducedMotion = window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Scroll-reveal: fade/slide elements in as they enter the viewport.
   Classes are added by JS, so with JS disabled everything stays visible. */
function initReveal() {
  if (prefersReducedMotion || !('IntersectionObserver' in window)) return;
  var selector = 'section .section-head, section .card, .feature-banner, ' +
    '.unit-card, .stat, .access-steps-row li, .dim-table, details';
  var els = Array.prototype.slice.call(document.querySelectorAll(selector));
  if (!els.length) return;
  els.forEach(function (el) { el.classList.add('reveal'); });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach(function (el) { io.observe(el); });
}

/* Count-up animation for stat numbers with a [data-count] attribute. */
function initCounters() {
  var nums = Array.prototype.slice.call(document.querySelectorAll('[data-count]'));
  if (!nums.length) return;
  var run = function (el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var suffix = el.getAttribute('data-suffix') || '';
    if (prefersReducedMotion) { el.textContent = target.toLocaleString() + suffix; return; }
    var dur = 1200, start = null;
    var step = function (now) {
      if (start === null) start = now;
      var p = Math.min((now - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString() + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if (!('IntersectionObserver' in window)) { nums.forEach(run); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { run(en.target); io.unobserve(en.target); }
    });
  }, { threshold: 0.4 });
  nums.forEach(function (el) { io.observe(el); });
}

/* ------------------------------------------------------------------
   Instant quote form.
   The form posts to a serverless function (/.netlify/functions/quote),
   which calculates the price server-side and emails the customer their
   quote from @mbstorage.co.uk. No pricing is held in this file, so prices
   are never exposed to the browser or the page.
------------------------------------------------------------------- */
var QUOTE_ENDPOINT = '/.netlify/functions/quote';

function initQuoteForm() {
  var form = document.getElementById('quote-form');
  if (!form) return;
  var status = document.getElementById('quote-status');
  var btn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var size = form.querySelector('[name="container_size"]');
    if (!size || !size.value) {
      if (status) { status.className = 'status-msg err'; status.textContent = 'Please choose a container size.'; }
      return;
    }

    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = v; });

    if (status) { status.className = 'status-msg ok'; status.textContent = 'Sending your quote…'; }
    if (btn) { btn.disabled = true; }

    fetch(QUOTE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) {
      if (!r.ok) throw new Error('Request failed (' + r.status + ')');
      return r.json();
    }).then(function () {
      window.location.href = 'thank-you.html';
    }).catch(function () {
      if (status) {
        status.className = 'status-msg err';
        status.innerHTML = "Sorry, something went wrong sending your quote. Please call us on " +
          "<a href=\"tel:+447375355233\">07375 355233</a> or email " +
          "<a href=\"mailto:info@mbstorage.co.uk\">info@mbstorage.co.uk</a>.";
      }
      if (btn) { btn.disabled = false; }
    });
  });
}
