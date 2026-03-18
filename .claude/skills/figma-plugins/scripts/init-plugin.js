#!/usr/bin/env node

/**
 * Figma Plugin Initializer
 * Creates a new Figma plugin project with TypeScript and esbuild
 * 
 * Usage: node init-plugin.js <plugin-name> [--with-ui] [--with-react]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const pluginName = args.find(a => !a.startsWith('--'));
const withUI = args.includes('--with-ui') || args.includes('--with-react');
const withReact = args.includes('--with-react');
const editorType = args.includes('--slides') ? ['slides']
  : args.includes('--figjam') ? ['figjam']
  : args.includes('--dev') ? ['dev']
  : ['figma'];

if (!pluginName) {
  console.log('Usage: node init-plugin.js <plugin-name> [--with-ui] [--with-react] [--slides] [--figjam] [--dev]');
  console.log('');
  console.log('Options:');
  console.log('  --with-ui     Include HTML UI');
  console.log('  --with-react  Include React UI');
  console.log('  --slides      Target Figma Slides editor');
  console.log('  --figjam      Target FigJam editor');
  console.log('  --dev         Target Dev Mode (codegen)');
  process.exit(1);
}

const pluginDir = path.resolve(pluginName);

if (fs.existsSync(pluginDir)) {
  console.error(`Error: Directory "${pluginName}" already exists`);
  process.exit(1);
}

console.log(`Creating Figma plugin: ${pluginName}`);
fs.mkdirSync(pluginDir);
fs.mkdirSync(path.join(pluginDir, 'src'));

// manifest.json
const manifest = {
  name: pluginName,
  id: '000000000000000000',
  api: '1.0.0',
  main: 'dist/code.js',
  editorType: editorType,
  documentAccess: 'dynamic-page',
};

if (withUI) {
  manifest.ui = 'dist/ui.html';
}

if (editorType[0] === 'dev') {
  manifest.capabilities = ['codegen'];
  manifest.codegenLanguages = [
    { label: 'React', value: 'react' },
    { label: 'CSS', value: 'css' }
  ];
}

fs.writeFileSync(
  path.join(pluginDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

// tsconfig.json
const tsconfig = {
  compilerOptions: {
    target: 'ES2020',
    lib: ['ES2020'],
    strict: true,
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true,
    typeRoots: ['./node_modules/@types', './node_modules/@figma'],
    outDir: './dist',
    jsx: withReact ? 'react-jsx' : undefined,
  },
  include: ['src/**/*.ts', withReact ? 'src/**/*.tsx' : null].filter(Boolean),
};

fs.writeFileSync(
  path.join(pluginDir, 'tsconfig.json'),
  JSON.stringify(tsconfig, null, 2)
);

// package.json
const packageJson = {
  name: pluginName,
  version: '1.0.0',
  scripts: {
    build: 'node build.mjs',
    watch: 'node build.mjs --watch',
    dev: 'node build.mjs --watch',
  },
  devDependencies: {
    '@figma/plugin-typings': '^1.121.0',
    typescript: '^5.5.0',
    esbuild: '^0.24.0',
  },
};

if (withReact) {
  packageJson.devDependencies.react = '^18.3.0';
  packageJson.devDependencies['react-dom'] = '^18.3.0';
  packageJson.devDependencies['@types/react'] = '^18.3.0';
  packageJson.devDependencies['@types/react-dom'] = '^18.3.0';
}

fs.writeFileSync(
  path.join(pluginDir, 'package.json'),
  JSON.stringify(packageJson, null, 2)
);

// build.mjs
let buildScript = `import * as esbuild from 'esbuild';
import fs from 'fs';

const watching = process.argv.includes('--watch');

// Build main plugin code
const codeConfig = {
  entryPoints: ['./src/code.ts'],
  bundle: true,
  outfile: './dist/code.js',
  target: 'es2020',
  minify: !watching,
  sourcemap: watching ? 'inline' : false,
};
`;

if (withUI && !withReact) {
  buildScript += `
// Copy UI HTML
function copyUI() {
  if (fs.existsSync('./src/ui.html')) {
    fs.copyFileSync('./src/ui.html', './dist/ui.html');
  }
}
`;
}

