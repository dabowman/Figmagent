import { describe, test, expect } from "bun:test";
import { looksLikeError } from "../src/figmagent_mcp/instance.js";
import { timeoutMessage, isWriteCommand } from "../src/figmagent_mcp/remote/domains.js";

/**
 * Issue #60 — every error/timeout/exception MCP response must carry
 * is_error: true (the server flags them centrally in the server.tool wrapper).
 * Issue #46 — timeout messages name the operation type + command so the agent
 * can distinguish a degraded connection (writes time out, reads succeed) from a
 * tool-specific problem.
 */

describe("looksLikeError (#60)", () => {
  test("flags catch-block error text", () => {
    expect(looksLikeError({ content: [{ type: "text", text: "Error importing library component: boom" }] })).toBe(true);
    expect(looksLikeError({ content: [{ type: "text", text: "Error setting text content: boom" }] })).toBe(true);
  });

  test("flags validation rejections", () => {
    expect(looksLikeError({ content: [{ type: "text", text: "Error: provide componentSetNodeId or componentSetNodeIds." }] })).toBe(true);
  });

  test("flags timeout messages from both transports", () => {
    expect(looksLikeError({ content: [{ type: "text", text: 'Write operation "set_text_content" timed out after 30s' }] })).toBe(true);
    expect(looksLikeError({ content: [{ type: "text", text: "Request to Figma timed out" }] })).toBe(true);
  });

  test("flags Failed to / Could not / Unable to phrasing", () => {
    expect(looksLikeError({ content: [{ type: "text", text: "Failed to set instance overrides: nope" }] })).toBe(true);
    expect(looksLikeError({ content: [{ type: "text", text: "Could not auto-discover channels" }] })).toBe(true);
    expect(looksLikeError({ content: [{ type: "text", text: "Unable to load font" }] })).toBe(true);
  });

  test("flags connection-loss text", () => {
    expect(looksLikeError({ content: [{ type: "text", text: "Not connected to Figma. Attempting to connect..." }] })).toBe(true);
    expect(looksLikeError({ content: [{ type: "text", text: "Connection closed" }] })).toBe(true);
  });

  test("does NOT flag successful responses", () => {
    expect(looksLikeError({ content: [{ type: "text", text: "Successfully applied 3 overrides." }] })).toBe(false);
    expect(looksLikeError({ content: [{ type: "text", text: "No annotations provided" }] })).toBe(false);
    expect(looksLikeError({ content: [{ type: "text", text: '{ "issues": 0, "errors": 0 }' }] })).toBe(false);
    expect(looksLikeError({ content: [{ type: "text", text: "Created 5 connections" }] })).toBe(false);
  });

  // #60 follow-up (review finding a): the matcher is start-anchored, so a
  // successful read/grep that merely *serializes* error-like node names or text
  // content (a "Timed out" error-state mockup, a layer named "Connection
  // closed") must NOT be flagged is_error.
  test("does NOT flag reads whose serialized node data contains error words mid-string", () => {
    expect(
      looksLikeError({
        content: [{ type: "text", text: 'meta:\n  nodeCount: 4\nnodes:\n  - name: "Timed out"\n    type: TEXT' }],
      }),
    ).toBe(false);
    expect(
      looksLikeError({ content: [{ type: "text", text: '{"name":"Connection closed banner","type":"FRAME"}' }] }),
    ).toBe(false);
    expect(
      looksLikeError({ content: [{ type: "text", text: "Found 2 nodes: a label reading 'Not connected to Figma'." }] }),
    ).toBe(false);
  });

  // #60 follow-up (review finding b): structured-verdict tools set isError
  // themselves from their success/failed counts. The matcher must honor that
  // flag — a fully-failed JSON batch is is_error:true even though it starts "{".
  test("honors source-level isError on structured-JSON failure verdicts", () => {
    expect(
      looksLikeError({
        isError: true,
        content: [{ type: "text", text: '{"success":false,"nodesEdited":0,"totalNodes":3,"failures":[]}' }],
      }),
    ).toBe(true);
    // A partial success stays unflagged at the source (isError omitted/false).
    expect(
      looksLikeError({
        content: [{ type: "text", text: '{"success":true,"nodesEdited":2,"totalNodes":3}' }],
      }),
    ).toBe(false);
  });

  test("respects an explicit isError flag either way", () => {
    expect(looksLikeError({ isError: true, content: [{ type: "text", text: "ok" }] })).toBe(true);
    expect(looksLikeError({ isError: false, content: [{ type: "text", text: "Error: something" }] })).toBe(false);
  });

  test("ignores non-result shapes", () => {
    expect(looksLikeError(null)).toBe(false);
    expect(looksLikeError({})).toBe(false);
    expect(looksLikeError({ content: [] })).toBe(false);
  });
});

describe("timeoutMessage (#46)", () => {
  test("write commands name the op and carry the degraded-connection hint", () => {
    const msg = timeoutMessage("set_text_content", 30000);
    expect(isWriteCommand("set_text_content", undefined)).toBe(true);
    expect(msg).toBe(
      'Write operation "set_text_content" timed out after 30s (if reads succeed but writes fail, the connection may be degraded — try use_file to re-join the channel)',
    );
  });

  test("read commands name the op without the write hint", () => {
    const msg = timeoutMessage("get_selection", 30000);
    expect(msg).toBe('Read operation "get_selection" timed out after 30s');
    expect(msg).not.toContain("degraded");
  });

  test("honors an explicit write-flag override (remote executor passes atomicWrite)", () => {
    // lint_design is a read by default but a write when autoFix binds variables.
    expect(timeoutMessage("lint_design", 30000, undefined, true)).toContain("Write operation");
    expect(timeoutMessage("lint_design", 30000, undefined, false)).toContain("Read operation");
  });

  // Review finding (c): plugin-only navigation/control commands don't mutate the
  // file, so they must not be labelled "Write" or carry the degraded-connection
  // hint. `join` especially — "re-join the channel" advice would be circular.
  test("non-mutating control commands are not classified as writes", () => {
    for (const cmd of ["join", "set_focus", "set_selections", "set_default_connector"]) {
      expect(isWriteCommand(cmd, undefined)).toBe(false);
      const msg = timeoutMessage(cmd, 30000);
      expect(msg).toContain("Read operation");
      expect(msg).not.toContain("degraded");
    }
  });
});
