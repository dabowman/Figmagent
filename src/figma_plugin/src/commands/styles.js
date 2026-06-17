// Styles commands: getStyles, getLocalVariables, getLocalComponents,
// getDesignSystem, createVariables, updateVariables, createStyles, updateStyles

import { sendProgressUpdate, prop, fail } from "../helpers.js";

// Load a font for a text style, converting Figma's opaque load error into one
// that names the exact fontFamily/fontStyle pair to pass.
async function loadFontOrFail(family, style) {
  try {
    await figma.loadFontAsync({ family: family, style: style });
  } catch (_fontErr) {
    fail(
      "Font load failed for fontFamily '" + family + "' fontStyle '" + style + "'",
      "pass a fontFamily/fontStyle pair that exists exactly as Figma lists it (e.g. fontFamily: 'Inter', fontStyle: 'Semi Bold' — not 'SemiBold' or a weight number)",
    );
  }
}

// Load a TEXT style's CURRENT font before writing any property. Figma
// re-renders the style on any write — even a non-font prop like lineHeight —
// and rejects writes when the already-assigned font is not loaded (#52).
// A TextStyle normally carries a single fontName; the figma.mixed guard is
// defensive (mixed fonts have no single name to load, so there is nothing to
// pre-load — the per-field write that needs them will surface its own error).
async function loadCurrentStyleFont(style) {
  const current = style.fontName;
  if (current && current !== figma.mixed) {
    // Use loadFontOrFail so an uninstalled current font yields a fix-stating
    // message (repo rule) instead of Figma's opaque load error.
    await loadFontOrFail(current.family, current.style);
  }
}

// Load every available style of a font family. Setting a FONT_FAMILY variable
// re-renders any text bound to it, which throws if the family is not loaded
// (#52). We don't know which style(s) the bound text uses, so load them all —
// the family string is all the variable value gives us. Best-effort: an
// unresolvable family is left to the setValueForMode write to report.
async function loadFontFamily(family, fontList) {
  if (typeof family !== "string" || family.length === 0) return;
  let fonts = fontList;
  if (!fonts) {
    try {
      fonts = await figma.listAvailableFontsAsync();
    } catch (_listErr) {
      return;
    }
  }
  for (let i = 0; i < fonts.length; i++) {
    const fn = fonts[i].fontName;
    if (fn && fn.family === family) {
      try {
        await figma.loadFontAsync({ family: fn.family, style: fn.style });
      } catch (_loadErr) {
        // Ignore individual style load failures; bound text may not use them.
      }
    }
  }
}

// Coerce a lineHeight value into Figma's { value, unit } format.
// - "AUTO" → { unit: "AUTO" }
// - { value, unit } → pass through (already Figma format)
// - number < 10 → treat as unitless multiplier, convert to PERCENT (1.5 → 150%)
// - number >= 10 → treat as pixels
function coerceLineHeight(val) {
  if (val === "AUTO") return { unit: "AUTO" };
  if (typeof val === "object" && val !== null) return val;
  if (typeof val === "number") {
    if (val < 10) {
      return { value: val * 100, unit: "PERCENT" };
    }
    return { value: val, unit: "PIXELS" };
  }
  return { unit: "AUTO" };
}

// Coerce a letterSpacing value into Figma's { value, unit } format.
// - { value, unit } → pass through
// - number where abs(value) < 1 → treat as em/ratio, convert to PERCENT
//   (e.g. -0.025 → -2.5%, 0.03 → 3%)
// - number where abs(value) >= 1 → treat as pixels
function coerceLetterSpacing(val) {
  if (typeof val === "object" && val !== null) return val;
  if (typeof val === "number") {
    if (Math.abs(val) < 1) {
      return { value: val * 100, unit: "PERCENT" };
    }
    return { value: val, unit: "PIXELS" };
  }
  return { value: 0, unit: "PIXELS" };
}