if (withReact) {
  buildScript += `
// Build React UI
const uiConfig = {
  entryPoints: ['./src/ui.tsx'],
  bundle: true,
  outfile: './dist/ui-bundle.js',
  target: 'es2020',
  minify: !watching,
  sourcemap: watching ? 'inline' : false,
};

// Create HTML wrapper for React
function createUIHtml() {
  const bundle = fs.readFileSync('./dist/ui-bundle.js', 'utf8');
  const html = \`<!DOCTYPE html>
<html>
<head>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Inter, system-ui, sans-serif;
      font-size: 11px;
      background: var(--figma-color-bg);
      color: var(--figma-color-text);
      padding: 12px;
    }
    button {
      background: var(--figma-color-bg-brand);
      color: var(--figma-color-text-onbrand);
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11px;
    }
    button:hover { background: var(--figma-color-bg-brand-hover); }
    input, select {
      background: var(--figma-color-bg-secondary);
      border: 1px solid var(--figma-color-border);
      padding: 8px;
      border-radius: 4px;
      color: var(--figma-color-text);
      font-size: 11px;
    }
    input:focus, select:focus {
      border-color: var(--figma-color-border-selected);
      outline: none;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>\${bundle}</script>
</body>
</html>\`;
  fs.writeFileSync('./dist/ui.html', html);
}
`;
}

buildScript += `
async function build() {
  fs.mkdirSync('./dist', { recursive: true });
  
  if (watching) {
    const codeCtx = await esbuild.context(codeConfig);
    await codeCtx.watch();
    console.log('Watching code...');
`;

if (withUI && !withReact) {
  buildScript += `    copyUI();
    fs.watch('./src/ui.html', () => { copyUI(); console.log('UI updated'); });
`;
}

if (withReact) {
  buildScript += `    const uiCtx = await esbuild.context({
      ...uiConfig,
      plugins: [{
        name: 'rebuild-html',
        setup(build) {
          build.onEnd(() => { createUIHtml(); console.log('UI rebuilt'); });
        }
      }]
    });
    await uiCtx.watch();
    console.log('Watching UI...');
`;
}

buildScript += `  } else {
    await esbuild.build(codeConfig);
`;

if (withUI && !withReact) {
  buildScript += `    copyUI();
`;
}

if (withReact) {
  buildScript += `    await esbuild.build(uiConfig);
    createUIHtml();
`;
}

buildScript += `    console.log('Build complete');
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;

fs.writeFileSync(path.join(pluginDir, 'build.mjs'), buildScript);

// src/code.ts
let codeTs;
if (withUI) {
  codeTs = `// Main plugin code - runs in Figma's sandbox
figma.showUI(__html__, { 
  width: 300, 
  height: 400,
  themeColors: true 
});

figma.ui.onmessage = async (msg: { type: string; [key: string]: any }) => {
  if (msg.type === 'create-rectangle') {
    const rect = figma.createRectangle();
    rect.x = figma.viewport.center.x;
    rect.y = figma.viewport.center.y;
    rect.resize(msg.width || 100, msg.height || 100);
    rect.fills = [figma.util.solidPaint(msg.color || '#FF5500')];
    
    figma.currentPage.appendChild(rect);
    figma.currentPage.selection = [rect];
    figma.viewport.scrollAndZoomIntoView([rect]);
    
    figma.ui.postMessage({ type: 'created', name: rect.name });
  }
  
  if (msg.type === 'close') {
    figma.closePlugin();
  }
};

// Handle selection changes
figma.on('selectionchange', () => {
  const selection = figma.currentPage.selection;
  figma.ui.postMessage({ 
    type: 'selection', 
    count: selection.length,
    names: selection.map(n => n.name)
  });
});
`;
} else {
  codeTs = `// Main plugin code - runs in Figma's sandbox

