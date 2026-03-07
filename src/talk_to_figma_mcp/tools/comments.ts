import { z } from "zod";
import { server } from "../instance.js";
import { getFileComments, postFileComment, deleteFileComment } from "../figma_rest_api.js";

// Get Comments Tool
server.tool(
  "get_comments",
  "Get comments from a Figma file via REST API. Returns comment threads with user, message (as markdown), timestamp, and resolved status. Requires FIGMA_API_TOKEN with file_comments:read scope.",
  {
    fileKey: z
      .string()
      .describe(
        "The Figma file key. Extract from a Figma URL: https://www.figma.com/design/<fileKey>/...",
      ),
    nodeId: z
      .string()
      .optional()
      .describe("Optional node ID to filter comments pinned to a specific node"),
    includeResolved: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include resolved comments (default: false, only unresolved)"),
  },
  async ({ fileKey, nodeId, includeResolved }: any) => {
    try {
      const allComments = await getFileComments(fileKey, true);

      let comments = allComments;

      // Filter out resolved unless requested
      if (!includeResolved) {
        comments = comments.filter((c) => !c.resolved_at);
      }

      // Filter to specific node if requested (include replies to matching comments)
      if (nodeId) {
        const nodeComments = comments.filter(
          (c) => c.client_meta && c.client_meta.node_id === nodeId,
        );
        const nodeCommentIds = new Set(nodeComments.map((c) => c.id));
        // Include replies (comments whose parent_id matches a node comment)
        const replies = comments.filter((c) => c.parent_id && nodeCommentIds.has(c.parent_id));
        comments = [...nodeComments, ...replies];
      }

      // Format for readability
      const formatted = comments.map((c) => ({
        id: c.id,
        user: c.user.handle,
        message: c.message,
        createdAt: c.created_at,
        resolved: !!c.resolved_at,
        parentId: c.parent_id || null,
        nodeId: c.client_meta?.node_id || null,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: formatted.length, comments: formatted }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting comments: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

// Post Comment Tool
server.tool(
  "post_comment",
  "Post a comment on a Figma file via REST API. Can create a new top-level comment, reply to an existing thread, or pin a comment to a specific node. Requires FIGMA_API_TOKEN with file_comments:write scope.",
  {
    fileKey: z
      .string()
      .describe(
        "The Figma file key. Extract from a Figma URL: https://www.figma.com/design/<fileKey>/...",
      ),
    message: z.string().describe("The comment text to post"),
    commentId: z
      .string()
      .optional()
      .describe("ID of an existing comment to reply to (creates a thread reply)"),
    nodeId: z
      .string()
      .optional()
      .describe("Node ID to pin the comment to (only for new top-level comments, not replies)"),
  },
  async ({ fileKey, message, commentId, nodeId }: any) => {
    try {
      const opts: { commentId?: string; nodeId?: string } = {};
      if (commentId) opts.commentId = commentId;
      if (nodeId) opts.nodeId = nodeId;

      const result = await postFileComment(fileKey, message, opts);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              commentId: result.id,
              user: result.user.handle,
              message: result.message,
              createdAt: result.created_at,
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error posting comment: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

// Delete Comment Tool
server.tool(
  "delete_comment",
  "Delete a comment from a Figma file via REST API. Only the comment author (token owner) can delete their own comments. Requires FIGMA_API_TOKEN with file_comments:write scope.",
  {
    fileKey: z
      .string()
      .describe(
        "The Figma file key. Extract from a Figma URL: https://www.figma.com/design/<fileKey>/...",
      ),
    commentId: z.string().describe("The ID of the comment to delete"),
  },
  async ({ fileKey, commentId }: any) => {
    try {
      await deleteFileComment(fileKey, commentId);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, deletedCommentId: commentId }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting comment: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);
