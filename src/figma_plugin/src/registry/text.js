// Command registry — text domain.

import { setTextContent, setMultipleTextContents } from "../commands/text.js";

export const COMMANDS = {
  set_text_content: { lock: "node", handler: (params) => setTextContent(params) },
  set_multiple_text_contents: { lock: "global", handler: (params) => setMultipleTextContents(params) },
};
