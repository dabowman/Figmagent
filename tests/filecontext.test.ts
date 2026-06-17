import { afterEach, describe, expect, test } from "bun:test";
import {
  parseFileKey,
  setFileKey,
  getFileKey,
  resolveFileKey,
  resetFileKeyForTests,
} from "../src/figmagent_mcp/remote/filecontext";

afterEach(() => {
  resetFileKeyForTests();
  delete process.env.FIGMA_FILE_KEY;
});

describe("parseFileKey", () => {
  test("extracts fileKey from a design URL", () => {
    expect(parseFileKey("https://www.figma.com/design/39H3zGBDrKOzYWvBo0kqFG/My-File?node-id=1-2")).toBe(
      "39H3zGBDrKOzYWvBo0kqFG",
    );
  });

  test("extracts fileKey from legacy /file/ and FigJam /board/ URLs", () => {
    expect(parseFileKey("https://www.figma.com/file/abcDEF1234567890/Old")).toBe("abcDEF1234567890");
    expect(parseFileKey("https://www.figma.com/board/abcDEF1234567890/Jam")).toBe("abcDEF1234567890");
  });

  test("branch URLs resolve to the branch key", () => {
    expect(parseFileKey("https://www.figma.com/design/mainKey123456/branch/branchKey7890/Name")).toBe("branchKey7890");
  });

  test("passes a bare fileKey through", () => {
    expect(parseFileKey("39H3zGBDrKOzYWvBo0kqFG")).toBe("39H3zGBDrKOzYWvBo0kqFG");
  });

  test("rejects garbage with a fix-stating error", () => {
    expect(() => parseFileKey("not a key!")).toThrow(/Pass a file URL/);
  });
});

describe("fileKey resolution order", () => {
  test("no source set → null, and resolveFileKey states the fix", () => {
    expect(getFileKey()).toBeNull();
    expect(() => resolveFileKey()).toThrow(
      "No Figma file selected. Pass a file URL to use_file " +
        "(e.g. https://www.figma.com/design/<fileKey>/...) or set FIGMA_FILE_KEY.",
    );
  });

  test("FIGMA_FILE_KEY env is used as fallback (accepts URL form too)", () => {
    process.env.FIGMA_FILE_KEY = "https://www.figma.com/design/envKey1234567/EnvFile";
    expect(resolveFileKey()).toBe("envKey1234567");
  });

  test("use_file-set value wins over the env var", () => {
    process.env.FIGMA_FILE_KEY = "envKey1234567";
    setFileKey("https://www.figma.com/design/toolKey123456/ToolFile");
    expect(resolveFileKey()).toBe("toolKey123456");
  });
});
