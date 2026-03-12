// Styles commands: getStyles, getLocalVariables, getLocalComponents,
// getDesignSystem, createVariables, updateVariables

import { sendProgressUpdate } from "../helpers.js";

export async function getStyles() {
  const styles = {
    colors: await figma.getLocalPaintStylesAsync(),
    texts: await figma.getLocalTextStylesAsync(),
    effects: await figma.getLocalEffectStylesAsync(),
    grids: await figma.getLocalGridStylesAsync(),
  };

  return {
    colors: styles.colors.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      paint: style.paints[0],
    })),
    texts: styles.texts.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      fontSize: style.fontSize,
      fontName: style.fontName,
    })),
    effects: styles.effects.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
    grids: styles.grids.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
  };
}

export async function getLocalVariables() {
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

      variables.push({
        id: variable.id,
        name: variable.name,
        resolvedType: variable.resolvedType,
        values: values,
      });
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
  await figma.loadAllPagesAsync();

  const componentSets = figma.root.findAllWithCriteria({
    types: ["COMPONENT_SET"],
  });

  const standaloneComponents = figma.root
    .findAllWithCriteria({
      types: ["COMPONENT"],
    })
    .filter((c) => !c.parent || c.parent.type !== "COMPONENT_SET");

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
export async function getDesignSystem() {
  const [styles, variables] = await Promise.all([getStyles(), getLocalVariables()]);
  return { styles: styles, variables: variables };
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
            throw new Error(
              "Invalid scope '" +
                spec.scopes[s] +
                "' for type " +
                resolvedType +
                ". Valid: " +
                validForType.join(", "),
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
      sendProgressUpdate(commandId, "create_variables", "in_progress", pct, totalVars, i + 1, "Created " + (i + 1) + " of " + totalVars);
    }
  }

  if (commandId) {
    sendProgressUpdate(commandId, "create_variables", "completed", 100, totalVars, totalVars, "Variable creation completed");
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
              variable.setValueForMode(modeId, { type: "VARIABLE_ALIAS", id: aliasVar.id });
            } else {
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
      sendProgressUpdate(commandId, "update_variables", "in_progress", pct, totalOps, i + 1, "Updated " + (i + 1) + " of " + totalOps);
    }
  }

  if (commandId) {
    sendProgressUpdate(commandId, "update_variables", "completed", 100, totalOps, totalOps, "Variable updates completed");
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
};

