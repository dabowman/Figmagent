import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FigmaOAuthProvider } from "../src/figmagent_mcp/remote/auth";

const tmpDirs: string[] = [];

function tempAuthFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "figmagent-auth-"));
  tmpDirs.push(dir);
  return join(dir, "auth.json");
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe("FigmaOAuthProvider persistence", () => {
  test("tokens round-trip and survive a new provider instance", () => {
    const file = tempAuthFile();
    const provider = new FigmaOAuthProvider(file);

    expect(provider.tokens()).toBeUndefined();
    expect(provider.hasStoredTokens()).toBe(false);

    const tokens = { access_token: "at-123", token_type: "Bearer", refresh_token: "rt-456", expires_in: 3600 };
    provider.saveTokens(tokens);

    expect(provider.tokens()).toEqual(tokens);
    expect(provider.hasStoredTokens()).toBe(true);

    // Fresh instance reads the same file — survives a server restart
    const reloaded = new FigmaOAuthProvider(file);
    expect(reloaded.tokens()).toEqual(tokens);
  });

  test("client information round-trips alongside tokens", () => {
    const file = tempAuthFile();
    const provider = new FigmaOAuthProvider(file);

    const info = { client_id: "client-abc", redirect_uris: ["http://127.0.0.1:1234/callback"] };
    provider.saveClientInformation(info as any);
    provider.saveTokens({ access_token: "at", token_type: "Bearer" });

    expect(provider.clientInformation()).toEqual(info as any);
    expect(provider.tokens()).toEqual({ access_token: "at", token_type: "Bearer" });
  });

  test("code verifier round-trips; missing verifier states the fix", () => {
    const file = tempAuthFile();
    const provider = new FigmaOAuthProvider(file);

    expect(() => provider.codeVerifier()).toThrow("restart the authorization flow");
    provider.saveCodeVerifier("pkce-verifier-xyz");
    expect(provider.codeVerifier()).toBe("pkce-verifier-xyz");
  });

  test("auth file is written with 0600 permissions", () => {
    const file = tempAuthFile();
    const provider = new FigmaOAuthProvider(file);
    provider.saveTokens({ access_token: "secret", token_type: "Bearer" });

    expect(existsSync(file)).toBe(true);
    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("corrupt auth file is treated as empty, not fatal", async () => {
    const file = tempAuthFile();
    await Bun.write(file, "{ not json");
    const provider = new FigmaOAuthProvider(file);
    expect(provider.tokens()).toBeUndefined();
  });
});

describe("FigmaOAuthProvider metadata", () => {
  test("client metadata declares PKCE-friendly public client", () => {
    const provider = new FigmaOAuthProvider(tempAuthFile());
    const meta = provider.clientMetadata;
    // "Claude Code" prefix required — Figma's DCR endpoint allowlists known
    // client names and 403s everything else (verified live 2026-06-11).
    expect(meta.client_name).toBe("Claude Code (Figmagent)");
    expect(meta.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(meta.token_endpoint_auth_method).toBe("none");
  });

  test("callback server binds an ephemeral loopback port for redirectUrl", async () => {
    const provider = new FigmaOAuthProvider(tempAuthFile());
    await provider.startCallbackServer();
    try {
      expect(provider.redirectUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      expect(provider.redirectUrl).not.toContain(":0/");
    } finally {
      provider.stopCallbackServer();
    }
  });

  test("loopback redirect delivers the authorization code", async () => {
    const provider = new FigmaOAuthProvider(tempAuthFile());
    await provider.startCallbackServer();
    try {
      const url = new URL(provider.redirectUrl);
      url.searchParams.set("code", "auth-code-789");
      const codePromise = provider.waitForAuthorizationCode();
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(await codePromise).toBe("auth-code-789");
    } finally {
      provider.stopCallbackServer();
    }
  });
});
