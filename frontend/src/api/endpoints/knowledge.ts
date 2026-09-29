import { http, api } from '../client';
import type { KnowledgeBase, KbDocument, SearchResult, ChunkRead } from '@/types';

export const knowledgeApi = {
  list: () => http.get<KnowledgeBase[]>('/knowledge'),
  get: (id: number) => http.get<KnowledgeBase>(`/knowledge/${id}`),
  create: (body: Partial<KnowledgeBase>) =>
    http.post<KnowledgeBase>('/knowledge', body),
  update: (id: number, body: Partial<KnowledgeBase>) =>
    http.put<KnowledgeBase>(`/knowledge/${id}`, body),
  remove: (id: number) => http.del<{ ok: boolean }>(`/knowledge/${id}`),
  documents: (id: number) => http.get<KbDocument[]>(`/knowledge/${id}/documents`),
  uploadDocument: (id: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<KbDocument>(`/knowledge/${id}/documents`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      })
      .then((r) => r.data);
  },
  removeDocument: (kbId: number, docId: number) =>
    http.del<{ ok: boolean }>(`/knowledge/${kbId}/documents/${docId}`),
  chunks: (kbId: number, docId: number) =>
    http.get<ChunkRead[]>(`/knowledge/${kbId}/documents/${docId}/chunks`),
  search: (id: number, query: string, top_k = 4) =>
    http.post<SearchResult>(`/knowledge/${id}/search`, { query, top_k }),
};