// Extract bound variable IDs from a style's boundVariables property.
// Returns a flat map { field: "VariableID:xxx" } or undefined if none bound.
function extractBoundVariables(style) {
  const bv = prop(style, "boundVariables");
  if (!bv) return undefined;

  const result = {};
  const fields = Object.keys(bv);
  for (let i = 0; i < fields.length; i++) {
    const binding = bv[fields[i]];
    if (binding && binding.id) {
      result[fields[i]] = binding.id;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export async function getStyles() {
  const styles = {
    colors: await figma.getLocalPaintStylesAsync(),
    texts: await figma.getLocalTextStylesAsync(),
    effects: await figma.getLocalEffectStylesAsync(),
    grids: await figma.getLocalGridStylesAsync(),
  };

  return {
    colors: styles.colors.map((style) => {
      const entry = {
        id: style.id,
        name: style.name,
        key: style.key,
        description: style.description || undefined,
        paints: style.paints,
      };
      const bv = extractBoundVariables(style);
      if (bv) entry.boundVariables = bv;
      return entry;
    }),
    texts: styles.texts.map((style) => {
      const entry = {
        id: style.id,
        name: style.name,
        key: style.key,
        description: style.description || undefined,
        fontFamily: style.fontName.family,
        fontStyle: style.fontName.style,
        fontSize: style.fontSize,
      };
      if (style.lineHeight && style.lineHeight.unit !== "AUTO") {
        entry.lineHeight = style.lineHeight;
      }
      if (style.letterSpacing && style.letterSpacing.value !== 0) {
        entry.letterSpacing = style.letterSpacing;
      }
      if (style.paragraphSpacing && style.paragraphSpacing !== 0) {
        entry.paragraphSpacing = style.paragraphSpacing;
      }
      if (style.textDecoration && style.textDecoration !== "NONE") {
        entry.textDecoration = style.textDecoration;
      }
      if (style.textCase && style.textCase !== "ORIGINAL") {
        entry.textCase = style.textCase;
      }
      const bv = extractBoundVariables(style);
      if (bv) entry.boundVariables = bv;
      return entry;
    }),
    effects: styles.effects.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      description: style.description || undefined,
      effects: style.effects,
    })),
    grids: styles.grids.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      description: style.description || undefined,
      grids: style.layoutGrids,
    })),
  };
}

export async function getLocalVariables(options) {
  const includeScopes = !!(options && options.includeScopes);
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const result = [];

  for (let i = 0; i < collections.length; i++) {
    const collection = collections[i];
    const variables = [];

    for (let j = 0; j < collection.variableIds.length; j++) {
      const variable = await figma.variables.getVariableByIdAsync(collection.variableIds[j]);
      if (!variable) continue;

      const values = {};
      for (let m = 0; m < collection.modes.length; m++) {
        const mode = collection.modes[m];
        const value = variable.valuesByMode[mode.modeId];
        if (value && typeof value === "object" && "type" in value && value.type === "VARIABLE_ALIAS") {
          values[mode.name] = { alias: value.id };
        } else {
          values[mode.name] = value;
        }
      }

      const entry = {
        id: variable.id,
        name: variable.name,
        resolvedType: variable.resolvedType,
        values: values,
      };
      if (includeScopes) {
        entry.scopes = Array.isArray(variable.scopes) ? variable.scopes.slice() : [];
      }
      variables.push(entry);
    }

    result.push({
      id: collection.id,
      name: collection.name,
      modes: collection.modes.map((mode) => ({ id: mode.modeId, name: mode.name })),
      variableCount: variables.length,
      variables: variables,
    });
  }

  return result;
}

export async function getLocalComponents() {
  // Per-page loadAsync + per-page findAllWithCriteria (same pattern as
  // find.js / lint.js): the remote use_figma VM has no loadAllPagesAsync,
  // and desktop dynamic-page access rejects root-level findAllWithCriteria
  // unless loadAllPagesAsync was called — per-page traversal satisfies both.
  const pages = figma.root.children;
  const componentSets = [];
  const standaloneComponents = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (typeof page.loadAsync === "function") {
      await page.loadAsync();
    }
    const sets = page.findAllWithCriteria({ types: ["COMPONENT_SET"] });
    for (let j = 0; j < sets.length; j++) {
      componentSets.push(sets[j]);
    }
    const components = page.findAllWithCriteria({ types: ["COMPONENT"] });
    for (let j = 0; j < components.length; j++) {
      if (!components[j].parent || components[j].parent.type !== "COMPONENT_SET") {
        standaloneComponents.push(components[j]);
      }
    }
  }

  const results = [];

  for (let i = 0; i < componentSets.length; i++) {
    const set = componentSets[i];
    const axesMap = {};
    const variants = [];
    for (let j = 0; j < set.children.length; j++) {
      const child = set.children[j];
      if (child.type !== "COMPONENT") continue;
      variants.push({
        id: child.id,
        name: child.name,
        key: "key" in child ? child.key : null,
      });
      const pairs = child.name.split(",");
      for (let k = 0; k < pairs.length; k++) {
        const pair = pairs[k].trim();
        const eqIdx = pair.indexOf("=");
        if (eqIdx === -1) continue;
        const propName = pair.substring(0, eqIdx).trim();
        const propVal = pair.substring(eqIdx + 1).trim();
        if (!axesMap[propName]) axesMap[propName] = [];
        if (axesMap[propName].indexOf(propVal) === -1) axesMap[propName].push(propVal);
      }
    }
    results.push({
      id: set.id,
      name: set.name,
      key: "key" in set ? set.key : null,
      type: "COMPONENT_SET",
      variantCount: variants.length,
      variantAxes: axesMap,
      defaultVariant: set.defaultVariant && set.defaultVariant.name ? set.defaultVariant.name : null,
      variants: variants,
    });
  }

  for (let i = 0; i < standaloneComponents.length; i++) {
    const comp = standaloneComponents[i];
    results.push({
      id: comp.id,
      name: comp.name,
      key: "key" in comp ? comp.key : null,
      type: "COMPONENT",
    });
  }

  return {
    count: results.length,
    components: results,
  };
}

