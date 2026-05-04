# Contributing to Cleave

Thanks for your interest. Cleave is a small project — one maintainer, no roadmap committee — so the bar for contributions is "does it make Cleave better for someone using it as a Gmail client." Bug fixes, keyboard shortcuts, and small UX wins are easy yeses. Architectural rewrites or new providers (Outlook, Fastmail) are unlikely to be merged without prior discussion.

## Local setup

Same as the [self-host setup in the README](./README.md#self-host-setup) — clone, `npm install`, configure your own Google Cloud + Supabase project, `npm run dev`. There's no separate dev fixture; you sign in with a real Gmail account in test mode.

## Project tour

```
src/
├── app/                       # Next.js App Router
│   ├── api/refresh-token/     # Server route — proxies Google token refresh (needs GOOGLE_CLIENT_SECRET)
│   ├── auth/callback/         # OAuth redirect handler
│   ├── settings/              # Settings page
│   └── page.tsx               # Mounts <SplitInbox /> behind auth middleware
├── components/
│   ├── inbox/
│   │   ├── split-inbox.tsx    # Top-level inbox shell — keyboard handling, sections, command bar
│   │   ├── inbox-section.tsx  # Per-section email list + actions
│   │   └── compose-pane.tsx   # Compose / reply / forward pane
│   └── providers.tsx          # Captures OAuth tokens from URL hash and writes to sessionStorage
├── hooks/
│   └── use-sections.ts        # Builds the section list from Gmail labels prefixed Cleave/
├── lib/
│   ├── gmail.ts               # All Gmail API calls (browser-side)
│   └── gmail-token.ts         # sessionStorage token helpers
└── middleware.ts              # Auth gate
```

Architecture notes — including the section model, the `cleave:*` custom-event communication pattern, and the token flow — live in [`CLAUDE.md`](./CLAUDE.md). Read it before making cross-cutting changes.

## Conventions

- **Path alias**: `@/*` → `./src/*`
- **Styling**: Tailwind CSS v4 + CSS custom properties from `globals.css`. Use `var(--*)` tokens, not hardcoded colors or fonts.
- **Fonts**: `var(--font-mono)` (Azeret Mono) for chrome, `var(--font-sans)` (DM Sans) for body
- **Toasts**: `sonner`
- **Icons**: `lucide-react`
- **Light theme only** — no dark mode currently. Don't add one without discussion.
- **Inter-component events**: actions like archive / reply / refresh flow from `<SplitInbox />` to `<InboxSection />` via `window.dispatchEvent(new CustomEvent('cleave:*'))`. Reuse the existing event names; don't invent new state plumbing.

## Commits

Single-line conventional commits:

```
fix: archive shortcut leaving thread selected
feat: add mute action to command palette
style: tighten compose pane spacing on mobile
chore: bump next to 16.2.2
```

Common types: `fix`, `feat`, `style`, `chore`, `docs`, `refactor`. No body, no Co-Authored-By trailers, no scopes.

## Pull requests

- Keep PRs small and focused. One concern per PR.
- Don't bundle unrelated refactors with feature work.
- For UI changes, attach a screenshot or short clip — the maintainer is going to want to see it before merging.
- Don't introduce new dependencies without a one-line justification in the PR description.
- There's no test suite or linter configured. Run `npm run build` locally before opening the PR — type errors fail the build.

## Issues

- **bug** — something isn't working
- **enhancement** — feature requests
- **good first issue** — small, well-scoped, no architectural decisions needed
- **help wanted** — maintainer doesn't plan to take this; PRs welcome
- **wontfix** — explicitly out of scope

If you're picking up a `good first issue`, drop a comment so two people don't end up working on it in parallel.

## Security

If you find a security issue (token leak path, XSS, OAuth misuse, anything that could compromise a user's Gmail), please **email** rather than opening a public issue. The contact is in the GitHub profile.
