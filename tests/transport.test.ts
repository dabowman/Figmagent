import { describe, expect, test } from "bun:test";
import { resolveTransportName } from "../src/figmagent_mcp/transport";
import { assembleScript, enqueuePerFile, resetQueuesForTests } from "../src/figmagent_mcp/remote/executor";

describe("resolveTransportName", () => {
  test("defaults to auto (Phase 6 flip) — plugin when the relay is reachable", () => {
    expect(resolveTransportName({}, true)).toBe("plugin");
  });

  test("auto without a reachable relay falls back to the token-based choice", () => {
    // Depends on whether ~/.figmagent/auth.json exists on this machine —
    // assert it picks one of the two deterministically.
    expect(["plugin", "remote"]).toContain(resolveTransportName({}, false));
  });

  test("auto with a reachable relay prefers plugin even when authed", () => {
    expect(resolveTransportName({ FIGMA_TRANSPORT: "auto" }, true)).toBe("plugin");
  });

  test("honors FIGMA_TRANSPORT=remote", () => {
    expect(resolveTransportName({ FIGMA_TRANSPORT: "remote" })).toBe("remote");
  });

  test("honors FIGMA_TRANSPORT=plugin", () => {
    expect(resolveTransportName({ FIGMA_TRANSPORT: "plugin" })).toBe("plugin");
  });

  test("is case-insensitive", () => {
    expect(resolveTransportName({ FIGMA_TRANSPORT: "REMOTE" })).toBe("remote");
  });

  test("unknown values fall back to plugin", () => {
    expect(resolveTransportName({ FIGMA_TRANSPORT: "websocket" })).toBe("plugin");
  });

  test("auto resolves to plugin or remote without throwing", () => {
    // Depends on whether ~/.figmagent/auth.json exists on this machine —
    // assert it picks one of the two deterministically.
    const name = resolveTransportName({ FIGMA_TRANSPORT: "auto" });
    expect(["plugin", "remote"]).toContain(name);
  });
});

describe("per-file FIFO queue", () => {
  test("two commands on the same fileKey run sequentially", async () => {
    resetQueuesForTests();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = enqueuePerFile("fileA", async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
      return 1;
    });
    const second = enqueuePerFile("fileA", async () => {
      order.push("second:start");
      return 2;
    });

    // Give the second task a chance to (incorrectly) start
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["first:start"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  test("different fileKeys do not serialize against each other", async () => {
    resetQueuesForTests();
    const order: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const a = enqueuePerFile("fileA", async () => {
      order.push("a:start");
      await gateA;
      order.push("a:end");
    });
    const b = enqueuePerFile("fileB", async () => {
      order.push("b:done");
    });

    await b;
    expect(order).toContain("b:done");
    expect(order).not.toContain("a:end");
    releaseA();
    await a;
  });

  test("a rejected task does not block the queue", async () => {
    resetQueuesForTests();
    const failing = enqueuePerFile("fileC", async () => {
      throw new Error("boom");
    });
    const next = enqueuePerFile("fileC", async () => "ok");

    await expect(failing).rejects.toThrow("boom");
    expect(await next).toBe("ok");
  });
});

describe("script assembly", () => {
  test("assembled script has bundle + params + handler call + return", async () => {
    const script = await assembleScript("get_document_info", {});
    // Entry shim namespace from the bundled IIFE
    expect(script).toContain("__figmagent");
    expect(script).toContain("const __params = {};");
    expect(script).toContain('await globalThis.__figmagent["get_document_info"](__params)');
    expect(script).toContain("return JSON.stringify(__r === undefined ? null : __r);");
  });

  test("unknown command throws", async () => {
    await expect(assembleScript("not_a_command", {})).rejects.toThrow("No remote domain registered");
  });

  test("oversized params hit the 50KB guard and name the dominant param", async () => {
    const big = { nodeId: "1:2", nodes: "x".repeat(60000) };
    await expect(assembleScript("create", big)).rejects.toThrow(/over the 49000.*nodes/s);
  });
});

describe("chunked create fallback", () => {
  test("oversized create with a single monolithic node surfaces the budget error", async () => {
    const { executeRemoteCommand } = await import("../src/figmagent_mcp/remote/executor");
    // One giant childless node — nothing to split at depth-1, so the
    // original 50KB guard error must surface (no network touched).
    const tree = { type: "TEXT", name: "huge", text: "x".repeat(60000) };
    await expect(
      executeRemoteCommand({ fileKey: "f", command: "create", params: { tree }, atomicWrite: true }),
    ).rejects.toThrow(/over the 49000/);
  });

  test("oversized create with one giant child names the unsplittable child", async () => {
    const { executeRemoteCommand } = await import("../src/figmagent_mcp/remote/executor");
    const tree = {
      type: "FRAME",
      name: "root",
      children: [
        { type: "TEXT", name: "small", text: "hi" },
        { type: "TEXT", name: "giant", text: "x".repeat(60000) },
      ],
    };
    await expect(
      executeRemoteCommand({ fileKey: "f", command: "create", params: { tree }, atomicWrite: true }),
    ).rejects.toThrow(/cannot be chunked.*giant/s);
  });
});