// Combined design system discovery — returns styles + variables in one call
// Supports filtering: collection (string|string[]), styleType (string|string[]),
// namePattern (regex on variable/style names), includeVariables (bool), includeStyles (bool).
// Always returns a top-level `collections` array of every variable collection name
// (cheap — names are short) so the MCP server can list them when output is truncated.
export async function getDesignSystem(params) {
  const includeVariables = !(params && params.includeVariables === false);
  const includeStyles = !(params && params.includeStyles === false);

  const includeScopes = !!(params && params.includeScopes);

  const promises = [];
  promises.push(includeStyles ? getStyles() : Promise.resolve(null));
  promises.push(includeVariables ? getLocalVariables({ includeScopes: includeScopes }) : Promise.resolve(null));

  const [styles, variables] = await Promise.all(promises);

  // Compile namePattern once — applied to both variable and per-style names.
  let nameRe = null;
  if (params && params.namePattern) {
    try {
      nameRe = new RegExp(params.namePattern, "i");
    } catch (e) {
      fail(
        'namePattern "' + params.namePattern + '" is not a valid regular expression: ' + e.message,
        'Pass a valid JavaScript regex string (e.g. namePattern: "^font/" for tokens whose name starts with font/).',
      );
    }
  }

  const result = {};

  // Filter styles by styleType (group) then namePattern (per-style name).
  if (styles) {
    let stylesObj = styles;
    if (params && params.styleType) {
      const types = Array.isArray(params.styleType) ? params.styleType : [params.styleType];
      const filtered = {};
      for (let i = 0; i < types.length; i++) {
        const t = types[i];
        if (styles[t] !== undefined) {
          filtered[t] = styles[t];
        }
      }
      stylesObj = filtered;
    }
    if (nameRe) {
      const byName = {};
      const groups = Object.keys(stylesObj);
      for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        const arr = stylesObj[group];
        if (Array.isArray(arr)) {
          const kept = [];
          for (let i = 0; i < arr.length; i++) {
            if (arr[i] && nameRe.test(prop(arr[i], "name") || "")) kept.push(arr[i]);
          }
          byName[group] = kept;
        } else {
          byName[group] = arr;
        }
      }
      stylesObj = byName;
    }
    result.styles = stylesObj;
  }

  // Filter variables by collection name then namePattern (per-variable name).
  if (variables) {
    let varList = variables;
    if (params && params.collection) {
      const names = Array.isArray(params.collection) ? params.collection : [params.collection];
      const namesLower = [];
      for (let i = 0; i < names.length; i++) {
        namesLower.push(names[i].toLowerCase());
      }
      const filtered = [];
      for (let i = 0; i < varList.length; i++) {
        if (namesLower.indexOf(varList[i].name.toLowerCase()) !== -1) {
          filtered.push(varList[i]);
        }
      }
      varList = filtered;
    }
    if (nameRe) {
      const filtered = [];
      for (let i = 0; i < varList.length; i++) {
        const coll = Object.assign({}, varList[i]);
        const keptVars = [];
        const vars = coll.variables || [];
        for (let j = 0; j < vars.length; j++) {
          if (nameRe.test(vars[j].name || "")) keptVars.push(vars[j]);
        }
        coll.variables = keptVars;
        coll.variableCount = keptVars.length;
        // Drop collections with no matches — keeping empty shells defeats the
        // output reduction this filter exists for. The top-level `collections`
        // array already advertises every collection name (issue #28/#44).
        if (keptVars.length > 0) filtered.push(coll);
      }
      varList = filtered;
    }
    result.variables = varList;
  }

  // Always surface the full set of collection names so a truncated response
  // can tell the agent exactly what to pass to `collection` (issue #44).
  if (variables) {
    const collNames = [];
    for (let i = 0; i < variables.length; i++) {
      collNames.push(variables[i].name);
    }
    result.collections = collNames;
  }

  return result;
}

