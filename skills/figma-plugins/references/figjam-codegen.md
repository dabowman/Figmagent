# FigJam, Slides, and Code Generation Plugins

## FigJam-Specific APIs

### Editor Type Check

```typescript
if (figma.editorType === 'figjam') {
  // FigJam-specific code
}
```

### Sticky Notes

```typescript
const sticky = figma.createSticky();
sticky.text.characters = "My note";
sticky.authorVisible = true;
sticky.fills = [figma.util.solidPaint('#FFF9B1')];
```

### Shapes with Text

```typescript
const shape = figma.createShapeWithText();
shape.shapeType = "ROUNDED_RECTANGLE";
// Options: SQUARE, ELLIPSE, ROUNDED_RECTANGLE, DIAMOND,
//          TRIANGLE_UP, TRIANGLE_DOWN, PARALLELOGRAM_RIGHT,
//          PARALLELOGRAM_LEFT, ENG_DATABASE, ENG_QUEUE,
//          ENG_FILE, ENG_FOLDER
shape.text.characters = "Process Step";
shape.resize(200, 100);
```

### Connectors

```typescript
const connector = figma.createConnector();
connector.connectorStart = {
  endpointNodeId: nodeA.id,
  magnet: 'AUTO'  // 'AUTO' | 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT' | 'CENTER'
};
connector.connectorEnd = { endpointNodeId: nodeB.id, magnet: 'AUTO' };

// Or connect to points
connector.connectorStart = { position: { x: 0, y: 0 } };
connector.connectorEnd = { position: { x: 100, y: 100 } };

// Styling
connector.connectorStartStrokeCap = 'ARROW_LINES';
// Options: NONE, ARROW_LINES, ARROW_EQUILATERAL, TRIANGLE_FILLED,
//          DIAMOND_FILLED, CIRCLE_FILLED, ROUND
connector.connectorEndStrokeCap = 'ARROW_LINES';
connector.connectorLineType = 'STRAIGHT';  // 'STRAIGHT' | 'ELBOWED' | 'CURVED'

// Text label
connector.text.characters = "connects to";
connector.textBackground.fills = [figma.util.solidPaint('#FFFFFF')];
```

### Tables

```typescript
const table = figma.createTable(3, 4); // 3 rows x 4 columns
const cell = table.cellAt(rowIndex, colIndex);
cell.text.characters = "Cell content";
table.resizeColumn(colIndex, newWidth);
```

### Code Blocks

```typescript
const codeBlock = figma.createCodeBlock();
codeBlock.code = "console.log('Hello');";
codeBlock.codeLanguage = "JAVASCRIPT";
// Languages: JAVASCRIPT, TYPESCRIPT, PYTHON, RUBY, CSS, HTML, JSON, etc.
```

### Sections

```typescript
const section = figma.createSection();
section.name = "My Section";
section.resizeWithoutConstraints(500, 300);
section.fills = [figma.util.solidPaint('#F5F5F5')];
```

### Timer API

```typescript
figma.timer.start(60);  // 60 seconds
figma.timer.pause();
figma.timer.resume();
figma.timer.stop();
figma.timer.state;      // 'STOPPED' | 'PAUSED' | 'RUNNING'
figma.timer.remaining;  // Seconds remaining

figma.on('timerstart', () => {});
figma.on('timerpause', () => {});
figma.on('timerresume', () => {});
figma.on('timerstop', () => {});
figma.on('timerdone', () => {});
figma.on('timeradjust', ({ oldRemaining, newRemaining }) => {});
```

---

## Figma Slides APIs

### Editor Type and Structure

```typescript
if (figma.editorType === 'slides') {
  // Slides files have a SINGLE PageNode
  // No Components, Styles, Variables, or Libraries support
}
```

### Slide Node Types

```typescript
// SlideNode (type: 'SLIDE') - Fixed 1920x1080 building block
const slide = figma.createSlide();

// SlideRowNode (type: 'SLIDE_ROW') - Container for slides
const slideRow = figma.createSlideRow();

// SlideGridNode (type: 'SLIDE_GRID') - Top-level 2D grid
const grid = figma.getSlideGrid();

// InteractiveSlideElementNode (type: 'INTERACTIVE_SLIDE_ELEMENT') - Read-only
// Subtypes: POLL, EMBED, FACEPILE, ALIGNMENT, YOUTUBE
```

### Slide Navigation

```typescript
figma.currentPage.focusedSlide = slide;
figma.viewport.slidesMode; // 'grid' | 'single-slide'
figma.setSlideGrid(rows); // Reorder slides
```

### Slide Transitions

