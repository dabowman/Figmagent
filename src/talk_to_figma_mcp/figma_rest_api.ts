import { logger } from "./utils.js";

const BASE_URL = "https://api.figma.com";

function getToken(): string {
  const token = process.env.FIGMA_API_TOKEN;
  if (!token) {
    throw new Error(
      "FIGMA_API_TOKEN environment variable is not set. " +
        "Create a Figma personal access token with scopes: file_content:read, library_content:read, " +
        "file_comments:read, file_comments:write. Then set it in your MCP server config env.",
    );
  }
  return token;
}

// --- Types ---

export interface ComponentMetadata {
  key: string;
  file_key: string;
  node_id: string;
  name: string;
  description: string;
  thumbnail_url: string;
  containing_frame: {
    name: string;
    pageName: string;
    nodeId: string;
  };
  created_at: string;
  updated_at: string;
}

export interface FileComponentsResponse {
  error: boolean;
  status: number;
  meta: {
    components: ComponentMetadata[];
  };
}

export interface FileComponentSetsResponse {
  error: boolean;
  status: number;
  meta: {
    component_sets: ComponentMetadata[];
  };
}

export interface SingleComponentResponse {
  error: boolean;
  status: number;
  meta: ComponentMetadata;
}

export interface FileNodesResponse {
  name: string;
  nodes: Record<string, { document: any; components: Record<string, any> }>;
}

export interface VariableCollection {
  id: string;
  name: string;
  modes: Array<{ modeId: string; name: string }>;
  variableIds: string[];
}

export interface Variable {
  id: string;
  name: string;
  resolvedType: string;
  valuesByMode: Record<string, any>;
  description: string;
  codeSyntax: Record<string, string>;
}

export interface FileVariablesResponse {
  status: number;
  error: boolean;
  meta: {
    variableCollections: Record<string, VariableCollection>;
    variables: Record<string, Variable>;
  };
}

// --- Comment types ---

export interface CommentUser {
  id: string;
  handle: string;
  img_url: string;
}

export interface ClientMeta {
  node_id?: string;
  node_offset?: { x: number; y: number };
}

export interface FigmaComment {
  id: string;
  file_key: string;
  parent_id: string;
  user: CommentUser;
  created_at: string;
  resolved_at: string | null;
  message: string;
  client_meta: ClientMeta | null;
  order_id: string;
}

interface CommentsResponse {
  comments: FigmaComment[];
}

// --- Cache ---

const componentsCache = new Map<string, ComponentMetadata[]>();
const componentSetsCache = new Map<string, ComponentMetadata[]>();

export function clearCache(fileKey?: string): void {
  if (fileKey) {
    componentsCache.delete(fileKey);
    componentSetsCache.delete(fileKey);
  } else {
    componentsCache.clear();
    componentSetsCache.clear();
  }
}

// --- HTTP helpers ---

async function figmaFetch<T>(path: string): Promise<T> {
  const token = getToken();
  const url = `${BASE_URL}${path}`;

  logger.info(`Figma REST API: GET ${path}`);

  const response = await fetch(url, {
    headers: {
      "X-Figma-Token": token,
    },
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        `Figma API returned 403 Forbidden. Your token may lack required scopes. ` +
          `Ensure it has: file_content:read, library_content:read. ` +
          `For variables endpoints, library_assets:read (Enterprise only) is also needed.`,
      );
    }
    if (response.status === 404) {
      throw new Error(
        `Figma API returned 404 Not Found. The file may not exist or your token may not have access to it.`,
      );
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After") || "unknown";
      throw new Error(`Figma API rate limited (429). Retry after ${retryAfter} seconds.`);
    }
    const body = await response.text();
    throw new Error(`Figma API error ${response.status}: ${body}`);
  }

  return (await response.json()) as T;
}

async function figmaPost<T>(path: string, body: any): Promise<T> {
  const token = getToken();
  const url = `${BASE_URL}${path}`;

  logger.info(`Figma REST API: POST ${path}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Figma-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        `Figma API returned 403 Forbidden. Your token may lack the file_comments:write scope.`,
      );
    }
    if (response.status === 404) {
      throw new Error(`Figma API returned 404 Not Found. The file or comment may not exist.`);
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After") || "unknown";
      throw new Error(`Figma API rate limited (429). Retry after ${retryAfter} seconds.`);
    }
    const text = await response.text();
    throw new Error(`Figma API error ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

async function figmaDelete(path: string): Promise<void> {
  const token = getToken();
  const url = `${BASE_URL}${path}`;

  logger.info(`Figma REST API: DELETE ${path}`);

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      "X-Figma-Token": token,
    },
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        `Figma API returned 403 Forbidden. You can only delete your own comments, and your token needs file_comments:write scope.`,
      );
    }
    if (response.status === 404) {
      throw new Error(`Figma API returned 404 Not Found. The comment may not exist.`);
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After") || "unknown";
      throw new Error(`Figma API rate limited (429). Retry after ${retryAfter} seconds.`);
    }
    const text = await response.text();
    throw new Error(`Figma API error ${response.status}: ${text}`);
  }
}

// --- Public API ---

export async function getFileComponents(fileKey: string): Promise<ComponentMetadata[]> {
  const cached = componentsCache.get(fileKey);
  if (cached) return cached;

  const data = await figmaFetch<FileComponentsResponse>(`/v1/files/${fileKey}/components`);
  const components = data.meta.components;
  componentsCache.set(fileKey, components);
  return components;
}

export async function getFileComponentSets(fileKey: string): Promise<ComponentMetadata[]> {
  const cached = componentSetsCache.get(fileKey);
  if (cached) return cached;

  const data = await figmaFetch<FileComponentSetsResponse>(`/v1/files/${fileKey}/component_sets`);
  const sets = data.meta.component_sets;
  componentSetsCache.set(fileKey, sets);
  return sets;
}

export async function getComponentByKey(componentKey: string): Promise<ComponentMetadata> {
  const data = await figmaFetch<SingleComponentResponse>(`/v1/components/${componentKey}`);
  return data.meta;
}

export async function getFileNodes(fileKey: string, nodeIds: string[]): Promise<FileNodesResponse> {
  const ids = nodeIds.map((id) => encodeURIComponent(id)).join(",");
  return figmaFetch<FileNodesResponse>(`/v1/files/${fileKey}/nodes?ids=${ids}`);
}

export async function getFileVariables(fileKey: string): Promise<FileVariablesResponse> {
  return figmaFetch<FileVariablesResponse>(`/v1/files/${fileKey}/variables/local`);
}

// --- Comments API ---

export async function getFileComments(fileKey: string, asMd = true): Promise<FigmaComment[]> {
  const query = asMd ? "?as_md=true" : "";
  const data = await figmaFetch<CommentsResponse>(`/v1/files/${fileKey}/comments${query}`);
  return data.comments;
}

export async function postFileComment(
  fileKey: string,
  message: string,
  opts?: { commentId?: string; nodeId?: string; nodeOffset?: { x: number; y: number } },
): Promise<FigmaComment> {
  const body: any = { message };
  if (opts?.commentId) {
    body.comment_id = opts.commentId;
  }
  if (opts?.nodeId) {
    body.client_meta = {
      node_id: opts.nodeId,
      node_offset: opts.nodeOffset || { x: 0, y: 0 },
    };
  }
  return figmaPost<FigmaComment>(`/v1/files/${fileKey}/comments`, body);
}

export async function deleteFileComment(fileKey: string, commentId: string): Promise<void> {
  return figmaDelete(`/v1/files/${fileKey}/comments/${commentId}`);
}
