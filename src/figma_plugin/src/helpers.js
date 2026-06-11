// Shared utilities for the Figma plugin
// No optional chaining (?.) or nullish coalescing (??) — Figma sandbox constraint

// Plugin state (shared across modules)
export const state = {
  serverPort: 3055,
};

// Send progress updates to the plugin UI
export function sendProgressUpdate(
  commandId,
  commandType,
  status,
  progress,
  totalItems,
  processedItems,
  message,
  payload = null,
) {
  const update = {
    type: "command_progress",
    commandId,
    commandType,
    status,
    progress,
    totalItems,
    processedItems,
    message,
    timestamp: Date.now(),
  };

  if (payload) {
    if (payload.currentChunk !== undefined && payload.totalChunks !== undefined) {
      update.currentChunk = payload.currentChunk;
      update.totalChunks = payload.totalChunks;
      update.chunkSize = payload.chunkSize;
    }
    update.payload = payload;
  }

  figma.ui.postMessage(update);
  console.log(`Progress update: ${status} - ${progress}% - ${message}`);

  return update;
}

// Strict-property-guard compat: the remote VM throws on reading properties that
// don't exist on a node type; the desktop VM returns undefined. `in` is safe on both.
export function prop(node, name) {
  return name in node ? node[name] : undefined;
}

// Coerce value to number with fallback (handles string "4" → 4)
export function toNumber(val, fallback) {
  if (val === undefined || val === null) return fallback;
  var n = typeof val === "number" ? val : parseFloat(val);
  return Number.isNaN(n) ? fallback : n;
}

// Convert Figma RGBA (0-1) to hex string
export function rgbaToHex(color) {
  var r = Math.round(color.r * 255);
  var g = Math.round(color.g * 255);
  var b = Math.round(color.b * 255);
  var a = color.a !== undefined ? Math.round(color.a * 255) : 255;

  if (a === 255) {
    return (
      "#" +
      [r, g, b]
        .map((x) => {
          return x.toString(16).padStart(2, "0");
        })
        .join("")
    );
  }

  return (
    "#" +
    [r, g, b, a]
      .map((x) => {
        return x.toString(16).padStart(2, "0");
      })
      .join("")
  );
}

// Promise-based delay for chunked processing
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generate simple UUID for command tracking
export function generateCommandId() {
  return "cmd_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Walk the current page tree to find a node by ID (fallback for getNodeByIdAsync)
export function findNodeByIdInTree(nodeId) {
  let found = null;
  function walk(node) {
    if (found) return;
    if (node.id === nodeId) {
      found = node;
      return;
    }
    const children = prop(node, "children");
    if (children) {
      for (let i = 0; i < children.length; i++) {
        walk(children[i]);
      }
    }
  }
  walk(figma.currentPage);
  return found;
}

// Base64 encode a Uint8Array (Figma sandbox lacks btoa)
export function customBase64Encode(bytes) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64 = "";

  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;

  let a, b, c, d;
  let chunk;

  for (let i = 0; i < mainLength; i = i + 3) {
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    a = (chunk & 16515072) >> 18;
    b = (chunk & 258048) >> 12;
    c = (chunk & 4032) >> 6;
    d = chunk & 63;
    base64 += chars[a] + chars[b] + chars[c] + chars[d];
  }

  if (byteRemainder === 1) {
    chunk = bytes[mainLength];
    a = (chunk & 252) >> 2;
    b = (chunk & 3) << 4;
    base64 += chars[a] + chars[b] + "==";
  } else if (byteRemainder === 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];
    a = (chunk & 64512) >> 10;
    b = (chunk & 1008) >> 4;
    c = (chunk & 15) << 2;
    base64 += chars[a] + chars[b] + chars[c] + "=";
  }

  return base64;
}

// Recursively convert Symbol values (e.g. figma.mixed) to the string "mixed".
// Symbols crash figma.ui.postMessage (structured clone can't handle them).
export function sanitizeSymbols(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "symbol") return "mixed";
  if (typeof obj === "number" || typeof obj === "string" || typeof obj === "boolean") return obj;
  if (Array.isArray(obj)) {
    const out = [];
    for (let i = 0; i < obj.length; i++) {
      out.push(sanitizeSymbols(obj[i]));
    }
    return out;
  }
  if (typeof obj === "object") {
    const out = {};
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      out[keys[i]] = sanitizeSymbols(obj[keys[i]]);
    }
    return out;
  }
  return obj;
}

