---
name: figma-sub-agents
description: "Orchestrator guide for delegating Figma MCP phases to specialized sub-agents. Use when a Figma task is large enough to risk context overflow — component sets with 8+ variants, unknown tree depth, large read_my_design responses, or sessions expected to exceed 100 tool calls. Currently covers the Discovery sub-agent. Builder and Styler sub-agents are planned for future rollout."
---

# Figma MCP Sub-Agent Orchestration

Large Figma sessions hit three problems in a single-agent context: **context pressure** (300K-character `read_my_design` responses), **attention drift** (losing track of which nodes are done after 30+ sequential calls), and **error pollution** (9 retries of a failing tool consuming planning context). Sub-agents solve this by giving each phase its own clean context window.

**Current rollout:** Discovery sub-agent only (`figma-discovery` agent defined in `.claude/agents/figma-discovery.md`). Builder and Styler are described in `.claude/plans/figma-mcp-sub-agents.md`.

---

## When to Use the Discovery Sub-Agent

Delegate when **any** of these are true:

- Target component set has **8+ variants**
- Frame tree depth is unknown or likely > 4 levels
- This is the first time seeing this Figma file in the session
- A `read_my_design` or `get_node_info` response was truncated or very large (>50K characters)
- You need both a full text node inventory AND a variable binding audit in the same pass

**Skip it when** you already have the node IDs and structure, the target has < 20 children, or you only need one piece of info (just call the tool directly).

---

## Serial Execution Protocol

Sub-agents share the WebSocket channel — always run them one at a time.

1. **Orchestrator joins the channel first.** Call `join_channel` (no args) before spawning any sub-agent.
2. **Pass the channel name explicitly.** Read the channel name from the `join_channel` response and include it in the sub-agent prompt. Do not let the sub-agent auto-discover — this avoids race conditions.
3. **Wait for the JSON result** before proceeding to build or style phases.
4. **Check `status` first** — if `"blocked"`, surface the error to the user and stop.

---

## Discovery Sub-Agent

The agent definition lives at `.claude/agents/figma-discovery.md`. It has:
- A read-only tool set (no create/modify tools)
- A system prompt with its full workflow and output schema

**Tools available to the agent:** `join_channel`, `get_node_info`, `get_nodes_info`, `scan_text_nodes`, `get_local_variables`, `get_styles`, `get_local_components` (plus `ToolSearch` to load them)

### Spawning the Agent

Use the Agent tool with `subagent_type: "figma-discovery"`. The prompt only needs task-specific parameters — no system prompt needed.

```
Agent(
  subagent_type: "figma-discovery",
  description: "Discover <component name> structure",
  prompt: JSON.stringify({
    channelName: "<from your join_channel call>",
    nodeId: "<target component set or frame ID>",
    description: "Map DataViews component set",
    include: ["text_nodes", "variables", "text_styles"],
    nameFilter: "DataRow"   // omit if not filtering components
  })
)
```

Valid `include` values: `text_nodes`, `variables`, `text_styles`, `components`.

### Using the Result

The agent's final message is JSON. Parse it immediately:

```
const discovery = JSON.parse(agentResult);

if (discovery.status === "blocked") {
  // Surface to user: discovery.error + discovery.recommendation
  // Do NOT proceed to build/style phases
} else {
  // discovery.variants[].id      → parentId values for create/clone calls
  // discovery.text_nodes[]       → input for batch_set_text_styles / batch_bind_variables
  // discovery.unbound_nodes      → if >= 20, a Styler phase is needed
  // discovery.variables          → sanity-check tokens are loaded
  // discovery.summary            → user-facing status message
}
```

### Output Schema Reference

**Success:**
```json
{
  "status": "success",
  "component_set": {
    "id": "...",
    "name": "...",
    "variant_properties": ["Layout", "State"],
    "variants": [
      {
        "id": "...",
        "name": "Layout=List, State=Default",
        "children": [
          { "id": "...", "name": "Header", "type": "FRAME", "variables_bound": ["fill:surface-primary"] },
          { "id": "...", "name": "Row 1", "type": "INSTANCE", "componentName": "DataRow", "variables_bound": [] }
        ]
      }
    ]
  },
  "text_nodes": [
    { "id": "...", "name": "Title", "parentVariantId": "16547:36681", "content": "Activity", "style": "Heading MD", "fills_variable": null }
  ],
  "variables": {
    "collections": ["Primitives", "Semantic"],
    "total_count": 84,
    "by_collection": {
      "Semantic": [
        { "id": "VariableID:15613:5786", "name": "gray-700", "type": "COLOR" },
        { "id": "VariableID:15613:5784", "name": "surface-primary", "type": "COLOR" }
      ]
    }
  },
  "text_styles": [
    { "name": "Heading MD", "id": "S:5a04abc..." },
    { "name": "Body SM", "id": "S:7b12def..." }
  ],
  "unbound_nodes": 47,
  "summary": "4 variants exist. 47 nodes have no variable bindings. 12 text nodes have no text style."
}
```

**Blocked:**
```json
{
  "status": "blocked",
  "error": "get_node_info timed out twice",
  "last_tool": "get_node_info",
  "recommendation": "Call join_channel again — connection may have dropped"
}
```

---

## Future Sub-Agents (Not Yet Implemented)

**Builder sub-agent** — creates/clones node structures from a declarative spec. Trigger when build spec has 5+ nodes. See `.claude/plans/figma-mcp-sub-agents.md`.

**Styler sub-agent** — applies `batch_bind_variables` and `batch_set_text_styles` from a binding plan. Trigger when binding plan has 20+ bindings. See the same plan doc.

Both will follow the same protocol: orchestrator joins channel first, passes `channelName` explicitly, waits for JSON.
