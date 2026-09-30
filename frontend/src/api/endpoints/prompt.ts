import { http } from '../client';
import type { PromptTemplate, PromptCacheStats, PromptCacheEntry } from '@/types';

export const promptApi = {
  // 模板市场
  list: (category?: string, all = false) =>
    http.get<PromptTemplate[]>('/prompt-templates', {
      ...(category ? { category } : {}),
      ...(all ? { all: true } : {}),
    }),
  get: (id: number) => http.get<PromptTemplate>(`/prompt-templates/${id}`),
  create: (body: Partial<PromptTemplate>) => http.post<PromptTemplate>('/prompt-templates', body),
  update: (id: number, body: Partial<PromptTemplate>) =>
    http.put<PromptTemplate>(`/prompt-templates/${id}`, body),
  remove: (id: number) => http.del<{ ok: boolean }>(`/prompt-templates/${id}`),
  render: (id: number, variables: Record<string, unknown>) =>
    http.post<{ rendered: string }>(`/prompt-templates/${id}/render`, { variables }),
  apply: (id: number, agentId: number, variables: Record<string, unknown>) =>
    http.post<{ agent_id: number; rendered: string }>(`/prompt-templates/${id}/apply/${agentId}`, { variables }),
  // 缓存
  cacheStats: () => http.get<PromptCacheStats>('/prompt-cache/stats'),
  cacheList: () => http.get<PromptCacheEntry[]>('/prompt-cache'),
  cacheClear: () => http.del<{ ok: boolean; cleared: number }>('/prompt-cache'),
};
