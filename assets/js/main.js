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
  initWhatsAppButton();
  initBookingForm();
});

/* ------------------------------------------------------------------
   Online booking form (book.html).
   Posts to /.netlify/functions/book, which re-checks availability and
   returns a Stripe Checkout URL; the browser then redirects there to pay
   the refundable deposit. Deposit amounts live server-side only.
   Live availability (from /.netlify/functions/availability) is shown as
   a hint under the size selector and full options are disabled.
------------------------------------------------------------------- */
/* Bookings are only taken up to 3 days ahead - we can't guarantee
   availability further out. Clamp the date picker to today..+3 days. */
function clampBookingDate(input) {
  if (!input) return;
  var fmt = function (d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  var today = new Date();
  var max = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
  input.min = fmt(today);
  input.max = fmt(max);
}

function initBookingForm() {
  var form = document.getElementById('book-form');
  if (!form) return;
  clampBookingDate(document.getElementById('b-date'));

  // Pre-fill from the quote email's "Book online now" link
  var params = new URLSearchParams(window.location.search);
  [['site', 'b-site'], ['size', 'b-size'], ['name', 'b-name'], ['email', 'b-email'], ['phone', 'b-phone']].forEach(function (pair) {
    var val = params.get(pair[0]);
    var el = document.getElementById(pair[1]);
    if (!val || !el) return;
    if (el.tagName === 'SELECT') {
      if (el.querySelector('option[value="' + val + '"]')) el.value = val;
    } else {
      el.value = val;
    }
  });
  var status = document.getElementById('book-status');
  var btn = form.querySelector('button[type="submit"]');
  var siteSel = document.getElementById('b-site');
  var sizeSel = document.getElementById('b-size');
  var availHint = document.getElementById('b-availability');
  var availability = null;

  fetch('/.netlify/functions/availability')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && data.configured) { availability = data.availability || {}; updateAvail(); }
    })
    .catch(function () { /* no availability - booking still works */ });

  function updateAvail() {
    if (!availability || !availHint) return;
    var site = siteSel && siteSel.value;
    var size = sizeSel && sizeSel.value;
    if (!site || !size) { availHint.innerHTML = ''; return; }
    var free = (availability[site] || {})[size];
    if (free === undefined) { availHint.innerHTML = ''; return; }
    if (free <= 0) {
      availHint.innerHTML = '<span class="avail-badge full">⛔ None left to book online at this site - call <a href="tel:+447375355233">07375 355233</a> to join the waiting list.</span>';
    } else if (free <= 3) {
      availHint.innerHTML = '<span class="avail-badge low">⚠️ Only ' + free + (free === 1 ? ' unit' : ' units') + ' left to book online at this site - book now to secure yours.</span>';
    } else {
      availHint.innerHTML = '<span class="avail-badge ok">✓ Available to book online now.</span>';
    }
  }
  /* 8ft containers only exist at Batley - physically prevent the
     Liversedge + 8ft combination rather than erroring at checkout. */
  function enforceSiteSizes() {
    if (!siteSel || !sizeSel) return;
    var opt8 = sizeSel.querySelector('option[value="8ft"]');
    if (!opt8) return;
    var isLiversedge = siteSel.value === 'liversedge';
    opt8.disabled = isLiversedge;
    if (isLiversedge && sizeSel.value === '8ft') {
      sizeSel.value = '';
      if (availHint) availHint.innerHTML = '<strong style="color:#b3261e">8ft containers are available at our Batley site only</strong> - please choose the 20ft, or switch site to Batley.';
    }
  }
  if (siteSel) siteSel.addEventListener('change', function () { enforceSiteSizes(); updateAvail(); });
  if (sizeSel) sizeSel.addEventListener('change', function () { enforceSiteSizes(); updateAvail(); });
  enforceSiteSizes();

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    if (availability && siteSel && sizeSel && siteSel.value && sizeSel.value) {
      var free = (availability[siteSel.value] || {})[sizeSel.value];
      if (free !== undefined && free <= 0) {
        if (status) { status.className = 'status-msg err'; status.textContent = 'Sorry - that size is currently full at this site. Please call 07375 355233.'; }
        return;
      }
    }

    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = v; });

    if (status) { status.className = 'status-msg ok'; status.textContent = 'Taking you to secure payment…'; }
    if (btn) { btn.disabled = true; }

    fetch('/.netlify/functions/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) {
      return r.json().then(function (body) { return { ok: r.ok, body: body }; });
    }).then(function (res) {
      if (res.ok && res.body && res.body.url) { window.location.href = res.body.url; return; }
      throw new Error((res.body && res.body.error) || 'Booking failed');
    }).catch(function (err) {
      if (status) {
        status.className = 'status-msg err';
        status.textContent = (err && err.message && err.message !== 'Failed to fetch') ? err.message :
          'Sorry, something went wrong. Please call us on 07375 355233.';
      }
      if (btn) { btn.disabled = false; }
    });
  });
}

/* Floating WhatsApp click-to-chat bubble, added to every page. */
var WHATSAPP_URL = 'https://wa.me/447375355233?text=' +
  encodeURIComponent("Hi MB Storage, I'd like to ask about storage.");

function initWhatsAppButton() {
  var a = document.createElement('a');
  a.className = 'wa-float';
  a.href = WHATSAPP_URL;
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', 'Chat with us on WhatsApp');
  a.innerHTML =
    '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#fff" d="M16 3C9.4 3 4 8.3 4 14.9c0 2.1.6 4.1 1.6 5.9L4 29l8.4-1.6c1.7.9 3.5 1.4 5.5 1.4h.1c6.6 0 12-5.3 12-11.9C30 8.3 24.6 3 16 3zm.1 21.8c-1.8 0-3.5-.5-5-1.3l-.4-.2-5 1 1-4.8-.3-.4c-1-1.6-1.5-3.4-1.5-5.2 0-5.5 4.5-9.9 10.1-9.9 2.7 0 5.2 1 7.1 2.9 1.9 1.9 3 4.4 2.9 7.1 0 5.4-4.5 9.8-9.9 9.8zm5.5-7.4c-.3-.2-1.8-.9-2-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.2-.7-1.7-1-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.2-.6-.4z"/></svg>' +
    '<span>WhatsApp us</span>';
  document.body.appendChild(a);
}

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