// Create variables — create a collection (or use existing) + variables + set values
export async function createVariables(params) {
  const collectionName = params.collectionName;
  const collectionId = params.collectionId;
  const modeNames = params.modes;
  const variableSpecs = params.variables;

  if (!variableSpecs || !Array.isArray(variableSpecs) || variableSpecs.length === 0) {
    throw new Error("Missing or empty variables array");
  }

  // Find or create collection
  let collection;
  if (collectionId) {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    collection = collections.find((c) => c.id === collectionId);
    if (!collection) throw new Error("Collection not found: " + collectionId);
  } else if (collectionName) {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    collection = collections.find((c) => c.name === collectionName);
    if (!collection) {
      collection = figma.variables.createVariableCollection(collectionName);
    }
  } else {
    throw new Error("Must provide collectionName or collectionId");
  }

  // Set up modes if specified
  if (modeNames && Array.isArray(modeNames) && modeNames.length > 0) {
    const existingModes = collection.modes;

    // Rename existing modes to match requested names, add new ones as needed
    for (let i = 0; i < modeNames.length; i++) {
      if (i < existingModes.length) {
        // Rename existing mode
        if (existingModes[i].name !== modeNames[i]) {
          collection.renameMode(existingModes[i].modeId, modeNames[i]);
        }
      } else {
        // Add new mode
        collection.addMode(modeNames[i]);
      }
    }
  }

  // Refresh modes after potential changes
  const finalModes = collection.modes;
  const modeByName = {};
  for (let i = 0; i < finalModes.length; i++) {
    modeByName[finalModes[i].name] = finalModes[i].modeId;
  }

  // Build a set of existing variable names in this collection for duplicate detection
  const existingNames = {};
  for (let i = 0; i < collection.variableIds.length; i++) {
    const existing = await figma.variables.getVariableByIdAsync(collection.variableIds[i]);
    if (existing) {
      existingNames[existing.name] = existing.id;
    }
  }

  // Valid scopes per type for validation
  var VALID_SCOPES = {
    COLOR: ["ALL_SCOPES", "ALL_FILLS", "FRAME_FILL", "SHAPE_FILL", "TEXT_FILL", "STROKE_COLOR", "EFFECT_COLOR"],
    FLOAT: [
      "ALL_SCOPES",
      "CORNER_RADIUS",
      "WIDTH_HEIGHT",
      "GAP",
      "OPACITY",
      "STROKE_FLOAT",
      "EFFECT_FLOAT",
      "FONT_SIZE",
      "FONT_WEIGHT",
      "LINE_HEIGHT",
      "LETTER_SPACING",
      "PARAGRAPH_SPACING",
      "PARAGRAPH_INDENT",
    ],
    STRING: ["ALL_SCOPES", "TEXT_CONTENT", "FONT_FAMILY", "FONT_STYLE"],
    BOOLEAN: ["ALL_SCOPES", "TEXT_CONTENT"],
  };

  // Create variables and set values
  const results = [];
  const commandId = params.commandId;
  const totalVars = variableSpecs.length;

  if (commandId) {
    sendProgressUpdate(commandId, "create_variables", "started", 0, totalVars, 0, "Creating variables");
  }

  for (let i = 0; i < variableSpecs.length; i++) {
    const spec = variableSpecs[i];
    try {
      const resolvedType = spec.type || "COLOR";

      // Check for duplicate names — skip if already exists
      if (existingNames[spec.name]) {
        results.push({
          success: false,
          name: spec.name,
          error: "Variable already exists with id " + existingNames[spec.name] + ". Use update_variables to modify it.",
        });
        continue;
      }

      // Validate scopes before creating the variable
      if (spec.scopes && Array.isArray(spec.scopes)) {
        const validForType = VALID_SCOPES[resolvedType] || VALID_SCOPES.COLOR;
        for (let s = 0; s < spec.scopes.length; s++) {
          if (validForType.indexOf(spec.scopes[s]) === -1) {
            fail(
              "Invalid scope '" + spec.scopes[s] + "' for type " + resolvedType,
              "use one of: " + validForType.join(", "),
            );
          }
        }
      }

      const variable = figma.variables.createVariable(spec.name, collection, resolvedType);

      if (spec.description) {
        variable.description = spec.description;
      }

      if (spec.scopes && Array.isArray(spec.scopes)) {
        variable.scopes = spec.scopes;
      }

      // Set values per mode
      if (spec.values && typeof spec.values === "object") {
        const valueKeys = Object.keys(spec.values);
        for (let j = 0; j < valueKeys.length; j++) {
          const modeName = valueKeys[j];
          const modeId = modeByName[modeName];
          if (!modeId) {
            throw new Error("Mode not found: " + modeName + ". Available: " + Object.keys(modeByName).join(", "));
          }
          const value = spec.values[modeName];
          // Handle alias references
          if (value && typeof value === "object" && value.alias) {
            const aliasVar = await figma.variables.getVariableByIdAsync(value.alias);
            if (!aliasVar) throw new Error("Alias variable not found: " + value.alias);
            variable.setValueForMode(modeId, { type: "VARIABLE_ALIAS", id: aliasVar.id });
          } else {
            variable.setValueForMode(modeId, value);
          }
        }
      }

      // Track for in-batch duplicate detection
      existingNames[spec.name] = variable.id;
      results.push({ success: true, name: spec.name, id: variable.id, type: resolvedType });
    } catch (e) {
      results.push({ success: false, name: spec.name, error: e.message || String(e) });
    }

    if (commandId && (i + 1) % 5 === 0) {
      const pct = Math.round(((i + 1) / totalVars) * 100);
      sendProgressUpdate(
        commandId,
        "create_variables",
        "in_progress",
        pct,
        totalVars,
        i + 1,
        "Created " + (i + 1) + " of " + totalVars,
      );
    }
  }

  if (commandId) {
    sendProgressUpdate(
      commandId,
      "create_variables",
      "completed",
      100,
      totalVars,
      totalVars,
      "Variable creation completed",
    );
  }

  const successCount = results.filter((r) => r.success).length;
  return {
    success: successCount === results.length,
    collectionId: collection.id,
    collectionName: collection.name,
    modes: collection.modes.map((m) => ({ id: m.modeId, name: m.name })),
    totalCreated: successCount,
    totalFailed: results.length - successCount,
    results: results,
  };
}

