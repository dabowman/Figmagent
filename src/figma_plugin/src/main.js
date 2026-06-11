// Main entry point for the Figma plugin
// Bundles into code.js via `bun build`

import { state, sanitizeSymbols } from "./helpers.js";
import { COMMANDS } from "./registry.js";

// ─── Performance ─────────────────────────────────────────────────────────────
figma.skipInvisibleInstanceChildren = true;

// ─── Concurrency Control ─────────────────────────────────────────────────────
// Operation classification lives in the registry: each command carries
// lock: "read" (run freely) | "global" (serialize via global mutex) |
// "node" (lock by params.nodeId).

// Node-level write locks
var nodeLocks = {};

function acquireNodeLock(nodeId) {
  if (!nodeId) {
    return Promise.resolve(() => {});
  }
  var entry = nodeLocks[nodeId];
  if (!entry) {
    entry = { queue: Promise.resolve() };
    nodeLocks[nodeId] = entry;
  }
  var release;
  var prev = entry.queue;
  entry.queue = new Promise((resolve) => {
    release = resolve;
  });
  return prev.then(() => release);
}

// Global mutex
var globalLockQueue = Promise.resolve();

function acquireGlobalLock() {
  var release;
  var prev = globalLockQueue;
  globalLockQueue = new Promise((resolve) => {
    release = resolve;
  });
  return prev.then(() => release);
}

// Concurrency limiter
var inFlightCount = 0;
var MAX_CONCURRENT = 6;
var waitQueue = [];

function waitForSlot() {
  if (inFlightCount < MAX_CONCURRENT) {
    inFlightCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waitQueue.push(resolve);
  });
}

function releaseSlot() {
  inFlightCount--;
  if (waitQueue.length > 0 && inFlightCount < MAX_CONCURRENT) {
    inFlightCount++;
    waitQueue.shift()();
  }
}

// Concurrency-safe request router
async function routeCommand(id, command, params) {
  await waitForSlot();
  let result;
  let release;
  const entry = COMMANDS[command];
  const lock = entry ? entry.lock : null;
  try {
    if (command === "lint_design" && params && params.autoFix) {
      // lint_design is read-only by default, but autoFix mutates nodes
      release = await acquireGlobalLock();
      try {
        result = await handleCommand(command, params);
      } finally {
        release();
      }
    } else if (lock === "global") {
      release = await acquireGlobalLock();
      try {
        result = await handleCommand(command, params);
      } finally {
        release();
      }
    } else if (lock !== "read" && params && params.nodeId) {
      release = await acquireNodeLock(params.nodeId);
      try {
        result = await handleCommand(command, params);
      } finally {
        release();
      }
    } else {
      result = await handleCommand(command, params);
    }
    figma.ui.postMessage({
      type: "command-result",
      id: id,
      result: sanitizeSymbols(result),
    });
  } catch (error) {
    figma.ui.postMessage({
      type: "command-error",
      id: id,
      error: error.message || "Error executing command",
    });
  } finally {
    releaseSlot();
  }
}

// ─── Command Dispatcher ──────────────────────────────────────────────────────

async function handleCommand(command, params) {
  const entry = COMMANDS[command];
  if (!entry) {
    throw new Error(`Unknown command: ${command}`);
  }
  return await entry.handler(params);
}

// ─── Plugin UI & Message Handling ────────────────────────────────────────────

figma.showUI(__html__, { width: 320, height: 56 });

figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "update-settings":
      updateSettings(msg);
      break;
    case "notify":
      figma.notify(msg.message);
      break;
    case "close-plugin":
      figma.closePlugin();
      break;
    case "execute-command":
      routeCommand(msg.id, msg.command, msg.params);
      break;
    case "get-file-name":
      figma.ui.postMessage({ type: "file-name", name: figma.root.name });
      break;
  }
};

figma.on("run", ({ command }) => {
  figma.ui.postMessage({ type: "auto-connect" });
});

function updateSettings(settings) {
  if (settings.serverPort) {
    state.serverPort = settings.serverPort;
  }

  figma.clientStorage.setAsync("settings", {
    serverPort: state.serverPort,
  });
}