```typescript
slide.setSlideTransition({
  style: 'DISSOLVE',
  // 21 styles: DISSOLVE, SLIDE_FROM_LEFT, SLIDE_FROM_RIGHT, SLIDE_FROM_TOP,
  //   SLIDE_FROM_BOTTOM, PUSH_FROM_LEFT, PUSH_FROM_RIGHT, PUSH_FROM_TOP,
  //   PUSH_FROM_BOTTOM, MOVE_FROM_LEFT, MOVE_FROM_RIGHT, MOVE_FROM_TOP,
  //   MOVE_FROM_BOTTOM, SMART_ANIMATE, and more
  timing: 'ON_CLICK',    // 'ON_CLICK' | 'AFTER_DELAY'
  duration: 500,
  curve: 'EASE_IN_OUT'   // 7 curve options
});

const transition = slide.getSlideTransition();
```

### Slides-Compatible Creation Methods

```typescript
// Available in Slides (shared with FigJam)
figma.createShapeWithText()
figma.createTable(rows, cols)
figma.createGif()
```

### Slides Events

```typescript
figma.on('slidesviewchange', () => {
  console.log('View changed:', figma.viewport.slidesMode);
});
```

---

## Code Generation Plugins

### Manifest Configuration

```json
{
  "name": "My Codegen Plugin",
  "id": "000000000000000000",
  "api": "1.0.0",
  "main": "code.js",
  "editorType": ["dev"],
  "capabilities": ["codegen"],
  "documentAccess": "dynamic-page",
  "codegenLanguages": [
    { "label": "React", "value": "react" },
    { "label": "CSS", "value": "css" }
  ],
  "codegenPreferences": [
    {
      "itemType": "select",
      "propertyName": "framework",
      "label": "Framework",
      "options": [
        { "label": "React", "value": "react" },
        { "label": "Vue", "value": "vue" }
      ],
      "defaultValue": "react"
    }
  ]
}
```

### Generate Event Handler

```typescript
figma.codegen.on('generate', async (event) => {
  const { node, language } = event;
  const prefs = figma.codegen.preferences;
  const css = await node.getCSSAsync();

  // 15-second timeout applies
  // figma.showUI() is NOT allowed inside this callback

  return [{
    title: 'CSS',
    language: 'CSS',
    code: cssString
  }, {
    title: 'React Component',
    language: 'TYPESCRIPT',
    code: reactCode
  }];
});
```

### Code Language Options

```typescript
type CodeLanguage =
  | 'BASH' | 'CPP' | 'CSS' | 'GO' | 'GRAPHQL' | 'HTML'
  | 'JAVASCRIPT' | 'JSON' | 'KOTLIN' | 'PLAINTEXT' | 'PYTHON'
  | 'RUBY' | 'RUST' | 'SQL' | 'SWIFT' | 'TYPESCRIPT' | 'XML';
```

### Preferences

```typescript
const prefs = figma.codegen.preferences;
figma.codegen.on('preferenceschange', (event) => {
  console.log('New preferences:', event.preferences);
});
```

---

## Dev Mode

### Inspect Capability

```json
{
  "capabilities": ["inspect"],
  "inspectByDefault": true
}
```

```typescript
if (figma.mode === 'inspect') {
  // Read-only inspect mode
}
```

### Dev Resources

```typescript
await node.addDevResourceAsync('https://github.com/org/repo/Button.tsx');
const resources = await node.getDevResourcesAsync({ includeChildren: true });
// Returns: Array<{ name, url, nodeId, inheritedNodeId? }>
await node.editDevResourceAsync(originalUrl, { name: 'Button Component', url: newUrl });
await node.deleteDevResourceAsync(url);
```

### CSS API

```typescript
const css = await node.getCSSAsync();
// Returns: { [property: string]: string }
// Note: May return raw values instead of variable-resolved values
```

---

## Code Connect (Separate CLI Tool)

Code Connect is a **CLI tool** (`@figma/code-connect`), not part of the Plugin API. It connects codebase components to Figma components in Dev Mode.

Supports: React, HTML/Web Components, SwiftUI, Jetpack Compose, Storybook.

```bash
npm install @figma/code-connect
npx figma connect create
npx figma connect publish
```

---

## Widget API vs Plugin API

| Feature | Plugin | Widget |
|---------|--------|--------|
| Persistence | Runs temporarily | Lives on canvas |
| State | Manual (pluginData) | Built-in (useState) |
| UI | iframe (HTML/CSS/JS) | Declarative (JSX-like) |
| Interaction | Click to run | Always interactive |
| Multi-user | Limited | Real-time sync |

Widgets use a different API (`useSyncedState`, `AutoLayout`, `Text`) and require `@figma/widget-typings`. This skill focuses on Plugins.
