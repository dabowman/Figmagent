import { z } from "zod";
import { server } from "../instance.js";
import { getRemoteClient } from "../remote/client.js";
import { hasStoredAuth } from "../remote/auth.js";

server.tool(
  "reauthenticate",
  `Re-run Figma OAuth for the remote transport. Use this when Figma commands fail with
"you don't have edit access" or an authorization/401/403 error — typically because the
stored token belongs to the wrong Figma account, or expired and can't refresh.

Clears the cached token in ~/.figmagent/auth.json, opens the Figma authorization page in
your browser, and waits for you to finish login (the URL is also returned in case the
browser doesn't open). On success it reports which account is now authenticated, so you
can confirm you picked one with editor access to the file.

Notes:
- Remote transport only. The plugin transport inherits your live Figma session and has no
  separate token — nothing to re-authenticate there.
- The browser flow can take up to ~5 minutes. Even if this call times out at the harness
  level, the login still completes and the token is saved — just retry your command.
- Set forgetClient=true only if registration itself looks broken (rare); it forces fresh
  dynamic client registration instead of reusing the existing client.`,
  {
    forgetClient: z
      .boolean()
      .optional()
      .describe(
        "Also drop the registered OAuth client and re-register from scratch. Default false (reuse the existing client, just re-authorize and pick an account).",
      ),
  },
  async ({ forgetClient }: any) => {
    const hadToken = hasStoredAuth();
    try {
      const { authUrl, account } = await getRemoteClient().reauthenticate(forgetClient === true);

      const lines = [
        hadToken
          ? "Re-authenticated with Figma's remote MCP. The previous token was replaced."
          : "Authenticated with Figma's remote MCP.",
      ];
      if (account != null) {
        lines.push(
          `\nAuthenticated account:\n${typeof account === "string" ? account : JSON.stringify(account, null, 2)}`,
        );
        lines.push("\nConfirm this account has editor access to your target file.");
      } else {
        lines.push("\nMake sure the account you just authorized has editor access to your target file.");
      }
      if (authUrl) lines.push(`\nAuthorization URL (if you need to repeat it): ${authUrl}`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `Re-authentication did not complete: ${msg}\n\n` +
              "The token was cleared, so your next Figma command will trigger the browser login again. " +
              "If the browser didn't open, complete the flow at the authorization URL printed to the MCP server's stderr.",
          },
        ],
      };
    }
  },
);