// Filter a Figma node tree for serializable output (strips vectors, bindings, image refs)
export function filterFigmaNode(node) {
  if (node.type === "VECTOR") {
    return null;
  }

  var filtered = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  const fills = prop(node, "fills");
  if (fills && fills.length > 0) {
    filtered.fills = fills.map((fill) => {
      var processedFill = Object.assign({}, fill);
      delete processedFill.boundVariables;
      delete processedFill.imageRef;

      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map((stop) => {
          var processedStop = Object.assign({}, stop);
          if (processedStop.color) {
            processedStop.color = rgbaToHex(processedStop.color);
          }
          delete processedStop.boundVariables;
          return processedStop;
        });
      }

      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }

      return processedFill;
    });
  }

  const strokes = prop(node, "strokes");
  if (strokes && strokes.length > 0) {
    filtered.strokes = strokes.map((stroke) => {
      var processedStroke = Object.assign({}, stroke);
      delete processedStroke.boundVariables;
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    });
  }

  const cornerRadius = prop(node, "cornerRadius");
  if (cornerRadius !== undefined) {
    filtered.cornerRadius = cornerRadius;
  }

  const absoluteBoundingBox = prop(node, "absoluteBoundingBox");
  if (absoluteBoundingBox) {
    filtered.absoluteBoundingBox = absoluteBoundingBox;
  }

  const characters = prop(node, "characters");
  if (characters) {
    filtered.characters = characters;
  }

  const style = prop(node, "style");
  if (style) {
    filtered.style = {
      fontFamily: style.fontFamily,
      fontStyle: style.fontStyle,
      fontWeight: style.fontWeight,
      fontSize: style.fontSize,
      textAlignHorizontal: style.textAlignHorizontal,
      letterSpacing: style.letterSpacing,
      lineHeightPx: style.lineHeightPx,
    };
  }

  // Auto-layout properties
  const layoutMode = prop(node, "layoutMode");
  if (layoutMode && layoutMode !== "NONE") {
    filtered.layoutMode = layoutMode;
    filtered.primaryAxisSizingMode = prop(node, "primaryAxisSizingMode");
    filtered.counterAxisSizingMode = prop(node, "counterAxisSizingMode");
    const primaryAxisAlignItems = prop(node, "primaryAxisAlignItems");
    if (primaryAxisAlignItems && primaryAxisAlignItems !== "MIN") {
      filtered.primaryAxisAlignItems = primaryAxisAlignItems;
    }
    const counterAxisAlignItems = prop(node, "counterAxisAlignItems");
    if (counterAxisAlignItems && counterAxisAlignItems !== "MIN") {
      filtered.counterAxisAlignItems = counterAxisAlignItems;
    }
    const itemSpacing = prop(node, "itemSpacing");
    if (itemSpacing > 0) {
      filtered.itemSpacing = itemSpacing;
    }
    const counterAxisSpacing = prop(node, "counterAxisSpacing");
    if (counterAxisSpacing > 0) {
      filtered.counterAxisSpacing = counterAxisSpacing;
    }
    const paddingLeft = prop(node, "paddingLeft");
    if (paddingLeft > 0) {
      filtered.paddingLeft = paddingLeft;
    }
    const paddingRight = prop(node, "paddingRight");
    if (paddingRight > 0) {
      filtered.paddingRight = paddingRight;
    }
    const paddingTop = prop(node, "paddingTop");
    if (paddingTop > 0) {
      filtered.paddingTop = paddingTop;
    }
    const paddingBottom = prop(node, "paddingBottom");
    if (paddingBottom > 0) {
      filtered.paddingBottom = paddingBottom;
    }
    if (prop(node, "layoutWrap") === "WRAP") {
      filtered.layoutWrap = "WRAP";
    }
  }

  const children = prop(node, "children");
  if (children) {
    filtered.children = children
      .map((child) => {
        return filterFigmaNode(child);
      })
      .filter((child) => {
        return child !== null;
      });
  }

  return filtered;
}
