# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev    # Start dev server (Next.js 16, http://localhost:3000)
npm run build  # Production build
npm run start  # Start production server
```

No test runner or linter is configured.

## What is Cleave

Cleave is a keyboard-driven Gmail client that splits your inbox into sections based on Gmail labels. Emails are **never stored** — they're fetched live from the Gmail API directly from the browser. Auth is handled by Supabase (Google OAuth), and Gmail API calls happen client-side using tokens stored in `sessionStorage`.

## Architecture

**Next.js 16 + React 19 + Supabase + client-side Gmail API**

The app is almost entirely client-side. There are only two server-side routes:
- `src/app/auth/callback/route.ts` — OAuth redirect handler; exchanges Supabase auth code for session and passes Gmail provider tokens via URL hash fragments
- `src/app/api/refresh-token/route.ts` — Proxies Google token refresh (needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` server-side)

### Token flow
1. User signs in via Supabase Google OAuth (requesting `gmail.modify`, `gmail.labels`, `gmail.settings.basic` scopes)
2. Auth callback passes provider tokens as URL hash fragments (never in server logs)
3. `src/components/providers.tsx` captures tokens from hash and stores in `sessionStorage` via `src/lib/gmail-token.ts`
4. All Gmail API calls (`src/lib/gmail.ts`) use these tokens directly from the browser

### Sections model
Sections are derived from Gmail labels prefixed with `Cleave/`. The first section is always "Inbox" (primary, no label filter). The `useSections` hook (`src/hooks/use-sections.ts`) fetches labels and builds the section list. Creating a section creates a Gmail label + filter, then bulk-moves matching threads.

### Inter-component communication
The `SplitInbox` component uses `window.dispatchEvent(new CustomEvent('cleave:*'))` to communicate actions (archive, star, reply, etc.) to child `InboxSection` components. Events include `cleave:archive`, `cleave:star`, `cleave:reply`, `cleave:forward`, `cleave:mark-unread`, `cleave:important`, `cleave:mute`, `cleave:snooze`, `cleave:archive-all`, `cleave:refresh`, `cleave:open`.

### Key conventions
- `@/*` path alias maps to `./src/*`
- Styling: Tailwind CSS v4 + CSS custom properties defined in `globals.css` (light theme only). Use `var(--*)` tokens for colors/fonts, not hardcoded values
- Fonts: `var(--font-mono)` (Azeret Mono) for UI chrome, `var(--font-sans)` (DM Sans) for body text
- Toast notifications via `sonner`
- Icons via `lucide-react`
- No database tables — all data lives in Gmail and Supabase Auth

### Environment variables
See `.env.local.example`:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — server-side token refresh

## Important: Next.js 16

@AGENTS.md
