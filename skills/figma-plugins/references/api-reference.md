# Figma Plugin API Reference

Complete reference for node types, methods, properties, variables, and annotations.

## Document Structure

```typescript
figma.root                    // DocumentNode - root of tree
figma.currentPage             // PageNode - active page
figma.currentPage.selection   // ReadonlyArray<SceneNode>

// Page operations (ALL async under dynamic-page)
await page.loadAsync();
await figma.setCurrentPageAsync(page);
await figma.loadAllPagesAsync();  // Avoid unless necessary

// Async node/style lookup (sync versions DEPRECATED)
await figma.getNodeByIdAsync(id);
await figma.getStyleByIdAsync(id);

// Editor info
figma.editorType  // 'figma' | 'figjam' | 'dev' | 'slides' | 'buzz'
figma.mode        // 'default' | 'textreview' | 'inspect' | 'codegen' | 'linkpreview' | 'auth'
```

---

## Node Types (35 total)

```typescript
type SceneNode =
  // Containers
  | FrameNode | GroupNode | SectionNode
  // Components
  | ComponentNode | ComponentSetNode | InstanceNode
  // Shapes
  | RectangleNode | EllipseNode | PolygonNode | StarNode
  | LineNode | VectorNode | BooleanOperationNode
  // Content
  | TextNode | SliceNode
  // FigJam
  | StickyNode | ConnectorNode | ShapeWithTextNode
  | CodeBlockNode | TableNode | TableCellNode | StampNode
  | HighlightNode | WashiTapeNode
  // Slides
  | SlideNode | SlideRowNode | SlideGridNode | InteractiveSlideElementNode
  // Embeds
  | WidgetNode | EmbedNode | LinkUnfurlNode | MediaNode
  // Beta (May 2025+)
  | TextPathNode | TransformGroupNode

function isTextNode(node: SceneNode): node is TextNode {
  return node.type === 'TEXT';
}

function hasChildren(node: SceneNode): node is FrameNode | GroupNode {
  return 'children' in node;
}
```

---

## Node Properties

### Common Properties (All Nodes)

```typescript
node.id          // string - Unique identifier
node.name        // string - Layer name
node.type        // NodeType - Type string
node.parent      // BaseNode | null (read-only)
node.removed     // boolean
node.visible     // boolean
node.locked      // boolean
```

### Geometry (SceneNode)

```typescript
node.x           // number - X position relative to parent
node.y           // number - Y position
node.width       // number (read-only, use resize())
node.height      // number (read-only, use resize())
node.rotation    // number - Degrees

node.resize(width, height);
node.resizeWithoutConstraints(width, height);
node.rescale(scale);

node.absoluteTransform      // Transform matrix
node.absoluteBoundingBox    // { x, y, width, height }
node.absoluteRenderBounds   // Includes effects like shadows
```

### Blend and Opacity

```typescript
node.opacity           // 0-1
node.blendMode         // BlendMode
node.isMask            // boolean
node.effects           // Effect[]
node.effectStyleId     // string
```

### Export

```typescript
await node.exportAsync({
  format: 'PNG',        // 'PNG' | 'JPG' | 'SVG' | 'PDF'
  constraint: { type: 'SCALE', value: 2 },
  contentsOnly: true,
  useAbsoluteBounds: false
});
```

### Annotations and Bound Variables

```typescript
// Annotations (Frame, Component, Instance, shapes, Text, Vector)
node.annotations       // Annotation[] — read/write

// Variable bindings
node.boundVariables    // { [field]: VariableAlias | VariableAlias[] }
node.setBoundVariable(field, variable);
node.setBoundVariable(field, index, variable); // For array fields like fills
```

---

## Creation Methods

```typescript
// Shapes
figma.createRectangle()
figma.createEllipse()
figma.createPolygon()
figma.createStar()
figma.createLine()
figma.createVector()

// Containers
figma.createFrame()
figma.createSection()

// Content
figma.createText()
figma.createSlice()

// Components
figma.createComponent()
figma.createComponentFromNode(node)

// Boolean operations
figma.union(nodes, parent)
figma.subtract(nodes, parent)
figma.intersect(nodes, parent)
figma.exclude(nodes, parent)
figma.flatten(nodes, parent)

// Groups
figma.group(nodes, parent)
figma.ungroup(group)

// Slides
figma.createSlide()
figma.createSlideRow()
figma.getSlideGrid()

// Beta
figma.createTextPath()
figma.transformGroup(nodes)

// Clone
const clone = node.clone();
```

