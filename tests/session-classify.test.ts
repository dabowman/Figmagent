// INFRA-005 — the manifest classified any session with >=1 Figmagent tool NAME as
// a "figma" session, so a session whose single Figmagent call errored, or which
// only dumped its own log via export_session, entered the analysis queue as if it
// had exercised the tools. Each one costs an analysis pass and seeds the tracker
// with findings from a session that never touched a canvas.

import { describe, expect, test } from "bun:test";
import { hasEffectiveFigmaCall, sessionHasEffectiveFigmaCall } from "../scripts/session-classify.ts";

const FIGMA_TOOL = "mcp__Figmagent__read";

function call(id: string, name: string) {
  return { type: "tool_use", id, name };
}
function ok(id: string) {
  return { type: "tool_result", tool_use_id: id, content: "fine" };
}
function errored(id: string) {
  return { type: "tool_result", tool_use_id: id, content: "boom", is_error: true };
}
function msg(...blocks: unknown[]) {
  return { content: blocks };
}

describe("hasEffectiveFigmaCall: what counts as a real Figma session", () => {
  test("a successful Figmagent call counts", () => {
    expect(hasEffectiveFigmaCall([msg(call("a", FIGMA_TOOL)), msg(ok("a"))])).toBe(true);
  });

  test("a call with no result block still counts — absence of an error is not an error", () => {
    expect(hasEffectiveFigmaCall([msg(call("a", FIGMA_TOOL))])).toBe(true);
  });

  test("a session whose only Figmagent call errored does not count", () => {
    expect(hasEffectiveFigmaCall([msg(call("a", FIGMA_TOOL)), msg(errored("a"))])).toBe(false);
  });

  test("export_session alone does not count — it reads the log, not the canvas", () => {
    const messages = [msg(call("a", "mcp__Figmagent__export_session")), msg(ok("a"))];
    expect(hasEffectiveFigmaCall(messages)).toBe(false);
  });

  test("export_session plus one real call counts", () => {
    const messages = [
      msg(call("a", "mcp__Figmagent__export_session"), call("b", FIGMA_TOOL)),
      msg(ok("a"), ok("b")),
    ];
    expect(hasEffectiveFigmaCall(messages)).toBe(true);
  });

  test("one failed call and one good call counts", () => {
    const messages = [msg(call("a", FIGMA_TOOL), call("b", FIGMA_TOOL)), msg(errored("a"), ok("b"))];
    expect(hasEffectiveFigmaCall(messages)).toBe(true);
  });

  test("non-Figmagent tools never count, however many succeed", () => {
    const messages = [msg(call("a", "Read"), call("b", "Bash")), msg(ok("a"), ok("b"))];
    expect(hasEffectiveFigmaCall(messages)).toBe(false);
  });

  test("the official figma MCP is not Figmagent", () => {
    expect(hasEffectiveFigmaCall([msg(call("a", "mcp__figma__get_metadata")), msg(ok("a"))])).toBe(false);
  });
});

describe("hasEffectiveFigmaCall: undecidable input defers to the caller", () => {
  // Sessions extracted before messages were stored (or a --compact run) must not
  // be demoted to "dev" — that would drop a real session out of the queue for
  // good. undefined tells refresh-manifest to fall back to the name-presence test.
  test("no messages array is undecidable", () => {
    expect(hasEffectiveFigmaCall(undefined)).toBeUndefined();
    expect(hasEffectiveFigmaCall(null)).toBeUndefined();
    expect(hasEffectiveFigmaCall("some string")).toBeUndefined();
  });

  test("messages with no structured content blocks are undecidable", () => {
    expect(hasEffectiveFigmaCall([{ content: "plain text" }, {}])).toBeUndefined();
  });

  test("an empty message list is undecidable, not a negative", () => {
    expect(hasEffectiveFigmaCall([])).toBeUndefined();
  });

  test("structured blocks with no Figmagent call is a real negative, not undecidable", () => {
    expect(hasEffectiveFigmaCall([msg(call("a", "Read")), msg(ok("a"))])).toBe(false);
  });

  test("malformed blocks do not throw", () => {
    const messages = [msg(null, undefined, { type: "tool_use" }, { type: "text", text: "hi" })];
    expect(() => hasEffectiveFigmaCall(messages)).not.toThrow();
  });
});

describe("sessionHasEffectiveFigmaCall: sub-agent transcripts count", () => {
  // `extract-sessions --include-agents` (what the nightly pipeline runs) puts
  // Builder/Styler transcripts under `subAgents`. CLAUDE.md points large Figma
  // tasks at exactly that architecture, so judging the parent alone would demote
  // a session that delegated every canvas write.
  const parentFailed = [msg(call("p1", FIGMA_TOOL)), msg(errored("p1"))];
  const agentWorked = [msg(call("a1", FIGMA_TOOL)), msg(ok("a1"))];

  test("a sub-agent's successful call rescues a parent whose own calls all errored", () => {
    const data = { messages: parentFailed, subAgents: { "agent-1": { messages: agentWorked } } };
    expect(sessionHasEffectiveFigmaCall(data)).toBe(true);
  });

  test("all-errored parent and all-errored sub-agents is still a negative", () => {
    const data = { messages: parentFailed, subAgents: { "agent-1": { messages: parentFailed } } };
    expect(sessionHasEffectiveFigmaCall(data)).toBe(false);
  });

  test("a session with no sub-agents matches the parent-only verdict", () => {
    expect(sessionHasEffectiveFigmaCall({ messages: agentWorked })).toBe(true);
    expect(sessionHasEffectiveFigmaCall({ messages: parentFailed })).toBe(false);
  });

  test("undecidable stays undecidable so the caller keeps its name-presence fallback", () => {
    expect(sessionHasEffectiveFigmaCall({})).toBeUndefined();
    expect(sessionHasEffectiveFigmaCall(undefined)).toBeUndefined();
    expect(sessionHasEffectiveFigmaCall({ messages: "raw dump", subAgents: null })).toBeUndefined();
  });

  test("an undecidable parent still takes a decidable sub-agent verdict", () => {
    const data = { messages: undefined, subAgents: { "agent-1": { messages: agentWorked } } };
    expect(sessionHasEffectiveFigmaCall(data)).toBe(true);
  });

  test("malformed subAgents entries do not throw", () => {
    const data = { messages: parentFailed, subAgents: { a: null, b: 7, c: { messages: 1 } } };
    expect(() => sessionHasEffectiveFigmaCall(data as never)).not.toThrow();
    expect(sessionHasEffectiveFigmaCall(data as never)).toBe(false);
  });
});
