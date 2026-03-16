import { z } from "zod";
import { server } from "../instance.js";
import { getSessionSummary, getSessionLog, getSessionLogPath } from "../session-logger.js";

server.tool(
  "export_session",
  `Export the current session log for analysis. Returns tool call metrics, error patterns, and timing data.

Use format="summary" (default) for a compact overview: tool frequency, error rate, avg duration.
Use format="full" for the complete log with every tool call (can be large).

Share the output with the Figmagent maintainer to help improve tool design and agent guidance.`,
  {
    format: z
      .enum(["summary", "full"])
      .optional()
      .describe('Output format. "summary" (default) = metrics overview, "full" = every tool call.'),
  },
  async ({ format }: any) => {
    const fmt = format || "summary";
    const data = fmt === "full" ? getSessionLog() : getSessionSummary();
    const logPath = getSessionLogPath();

    const output = JSON.stringify(data, null, 2);
    const footer = logPath ? `\n\nFull session log saved to: ${logPath}` : "";

    return {
      content: [
        {
          type: "text",
          text: output + footer,
        },
      ],
    };
  },
);
