# Figma MCP Session 12 Analysis

## Session Overview
- **Transcript**: `b25b55b0-db5d-47e7-ac56-b3702df8b362.json`
- **Duration**: 8 minutes
- **Total tool calls**: 105
- **Total errors**: 1
- **Reconnections**: 0 (1 join_channel for initial join)
- **Context restarts**: 0
- **Task**: Expose nested instances (Header, Filters, Footer) as slot properties on the DataViews COMPONENT_SET (16 variants). Agent initially used `set_exposed_instance` (wrong approach), user corrected mid-session, agent undid all 42 exposures and switched to `add_component_property` with INSTANCE_SWAP type.

## Metrics
| Metric | Session 10 | Session 12 | Change |
|---|---|---|---|
| Total tool calls | 23 | 105 | +357% |
| Figma MCP calls | 18 | 103 | +472% |
| ToolSearch calls | 5 (21.7%) | 2 (1.9%) | Improved |
| Errors | 2 (8.7%) | 1 (1.0%) | Improved |
| Estimated waste % | ~30% | ~81% | Regressed significantly |
| Unique tools used | 10 | 6 | Fewer tools needed |

## Tool Call Distribution
| Tool | Calls | Notes |
|---|---|---|
| `set_exposed_instance` | 85 | 42 expose (wrong approach) + 43 unexpose (cleanup). Dominates the session. |
| `get_node_tree` | 11 | 1 on COMPONENT_SET + 10 on individual variants to gather instance IDs. |
| `add_component_property` | 3 | Final correct approach: Header, Filters, Footer INSTANCE_SWAP properties. |
| `get_component_properties` | 3 | 2 on COMPONENT_SET (verification), 1 on variant (error). |
| `ToolSearch` | 2 | 1 initial batch (5 tools), 1 mid-correction (`add_component_property`). |
| `join_channel` | 1 | Initial channel join. |

**Totals**: 2 ToolSearch + 103 Figma MCP = 105. Errors: 1.

## Efficiency Issues

### 1. Wrong approach: `set_exposed_instance` instead of `add_component_property` (saves ~85 calls)

The core waste in this session. The agent was asked to create slot/swap properties on the DataViews component set. It used `set_exposed_instance` on 42 nested instance nodes across 16 variants (16 Header + 16 Filters + 10 Footer). The user then corrected that exposed instances are NOT the same as INSTANCE_SWAP properties. The agent then undid all 42 by calling `set_exposed_instance(exposed: false)` on 43 nodes, then correctly used `add_component_property` with type `INSTANCE_SWAP` (3 calls).

**Pattern observed:** Agent confused "exposed instances" (bubbles up nested instance properties) with "INSTANCE_SWAP component properties" (slot dropdowns on the component set). This is a documented distinction in CLAUDE.md but the agent didn't have that context (or misunderstood it).

**Root cause:** The distinction between `set_exposed_instance` and INSTANCE_SWAP `add_component_property` is subtle. The agent's initial ToolSearch fetched `set_exposed_instance` and `get_component_properties` but not `add_component_property`, suggesting it planned the wrong approach from the start.

**Estimated savings:** 85 `set_exposed_instance` calls wasted (42 expose + 43 unexpose). The correct approach needed only 3 `add_component_property` calls + wiring (which wasn't completed in this session).

### 2. Sequential `set_exposed_instance` calls (saves ~70 calls if batched)

Even if `set_exposed_instance` had been the right tool, calling it 42 times sequentially (one per instance node) is extremely inefficient. The `apply` tool with `isExposedInstance: true` can handle multiple nodes in a single call.

**Pattern observed:** 42 sequential calls: `set_exposed_instance(nodeId, exposed: true)` one at a time. Then 43 sequential `set_exposed_instance(nodeId, exposed: false)` to undo.

**Root cause:** Agent used the standalone `set_exposed_instance` tool instead of batching via `apply`. The `apply` tool supports `isExposedInstance` on multiple nodes.

**Estimated savings:** 85 calls could have been ~4 calls (one `apply` per batch of nodes). But since the approach was wrong, this is moot.

### 3. Missing property wiring at end of session (incomplete task)

The agent created 3 INSTANCE_SWAP properties on the COMPONENT_SET but acknowledged they were "not yet wired" to actual instance nodes. The `add_component_property` creates the definition but doesn't bind it to specific nested instances via `componentPropertyReferences`. The session ended without completing this step.

**Root cause:** The agent recognized it didn't have a tool to wire properties to instances. This is the `bind` action on `component_properties` (which was added after this session).

### 4. Redundant `get_component_properties` checks (saves ~1 call)

Called `get_component_properties` on the COMPONENT_SET twice (calls #15 and #56) — both returned the same result (only VARIANT properties visible at that level). The first check was reasonable (pilot verification), but the second was redundant since nothing changed at the COMPONENT_SET level.

## Error Analysis

### 1. `get_component_properties` on variant component (1 failure)

Call #16: `get_component_properties(nodeId: "13635:32859")` — this was a variant COMPONENT (child of a COMPONENT_SET). The API correctly rejected it: "Can only get component property definitions of a component set or non-variant component."

**Agent recovery:** Good — understood the error, moved on to the rollout phase without retrying.

**Root cause:** Agent tried to verify exposed properties on the variant level after failing to see them at the COMPONENT_SET level. The error message is clear.

## What Worked Well

1. **Efficient variant discovery.** Used `get_node_tree(depth=1)` on the COMPONENT_SET to get all 16 variant IDs, then `get_node_tree(depth=2)` on each to find nested instance IDs. Built a complete mapping table before acting.

2. **Good ToolSearch efficiency.** Only 2 ToolSearch calls (1.9% of total), both purposeful. First batch fetched 5 tools upfront, second fetched 1 tool mid-correction.

3. **Clean error recovery.** The 1 error was handled gracefully with no retry storm.

4. **User correction handled well.** When the user pointed out exposed instances are not slot properties, the agent immediately: (a) acknowledged the mistake, (b) fetched the correct tool, (c) undid all previous work, (d) applied the correct approach.

5. **Zero reconnections/timeouts.** Stable connection throughout despite 105 calls over 8 minutes.

## Priority Improvements

### Tool Changes

1. **Batch `apply` for `isExposedInstance`** — [TOOL-012] new. Even though the approach was wrong here, when exposing/unexposing many instances, a single `apply` call with multiple nodeIds should replace N sequential `set_exposed_instance` calls. The `apply` tool already supports this (`isExposedInstance` field), but the agent didn't use it.

2. **Deprecate standalone `set_exposed_instance`** — Its existence as a separate tool leads agents to call it individually per node. If `apply` handles it, the standalone tool is a footgun.

### Agent Skill Updates

1. **Clarify exposed instances vs INSTANCE_SWAP in agent instructions** — [AGENT-012] new. The distinction is documented in CLAUDE.md but wasn't followed. Key rule: `set_exposed_instance` / `apply(isExposedInstance)` bubbles up nested instance properties. `add_component_property(type: INSTANCE_SWAP)` + `bind` creates a swap slot. Agents must ask which one is intended before proceeding.

2. **Pre-load `add_component_property` in component work** — When the task involves component properties, the initial ToolSearch should include both `set_exposed_instance` AND `add_component_property` / `component_properties` to avoid mid-session correction.

3. **Fail-fast on approach validation** — [AGENT-013] new. Before executing 42 identical calls, the agent should pilot on 1 node, verify with the user, THEN roll out. The agent did pilot on 3 nodes (Table, Default) but didn't pause for user confirmation before rolling out to all 16 variants.
