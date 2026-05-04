# Cleave

Keyboard-driven Gmail client that splits your inbox by Gmail labels.

Cleave is **not a hosted service**. It's a self-hosted, browser-based Gmail UI you run on your own Google Cloud + Supabase setup. Email is **never stored** — everything is fetched live from the Gmail API in your browser.

![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg) ![Next.js](https://img.shields.io/badge/Next.js-16-black) ![React](https://img.shields.io/badge/React-19-61dafb)

> Screenshots go here once captured.

## Why

Gmail is fine until your inbox is doing five jobs at once: receipts, newsletters, work threads, GitHub noise, calendar invites. Cleave lets you pin any Gmail label as a side-by-side section, switch between them with `H`/`L`, and keep moving with `J`/`K`/`E`. No tabs, no folders to babysit, no clients syncing in the background — it's a thin keyboard UI on top of the Gmail API.

## Features

- **Split inbox** — pin any Gmail label (prefixed `Cleave/`) as its own section
- **Keyboard first** — `J`/`K` navigate, `E` archive, `S` star, `R` reply, `?` shows the full list
- **Command palette** — `Cmd+K` for everything
- **Snooze, mute, archive-all** — real Gmail actions, not local hacks
- **Search** — straight to Gmail's search syntax
- **Calendar peek** — quick view of upcoming events from your Google Calendar
- **No storage** — emails live in Gmail, tokens live in your browser's `sessionStorage`. Nothing else stores email content.

## Privacy & data flow

- **Auth**: Supabase Google OAuth (you provide your own Supabase project + Google client)
- **Tokens**: stored in browser `sessionStorage`, refreshed via `/api/refresh-token` (server route that holds your `GOOGLE_CLIENT_SECRET`)
- **Gmail API calls**: made directly from the browser to Google
- **No database tables**: there is no Cleave database. Supabase only holds the auth user record.

Because Cleave uses the restricted `gmail.modify` scope, hosting a public version requires Google's full OAuth verification + a CASA security assessment (~$10k+/year). That's why this project is self-host only.

## Self-host setup

You'll need a Google Cloud project, a Supabase project, and Node 20+.

### 1. Clone + install

```bash
git clone https://github.com/myerekapan/cleave.git
cd cleave
npm install
cp .env.local.example .env.local
```

### 2. Google Cloud Console

1. Create / open a project → **APIs & Services → Library** → enable both **Gmail API** and **Google Calendar API**
2. **OAuth consent screen**:
   - User type: External
   - Add scopes:
     - `https://www.googleapis.com/auth/gmail.modify`
     - `https://www.googleapis.com/auth/gmail.labels`
     - `https://www.googleapis.com/auth/gmail.settings.basic`
     - `https://www.googleapis.com/auth/calendar`
   - Add yourself (and anyone you want to share with) under **Test users** — leave the app in **Testing** mode. You can have up to 100 test users without going through Google verification.
3. **Credentials** → create **OAuth 2.0 Client ID** → Web application
   - Authorized JavaScript origin: `http://localhost:3000` (and your prod URL if deploying)
   - Authorized redirect URIs (add **all** of the following):
     - `https://<your-supabase-project>.supabase.co/auth/v1/callback` — primary Supabase sign-in
     - `http://localhost:3000/api/google/oauth/callback` — dev, side-channel flow for adding extra Gmail accounts
     - `https://<your-prod-domain>/api/google/oauth/callback` — prod, same as above
   - Without the side-channel callback URIs, the **Add account** flow will fail with `redirect_uri_mismatch` from Google.
4. Copy the Client ID and Client Secret into `.env.local` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).

### 3. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. **Authentication → Providers → Google** — paste the Client ID + Secret from step 2
3. **Authentication → URL Configuration**:
   - Set **Site URL** to `http://localhost:3000` (or your prod URL if deploying)
   - Under **Redirect URLs**, add `http://localhost:3000/auth/callback` (and your prod callback URL if deploying)
4. Copy the Project URL and anon key (from **Project Settings → API**) into `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

### 4. Run

```bash
npm run dev
```

Open <http://localhost:3000>, sign in with the Google account you added as a test user.

### Deploy

Cleave runs on any Node host that supports Next.js 16 (Vercel, Fly, Railway, your own server). The `/api/refresh-token` route requires `GOOGLE_CLIENT_SECRET` server-side, so a static-only deploy won't work.

For Vercel:

```bash
vercel
```

Then set the env vars in the Vercel dashboard and update the OAuth redirect URIs / Supabase URL configuration to include your production URL.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `J` / `K` | Next / previous email |
| `H` / `L` | Previous / next section |
| `E` | Archive |
| `S` | Star |
| `R` | Reply |
| `F` | Forward |
| `M` | Mute thread |
| `Z` | Snooze |
| `U` | Mark unread |
| `I` | Mark important |
| `Enter` | Open in Gmail |
| `C` | Compose |
| `/` | Search |
| `Cmd+K` | Command palette |
| `,` | Settings |
| `?` | Show all shortcuts |

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router) + [React 19](https://react.dev)
- [Supabase](https://supabase.com) auth (Google OAuth provider)
- [Tailwind CSS v4](https://tailwindcss.com)
- [lucide-react](https://lucide.dev) icons
- [sonner](https://sonner.emilkowal.ski/) toasts

Architecture notes live in [`CLAUDE.md`](./CLAUDE.md) and [`AGENTS.md`](./AGENTS.md).

## Contributing

PRs welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup, conventions, and the project tour.

## License

[AGPL-3.0-only](./LICENSE). If you run a modified version as a network service, you must publish your changes under the same license.
