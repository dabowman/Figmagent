/**
 * MCP client for Figma's official remote server (mcp.figma.com).
 *
 * Wraps the SDK's Streamable HTTP client + OAuth provider. Exposes a single
 * high-level call: runScript() → use_figma tool. Tool errors surface as
 * thrown Errors carrying Figma's message verbatim (their messages state
 * fixes — never truncate them).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { logger } from "../utils.js";
import { FigmaOAuthProvider } from "./auth.js";

const DEFAULT_MCP_URL = "https://mcp.figma.com/mcp";

export interface UseFigmaParams {
  fileKey: string;
  code: string;
  description: string;
}

interface ToolResultContent {
  type: string;
  text?: string;
}

export class RemoteMcpClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private readonly url: string;
  private readonly authProvider: FigmaOAuthProvider;

  constructor(url: string = process.env.FIGMA_MCP_URL || DEFAULT_MCP_URL, authProvider?: FigmaOAuthProvider) {
    this.url = url;
    this.authProvider = authProvider || new FigmaOAuthProvider();
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      // The loopback server must exist before the SDK reads clientMetadata,
      // so redirectUrl carries a concrete port.
      await this.authProvider.startCallbackServer();
      const client = new Client({ name: "figmagent", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(this.url), {
        authProvider: this.authProvider,
      });

      try {
        await client.connect(transport);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          // First run: the SDK already invoked redirectToAuthorization().
          // Wait for the loopback redirect, finish the code exchange, retry.
          logger.info("Waiting for Figma OAuth authorization...");
          const code = await this.authProvider.waitForAuthorizationCode();
          await transport.finishAuth(code);
          await client.connect(
            new StreamableHTTPClientTransport(new URL(this.url), {
              authProvider: this.authProvider,
            }),
          );
        } else {
          throw err;
        }
      } finally {
        this.authProvider.stopCallbackServer();
      }

      this.client = client;
      logger.info(`Connected to Figma remote MCP at ${this.url}`);
      return client;
    })();

    try {
      return await this.connecting;
    } catch (err) {
      // Allow a later retry after a failed connect
      this.connecting = null;
      throw err;
    }
  }

  /**
   * Call any tool on the official server. Returns the parsed JSON when the
   * tool returned JSON text, otherwise the raw text. Tool errors surface as
   * thrown Errors carrying Figma's message verbatim.
   */
  async callOfficialTool(name: string, args: Record<string, unknown>, timeoutMs: number = 120000): Promise<unknown> {
    const client = await this.connect();

    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });

    const content = (result.content || []) as ToolResultContent[];
    const text = content
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");

    if (result.isError) {
      // Figma's error messages already state fixes — pass them through verbatim.
      throw new Error(text || `${name} returned an error with no message`);
    }

    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * Execute a Plugin API script in the target file via use_figma.
   * Returns the parsed JSON when the script returned JSON.stringify(...),
   * otherwise the raw text.
   */
  async runScript(params: UseFigmaParams, timeoutMs: number = 120000): Promise<unknown> {
    return this.callOfficialTool(
      "use_figma",
      { fileKey: params.fileKey, code: params.code, description: params.description },
      timeoutMs,
    );
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.connecting = null;
    }
  }

  /**
   * Force a fresh OAuth flow: drop any cached connection, wipe the stored token,
   * then reconnect — which (with no token) re-triggers the browser authorization
   * and blocks until the loopback redirect completes. Lets the user pick a
   * different Figma account without hand-editing ~/.figmagent/auth.json.
   *
   * The token is persisted by the SDK as soon as the code exchange succeeds, so
   * even if the caller abandons the awaited promise (e.g. a harness tool-call
   * timeout) the login still lands and the next command is authenticated.
   *
   * @returns the account info from whoami when the official server exposes it.
   */
  async reauthenticate(forgetClient: boolean = false): Promise<{ authUrl: string | null; account: unknown }> {
    await this.close();
    this.authProvider.clearStoredAuth(forgetClient);
    await this.connect();
    let account: unknown = null;
    try {
      // Best-effort: confirm which account is now authed. Swallow if the
      // server doesn't expose whoami — the reauth itself already succeeded.
      account = await this.callOfficialTool("whoami", {}, 15000);
    } catch (err) {
      logger.info(`whoami after reauth unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { authUrl: this.authProvider.lastAuthorizationUrl, account };
  }
}

let sharedClient: RemoteMcpClient | null = null;

export function getRemoteClient(): RemoteMcpClient {
  if (!sharedClient) {
    sharedClient = new RemoteMcpClient();
  }
  return sharedClient;
}

/** Inject a mock client (tests only). Pass null to restore the real one. */
export function setRemoteClientForTests(client: RemoteMcpClient | null): void {
  sharedClient = client;
}
