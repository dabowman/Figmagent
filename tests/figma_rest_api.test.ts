import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  getFileComponents,
  getFileComponentSets,
  getComponentByKey,
  getFileNodes,
  getFileVariables,
  getFileComments,
  postFileComment,
  deleteFileComment,
  clearCache,
} from "../src/figmagent_mcp/figma_rest_api.js";

const FAKE_TOKEN = "figd_test_token_1234";
let originalEnv: string | undefined;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalEnv = process.env.FIGMA_API_TOKEN;
  process.env.FIGMA_API_TOKEN = FAKE_TOKEN;
  originalFetch = globalThis.fetch;
  clearCache();
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.FIGMA_API_TOKEN;
  } else {
    process.env.FIGMA_API_TOKEN = originalEnv;
  }
  globalThis.fetch = originalFetch;
});

function mockFetch(status: number, body: any, headers?: Record<string, string>) {
  const fn = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      }),
    ),
  );
  globalThis.fetch = fn as any;
  return fn;
}

function mockFetchText(status: number, text: string) {
  const fn = mock(() =>
    Promise.resolve(
      new Response(text, {
        status,
        headers: { "Content-Type": "text/plain" },
      }),
    ),
  );
  globalThis.fetch = fn as any;
  return fn;
}

describe("authentication", () => {
  test("throws when FIGMA_API_TOKEN is not set", async () => {
    delete process.env.FIGMA_API_TOKEN;
    mockFetch(200, { meta: { components: [] } });
    await expect(getFileComponents("abc123")).rejects.toThrow("FIGMA_API_TOKEN environment variable is not set");
  });

  test("sends token in X-Figma-Token header", async () => {
    const fetchMock = mockFetch(200, { meta: { components: [] } });
    await getFileComponents("abc123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.figma.com/v1/files/abc123/components");
    expect(opts.headers).toHaveProperty("X-Figma-Token", FAKE_TOKEN);
  });
});

describe("error handling", () => {
  test("403 throws with scope guidance", async () => {
    mockFetch(403, {});
    await expect(getFileComponents("abc123")).rejects.toThrow("403 Forbidden");
  });

  test("404 throws not found", async () => {
    mockFetch(404, {});
    await expect(getFileComponents("abc123")).rejects.toThrow("404 Not Found");
  });

  test("429 throws with retry info", async () => {
    mockFetch(429, {}, { "Retry-After": "30" });
    await expect(getFileComponents("abc123")).rejects.toThrow("rate limited");
  });

  test("500 throws with response body", async () => {
    mockFetchText(500, "Internal Server Error");
    await expect(getFileComponents("abc123")).rejects.toThrow("Figma API error 500");
  });
});

describe("getFileComponents", () => {
  const components = [
    { key: "comp1", name: "Button", file_key: "abc", node_id: "1:2" },
    { key: "comp2", name: "Input", file_key: "abc", node_id: "1:3" },
  ];

  test("returns components from response", async () => {
    mockFetch(200, { meta: { components } });
    const result = await getFileComponents("abc123");
    expect(result).toEqual(components);
  });

  test("caches results for same file key", async () => {
    const fetchMock = mockFetch(200, { meta: { components } });
    await getFileComponents("abc123");
    await getFileComponents("abc123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("clearCache invalidates specific file", async () => {
    const fetchMock = mockFetch(200, { meta: { components } });
    await getFileComponents("abc123");
    clearCache("abc123");
    await getFileComponents("abc123");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getFileComponentSets", () => {
  test("returns component sets", async () => {
    const sets = [{ key: "set1", name: "ButtonSet", file_key: "abc", node_id: "2:1" }];
    mockFetch(200, { meta: { component_sets: sets } });
    const result = await getFileComponentSets("abc123");
    expect(result).toEqual(sets);
  });

  test("caches results", async () => {
    const fetchMock = mockFetch(200, { meta: { component_sets: [] } });
    await getFileComponentSets("file1");
    await getFileComponentSets("file1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getComponentByKey", () => {
  test("fetches single component by key", async () => {
    const comp = { key: "comp1", name: "Button" };
    const fetchMock = mockFetch(200, { meta: comp });
    const result = await getComponentByKey("comp1");
    expect(result).toEqual(comp);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.figma.com/v1/components/comp1");
  });
});

describe("getFileNodes", () => {
  test("encodes node IDs in URL", async () => {
    const fetchMock = mockFetch(200, { name: "File", nodes: {} });
    await getFileNodes("abc123", ["1:2", "3:4"]);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.figma.com/v1/files/abc123/nodes?ids=1%3A2,3%3A4");
  });
});

describe("getFileVariables", () => {
  test("fetches variables endpoint", async () => {
    const fetchMock = mockFetch(200, { meta: { variableCollections: {}, variables: {} } });
    await getFileVariables("abc123");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.figma.com/v1/files/abc123/variables/local");
  });
});

describe("comments API", () => {
  test("getFileComments fetches with as_md=true by default", async () => {
    const fetchMock = mockFetch(200, { comments: [] });
    await getFileComments("abc123");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.figma.com/v1/files/abc123/comments?as_md=true");
  });

  test("getFileComments without markdown", async () => {
    const fetchMock = mockFetch(200, { comments: [] });
    await getFileComments("abc123", false);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.figma.com/v1/files/abc123/comments");
  });

  test("postFileComment sends POST with message", async () => {
    const comment = { id: "c1", message: "Hello" };
    const fetchMock = mockFetch(200, comment);
    const result = await postFileComment("abc123", "Hello");

    expect(result).toEqual(comment);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.figma.com/v1/files/abc123/comments");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ message: "Hello" });
  });

  test("postFileComment with reply and node pin", async () => {
    const fetchMock = mockFetch(200, { id: "c2" });
    await postFileComment("abc123", "Reply", { commentId: "c1", nodeId: "5:6" });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.comment_id).toBe("c1");
    expect(body.client_meta.node_id).toBe("5:6");
    expect(body.client_meta.node_offset).toEqual({ x: 0, y: 0 });
  });

  test("deleteFileComment sends DELETE", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })));
    globalThis.fetch = fetchMock as any;
    await deleteFileComment("abc123", "c1");

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.figma.com/v1/files/abc123/comments/c1");
    expect(opts.method).toBe("DELETE");
  });

  test("deleteFileComment 403 throws ownership error", async () => {
    mockFetch(403, {});
    await expect(deleteFileComment("abc123", "c1")).rejects.toThrow("only delete your own comments");
  });
});