// Update existing variables — set values, rename, change description, delete
export async function updateVariables(params) {
  const updates = params.updates;
  const commandId = params.commandId;

  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    throw new Error("Missing or empty updates array");
  }

  const totalOps = updates.length;
  const results = [];

  if (commandId) {
    sendProgressUpdate(commandId, "update_variables", "started", 0, totalOps, 0, "Updating variables");
  }

  for (let i = 0; i < updates.length; i++) {
    const update = updates[i];
    try {
      if (update.delete) {
        // Delete variable
        const variable = await figma.variables.getVariableByIdAsync(update.variableId);
        if (!variable) throw new Error("Variable not found: " + update.variableId);
        variable.remove();
        results.push({ success: true, variableId: update.variableId, action: "deleted" });
      } else {
        // Update variable
        const variable = await figma.variables.getVariableByIdAsync(update.variableId);
        if (!variable) throw new Error("Variable not found: " + update.variableId);

        if (update.name !== undefined) {
          variable.name = update.name;
        }

        if (update.description !== undefined) {
          variable.description = update.description;
        }

        if (update.scopes && Array.isArray(update.scopes)) {
          variable.scopes = update.scopes;
        }

        // Set values by mode name
        if (update.values && typeof update.values === "object") {
          // Resolve mode names to IDs via the variable's collection
          const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
          if (!collection) throw new Error("Collection not found for variable: " + update.variableId);

          const modeByName = {};
          for (let m = 0; m < collection.modes.length; m++) {
            modeByName[collection.modes[m].name] = collection.modes[m].modeId;
          }

          // A FONT_FAMILY variable re-renders bound text on value change, so
          // both the OLD and NEW font families must be loaded before writing
          // (#52). Scope detection covers font-family STRING variables. An empty
          // scopes array is Figma's default and is treated as ALL_SCOPES (same
          // rule as lint.js isScopeCompatible), so a default-scoped STRING
          // variable still preloads — otherwise the common case (no explicit
          // scopes) would miss the preload and reproduce #52.
          const fontScopes =
            variable.scopes && variable.scopes.length > 0 ? variable.scopes : ["ALL_SCOPES"];
          const isFontFamilyVar =
            variable.resolvedType === "STRING" &&
            (fontScopes.indexOf("FONT_FAMILY") !== -1 || fontScopes.indexOf("ALL_SCOPES") !== -1);

          // Enumerate the installed font list once per update — it is invariant
          // for the whole call, so loadFontFamily reuses it instead of calling
          // figma.listAvailableFontsAsync() per family/mode (#52 review).
          let availableFonts = null;
          if (isFontFamilyVar) {
            try {
              availableFonts = await figma.listAvailableFontsAsync();
            } catch (_listErr) {
              availableFonts = null;
            }
          }

          const valueKeys = Object.keys(update.values);
          for (let j = 0; j < valueKeys.length; j++) {
            const modeName = valueKeys[j];
            const modeId = modeByName[modeName];
            if (!modeId) {
              throw new Error("Mode not found: " + modeName + ". Available: " + Object.keys(modeByName).join(", "));
            }
            const value = update.values[modeName];
            if (value && typeof value === "object" && value.alias) {
              const aliasVar = await figma.variables.getVariableByIdAsync(value.alias);
              if (!aliasVar) throw new Error("Alias variable not found: " + value.alias);
              // An alias change re-renders bound text just like a raw-string
              // change (#52). Preload the OLD family and the alias's resolved
              // NEW family so setValueForMode doesn't throw on an unloaded font.
              if (isFontFamilyVar) {
                const oldFamily = variable.valuesByMode ? variable.valuesByMode[modeId] : undefined;
                if (typeof oldFamily === "string") await loadFontFamily(oldFamily, availableFonts);
                const aliasValue = aliasVar.valuesByMode ? aliasVar.valuesByMode[modeId] : undefined;
                if (typeof aliasValue === "string") await loadFontFamily(aliasValue, availableFonts);
              }
              variable.setValueForMode(modeId, { type: "VARIABLE_ALIAS", id: aliasVar.id });
            } else {
              if (isFontFamilyVar) {
                const oldFamily = variable.valuesByMode ? variable.valuesByMode[modeId] : undefined;
                if (typeof oldFamily === "string") await loadFontFamily(oldFamily, availableFonts);
                await loadFontFamily(value, availableFonts);
              }
              variable.setValueForMode(modeId, value);
            }
          }
        }

        results.push({ success: true, variableId: update.variableId, action: "updated", name: variable.name });
      }
    } catch (e) {
      results.push({ success: false, variableId: update.variableId, error: e.message || String(e) });
    }

    if (commandId && (i + 1) % 5 === 0) {
      const pct = Math.round(((i + 1) / totalOps) * 100);
      sendProgressUpdate(
        commandId,
        "update_variables",
        "in_progress",
        pct,
        totalOps,
        i + 1,
        "Updated " + (i + 1) + " of " + totalOps,
      );
    }
  }

  if (commandId) {
    sendProgressUpdate(
      commandId,
      "update_variables",
      "completed",
      100,
      totalOps,
      totalOps,
      "Variable updates completed",
    );
  }

  const successCount = results.filter((r) => r.success).length;
  return {
    success: successCount === results.length,
    totalUpdated: successCount,
    totalFailed: results.length - successCount,
    results: results,
  };
}

