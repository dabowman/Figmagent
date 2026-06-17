import { afterEach, describe, expect, test } from "bun:test";
import { RemoteMcpClient, setRemoteClientForTests, type UseFigmaParams } from "../src/figmagent_mcp/remote/client";
import { executeRemoteCommand, resetQueuesForTests } from "../src/figmagent_mcp/remote/executor";

/**
 * Mock client that intercepts assembled scripts, extracts the create params,
 * and returns synthetic create results — exercising the chunk split/merge
 * logic without network or OAuth.
 */
class MockClient extends RemoteMcpClient {
  calls: { params: { parentId?: string; tree: any } }[] = [];
  failOnCall: number | null = null;
  private counter = 0;

  override async runScript(params: UseFigmaParams): Promise<unknown> {
    // The assembled script embeds `const __params = {...};` — extract it.
    const match = params.code.match(/const __params = (.*);\n/);
    const createParams = JSON.parse(match![1]);
    this.calls.push({ params: createParams });

    if (this.failOnCall !== null && this.calls.length === this.failOnCall) {
      throw new Error("Simulated mid-chunk failure");
    }

    const countNodes = (spec: any): number =>
      1 + (Array.isArray(spec.children) ? spec.children.reduce((s: number, c: any) => s + countNodes(c), 0) : 0);

    this.counter++;
    return {
      success: true,
      totalNodesCreated: countNodes(createParams.tree),
      tree: {
        id: `mock:${this.counter}`,
        name: createParams.tree.name || "node",
        type: createParams.tree.type || "FRAME",
        children: [],
      },
    };
  }
}

function bigTree(childCount: number, charsPerChild: number) {
  return {
    type: "FRAME",
    name: "root",
    children: Array.from({ length: childCount }, (_, i) => ({
      type: "TEXT",
      name: `child-${i}`,
      text: "x".repeat(charsPerChild),
    })),
  };
}

afterEach(() => {
  setRemoteClientForTests(null);
  resetQueuesForTests();
});

describe("chunked create execution", () => {
  test("a synthetic ~80KB tree splits into sequential chunks and merges results", async () => {
    const mock = new MockClient();
    setRemoteClientForTests(mock);

    // 20 children × ~4KB ≈ 80KB params — over the 49KB script budget
    const tree = bigTree(20, 4000);
    const result = (await executeRemoteCommand({
      fileKey: "scratch",
      command: "create",
      params: { tree },
      atomicWrite: true,
    })) as any;

    expect(result.chunked).toBe(true);
    expect(result.chunks).toBeGreaterThan(1);
    expect(mock.calls.length).toBe(result.chunks);

    // Chunk 1 carries the root; subsequent chunks reparent onto its id
    expect(mock.calls[0].params.tree.name).toBe("root");
    for (let i = 1; i < mock.calls.length; i++) {
      expect(mock.calls[i].params.parentId).toBe("mock:1");
      expect(mock.calls[i].params.tree.name).toMatch(/^child-/);
    }

    // All 21 nodes accounted for (root + 20 children across chunks)
    expect(result.totalNodesCreated).toBe(21);
    // Reparented chunk results were merged onto the root, in original order
    const chunk1Children = mock.calls[0].params.tree.children.length;
    const mergedNames = result.tree.children.map((c: any) => c.name);
    expect(mergedNames).toEqual(Array.from({ length: 20 - chunk1Children }, (_, i) => `child-${chunk1Children + i}`));
    expect(result.tree.id).toBe("mock:1");
  });

  test("mid-chunk failure names the partial root and the cleanup fix", async () => {
    const mock = new MockClient();
    mock.failOnCall = 2;
    setRemoteClientForTests(mock);

    const tree = bigTree(20, 4000);
    await expect(
      executeRemoteCommand({ fileKey: "scratch", command: "create", params: { tree }, atomicWrite: true }),
    ).rejects.toThrow(/mock:1 holds a partial tree.*Delete mock:1/s);
  });

  test("small creates do not chunk", async () => {
    const mock = new MockClient();
    setRemoteClientForTests(mock);

    const result = (await executeRemoteCommand({
      fileKey: "scratch",
      command: "create",
      params: { tree: { type: "FRAME", name: "small" } },
      atomicWrite: true,
    })) as any;

    expect(result.chunked).toBeUndefined();
    expect(mock.calls.length).toBe(1);
  });
});