---

## Traversal Methods

```typescript
node.children                              // ChildrenMixin
node.findAll(callback)                     // All matching
node.findOne(callback)                     // First or null
node.findChildren(callback)                // Immediate children
node.findAllWithCriteria({                 // Optimized
  types: ['TEXT', 'FRAME'],
  pluginData: { keys: ['myKey'] },
  sharedPluginData: { namespace: 'ns', keys: ['key'] }
})

figma.skipInvisibleInstanceChildren = true; // Major perf boost
```

---

## Styles and Effects

### Fills

```typescript
// Solid
node.fills = [{ type: 'SOLID', color: { r: 1, g: 0.5, b: 0 }, opacity: 0.8, visible: true }];

// Gradient
node.fills = [{
  type: 'GRADIENT_LINEAR',  // GRADIENT_RADIAL, GRADIENT_ANGULAR, GRADIENT_DIAMOND
  gradientStops: [
    { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
  ],
  gradientTransform: [[1, 0, 0], [0, 1, 0]]
}];

// Image fill
node.fills = [{
  type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL',
  filters: { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0 }
}];

// Utilities
figma.util.rgb('#FF5500');
figma.util.rgba('#FF550088');
figma.util.solidPaint('#FF5500');
figma.util.solidPaint({ r: 1, g: 0, b: 0 }, 0.5);
```

### Strokes

```typescript
node.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
node.strokeWeight = 2;
node.strokeAlign = 'CENTER';    // 'INSIDE' | 'OUTSIDE' | 'CENTER'
node.strokeCap = 'ROUND';       // 'NONE' | 'ROUND' | 'SQUARE'
node.strokeJoin = 'MITER';      // 'MITER' | 'BEVEL' | 'ROUND'
node.dashPattern = [5, 3];

// Individual weights (frames)
node.strokeTopWeight = 1;
node.strokeBottomWeight = 1;
node.strokeLeftWeight = 1;
node.strokeRightWeight = 1;
```

### Effects

```typescript
node.effects = [{
  type: 'DROP_SHADOW', // or 'INNER_SHADOW'
  color: { r: 0, g: 0, b: 0, a: 0.25 },
  offset: { x: 0, y: 4 }, radius: 8, spread: 0, visible: true, blendMode: 'NORMAL'
}];
node.effects = [{ type: 'LAYER_BLUR', radius: 10, visible: true }];
node.effects = [{ type: 'BACKGROUND_BLUR', radius: 20, visible: true }];
```

### Corner Radius

```typescript
node.cornerRadius = 8;
node.topLeftRadius = 8;
node.topRightRadius = 8;
node.bottomLeftRadius = 0;
node.bottomRightRadius = 0;
node.cornerSmoothing = 0.6;  // 0-1 (iOS-style)
```

### Styles (ALL async under dynamic-page)

```typescript
const paintStyles = await figma.getLocalPaintStylesAsync();
const textStyles = await figma.getLocalTextStylesAsync();
const effectStyles = await figma.getLocalEffectStylesAsync();
const gridStyles = await figma.getLocalGridStylesAsync();

await node.setFillStyleIdAsync(styleId);
node.fillStyleId = paintStyle.id;
node.strokeStyleId = paintStyle.id;
node.effectStyleId = effectStyle.id;
```

---

## Text API

### Basic Text

```typescript
const text = figma.createText();
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
text.characters = 'Hello World';
```

### Text Properties

```typescript
text.fontName = { family: 'Inter', style: 'Bold' };
text.fontSize = 24;
text.fontWeight = 700;
text.letterSpacing = { value: 2, unit: 'PIXELS' };     // or 'PERCENT'
text.lineHeight = { value: 150, unit: 'PERCENT' };     // or 'PIXELS' | 'AUTO'
text.paragraphIndent = 20;
text.paragraphSpacing = 10;
text.textCase = 'UPPER';           // 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS'
text.textDecoration = 'UNDERLINE'; // 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH'
text.textAlignHorizontal = 'CENTER';  // 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
text.textAlignVertical = 'CENTER';    // 'TOP' | 'CENTER' | 'BOTTOM'
text.textAutoResize = 'WIDTH_AND_HEIGHT';  // 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT' | 'TRUNCATE'
text.textTruncation = 'ENDING';       // 'DISABLED' | 'ENDING'
text.maxLines = 3;
```

