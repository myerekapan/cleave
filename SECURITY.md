# Security Policy

## Reporting a vulnerability

If you find a security issue in Cleave — anything that could compromise a user's Gmail account, leak OAuth tokens, expose mailbox content, or allow XSS / injection in the app — please **do not** open a public GitHub issue.

Use one of these channels instead:

1. **GitHub private security advisory** (preferred) — open a draft advisory under the [Security tab](https://github.com/myerekapan/cleave/security/advisories/new) of this repo. Maintainer is notified and the discussion stays private until a fix ships.
2. **Email** — the maintainer's contact is on their [GitHub profile](https://github.com/myerekapan).

Please include:

- A description of the issue and its impact
- Steps to reproduce, or a minimal proof-of-concept
- The version / commit hash you tested against

You should expect an initial response within a few days. There is no bug bounty.

## Scope

Cleave is a self-hosted Gmail client. Each install runs against the operator's own Google Cloud OAuth credentials and Supabase project — there is no central Cleave service to compromise. In-scope reports are issues in the upstream code that affect any self-hosted instance: e.g., token mishandling, XSS, OAuth scope misuse, dependency vulnerabilities.

Out of scope:

- Misconfigurations of a self-hoster's own Google Cloud / Supabase / Vercel project
- Issues in upstream dependencies (Next.js, Supabase, Gmail API) — please report those directly to the relevant project
- Social engineering or phishing of individual users
