/**
 * OAuth client provider for Figma's official MCP server.
 *
 * Implements the SDK's OAuthClientProvider: dynamic client registration,
 * token + client-info persistence to ~/.figmagent/auth.json (0600), PKCE
 * verifier storage, and a first-run interactive flow that spins a loopback
 * HTTP server for the redirect and prints the authorization URL to stderr
 * (stdout is reserved for MCP protocol messages).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { logger } from "../utils.js";

export const AUTH_DIR = join(homedir(), ".figmagent");
export const AUTH_FILE = join(AUTH_DIR, "auth.json");

interface PersistedAuth {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

function readAuthFile(file: string): PersistedAuth {
  try {
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf8")) as PersistedAuth;
  } catch (err) {
    logger.warn(`Failed to read auth file ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

function writeAuthFile(file: string, data: PersistedAuth): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  // mode in writeFileSync only applies on creation — enforce on every write
  chmodSync(file, 0o600);
}

/** Best-effort: open a URL in the user's browser. Failure is fine (headless). */
function tryOpenBrowser(url: string): void {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(opener, [url], { stdio: "ignore", detached: true });
    child.on("error", () => {
      // headless container or no opener — the URL was already printed to stderr
    });
    child.unref();
  } catch {
    // ignore — headless fallback is the printed URL
  }
}

export class FigmaOAuthProvider implements OAuthClientProvider {
  private readonly file: string;
  private callbackServer: Server | null = null;
  private callbackPort = 0;
  private pendingCode: Promise<string> | null = null;
  private resolveCode: ((code: string) => void) | null = null;
  private rejectCode: ((err: Error) => void) | null = null;

  constructor(file: string = AUTH_FILE) {
    this.file = file;
  }

  get redirectUrl(): string {
    return `http://127.0.0.1:${this.callbackPort}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Figmagent",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return readAuthFile(this.file).clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    const data = readAuthFile(this.file);
    data.clientInformation = clientInformation;
    writeAuthFile(this.file, data);
  }

  tokens(): OAuthTokens | undefined {
    return readAuthFile(this.file).tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    const data = readAuthFile(this.file);
    data.tokens = tokens;
    writeAuthFile(this.file, data);
  }

  saveCodeVerifier(codeVerifier: string): void {
    const data = readAuthFile(this.file);
    data.codeVerifier = codeVerifier;
    writeAuthFile(this.file, data);
  }

  codeVerifier(): string {
    const verifier = readAuthFile(this.file).codeVerifier;
    if (!verifier) {
      throw new Error("No PKCE code verifier saved — restart the authorization flow");
    }
    return verifier;
  }

  /**
   * Start the loopback callback server (ephemeral port) before the auth flow
   * begins, so redirectUrl is concrete when the SDK reads clientMetadata.
   */
  async startCallbackServer(): Promise<void> {
    if (this.callbackServer) return;

    this.pendingCode = new Promise<string>((resolve, reject) => {
      this.resolveCode = resolve;
      this.rejectCode = reject;
    });

    await new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url || "/", `http://127.0.0.1:${this.callbackPort}`);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Figmagent authorized.</h2>You can close this tab.</body></html>");
          if (this.resolveCode) this.resolveCode(code);
        } else {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<html><body><h2>Authorization failed.</h2>${error || "No code received."}</body></html>`);
          if (this.rejectCode) this.rejectCode(new Error(`Authorization failed: ${error || "no code received"}`));
        }
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          this.callbackPort = addr.port;
        }
        this.callbackServer = server;
        resolve();
      });
    });
  }

  stopCallbackServer(): void {
    if (this.callbackServer) {
      this.callbackServer.close();
      this.callbackServer = null;
    }
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // stderr only — stdout is the MCP protocol stream
    process.stderr.write(
      `\nFigma authorization required. Open this URL in your browser:\n\n  ${authorizationUrl.toString()}\n\n` +
        `Waiting for the redirect on ${this.redirectUrl} ...\n`,
    );
    tryOpenBrowser(authorizationUrl.toString());
  }

  /** Wait for the authorization code from the loopback redirect. */
  async waitForAuthorizationCode(timeoutMs: number = 5 * 60 * 1000): Promise<string> {
    if (!this.pendingCode) {
      throw new Error("Callback server not started — call startCallbackServer() first");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out waiting for Figma authorization (5 minutes)")), timeoutMs);
    });
    try {
      return await Promise.race([this.pendingCode, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** True when a token has been persisted from a previous session. */
  hasStoredTokens(): boolean {
    return readAuthFile(this.file).tokens !== undefined;
  }
}