### Extended Text Decoration

```typescript
text.textDecorationStyle = 'WAVY';    // 'SOLID' | 'DOUBLE' | 'DOTTED' | 'DASHED' | 'WAVY'
text.textDecorationOffset = 2;
text.textDecorationThickness = 1;
text.textDecorationColor = { r: 1, g: 0, b: 0, a: 1 };
text.textDecorationSkipInk = 'AUTO';  // 'NONE' | 'AUTO'
```

### Range Styling

```typescript
text.setRangeFontSize(start, end, 32);
text.setRangeFontName(start, end, { family: 'Inter', style: 'Bold' });
text.setRangeFills(start, end, [figma.util.solidPaint('#FF0000')]);
text.setRangeTextCase(start, end, 'UPPER');
text.setRangeTextDecoration(start, end, 'UNDERLINE');
text.setRangeHyperlink(start, end, { type: 'URL', value: 'https://example.com' });
text.setRangeBoundVariable(start, end, 'fontSize', fontSizeVar);
```

### Styled Text Segments

```typescript
const segments = text.getStyledTextSegments([
  'fontSize', 'fontName', 'fontWeight', 'fills', 'textCase',
  'textDecoration', 'letterSpacing', 'lineHeight', 'hyperlink',
  'fontStyle', 'textStyleOverrides', 'boundVariables'
]);
// Returns: Array<StyledTextSegment> with characters, start, end + requested fields
// fontStyle: 'REGULAR' | 'ITALIC'
// textStyleOverrides: 'SEMANTIC_WEIGHT' | 'SEMANTIC_ITALIC' | 'HYPERLINK' | 'TEXT_DECORATION'
```

### OpenType Features

```typescript
const features = text.openTypeFeatures;  // { [tag: string]: boolean }
const rangeFeatures = text.getRangeOpenTypeFeatures(start, end);
```

---

## Components API

### Component Properties (4 types)

```typescript
component.addComponentProperty("Label", "TEXT", "Button");
component.addComponentProperty("Visible", "BOOLEAN", true);
component.addComponentProperty("Icon", "INSTANCE_SWAP", defaultId, {
  preferredValues: [{ type: 'COMPONENT', key: compA.key }]
});

component.componentPropertyDefinitions; // Read definitions
component.editComponentProperty("Label#0:1", { defaultValue: "Click" });
component.deleteComponentProperty("Label#0:1");
```

### Instances

```typescript
const instance = component.createInstance();
instance.setProperties({ 'Label#0:1': 'Submit' });
instance.componentProperties;             // Read values
const main = await instance.getMainComponentAsync(); // ASYNC required
instance.exposedInstances;  // { [propName]: InstanceNode[] }
instance.isExposedInstance; // boolean
instance.detachInstance();
instance.resetOverrides();
```

### Variants

```typescript
const componentSet = figma.combineAsVariants([comp1, comp2], parentFrame);
instance.variantProperties;  // { Size: 'Small', State: 'Default' }
instance.setProperties({ Size: 'Large' });
instance.swapComponent(differentVariant);
```

---

## Auto Layout

```typescript
frame.layoutMode = 'HORIZONTAL';     // 'HORIZONTAL' | 'VERTICAL' | 'NONE'
frame.primaryAxisSizingMode = 'AUTO';   // 'FIXED' | 'AUTO'
frame.counterAxisSizingMode = 'FIXED';
frame.layoutSizingHorizontal = 'HUG';  // 'FIXED' | 'HUG' | 'FILL'
frame.layoutSizingVertical = 'FIXED';

frame.itemSpacing = 16;
frame.paddingTop = 20; frame.paddingBottom = 20;
frame.paddingLeft = 16; frame.paddingRight = 16;

frame.primaryAxisAlignItems = 'CENTER';   // 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'
frame.counterAxisAlignItems = 'CENTER';   // 'MIN' | 'CENTER' | 'MAX' | 'BASELINE'

frame.layoutWrap = 'WRAP';             // 'NO_WRAP' | 'WRAP'
frame.counterAxisSpacing = 12;
frame.counterAxisAlignContent = 'AUTO'; // 'AUTO' | 'SPACE_BETWEEN'

child.layoutGrow = 1;
child.layoutSizingHorizontal = 'FILL';
child.layoutPositioning = 'ABSOLUTE';   // 'AUTO' | 'ABSOLUTE'
child.layoutAlign = 'STRETCH';          // 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX'
frame.strokesIncludedInLayout = true;
```

