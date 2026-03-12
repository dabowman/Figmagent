// Lint command: scan subtree for properties not bound to design token variables.
// Reports unbound fills, strokes, corner radii, spacing, opacity, font properties.
// Optionally suggests matching variables and auto-fixes exact matches.

import { sendProgressUpdate, generateCommandId, delay, rgbaToHex } from "../helpers.js";

// ─── Color Distance (CIE76 deltaE in CIELAB) ───────────────────────────────

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(r, g, b) {
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

// ─── Variable Index Builder ─────────────────────────────────────────────────

async function buildVariableIndexes() {
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

      if (variable.resolvedType === "COLOR" && val && typeof val === "object" && "r" in val) {
        colorIndex.push({
          id: variable.id,
          name: variable.name,
          collectionName: collectionName,
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
          value: val,
        });
      } else if (variable.resolvedType === "STRING" && typeof val === "string") {
        scalarIndex.STRING.push({
          id: variable.id,
          name: variable.name,
          collectionName: collectionName,
          value: val,
        });
      }
    }
  }

  return { colorIndex, scalarIndex };
}

// ─── Node Collection ────────────────────────────────────────────────────────

function collectNodes(node, path, depth, result) {
  if (!node.visible) return;

  const nodePath = path ? path + " > " + node.name : node.name;
  result.push({ node: node, path: nodePath, depth: depth });

  // Skip children of INSTANCE nodes — bindings come from main component
  // But we still lint the instance node itself for overrides
  if (node.type === "INSTANCE") return;

  if ("children" in node) {
    for (let i = 0; i < node.children.length; i++) {
      collectNodes(node.children[i], nodePath, depth + 1, result);
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

function findBestColorMatch(r, g, b, colorIndex, threshold) {
  const lab = rgbToLab(r, g, b);
  let bestDist = Infinity;
  let bestMatch = null;

  for (let i = 0; i < colorIndex.length; i++) {
    const d = deltaE(lab, colorIndex[i].lab);
    if (d < bestDist) {
      bestDist = d;
      bestMatch = colorIndex[i];
    }
  }

  if (!bestMatch || bestDist > threshold) return null;

  return {
    id: bestMatch.id,
    name: bestMatch.name,
    collection: bestMatch.collectionName,
    distance: Math.round(bestDist * 100) / 100,
  };
}

function findBestScalarMatch(value, scalarList) {
  let bestDist = Infinity;
  let bestMatch = null;

  for (let i = 0; i < scalarList.length; i++) {
    const d = Math.abs(value - scalarList[i].value);
    if (d < bestDist) {
      bestDist = d;
      bestMatch = scalarList[i];
    }
  }

  if (!bestMatch) return null;

  // Exact: equal. Near: within 10% or 1 unit absolute
  const isNear = bestDist <= Math.max(Math.abs(value) * 0.1, 1);
  if (!isNear) return null;

  return {
    id: bestMatch.id,
    name: bestMatch.name,
    collection: bestMatch.collectionName,
    distance: Math.round(bestDist * 100) / 100,
  };
}

function findExactStringMatch(value, stringList) {
  for (let i = 0; i < stringList.length; i++) {
    if (stringList[i].value === value) {
      return {
        id: stringList[i].id,
        name: stringList[i].name,
        collection: stringList[i].collectionName,
        distance: 0,
      };
    }
  }
  return null;
}

function classifySeverity(distance, isColor) {
  if (distance === 0) return "exact_match";
  if (isColor) {
    return distance < 1.0 ? "exact_match" : "near_match";
  }
  return "near_match";
}

function checkColorProperty(node, fieldName, colorIndex, threshold) {
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
  const match = findBestColorMatch(color.r, color.g, color.b, colorIndex, threshold);
  const hexVal = rgbaToHex({ r: color.r, g: color.g, b: color.b, a: paint.opacity !== undefined ? paint.opacity : 1 });

  return {
    currentValue: hexVal,
    suggestedVariable: match,
    severity: match ? classifySeverity(match.distance, true) : "no_match",
  };
}

function checkScalarProperty(node, propName, figmaField, scalarList) {
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
  const bv = node.boundVariables;
  if (bv && bv[figmaField]) return null;

  const match = findBestScalarMatch(value, scalarList);

  return {
    currentValue: value,
    suggestedVariable: match,
    severity: match ? (match.distance === 0 ? "exact_match" : "near_match") : "no_match",
  };
}

function checkStringProperty(node, propName, figmaField, stringList) {
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
  const bv = node.boundVariables;
  if (bv && bv[figmaField]) return null;

  const match = findExactStringMatch(value, stringList);

  return {
    currentValue: value,
    suggestedVariable: match,
    severity: match ? "exact_match" : "no_match",
  };
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
  const nodeId = params.nodeId;
  const autoFix = params.autoFix || false;
  const properties = params.properties || null; // null = all
  const threshold = params.threshold !== undefined ? params.threshold : 5.0;
  const maxIssues = params.maxIssues || 200;
  const commandId = params.commandId || generateCommandId();

  // Resolve root node
  const rootNode = await figma.getNodeByIdAsync(nodeId);
  if (!rootNode) {
    throw new Error("Node not found: " + nodeId);
  }

  // Phase 1: Build variable lookup tables
  sendProgressUpdate(commandId, "lint_design", "started", 5, 0, 0, "Building variable index...");

  const indexes = await buildVariableIndexes();
  const colorIndex = indexes.colorIndex;
  const scalarIndex = indexes.scalarIndex;

  if (colorIndex.length === 0 && scalarIndex.FLOAT.length === 0 && scalarIndex.STRING.length === 0) {
    sendProgressUpdate(commandId, "lint_design", "completed", 100, 0, 0, "No local variables found in file");
    return {
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

  // Phase 2: Collect nodes
  const nodeList = [];
  collectNodes(rootNode, "", 0, nodeList);

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
  const bySeverity = { exact_match: 0, near_match: 0, no_match: 0 };
  let autoFixedCount = 0;

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

      for (let pi = 0; pi < propsToLint.length; pi++) {
        const propName = propsToLint[pi];
        const spec = LINT_PROPERTIES[propName];
        let result = null;

        if (spec.type === "color") {
          result = checkColorProperty(node, spec.field, colorIndex, threshold);
        } else if (spec.type === "scalar") {
          result = checkScalarProperty(node, propName, spec.field, scalarIndex.FLOAT);
        } else if (spec.type === "string") {
          result = checkStringProperty(node, propName, spec.field, scalarIndex.STRING);
        }

        if (!result) continue;

        totalIssueCount++;
        byProperty[propName] = (byProperty[propName] || 0) + 1;
        bySeverity[result.severity] = bySeverity[result.severity] || 0;
        bySeverity[result.severity]++;

        let fixed = false;
        if (autoFix && result.severity === "exact_match" && result.suggestedVariable && !insideInstance) {
          try {
            fixed = await autoFixProperty(node, propName, spec, result.suggestedVariable.id);
            if (fixed) autoFixedCount++;
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

  return {
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
}