async function main() {
  try {
    const selection = figma.currentPage.selection;
    
    if (selection.length === 0) {
      // No selection - create a sample rectangle
      const rect = figma.createRectangle();
      rect.x = figma.viewport.center.x;
      rect.y = figma.viewport.center.y;
      rect.resize(100, 100);
      rect.fills = [figma.util.solidPaint('#FF5500')];
      
      figma.currentPage.appendChild(rect);
      figma.currentPage.selection = [rect];
      figma.viewport.scrollAndZoomIntoView([rect]);
      
      figma.notify('Created a rectangle');
    } else {
      // Process selection
      for (const node of selection) {
        console.log('Selected:', node.name, node.type);
      }
      figma.notify(\`Selected \${selection.length} layer(s)\`);
    }
  } catch (error) {
    console.error(error);
    figma.notify('Error: ' + (error as Error).message, { error: true });
  } finally {
    figma.closePlugin();
  }
}

main();
`;
}

fs.writeFileSync(path.join(pluginDir, 'src', 'code.ts'), codeTs);

// UI files
if (withUI && !withReact) {
  const uiHtml = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Inter, system-ui, sans-serif;
      font-size: 11px;
      background: var(--figma-color-bg);
      color: var(--figma-color-text);
      padding: 12px;
    }
    .form-group { margin-bottom: 12px; }
    label { display: block; margin-bottom: 4px; font-weight: 500; }
    input {
      width: 100%;
      background: var(--figma-color-bg-secondary);
      border: 1px solid var(--figma-color-border);
      padding: 8px;
      border-radius: 4px;
      color: var(--figma-color-text);
    }
    input:focus {
      border-color: var(--figma-color-border-selected);
      outline: none;
    }
    button {
      background: var(--figma-color-bg-brand);
      color: var(--figma-color-text-onbrand);
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      width: 100%;
    }
    button:hover { background: var(--figma-color-bg-brand-hover); }
    .secondary {
      background: transparent;
      border: 1px solid var(--figma-color-border);
      color: var(--figma-color-text);
    }
    .status {
      margin-top: 12px;
      padding: 8px;
      background: var(--figma-color-bg-secondary);
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="form-group">
    <label>Width</label>
    <input type="number" id="width" value="100">
  </div>
  <div class="form-group">
    <label>Height</label>
    <input type="number" id="height" value="100">
  </div>
  <div class="form-group">
    <label>Color</label>
    <input type="color" id="color" value="#FF5500">
  </div>
  <button id="create">Create Rectangle</button>
  <button id="close" class="secondary" style="margin-top: 8px;">Close</button>
  <div id="status" class="status">Select layers or create new ones</div>

  <script>
    const widthInput = document.getElementById('width');
    const heightInput = document.getElementById('height');
    const colorInput = document.getElementById('color');
    const status = document.getElementById('status');

    document.getElementById('create').onclick = () => {
      parent.postMessage({
        pluginMessage: {
          type: 'create-rectangle',
          width: parseInt(widthInput.value),
          height: parseInt(heightInput.value),
          color: colorInput.value
        }
      }, '*');
    };

    document.getElementById('close').onclick = () => {
      parent.postMessage({ pluginMessage: { type: 'close' } }, '*');
    };

    onmessage = (event) => {
      const msg = event.data.pluginMessage;
      if (msg.type === 'created') {
        status.textContent = 'Created: ' + msg.name;
      } else if (msg.type === 'selection') {
        status.textContent = msg.count === 0 
          ? 'No selection' 
          : 'Selected: ' + msg.names.join(', ');
      }
    };
  </script>
</body>
</html>`;
  fs.writeFileSync(path.join(pluginDir, 'src', 'ui.html'), uiHtml);
}

if (withReact) {
  const uiTsx = `import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

interface Message {
  type: string;
  [key: string]: any;
}

function App() {
  const [width, setWidth] = useState(100);
  const [height, setHeight] = useState(100);
  const [color, setColor] = useState('#FF5500');
  const [status, setStatus] = useState('Select layers or create new ones');

  useEffect(() => {
    window.onmessage = (event: MessageEvent) => {
      const msg: Message = event.data.pluginMessage;
      if (msg.type === 'created') {
        setStatus('Created: ' + msg.name);
      } else if (msg.type === 'selection') {
        setStatus(msg.count === 0 
          ? 'No selection' 
          : 'Selected: ' + msg.names.join(', ')
        );
      }
    };
  }, []);

  const handleCreate = () => {
    parent.postMessage({
      pluginMessage: { type: 'create-rectangle', width, height, color }
    }, '*');
  };

  const handleClose = () => {
    parent.postMessage({ pluginMessage: { type: 'close' } }, '*');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Width</label>
        <input
          type="number"
          value={width}
          onChange={e => setWidth(parseInt(e.target.value) || 0)}
          style={{ width: '100%' }}
        />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Height</label>
        <input
          type="number"
          value={height}
          onChange={e => setHeight(parseInt(e.target.value) || 0)}
          style={{ width: '100%' }}
        />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Color</label>
        <input
          type="color"
          value={color}
          onChange={e => setColor(e.target.value)}
          style={{ width: '100%', height: 32 }}
        />
      </div>
      <button onClick={handleCreate}>Create Rectangle</button>
      <button 
        onClick={handleClose}
        style={{
          background: 'transparent',
          border: '1px solid var(--figma-color-border)',
          color: 'var(--figma-color-text)'
        }}
      >
        Close
      </button>
      <div style={{
        padding: 8,
        background: 'var(--figma-color-bg-secondary)',
        borderRadius: 4
      }}>
        {status}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
`;
  fs.writeFileSync(path.join(pluginDir, 'src', 'ui.tsx'), uiTsx);
}

// .gitignore
fs.writeFileSync(
  path.join(pluginDir, '.gitignore'),
  `node_modules/
dist/
*.log
.DS_Store
`
);

console.log('');
console.log('Plugin created! Next steps:');
console.log('');
console.log(`  cd ${pluginName}`);
console.log('  npm install');
console.log('  npm run build');
console.log('');
console.log('Then in Figma Desktop:');
console.log('  Plugins > Development > Import plugin from manifest...');
console.log(`  Select: ${pluginDir}/manifest.json`);
console.log('');
console.log('For development:');
console.log('  npm run watch');
