// Lint command: scan subtree for properties not bound to design token variables.
// Reports unbound fills, strokes, corner radii, spacing, opacity, font properties.
// Scope-aware: matches variables based on their declared scopes and node context.
// Flags ambiguous matches (multiple scope-compatible variables at same distance).

import { sendProgressUpdate, generateCommandId, delay, rgbaToHex, prop, fail } from "../helpers.js";

// ─── Color Distance (CIE76 deltaE in CIELAB) ───────────────────────────────

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) / 1.0;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;

  const epsilon = 0.008856;
  const kappa = 903.3;

  const fx = x > epsilon ? x ** (1 / 3) : (kappa * x + 16) / 116;
  const fy = y > epsilon ? y ** (1 / 3) : (kappa * y + 16) / 116;
  const fz = z > epsilon ? z ** (1 / 3) : (kappa * z + 16) / 116;

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function deltaE(lab1, lab2) {
  const dL = lab1.L - lab2.L;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

// ─── Scope Mapping ──────────────────────────────────────────────────────────

// Maps lint property + node type → array of compatible Figma variable scopes.
// A variable matches if its scopes include ALL_SCOPES or any scope in the list.
// Node type "TEXT" gets text-specific fill scope; "FRAME" gets frame fill; others get shape fill.
export function getCompatibleScopes(propName, nodeType) {
  if (propName === "fills") {
    if (nodeType === "TEXT") return ["ALL_SCOPES", "ALL_FILLS", "TEXT_FILL"];
    if (nodeType === "FRAME" || nodeType === "COMPONENT" || nodeType === "COMPONENT_SET" || nodeType === "INSTANCE")
      return ["ALL_SCOPES", "ALL_FILLS", "FRAME_FILL"];
    return ["ALL_SCOPES", "ALL_FILLS", "SHAPE_FILL"];
  }
  if (propName === "strokes") return ["ALL_SCOPES", "STROKE_COLOR"];
  if (propName === "cornerRadius") return ["ALL_SCOPES", "CORNER_RADIUS"];
  if (propName === "opacity") return ["ALL_SCOPES", "OPACITY"];
  if (propName === "itemSpacing" || propName === "counterAxisSpacing") return ["ALL_SCOPES", "GAP"];
  if (
    propName === "paddingTop" ||
    propName === "paddingRight" ||
    propName === "paddingBottom" ||
    propName === "paddingLeft"
  )
    return ["ALL_SCOPES", "GAP"];
  if (propName === "fontSize") return ["ALL_SCOPES", "FONT_SIZE"];
  if (propName === "fontFamily") return ["ALL_SCOPES", "FONT_FAMILY"];
  return ["ALL_SCOPES"];
}

// Check if a variable's scopes are compatible with the required scopes.
// A variable with an empty scopes array is treated as ALL_SCOPES (Figma default).
export function isScopeCompatible(variableScopes, requiredScopes) {
  // Empty scopes = unrestricted (Figma default when no scopes are set)
  if (!variableScopes || variableScopes.length === 0) return true;

  for (let i = 0; i < variableScopes.length; i++) {
    if (variableScopes[i] === "ALL_SCOPES") return true;
    for (let j = 0; j < requiredScopes.length; j++) {
      if (variableScopes[i] === requiredScopes[j]) return true;
    }
  }
  return false;
}

// ─── Variable Index Builder ─────────────────────────────────────────────────

export async function buildVariableIndexes() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const colorIndex = [];
  const scalarIndex = { FLOAT: [], STRING: [] };

  for (let i = 0; i < collections.length; i++) {
    const collection = collections[i];
    const defaultModeId = collection.modes[0].modeId;
    const collectionName = collection.name;

    for (let j = 0; j < collection.variableIds.length; j++) {
      const variable = await figma.variables.getVariableByIdAsync(collection.variableIds[j]);
      if (!variable) continue;

      const val = variable.valuesByMode[defaultModeId];
      // Skip aliases — we only match against resolved values
      if (val && typeof val === "object" && "type" in val && val.type === "VARIABLE_ALIAS") continue;

      const scopes = variable.scopes || [];

      if (variable.resolvedType === "COLOR" && val && typeof val === "object" && "r" in val) {
        colorIndex.push({
          id: variable.id,
          name: variable.name,
          collectionName: collectionName,
          scopes: scopes,
          r: val.r,
          g: val.g,
          b: val.b,
          a: val.a !== undefined ? val.a : 1,
          lab: rgbToLab(val.r, val.g, val.b),
        });
      } else if (variable.resolvedType === "FLOAT" && typeof val === "number") {
        scalarIndex.FLOAT.push({
          id: variable.id,
          name: variable.name,
          collectionName: collectionName,
          scopes: scopes,
          value: val,
        });
      } else if (variable.resolvedType === "STRING" && typeof val === "string") {
        scalarIndex.STRING.push({
          id: variable.id,
          name: variable.name,
          collectionName: collectionName,
          scopes: scopes,
          value: val,
        });
      }
    }
  }

  return { colorIndex, scalarIndex };
}

