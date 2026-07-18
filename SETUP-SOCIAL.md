# Automated social posting (Facebook Page + Instagram)

This adds a scheduled Netlify function (`social-post`) that publishes your
pre-made graphics and captions to your **Facebook Page** and, optionally,
your **Instagram Business** account - one post per day from the schedule in
`netlify/functions/social-posts.json`.

### Important: groups can't be automated
Meta removed the ability for any app to post into **Facebook groups**. No tool
(this one, Zapier, Buffer, Meta's own scheduler) can do it. Keep cross-posting
into your local Batley / Liversedge / Spen Valley groups **by hand** - the
graphics live in `assets/img/social/` and you already have them saved.

---

## What you need to set up (one time)

You need three values, stored as Netlify environment variables. Getting the
token is the only fiddly bit - it takes about 15 minutes.

### 1. Make sure Instagram is linked (only if you want IG posting)
Your Instagram must be a **Business** (or Creator) account and linked to your
Facebook Page in Meta Business settings. If you only want Facebook, skip this.

### 2. Create a Meta app
1. Go to <https://developers.facebook.com/apps> → **Create app** → choose
   **Business**.
2. Give it a name (e.g. "MB Storage Poster"). Note the **App ID** and, under
   **App settings → Basic**, the **App secret**.
3. You can leave the app in **Development** mode - because you're posting to a
   Page and Instagram account you own/admin, you do **not** need to submit it
   for App Review.

### 3. Get a long-lived Page access token
1. Open the **Graph API Explorer**:
   <https://developers.facebook.com/tools/explorer>
2. Top right, select your app.
3. Click **Generate Access Token** and grant these permissions:
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
   `business_management`, `instagram_basic`, `instagram_content_publish`.
   This gives a **short-lived user token** - copy it.
4. Swap it for a **long-lived user token** (paste in a browser, filling in
   the three values):
   ```
   https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_USER_TOKEN
   ```
   Copy the `access_token` it returns.
5. Get your **Page token + Page ID** (paste in a browser):
   ```
   https://graph.facebook.com/v21.0/me/accounts?access_token=LONG_USER_TOKEN
   ```
   Find your Page in the list. Its `id` is your **FB_PAGE_ID**, and its
   `access_token` is your **FB_PAGE_ACCESS_TOKEN**. This Page token is
   long-lived and does not expire unless you change your password or revoke
   the app.
6. (Instagram only) Get your **IG user id** (paste in a browser):
   ```
   https://graph.facebook.com/v21.0/FB_PAGE_ID?fields=instagram_business_account&access_token=FB_PAGE_ACCESS_TOKEN
   ```
   `instagram_business_account.id` is your **IG_USER_ID**.

### 4. Add the Netlify environment variables
In Netlify → **Site configuration → Environment variables**, add:

| Key | Value |
| --- | --- |
| `FB_PAGE_ID` | the numeric Page id from step 5 |
| `FB_PAGE_ACCESS_TOKEN` | the Page `access_token` from step 5 |
| `IG_USER_ID` | *(optional)* the id from step 6 - omit to post to Facebook only |

`SITE_URL` is already set. **Never** put these tokens in the repo - env vars
only. Redeploy after adding them.

Until `FB_PAGE_ID` and `FB_PAGE_ACCESS_TOKEN` are set, the function safely
does nothing.

---

## How it runs

- Runs daily at **10:00 UTC** (see `netlify.toml`).
- Publishes the **next due, not-yet-posted** entry from
  `netlify/functions/social-posts.json` - at most **one per run**, so if a few
  are overdue they release one a day rather than all at once.
- Every post is recorded in Netlify Blobs (`social-log`), so nothing is ever
  posted twice, even across redeploys.

## Editing the schedule

Open `netlify/functions/social-posts.json`. Each entry has:

- `id` - unique, don't reuse an id once it's been posted.
- `date` - `YYYY-MM-DD`, UK time. The post goes out on/after this date.
- `image` - path under the live site (files are in `assets/img/social/`).
- `caption` - the full post text, including hashtags. `\n` is a line break.

To keep the rotation going after the last post, add new dated entries (or
give the existing ones new ids and future dates). Commit and it deploys.

## Testing

Set one entry's `date` to today, deploy, and either wait for the 10:00 UTC
run or invoke it manually with the Netlify CLI:
```
netlify functions:invoke social-post
```
Check **Netlify → Functions → social-post → logs** for the result. Errors from
Meta (bad token, missing permission) are logged there with the Graph message.