---

## Constraints

```typescript
node.constraints = {
  horizontal: 'MIN',     // 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE'
  vertical: 'MIN'
};
```

---

## Images

```typescript
const image = await figma.createImageAsync('https://example.com/image.png');
const image = figma.createImage(uint8Array);
const { width, height } = await image.getSizeAsync();

rect.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];

// Read
const img = figma.getImageByHash(paint.imageHash);
const bytes = await img.getBytesAsync();

// Export
await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
await node.exportAsync({ format: 'SVG' });
await node.exportAsync({ format: 'JPG', quality: 80 });
```

---

## Variables API

### figma.variables Methods

```typescript
figma.variables.createVariable(name, collectionOrId, resolvedType)
figma.variables.createVariableCollection(name)
figma.variables.createVariableAlias(variable)

await figma.variables.getVariableByIdAsync(id)
await figma.variables.getVariableCollectionByIdAsync(id)
await figma.variables.getLocalVariablesAsync(type?)
await figma.variables.getLocalVariableCollectionsAsync()
await figma.variables.importVariableByKeyAsync(key)

figma.variables.setBoundVariableForPaint(paint, field, variable)
figma.variables.setBoundVariableForEffect(effect, field, variable)
figma.variables.setBoundVariableForLayoutGrid(grid, field, variable)
```

### Variable Interface

```typescript
interface Variable {
  id: string; name: string; key: string;
  resolvedType: 'BOOLEAN' | 'FLOAT' | 'STRING' | 'COLOR';
  description: string;
  hiddenFromPublishing: boolean;
  variableCollectionId: string;

  valuesByMode: { [modeId: string]: VariableValue };
  setValueForMode(modeId, value): void;
  resolveForConsumer(node): { value: any; resolvedType: string };

  scopes: VariableScope[];
  codeSyntax: { WEB?: string; ANDROID?: string; iOS?: string };
  setPluginData(key, value): void;
  getPluginData(key): string;
}
```

### VariableCollection Interface

```typescript
interface VariableCollection {
  id: string; name: string; key: string;
  modes: Array<{ modeId: string; name: string }>;
  defaultModeId: string;
  variableIds: string[];
  hiddenFromPublishing: boolean;

  addMode(name): string;
  removeMode(modeId): void;
  renameMode(modeId, name): void;
}
```

### Bindable Fields (30+)

fills, strokes, width, height, minWidth, maxWidth, minHeight, maxHeight, cornerRadius,
topLeftRadius, topRightRadius, bottomLeftRadius, bottomRightRadius, paddingTop, paddingBottom,
paddingLeft, paddingRight, itemSpacing, counterAxisSpacing, opacity, visible,
layoutGrids, effects, and text ranges (fontSize, fontFamily, fontStyle, fontWeight,
lineHeight, letterSpacing, paragraphSpacing, paragraphIndent).

---

## Annotations API

```typescript
node.annotations: Annotation[];

interface Annotation {
  label?: string;
  labelMarkdown?: string;
  properties: AnnotationProperty[];
  categoryId?: string;
}

// 32 property types: width, height, maxWidth, minWidth, maxHeight, minHeight,
// fills, strokes, effects, strokeWeight, cornerRadius, fontSize, fontFamily,
// fontWeight, lineHeight, letterSpacing, paragraphSpacing, textCase,
// textDecoration, textAlignHorizontal, opacity, layoutMode, itemSpacing,
// paddingLeft, paddingRight, paddingTop, paddingBottom,
// counterAxisAlignItems, primaryAxisAlignItems,
// layoutSizingHorizontal, layoutSizingVertical

await figma.annotations.getAnnotationCategoriesAsync()
await figma.annotations.getAnnotationCategoryByIdAsync(id)
await figma.annotations.addAnnotationCategoryAsync({ label, color })
```

