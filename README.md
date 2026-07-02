# Apikeeper website

This is the public-facing site for your API key system: homepage, docs,
pricing, signup, and a dashboard — all wired up to the real `apikeeper`
backend you already built and deployed.

## How it connects to your backend

This site is just static HTML/CSS/JS — it doesn’t run a server of its own.
Every page that needs real data (signup, dashboard) calls your `apikeeper`
backend directly from the browser, using the address you enter into the
“API base URL” field on those pages. That address is saved in the browser
(`localStorage`), so you only need to enter it once per browser.

- **While testing in Codespaces:** use the forwarded URL for port 3000
  (e.g. `https://your-codespace-name-3000.app.github.dev`).
- **Once deployed for real:** use your real domain (e.g.
  `https://api.yourdomain.com`).

## Files

```
index.html      Homepage
docs.html       API reference (only documents endpoints that actually exist)
pricing.html    Plans, matching what's seeded in your database
signup.html     Real signup form — creates a real key via your backend
dashboard.html  Lists real keys + usage, lets you revoke/create keys
css/style.css   Shared design system
js/api.js       Talks to your backend (base URL + fetch helpers)
```

## Required backend change

Your backend needs CORS enabled so a browser on a different address (this
website) is allowed to call it. This has already been added to your
`src/server.js` — look for the comment `// CORS:` near the top. If you’re
working from the version already on GitHub, add this block right after
`app.use(express.json());`:

```js
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-email');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
```

Without this, signup.html and dashboard.html will fail with a CORS error
in the browser console even though the backend itself is working fine.

## Trying it locally

Open `index.html` directly in a browser, or serve the folder with any
static file server. Go to the signup page, paste in your backend’s URL,
create a key, then go to the dashboard and load it with the same email.

## What’s not real yet

The football match data shown in the ticker and docs is illustrative —
your backend doesn’t have football data endpoints yet (`/v1/fixtures`,
`/v1/livescores`, `/v1/standings` are marked “Coming soon” in docs.html
for this reason). Everything else — signup, key creation, revocation,
usage — is fully real and calls your live server.