// ─── Node Collection ────────────────────────────────────────────────────────

function collectNodes(node, path, depth, result) {
  // PAGE nodes don't have a `visible` property — skip visibility check for them.
  // For all other nodes, skip hidden ones.
  if (node.type !== "PAGE" && !prop(node, "visible")) return;

  // Don't lint the PAGE node itself (it has no lintable properties),
  // but traverse its children so a single lint_design call on a page covers everything.
  if (node.type !== "PAGE") {
    const nodePath = path ? path + " > " + node.name : node.name;
    result.push({ node: node, path: nodePath, depth: depth });

    // Skip children of INSTANCE nodes — bindings come from main component
    // But we still lint the instance node itself for overrides
    if (node.type === "INSTANCE") return;
  }

  if ("children" in node) {
    const parentPath = node.type === "PAGE" ? "" : path ? path + " > " + node.name : node.name;
    for (let i = 0; i < node.children.length; i++) {
      collectNodes(node.children[i], parentPath, node.type === "PAGE" ? 0 : depth + 1, result);
    }
  }
}

// ─── Property Checkers ──────────────────────────────────────────────────────

// All lintable properties and their Figma API field mappings
const LINT_PROPERTIES = {
  fills: { type: "color", field: "fills" },
  strokes: { type: "color", field: "strokes" },
  cornerRadius: { type: "scalar", field: "topLeftRadius" },
  opacity: { type: "scalar", field: "opacity" },
  itemSpacing: { type: "scalar", field: "itemSpacing" },
  counterAxisSpacing: { type: "scalar", field: "counterAxisSpacing" },
  paddingTop: { type: "scalar", field: "paddingTop" },
  paddingRight: { type: "scalar", field: "paddingRight" },
  paddingBottom: { type: "scalar", field: "paddingBottom" },
  paddingLeft: { type: "scalar", field: "paddingLeft" },
  fontSize: { type: "scalar", field: "fontSize" },
  fontFamily: { type: "string", field: "fontFamily" },
};

function isInsideInstance(node) {
  let parent = node.parent;
  while (parent) {
    if (parent.type === "INSTANCE") return true;
    parent = parent.parent;
  }
  return false;
}

// Find best color match, filtering by scope. Returns { match, ambiguous, alternatives }.
// ambiguous=true when multiple scope-compatible variables tie at the same distance.
function findBestColorMatch(r, g, b, colorIndex, threshold, requiredScopes) {
  const lab = rgbToLab(r, g, b);
  let bestDist = Infinity;
  let bestMatch = null;
  let tieCount = 0;
  const alternatives = [];

  for (let i = 0; i < colorIndex.length; i++) {
    const entry = colorIndex[i];
    if (!isScopeCompatible(entry.scopes, requiredScopes)) continue;

    const d = deltaE(lab, entry.lab);
    if (d > threshold) continue;

    if (d < bestDist) {
      // New best — demote previous best to alternatives if it was close enough
      if (bestMatch && bestDist <= threshold) {
        alternatives.push({
          id: bestMatch.id,
          name: bestMatch.name,
          collection: bestMatch.collectionName,
          distance: Math.round(bestDist * 100) / 100,
        });
      }
      bestDist = d;
      bestMatch = entry;
      tieCount = 1;
    } else if (d === bestDist && bestMatch) {
      tieCount++;
      alternatives.push({
        id: entry.id,
        name: entry.name,
        collection: entry.collectionName,
        distance: Math.round(d * 100) / 100,
      });
    } else if (d <= threshold) {
      alternatives.push({
        id: entry.id,
        name: entry.name,
        collection: entry.collectionName,
        distance: Math.round(d * 100) / 100,
      });
    }
  }

  if (!bestMatch) return { match: null, ambiguous: false, alternatives: [] };

  const match = {
    id: bestMatch.id,
    name: bestMatch.name,
    collection: bestMatch.collectionName,
    distance: Math.round(bestDist * 100) / 100,
  };

  // Ambiguous if multiple scope-compatible vars tie at the exact same distance
  // and the distance qualifies as exact_match (< 1.0)
  const isExactRange = bestDist < 1.0;
  const ambiguous = tieCount > 1 && isExactRange;

  return { match, ambiguous, alternatives: ambiguous ? alternatives : [] };
}

