import { http } from '../client';
import type { Workflow, WorkflowRun, WorkflowValidation, WorkflowNode } from '@/types';

export const workflowApi = {
  list: () => http.get<Workflow[]>('/workflows'),
  get: (id: number) => http.get<Workflow>(`/workflows/${id}`),
  create: (body: { name: string; description?: string; nodes?: WorkflowNode[] }) =>
    http.post<Workflow>('/workflows', body),
  update: (id: number, body: Partial<Workflow>) =>
    http.put<Workflow>(`/workflows/${id}`, body),
  remove: (id: number) => http.del<{ ok: boolean }>(`/workflows/${id}`),
  // 校验
  validate: (id: number) =>
    http.post<WorkflowValidation>(`/workflows/${id}/validate`, {}),
  validateDraft: (body: { name: string; description?: string; nodes: WorkflowNode[] }) =>
    http.post<WorkflowValidation>('/workflows/validate', body),
  // 运行
  listRuns: (wfId: number) => http.get<WorkflowRun[]>(`/workflows/${wfId}/runs`),
  getRun: (runId: number) => http.get<WorkflowRun>(`/workflows/runs/${runId}`),
  // 版本
  listVersions: (wfId: number) => http.get<VersionSnapshot[]>(`/workflows/${wfId}/versions`),
  saveVersion: (wfId: number, note = '') =>
    http.post<VersionSnapshot>(`/workflows/${wfId}/versions`, { note }),
  rollbackVersion: (wfId: number, versionId: number) =>
    http.post<Workflow>(`/workflows/${wfId}/versions/${versionId}/rollback`),
};

export interface VersionSnapshot {
  id: number;
  version: number;
  snapshot: Record<string, unknown>;
  note: string;
  created_at: string;
}

// SSE 运行不走 axios：用 fetch + ReadableStream 解析。
// 调用方式：
//   await workflowApi.runStream(wfId, input, (evt) => { ... });
export async function runWorkflowStream(
  wfId: number,
  input: Record<string, unknown>,
  onEvent: (evt: import('@/types').WorkflowSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const masterKey = localStorage.getItem('agent_master_key');
  const resp = await fetch(`/api/workflows/${wfId}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(masterKey ? { 'X-Master-Key': masterKey } : {}),
    },
    body: JSON.stringify({ input }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`请求失败 ${resp.status} ${errText}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = () => {
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (!payload) continue;
        try {
          const evt = JSON.parse(payload);
          onEvent(evt);
        } catch {
          /* 忽略非 JSON 行 */
        }
      }
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    flush();
  }
  buffer += decoder.decode();
  flush();
}
