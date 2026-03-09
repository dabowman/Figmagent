// Build script for the Figma plugin
// Bundles src/main.js → code.js (single file, no ES modules)

const result = await Bun.build({
  entrypoints: ["src/figma_plugin/src/main.js"],
  outdir: "src/figma_plugin",
  naming: "code.js",
  target: "browser",
  format: "iife",
  minify: false,
  sourcemap: "none",
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
} else {
  console.log("Plugin built successfully → src/figma_plugin/code.js");
}