// Find best scalar match, filtering by scope. Returns { match, ambiguous, alternatives }.
function findBestScalarMatch(value, scalarList, requiredScopes) {
  let bestDist = Infinity;
  let bestMatch = null;
  let tieCount = 0;
  const alternatives = [];

  for (let i = 0; i < scalarList.length; i++) {
    const entry = scalarList[i];
    if (!isScopeCompatible(entry.scopes, requiredScopes)) continue;

    const d = Math.abs(value - entry.value);
    if (d < bestDist) {
      if (bestMatch) {
        const prevNear = bestDist <= Math.max(Math.abs(value) * 0.1, 1);
        if (prevNear) {
          alternatives.push({
            id: bestMatch.id,
            name: bestMatch.name,
            collection: bestMatch.collectionName,
            distance: Math.round(bestDist * 100) / 100,
          });
        }
      }
      bestDist = d;
      bestMatch = entry;
      tieCount = 1;
    } else if (d === bestDist && bestMatch) {
      tieCount++;
      alternatives.push({
        id: entry.id,
        name: entry.name,
        collection: entry.collectionName,
        distance: Math.round(d * 100) / 100,
      });
    } else {
      const isNear = d <= Math.max(Math.abs(value) * 0.1, 1);
      if (isNear) {
        alternatives.push({
          id: entry.id,
          name: entry.name,
          collection: entry.collectionName,
          distance: Math.round(d * 100) / 100,
        });
      }
    }
  }

  if (!bestMatch) return { match: null, ambiguous: false, alternatives: [] };

  // Check if best match is within near range
  const isNear = bestDist <= Math.max(Math.abs(value) * 0.1, 1);
  if (!isNear) return { match: null, ambiguous: false, alternatives: [] };

  const match = {
    id: bestMatch.id,
    name: bestMatch.name,
    collection: bestMatch.collectionName,
    distance: Math.round(bestDist * 100) / 100,
  };

  const ambiguous = tieCount > 1 && bestDist === 0;

  return { match, ambiguous, alternatives: ambiguous ? alternatives : [] };
}

// Find exact string match, filtering by scope. Returns { match, ambiguous, alternatives }.
function findExactStringMatch(value, stringList, requiredScopes) {
  const matches = [];
  for (let i = 0; i < stringList.length; i++) {
    const entry = stringList[i];
    if (!isScopeCompatible(entry.scopes, requiredScopes)) continue;
    if (entry.value === value) {
      matches.push({
        id: entry.id,
        name: entry.name,
        collection: entry.collectionName,
        distance: 0,
      });
    }
  }

  if (matches.length === 0) return { match: null, ambiguous: false, alternatives: [] };
  if (matches.length === 1) return { match: matches[0], ambiguous: false, alternatives: [] };

  // Multiple exact matches — ambiguous
  return { match: matches[0], ambiguous: true, alternatives: matches.slice(1) };
}

function classifySeverity(distance, isColor, ambiguous) {
  if (ambiguous) return "ambiguous";
  if (distance === 0) return "exact_match";
  if (isColor) {
    return distance < 1.0 ? "exact_match" : "near_match";
  }
  return "near_match";
}

