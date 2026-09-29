import { http } from '../client';
import type { McpServer, McpTool, ToolInvokeResult } from '@/types';

export const mcpApi = {
  listServers: () => http.get<McpServer[]>('/mcp/servers'),
  getServer: (id: number) => http.get<McpServer>(`/mcp/servers/${id}`),
  createServer: (body: Partial<McpServer>) =>
    http.post<McpServer>('/mcp/servers', body),
  updateServer: (id: number, body: Partial<McpServer>) =>
    http.put<McpServer>(`/mcp/servers/${id}`, body),
  removeServer: (id: number) =>
    http.del<{ ok: boolean }>(`/mcp/servers/${id}`),
  connect: (id: number) =>
    http.post<{ ok: boolean; error?: string }>(`/mcp/servers/${id}/connect`),
  discover: (id: number) =>
    http.post<McpTool[]>(`/mcp/servers/${id}/discover`),
  tools: (id: number) => http.get<McpTool[]>(`/mcp/servers/${id}/tools`),
  invoke: (toolId: number, args: Record<string, unknown>) =>
    http.post<ToolInvokeResult>(`/mcp/tools/${toolId}/invoke`, { arguments: args }),
};