// ─── Variable binding on styles ─────────────────────────────────────────────
// TEXT styles: setBoundVariable for fontSize, lineHeight, letterSpacing, etc.
// PAINT styles: setBoundVariableForPaint for color on first paint.
// EFFECT styles: not yet supported (effect sub-properties lack setBoundVariable).

async function bindVariablesToStyle(style, variables) {
  if (!variables || typeof variables !== "object") return;

  const entries = Object.keys(variables);
  for (let i = 0; i < entries.length; i++) {
    const field = entries[i];
    const varId = variables[field];
    const variable = await figma.variables.getVariableByIdAsync(varId);
    if (!variable) throw new Error("Variable not found: " + varId);

    if (field === "color" && style.type === "PAINT") {
      // Bind color variable to the first paint in a PaintStyle
      let paints = JSON.parse(JSON.stringify(style.paints));
      if (!paints || paints.length === 0) {
        paints = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
      }
      paints[0] = figma.variables.setBoundVariableForPaint(paints[0], "color", variable);
      style.paints = paints;
    } else {
      // Scalar fields on TEXT styles: fontSize, fontFamily, fontStyle,
      // lineHeight, letterSpacing, paragraphSpacing, paragraphIndent
      style.setBoundVariable(field, variable);
    }
  }
}

// Create styles — paint, text, effect, and grid styles in batch
export async function createStyles(params) {
  const styleSpecs = params.styles;
  const commandId = params.commandId;

  if (!styleSpecs || !Array.isArray(styleSpecs) || styleSpecs.length === 0) {
    throw new Error("Missing or empty styles array");
  }

  // Build set of existing style names for duplicate detection
  var existingPaintNames = {};
  var existingTextNames = {};
  var existingEffectNames = {};
  var existingGridNames = {};

  const paintStyles = await figma.getLocalPaintStylesAsync();
  for (let i = 0; i < paintStyles.length; i++) {
    existingPaintNames[paintStyles[i].name] = paintStyles[i].id;
  }
  const textStyles = await figma.getLocalTextStylesAsync();
  for (let i = 0; i < textStyles.length; i++) {
    existingTextNames[textStyles[i].name] = textStyles[i].id;
  }
  const effectStyles = await figma.getLocalEffectStylesAsync();
  for (let i = 0; i < effectStyles.length; i++) {
    existingEffectNames[effectStyles[i].name] = effectStyles[i].id;
  }
  const gridStyles = await figma.getLocalGridStylesAsync();
  for (let i = 0; i < gridStyles.length; i++) {
    existingGridNames[gridStyles[i].name] = gridStyles[i].id;
  }

  var existingByType = {
    PAINT: existingPaintNames,
    TEXT: existingTextNames,
    EFFECT: existingEffectNames,
    GRID: existingGridNames,
  };

  const results = [];
  const totalStyles = styleSpecs.length;

  if (commandId) {
    sendProgressUpdate(commandId, "create_styles", "started", 0, totalStyles, 0, "Creating styles");
  }

  for (let i = 0; i < styleSpecs.length; i++) {
    const spec = styleSpecs[i];
    try {
      const styleType = spec.type;
      if (!styleType || ["PAINT", "TEXT", "EFFECT", "GRID"].indexOf(styleType) === -1) {
        throw new Error("Invalid style type: " + styleType + ". Must be PAINT, TEXT, EFFECT, or GRID");
      }

      // Check for duplicates
      const existingNames = existingByType[styleType];
      if (existingNames[spec.name]) {
        results.push({
          success: false,
          name: spec.name,
          type: styleType,
          error: "Style already exists with id " + existingNames[spec.name] + ". Use update_styles to modify it.",
        });
        continue;
      }

      let style;

      if (styleType === "PAINT") {
        style = figma.createPaintStyle();
        style.name = spec.name;
        if (spec.paints && Array.isArray(spec.paints)) {
          style.paints = spec.paints;
        } else if (spec.color) {
          // Convenience: accept a single solid color
          const paint = { type: "SOLID", color: { r: spec.color.r, g: spec.color.g, b: spec.color.b } };
          if (spec.color.a !== undefined && spec.color.a < 1) {
            paint.opacity = spec.color.a;
          }
          style.paints = [paint];
        } else {
          throw new Error("PAINT style requires 'paints' array or 'color' object");
        }
      } else if (styleType === "TEXT") {
        style = figma.createTextStyle();
        style.name = spec.name;

        // Load and set font
        const family = spec.fontFamily || "Inter";
        const fontStyle = spec.fontStyle || "Regular";
        await loadFontOrFail(family, fontStyle);
        style.fontName = { family: family, style: fontStyle };

        if (spec.fontSize !== undefined) {
          style.fontSize = spec.fontSize;
        }
        if (spec.lineHeight !== undefined) {
          style.lineHeight = coerceLineHeight(spec.lineHeight);
        }
        if (spec.letterSpacing !== undefined) {
          style.letterSpacing = coerceLetterSpacing(spec.letterSpacing);
        }
        if (spec.paragraphSpacing !== undefined) {
          style.paragraphSpacing = spec.paragraphSpacing;
        }
        if (spec.paragraphIndent !== undefined) {
          style.paragraphIndent = spec.paragraphIndent;
        }
        if (spec.textDecoration !== undefined) {
          style.textDecoration = spec.textDecoration;
        }
        if (spec.textCase !== undefined) {
          style.textCase = spec.textCase;
        }
      } else if (styleType === "EFFECT") {
        style = figma.createEffectStyle();
        style.name = spec.name;
        if (spec.effects && Array.isArray(spec.effects)) {
          style.effects = spec.effects;
        } else {
          throw new Error("EFFECT style requires 'effects' array");
        }
      } else if (styleType === "GRID") {
        style = figma.createGridStyle();
        style.name = spec.name;
        if (spec.grids && Array.isArray(spec.grids)) {
          style.layoutGrids = spec.grids;
        } else {
          throw new Error("GRID style requires 'grids' array");
        }
      }

      if (spec.description) {
        style.description = spec.description;
      }

      // Bind variables to style properties (e.g., fontSize → FLOAT variable, color → COLOR variable)
      if (spec.variables) {
        await bindVariablesToStyle(style, spec.variables);
      }

      // Track for in-batch duplicate detection
      existingNames[spec.name] = style.id;
      results.push({ success: true, name: spec.name, id: style.id, key: style.key, type: styleType });
    } catch (e) {
      results.push({ success: false, name: spec.name, type: spec.type, error: e.message || String(e) });
    }

    if (commandId && (i + 1) % 5 === 0) {
      const pct = Math.round(((i + 1) / totalStyles) * 100);
      sendProgressUpdate(
        commandId,
        "create_styles",
        "in_progress",
        pct,
        totalStyles,
        i + 1,
        "Created " + (i + 1) + " of " + totalStyles,
      );
    }
  }

  if (commandId) {
    sendProgressUpdate(
      commandId,
      "create_styles",
      "completed",
      100,
      totalStyles,
      totalStyles,
      "Style creation completed",
    );
  }

  const successCount = results.filter((r) => r.success).length;
  return {
    success: successCount === results.length,
    totalCreated: successCount,
    totalFailed: results.length - successCount,
    results: results,
  };
}