// ─── Single-value matcher (shared by lintDesign and the write-time mini-lint) ─
//
// value:       { r, g, b } for color properties, number for scalars, string for strings
// property:    a LINT_PROPERTIES key ("fills", "cornerRadius", "fontSize", ...)
// nodeContext: { nodeType, threshold } — nodeType drives scope filtering,
//              threshold (default 5.0) bounds color distance
// variables:   indexes from buildVariableIndexes()
// Returns { severity, variable, ambiguous, alternatives } or null when no match.
export function matchVariable(value, property, nodeContext, variables) {
  const spec = LINT_PROPERTIES[property];
  if (!spec || !variables) return null;

  const nodeType = nodeContext && nodeContext.nodeType ? nodeContext.nodeType : null;
  const threshold = nodeContext && nodeContext.threshold !== undefined ? nodeContext.threshold : 5.0;
  const requiredScopes = getCompatibleScopes(property, nodeType);

  let r;
  if (spec.type === "color") {
    if (!value || typeof value !== "object") return null;
    r = findBestColorMatch(value.r, value.g, value.b, variables.colorIndex, threshold, requiredScopes);
  } else if (spec.type === "scalar") {
    if (typeof value !== "number") return null;
    r = findBestScalarMatch(value, variables.scalarIndex.FLOAT, requiredScopes);
  } else {
    if (typeof value !== "string") return null;
    r = findExactStringMatch(value, variables.scalarIndex.STRING, requiredScopes);
  }

  if (!r.match) return null;
  return {
    severity: classifySeverity(r.match.distance, spec.type === "color", r.ambiguous),
    variable: r.match,
    ambiguous: r.ambiguous,
    alternatives: r.alternatives,
  };
}

function checkColorProperty(node, propName, spec, indexes, nodeContext) {
  const fieldName = spec.field;
  if (!(fieldName in node)) return null;

  const paints = node[fieldName];
  if (!paints || paints.length === 0) return null;

  const paint = paints[0];
  if (paint.type !== "SOLID") return null;

  // Check if already bound
  if (paint.boundVariables && paint.boundVariables.color) {
    return null;
  }

  const color = paint.color;
  const m = matchVariable({ r: color.r, g: color.g, b: color.b }, propName, nodeContext, indexes);
  const hexVal = rgbaToHex({ r: color.r, g: color.g, b: color.b, a: paint.opacity !== undefined ? paint.opacity : 1 });

  const result = {
    currentValue: hexVal,
    suggestedVariable: m ? m.variable : null,
    severity: m ? m.severity : "no_match",
  };
  if (m && m.ambiguous && m.alternatives.length > 0) {
    result.alternatives = m.alternatives;
  }
  return result;
}

function checkScalarProperty(node, propName, spec, indexes, nodeContext) {
  const figmaField = spec.field;
  if (!(figmaField in node)) return null;

  const value = node[figmaField];
  if (value === undefined || value === null) return null;

  // Handle figma.mixed (Symbol) for cornerRadius
  if (typeof value === "symbol") {
    return {
      currentValue: "mixed",
      suggestedVariable: null,
      severity: "no_match",
    };
  }

  // Skip default/zero values that don't need tokens
  if (value === 0 && propName !== "opacity") return null;
  if (propName === "opacity" && value === 1) return null;

  // Check if already bound
  const bv = prop(node, "boundVariables");
  if (bv && bv[figmaField]) return null;

  const m = matchVariable(value, propName, nodeContext, indexes);

  const result = {
    currentValue: value,
    suggestedVariable: m ? m.variable : null,
    severity: m ? m.severity : "no_match",
  };
  if (m && m.ambiguous && m.alternatives.length > 0) {
    result.alternatives = m.alternatives;
  }
  return result;
}