---

## Dev Resources

```typescript
await node.addDevResourceAsync(url)
await node.getDevResourcesAsync({ includeChildren?: boolean })
  // Returns: Array<{ name, url, nodeId, inheritedNodeId? }>
await node.editDevResourceAsync(originalUrl, { name?, url? })
await node.deleteDevResourceAsync(url)
```

---

## Payments API

```typescript
figma.payments.status                          // { type: 'PAID' | 'UNPAID' | 'NOT_SUPPORTED' }
figma.payments.getUserFirstRanSecondsAgo()     // seconds since first run
await figma.payments.initiateCheckoutAsync({
  interstitial?: 'PAID_FEATURE' | 'TRIAL_ENDED' | 'SKIP'
})
figma.payments.requestCheckout()               // For textreview/query mode
figma.payments.setPaymentStatusInDevelopment({ type }) // Dev only
await figma.payments.getPluginPaymentTokenAsync()      // Server verification token
```

---

## Viewport and Selection

```typescript
figma.currentPage.selection = [node1, node2];
figma.currentPage.selection = [];

figma.viewport.center;
figma.viewport.zoom;
figma.viewport.bounds;
figma.viewport.scrollAndZoomIntoView(nodes);

// Slides
figma.viewport.slidesMode;        // 'grid' | 'single-slide'
figma.currentPage.focusedSlide;   // SlideNode | null
```

---

## Events

```typescript
// Core
figma.on('run', ({ command, parameters }) => {});
figma.on('selectionchange', () => {});
figma.on('currentpagechange', () => {});
figma.on('close', () => {});  // SYNC ONLY

// Document/style changes
figma.on('documentchange', (event: DocumentChangeEvent) => {
  // Types: CreateChange, DeleteChange, PropertyChange,
  //        StyleCreateChange, StyleDeleteChange, StylePropertyChange
  // change.origin: 'LOCAL' | 'REMOTE'
});
figma.on('stylechange', (event) => {});
page.on('nodechange', (event) => {}); // Page-scoped

// Drop
figma.on('drop', (event: DropEvent) => { return false; });

// FigJam timer
figma.on('timerstart' | 'timerstop' | 'timerpause' | 'timerresume' | 'timerdone', () => {});
figma.on('timeradjust', ({ oldRemaining, newRemaining }) => {});

// Slides
figma.on('slidesviewchange', () => {});

// Codegen
figma.codegen.on('generate', async ({ node, language }) => { return []; });
figma.codegen.on('preferenceschange', (event) => {});

figma.off('selectionchange', handler);
```

---

## Utilities

```typescript
figma.notify('Message');
figma.notify('Error!', { error: true });
figma.notify('Done', { timeout: 3000 });
figma.notify('Undo?', { button: { text: 'Undo', action: () => undo() } });

figma.util.rgb('#FF5500');
figma.util.rgba('#FF550088');
figma.util.solidPaint('#FF5500');

const user = figma.currentUser;    // { id, name, photoUrl, color, sessionId }
const users = figma.activeUsers;

node.setPluginData('key', 'value');
node.getPluginData('key');
node.getPluginDataKeys();
node.setSharedPluginData('namespace', 'key', 'value');
node.getSharedPluginData('namespace', 'key');

await figma.clientStorage.setAsync('key', value);
await figma.clientStorage.getAsync('key');
await figma.clientStorage.deleteAsync('key');
await figma.clientStorage.keysAsync();
```

### Parameters (Quick Actions)

```typescript
// manifest: { "parameters": [{ "name": "Count", "key": "count" }], "parameterOnly": true }
figma.parameters.on('input', ({ key, query, result }) => {
  result.setSuggestions(['1', '5', '10'].filter(s => s.includes(query)));
});
figma.on('run', ({ parameters }) => { const count = parameters.count; });
```

### Relaunch Buttons

```typescript
// manifest: { "relaunchButtons": [{ "command": "edit", "name": "Edit", "multipleSelection": true }] }
node.setRelaunchData({ edit: 'Click to edit' });
node.setRelaunchData({}); // Clear
```