// Update, rename, or delete existing styles
export async function updateStyles(params) {
  const updates = params.updates;
  const commandId = params.commandId;

  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    throw new Error("Missing or empty updates array");
  }

  const totalOps = updates.length;
  const results = [];

  if (commandId) {
    sendProgressUpdate(commandId, "update_styles", "started", 0, totalOps, 0, "Updating styles");
  }

  for (let i = 0; i < updates.length; i++) {
    const update = updates[i];
    try {
      const style = await figma.getStyleByIdAsync(update.styleId);
      if (!style) throw new Error("Style not found: " + update.styleId);

      if (update.delete) {
        const styleName = style.name;
        style.remove();
        results.push({ success: true, styleId: update.styleId, action: "deleted", name: styleName });
        continue;
      }

      // Common properties
      if (update.name !== undefined) {
        style.name = update.name;
      }
      if (update.description !== undefined) {
        style.description = update.description;
      }

      // Type-specific properties
      const styleType = style.type;

      if (styleType === "PAINT") {
        if (update.paints && Array.isArray(update.paints)) {
          style.paints = update.paints;
        } else if (update.color) {
          const paint = { type: "SOLID", color: { r: update.color.r, g: update.color.g, b: update.color.b } };
          if (update.color.a !== undefined && update.color.a < 1) {
            paint.opacity = update.color.a;
          }
          style.paints = [paint];
        }
      } else if (styleType === "TEXT") {
        // Writing ANY text-style property re-renders the style, which requires
        // its current font to be loaded — even non-font props like lineHeight.
        // (#52) Load the style's existing fontName before touching anything.
        await loadCurrentStyleFont(style);
        // Font name change requires loading the new font too.
        if (update.fontFamily !== undefined || update.fontStyle !== undefined) {
          // A mixed-font style has no single fontName to fall back on, so a
          // partial change (only family OR only style) would leave the other
          // half undefined. Require both fields in that case.
          if (style.fontName === figma.mixed && (update.fontFamily === undefined || update.fontStyle === undefined)) {
            fail(
              "Style '" + style.name + "' has mixed fonts; a partial font change leaves the other half undefined",
              "pass BOTH fontFamily and fontStyle to set a single font on a mixed-font text style",
            );
          }
          const family = update.fontFamily || style.fontName.family;
          const fStyle = update.fontStyle || style.fontName.style;
          await loadFontOrFail(family, fStyle);
          style.fontName = { family: family, style: fStyle };
        }
        if (update.fontSize !== undefined) {
          style.fontSize = update.fontSize;
        }
        if (update.lineHeight !== undefined) {
          style.lineHeight = coerceLineHeight(update.lineHeight);
        }
        if (update.letterSpacing !== undefined) {
          style.letterSpacing = coerceLetterSpacing(update.letterSpacing);
        }
        if (update.paragraphSpacing !== undefined) {
          style.paragraphSpacing = update.paragraphSpacing;
        }
        if (update.paragraphIndent !== undefined) {
          style.paragraphIndent = update.paragraphIndent;
        }
        if (update.textDecoration !== undefined) {
          style.textDecoration = update.textDecoration;
        }
        if (update.textCase !== undefined) {
          style.textCase = update.textCase;
        }
      } else if (styleType === "EFFECT") {
        if (update.effects && Array.isArray(update.effects)) {
          style.effects = update.effects;
        }
      } else if (styleType === "GRID") {
        if (update.grids && Array.isArray(update.grids)) {
          style.layoutGrids = update.grids;
        }
      }

      // Bind variables to style properties
      if (update.variables) {
        await bindVariablesToStyle(style, update.variables);
      }

      results.push({ success: true, styleId: update.styleId, action: "updated", name: style.name });
    } catch (e) {
      results.push({ success: false, styleId: update.styleId, error: e.message || String(e) });
    }

    if (commandId && (i + 1) % 5 === 0) {
      const pct = Math.round(((i + 1) / totalOps) * 100);
      sendProgressUpdate(
        commandId,
        "update_styles",
        "in_progress",
        pct,
        totalOps,
        i + 1,
        "Updated " + (i + 1) + " of " + totalOps,
      );
    }
  }

  if (commandId) {
    sendProgressUpdate(commandId, "update_styles", "completed", 100, totalOps, totalOps, "Style updates completed");
  }

  const successCount = results.filter((r) => r.success).length;
  return {
    success: successCount === results.length,
    totalUpdated: successCount,
    totalFailed: results.length - successCount,
    results: results,
  };
}

export var FIELD_MAP = {
  fills: "fills",
  fill: "fills",
  strokes: "strokes",
  stroke: "strokes",
  opacity: "opacity",
  cornerRadius: "topLeftRadius",
  topLeftRadius: "topLeftRadius",
  topRightRadius: "topRightRadius",
  bottomLeftRadius: "bottomLeftRadius",
  bottomRightRadius: "bottomRightRadius",
  paddingTop: "paddingTop",
  paddingRight: "paddingRight",
  paddingBottom: "paddingBottom",
  paddingLeft: "paddingLeft",
  itemSpacing: "itemSpacing",
  counterAxisSpacing: "counterAxisSpacing",
  width: "width",
  height: "height",
  minWidth: "minWidth",
  maxWidth: "maxWidth",
  minHeight: "minHeight",
  maxHeight: "maxHeight",
  visible: "visible",
  characters: "characters",
  fontSize: "fontSize",
  fontFamily: "fontFamily",
  fontStyle: "fontStyle",
  lineHeight: "lineHeight",
  letterSpacing: "letterSpacing",
  paragraphSpacing: "paragraphSpacing",
  paragraphIndent: "paragraphIndent",
};