function checkStringProperty(node, propName, spec, indexes, nodeContext) {
  const figmaField = spec.field;
  if (!(figmaField in node)) return null;

  let value = node[figmaField];
  if (value === undefined || value === null) return null;

  // Handle figma.mixed
  if (typeof value === "symbol") {
    return {
      currentValue: "mixed",
      suggestedVariable: null,
      severity: "no_match",
    };
  }

  // For fontFamily, the value might be in fontName.family
  if (propName === "fontFamily" && node.type === "TEXT") {
    if (node.fontName && typeof node.fontName === "object" && node.fontName.family) {
      value = node.fontName.family;
    } else {
      return null;
    }
  }

  // Check if already bound
  const bv = prop(node, "boundVariables");
  if (bv && bv[figmaField]) return null;

  const m = matchVariable(value, propName, nodeContext, indexes);

  const result = {
    currentValue: value,
    suggestedVariable: m ? m.variable : null,
    severity: m ? m.severity : "no_match",
  };
  if (m && m.ambiguous && m.alternatives.length > 0) {
    result.alternatives = m.alternatives;
  }
  return result;
}

// ─── Auto-fix ───────────────────────────────────────────────────────────────

async function autoFixProperty(node, propName, spec, variableId) {
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) return false;

  if (spec.type === "color") {
    const fieldName = spec.field;
    if (!(fieldName in node)) return false;
    const paintCopy = JSON.parse(JSON.stringify(node[fieldName]));
    if (!paintCopy || paintCopy.length === 0) return false;
    paintCopy[0] = figma.variables.setBoundVariableForPaint(paintCopy[0], "color", variable);
    node[fieldName] = paintCopy;
    return true;
  }

  if (spec.type === "scalar" || spec.type === "string") {
    node.setBoundVariable(spec.field, variable);
    return true;
  }

  return false;
}

// ─── Main Lint Function ─────────────────────────────────────────────────────

