import { http } from '../client';
import type {
  Agent, Conversation, ChatMessage, AgentVersion, AgentExport,
  AgentWorker, AgentWorkerCreate, AgentMemory, AgentMemoryCreate, AgentMemoryUpdate,
} from '@/types';

export const agentApi = {
  list: () => http.get<Agent[]>('/agents'),
  get: (id: number) => http.get<Agent>(`/agents/${id}`),
  create: (body: Partial<Agent>) => http.post<Agent>('/agents', body),
  update: (id: number, body: Partial<Agent>) =>
    http.put<Agent>(`/agents/${id}`, body),
  remove: (id: number) => http.del<{ ok: boolean }>(`/agents/${id}`),
  conversations: () => http.get<Conversation[]>('/conversations'),
  conversationMessages: (convId: number) =>
    http.get<ChatMessage[]>(`/conversations/${convId}/messages`),
  deleteConversation: (convId: number) =>
    http.del<{ ok: boolean }>(`/conversations/${convId}`),
  // 版本管理
  saveVersion: (id: number, note: string) =>
    http.post<AgentVersion>(`/agents/${id}/versions`, { note }),
  listVersions: (id: number) =>
    http.get<AgentVersion[]>(`/agents/${id}/versions`),
  rollbackVersion: (agentId: number, versionId: number) =>
    http.post<Agent>(`/agents/${agentId}/versions/${versionId}/rollback`),
  // 导入导出
  exportAgent: (id: number) => http.get<AgentExport>(`/agents/${id}/export`),
  importAgent: (body: AgentExport) => http.post<Agent>('/agents/import', body),
  // 多智能体协同（Worker 池）
  listWorkers: (agentId: number) =>
    http.get<AgentWorker[]>(`/agents/${agentId}/workers`),
  addWorker: (agentId: number, body: AgentWorkerCreate) =>
    http.post<AgentWorker>(`/agents/${agentId}/workers`, body),
  removeWorker: (agentId: number, workerRowId: number) =>
    http.del<{ ok: boolean }>(`/agents/${agentId}/workers/${workerRowId}`),
  // HITL 审批
  resolveApproval: (approvalId: string, approved: boolean, reason?: string) =>
    http.post<{ ok: boolean }>(`/approvals/${approvalId}`, { approved, reason: reason || '' }),
  // 长期记忆
  listMemories: (agentId: number) =>
    http.get<AgentMemory[]>(`/agents/${agentId}/memories`),
  createMemory: (agentId: number, body: AgentMemoryCreate) =>
    http.post<AgentMemory>(`/agents/${agentId}/memories`, body),
  updateMemory: (agentId: number, memoryId: number, body: AgentMemoryUpdate) =>
    http.put<AgentMemory>(`/agents/${agentId}/memories/${memoryId}`, body),
  deleteMemory: (agentId: number, memoryId: number) =>
    http.del<{ ok: boolean }>(`/agents/${agentId}/memories/${memoryId}`),
  searchMemories: (agentId: number, q: string) =>
    http.get<AgentMemory[]>(`/agents/${agentId}/memories/search`, { q }),
  extractMemories: (agentId: number) =>
    http.post<{ extracted: number; memories: unknown[] }>(`/agents/${agentId}/memories/extract`),
};

// SSE 对话不走 axios，用 fetch + ReadableStream 手动解析
// 实现在 stores/useChatStore.ts 中，按需调用
