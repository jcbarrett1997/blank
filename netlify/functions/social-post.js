/*
 * MB Storage - automated social posting (scheduled daily).
 *
 * Publishes the next DUE, not-yet-posted entry from social-posts.json to
 * the Facebook Page and (optionally) the linked Instagram Business account
 * via the Meta Graph API. One post per run, so a backlog trickles out
 * rather than all firing at once. Publishing state is tracked in Netlify
 * Blobs ('social-log') so nothing is ever posted twice.
 *
 * NOTE: Facebook GROUPS cannot be automated - Meta removed Groups
 * publishing from the API. Keep cross-posting into local groups by hand.
 *
 * Required Netlify env vars (never commit these):
 *   FB_PAGE_ID            numeric Facebook Page ID
 *   FB_PAGE_ACCESS_TOKEN  long-lived Page access token
 * Optional:
 *   IG_USER_ID            Instagram Business account id linked to the Page
 *   GRAPH_API_VERSION     Graph API version (default v21.0)
 *   SITE_URL              public site base (default https://www.mbstorage.co.uk)
 *
 * See SETUP-SOCIAL.md for how to get the IDs and a long-lived token.
 */

var blobs = require('./lib/blobs');
var schedule = require('./social-posts.json');

var PAGE_ID = process.env.FB_PAGE_ID;
var PAGE_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
var IG_USER_ID = process.env.IG_USER_ID;
var V = process.env.GRAPH_API_VERSION || 'v21.0';
var SITE = (process.env.SITE_URL || 'https://www.mbstorage.co.uk').replace(/\/$/, '');
var GRAPH = 'https://graph.facebook.com/' + V + '/';

function todayInLondon() {
  // en-CA formats as YYYY-MM-DD, matching the schedule's date strings.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

async function graph(path, params) {
  var r = await fetch(GRAPH + path, { method: 'POST', body: new URLSearchParams(params) });
  var text = await r.text();
  var json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  if (!r.ok) {
    throw new Error('Graph ' + r.status + ': ' + ((json.error && json.error.message) || text));
  }
  return json;
}

async function postToFacebook(post, imageUrl) {
  var res = await graph(PAGE_ID + '/photos', {
    url: imageUrl,
    caption: post.caption,
    published: 'true',
    access_token: PAGE_TOKEN
  });
  return res.post_id || res.id;
}

async function postToInstagram(post, imageUrl) {
  var container = await graph(IG_USER_ID + '/media', {
    image_url: imageUrl,
    caption: post.caption,
    access_token: PAGE_TOKEN
  });
  var published = await graph(IG_USER_ID + '/media_publish', {
    creation_id: container.id,
    access_token: PAGE_TOKEN
  });
  return published.id;
}

exports.handler = async function () {
  if (!PAGE_ID || !PAGE_TOKEN) {
    return { statusCode: 200, body: 'social posting not configured' };
  }

  var posts = (schedule.posts || []).slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  var today = todayInLondon();
  var wantIg = !!IG_USER_ID;
  var store = blobs.store('social-log');

  for (var i = 0; i < posts.length; i++) {
    var post = posts[i];
    if (!post.date || post.date > today) continue; // not due yet

    var rec;
    try { rec = await store.get(post.id, { type: 'json' }); } catch (e) { rec = null; }
    rec = rec || { id: post.id, date: post.date };

    if (rec.fb && (!wantIg || rec.ig)) continue; // already fully posted

    var imageUrl = SITE + '/' + String(post.image).replace(/^\//, '');
    var done = [];

    if (!rec.fb) {
      try {
        rec.fb = { id: await postToFacebook(post, imageUrl), at: Date.now() };
        done.push('facebook ' + rec.fb.id);
      } catch (err) {
        console.error('social-post FB failed for ' + post.id + ': ' + err.message);
      }
    }
    if (wantIg && !rec.ig) {
      try {
        rec.ig = { id: await postToInstagram(post, imageUrl), at: Date.now() };
        done.push('instagram ' + rec.ig.id);
      } catch (err) {
        console.error('social-post IG failed for ' + post.id + ': ' + err.message);
      }
    }

    await store.setJSON(post.id, rec);
    // Handle only one post per run so any backlog releases one per day.
    return { statusCode: 200, body: 'posted ' + post.id + ': ' + (done.join(', ') || 'nothing published (see logs)') };
  }

  return { statusCode: 200, body: 'no posts due' };
};