export async function lintDesign(params) {
  // nodeId accepts a single string (backward compat) or an array of root IDs.
  // Normalize to a de-duplicated, order-preserving array of non-empty strings.
  const rawNodeId = params.nodeId;
  const multiRoot = Array.isArray(rawNodeId);
  const rawList = multiRoot ? rawNodeId : [rawNodeId];
  const rootIds = [];
  const seenRootIds = {};
  for (let i = 0; i < rawList.length; i++) {
    const rid = rawList[i];
    if (typeof rid !== "string" || rid.length === 0) continue;
    if (seenRootIds[rid]) continue;
    seenRootIds[rid] = true;
    rootIds.push(rid);
  }
  if (rootIds.length === 0) {
    fail("No root node ID provided to lint", "pass a node ID string or a non-empty array of node ID strings as nodeId");
  }

  const autoFix = params.autoFix || false;
  const properties = params.properties || null; // null = all
  const threshold = params.threshold !== undefined ? params.threshold : 5.0;
  const maxIssues = params.maxIssues || 200;
  const commandId = params.commandId || generateCommandId();

  // Resolve all root nodes up front so a bad ID fails before any scanning work.
  const rootNodes = [];
  for (let i = 0; i < rootIds.length; i++) {
    const rootNode = await figma.getNodeByIdAsync(rootIds[i]);
    if (!rootNode) {
      fail(
        "Node not found: " + rootIds[i],
        "verify the ID with read or search with grep — it may have been deleted or belong to another page",
      );
    }
    rootNodes.push(rootNode);
  }

  // Phase 1: Build variable lookup tables (once, shared across all roots)
  sendProgressUpdate(commandId, "lint_design", "started", 5, 0, 0, "Building variable index...");

  const indexes = await buildVariableIndexes();
  const colorIndex = indexes.colorIndex;
  const scalarIndex = indexes.scalarIndex;

  if (colorIndex.length === 0 && scalarIndex.FLOAT.length === 0 && scalarIndex.STRING.length === 0) {
    sendProgressUpdate(commandId, "lint_design", "completed", 100, 0, 0, "No local variables found in file");
    const emptyResult = {
      summary: {
        totalNodesScanned: 0,
        totalIssues: 0,
        byProperty: {},
        bySeverity: {},
        autoFixed: 0,
      },
      issues: [],
      truncated: false,
      message: "No local variables found in this file. Create variables first to enable linting.",
    };
    if (multiRoot) {
      emptyResult.roots = rootIds.map((rid, idx) => ({
        rootNodeId: rid,
        rootNodeName: prop(rootNodes[idx], "name"),
        totalNodesScanned: 0,
        totalIssues: 0,
        autoFixed: 0,
      }));
    }
    return emptyResult;
  }

  sendProgressUpdate(
    commandId,
    "lint_design",
    "in_progress",
    10,
    0,
    0,
    "Found " + colorIndex.length + " color and " + scalarIndex.FLOAT.length + " scalar variables. Collecting nodes...",
  );

  // Phase 2: Collect nodes per root. Each entry carries its originating root so
  // issues can be attributed back to the frame/page they came from.
  const nodeList = [];
  for (let ri = 0; ri < rootNodes.length; ri++) {
    const rootNode = rootNodes[ri];
    const rootEntries = [];
    if (rootNode.type === "DOCUMENT") {
      // DOCUMENT root: lint every page (load each page first for dynamic-page access)
      for (let pi = 0; pi < rootNode.children.length; pi++) {
        const page = rootNode.children[pi];
        if (typeof page.loadAsync === "function") {
          await page.loadAsync();
        }
        collectNodes(page, "", 0, rootEntries);
      }
    } else {
      collectNodes(rootNode, "", 0, rootEntries);
    }
    const rootName = prop(rootNode, "name");
    for (let ei = 0; ei < rootEntries.length; ei++) {
      rootEntries[ei].rootNodeId = rootIds[ri];
      rootEntries[ei].rootNodeName = rootName;
      nodeList.push(rootEntries[ei]);
    }
  }

  sendProgressUpdate(
    commandId,
    "lint_design",
    "in_progress",
    15,
    nodeList.length,
    0,
    "Collected " + nodeList.length + " visible nodes. Linting...",
  );

  // Determine which properties to lint
  const propsToLint = properties ? properties.filter((p) => LINT_PROPERTIES[p]) : Object.keys(LINT_PROPERTIES);

  // Phase 3: Lint in chunks
  const CHUNK_SIZE = 10;
  const issues = [];
  let totalIssueCount = 0;
  const byProperty = {};
  const bySeverity = { exact_match: 0, near_match: 0, no_match: 0, ambiguous: 0 };
  let autoFixedCount = 0;

  // Per-root tallies (keyed by root node ID), seeded so empty roots still appear.
  const rootStats = {};
  for (let i = 0; i < rootIds.length; i++) {
    rootStats[rootIds[i]] = {
      rootNodeId: rootIds[i],
      rootNodeName: prop(rootNodes[i], "name"),
      totalNodesScanned: 0,
      totalIssues: 0,
      autoFixed: 0,
    };
  }
  for (let i = 0; i < nodeList.length; i++) {
    rootStats[nodeList[i].rootNodeId].totalNodesScanned++;
  }

  const totalChunks = Math.ceil(nodeList.length / CHUNK_SIZE);

  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    const chunkStart = chunkIdx * CHUNK_SIZE;
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, nodeList.length);
    const progress = Math.round(15 + (chunkIdx / totalChunks) * 80);

    sendProgressUpdate(
      commandId,
      "lint_design",
      "in_progress",
      progress,
      nodeList.length,
      chunkStart,
      "Linting chunk " + (chunkIdx + 1) + "/" + totalChunks + " (" + totalIssueCount + " issues so far)",
    );

    for (let ni = chunkStart; ni < chunkEnd; ni++) {
      const entry = nodeList[ni];
      const node = entry.node;
      const insideInstance = isInsideInstance(node);
      const entryRootStats = rootStats[entry.rootNodeId];

      for (let pi = 0; pi < propsToLint.length; pi++) {
        const propName = propsToLint[pi];
        const spec = LINT_PROPERTIES[propName];
        const nodeContext = { nodeType: node.type, threshold: threshold };
        let result = null;

        if (spec.type === "color") {
          result = checkColorProperty(node, propName, spec, indexes, nodeContext);
        } else if (spec.type === "scalar") {
          result = checkScalarProperty(node, propName, spec, indexes, nodeContext);
        } else if (spec.type === "string") {
          result = checkStringProperty(node, propName, spec, indexes, nodeContext);
        }

        if (!result) continue;

        totalIssueCount++;
        entryRootStats.totalIssues++;
        byProperty[propName] = (byProperty[propName] || 0) + 1;
        bySeverity[result.severity] = bySeverity[result.severity] || 0;
        bySeverity[result.severity]++;

        let fixed = false;
        // Only auto-fix exact_match — never ambiguous (needs human review)
        if (autoFix && result.severity === "exact_match" && result.suggestedVariable && !insideInstance) {
          try {
            fixed = await autoFixProperty(node, propName, spec, result.suggestedVariable.id);
            if (fixed) {
              autoFixedCount++;
              entryRootStats.autoFixed++;
            }
          } catch (err) {
            console.log("Auto-fix failed for " + node.id + "." + propName + ": " + err.message);
          }
        }

        if (issues.length < maxIssues) {
          const issue = {
            nodeId: node.id,
            nodeName: node.name,
            nodePath: entry.path,
            property: propName,
            currentValue: result.currentValue,
            severity: result.severity,
            suggestedVariable: result.suggestedVariable,
            fixed: fixed,
          };
          // Attribute every issue to its originating root so multi-root
          // callers can group results without re-deriving ancestry.
          if (multiRoot) {
            issue.rootNodeId = entry.rootNodeId;
          }
          if (result.alternatives && result.alternatives.length > 0) {
            issue.alternatives = result.alternatives;
          }
          if (insideInstance && autoFix && result.severity === "exact_match") {
            issue.skipReason = "instance_child";
          }
          issues.push(issue);
        }
      }

      await delay(5);
    }

    if (chunkIdx < totalChunks - 1) {
      await delay(50);
    }
  }

  // Phase 4: Return results
  sendProgressUpdate(
    commandId,
    "lint_design",
    "completed",
    100,
    nodeList.length,
    nodeList.length,
    "Lint complete: " +
      totalIssueCount +
      " issues found" +
      (autoFixedCount > 0 ? ", " + autoFixedCount + " auto-fixed" : ""),
  );

  const out = {
    summary: {
      totalNodesScanned: nodeList.length,
      totalIssues: totalIssueCount,
      byProperty: byProperty,
      bySeverity: bySeverity,
      autoFixed: autoFixedCount,
    },
    issues: issues,
    truncated: totalIssueCount > maxIssues,
  };
  // Per-root breakdown only when multiple roots were requested — preserves the
  // single-root response shape exactly for backward compatibility.
  if (multiRoot) {
    out.roots = rootIds.map((rid) => rootStats[rid]);
  }
  return out;
}

