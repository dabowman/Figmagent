---
description: Re-authenticate Figmagent's remote transport with Figma (re-run OAuth, pick an account)
argument-hint: "[--forget-client]"
allowed-tools: mcp__Figmagent__reauthenticate
---

Re-authenticate Figmagent's **remote transport** with Figma by calling the
`mcp__Figmagent__reauthenticate` tool. Use this when Figma commands fail with an
authorization error or "you don't have edit access" — usually because the cached
token in `~/.figmagent/auth.json` belongs to the wrong Figma account, or expired
and can't refresh.

Steps:

1. Tell the user a browser window will open for Figma login, and to choose an account
   that has **editor** access to their target file (the remote transport runs every
   command — reads included — as a `use_figma` script, which requires edit rights).
2. Call `mcp__Figmagent__reauthenticate`. Pass `forgetClient: true` only if the user
   included `--forget-client` in `$ARGUMENTS` (forces fresh OAuth client registration;
   rarely needed).
3. Relay the result: report which account got authenticated if the tool returned it,
   and confirm whether it should now have edit access. If the tool reports a timeout or
   the browser didn't open, give the user the authorization URL it returned so they can
   complete login manually.

Notes:
- This is a no-op concept on the plugin transport (no separate token). If the user is on
  the plugin transport, say so instead of forcing a re-auth.
- The browser flow can take up to ~5 minutes. Even if the tool call times out at the
  harness level, the login still completes and the token is saved — the next Figma
  command will be authenticated.