// ─── Write-time mini-lint (Phase 4.2) ───────────────────────────────────────
//
// Runs the single-value matcher over only the raw values a create/apply op
// just set. Fetches local variables ONCE per command invocation. Advisory
// only: any error is swallowed — mini-lint never fails the write.
//
// rawSets: [{ nodeId, property (LINT_PROPERTIES key), field (variables-map
// field name for the suggestion), value, nodeType }]
// Returns warnings: [{ nodeId, check: "unbound_value", message }]
export async function miniLint(rawSets) {
  if (!rawSets || rawSets.length === 0) return [];

  let indexes;
  try {
    indexes = await buildVariableIndexes();
  } catch (_e) {
    return [];
  }
  if (indexes.colorIndex.length === 0 && indexes.scalarIndex.FLOAT.length === 0) {
    return [];
  }

  const warnings = [];
  for (let i = 0; i < rawSets.length; i++) {
    const set = rawSets[i];
    try {
      const m = matchVariable(set.value, set.property, { nodeType: set.nodeType }, indexes);
      if (!m || m.severity !== "exact_match" || m.ambiguous) continue;

      let displayValue;
      if (set.value && typeof set.value === "object") {
        displayValue = rgbaToHex({
          r: set.value.r,
          g: set.value.g,
          b: set.value.b,
          a: set.value.a !== undefined ? set.value.a : 1,
        });
      } else {
        displayValue = String(set.value);
      }

      warnings.push({
        nodeId: set.nodeId,
        check: "unbound_value",
        message:
          set.field +
          " " +
          displayValue +
          " matches variable " +
          m.variable.name +
          " — pass variables: { " +
          set.field +
          ": '" +
          m.variable.id +
          "' } to bind",
      });
    } catch (_e) {
      // advisory only — skip this value
    }
  }
  return warnings;
}
