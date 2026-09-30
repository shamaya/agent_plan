import { http } from '../client';
import type { Evaluation, EvaluationRun, EvaluationCriterion } from '@/types';
import type { VersionSnapshot } from './workflow';

export const evaluationApi = {
  list: (agentId?: number) =>
    http.get<Evaluation[]>('/evaluations', agentId ? { agent_id: agentId } : undefined),
  get: (id: number) => http.get<Evaluation>(`/evaluations/${id}`),
  create: (body: {
    name: string;
    agent_id: number;
    description?: string;
    criteria?: EvaluationCriterion[];
    judge_model_id?: number | null;
  }) => http.post<Evaluation>('/evaluations', body),
  update: (id: number, body: Partial<Evaluation>) =>
    http.put<Evaluation>(`/evaluations/${id}`, body),
  remove: (id: number) => http.del<{ ok: boolean }>(`/evaluations/${id}`),
  listRuns: (eid: number) => http.get<EvaluationRun[]>(`/evaluations/${eid}/runs`),
  getRun: (runId: number) => http.get<EvaluationRun>(`/evaluations/runs/${runId}`),
  // 版本
  listVersions: (eid: number) => http.get<VersionSnapshot[]>(`/evaluations/${eid}/versions`),
  saveVersion: (eid: number, note = '') =>
    http.post<VersionSnapshot>(`/evaluations/${eid}/versions`, { note }),
  rollbackVersion: (eid: number, versionId: number) =>
    http.post<Evaluation>(`/evaluations/${eid}/versions/${versionId}/rollback`),
};

// SSE 评估运行：fetch + ReadableStream
export async function runEvaluationStream(
  eid: number,
  inputPrompt: string,
  onEvent: (evt: import('@/types').EvaluationSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const masterKey = localStorage.getItem('agent_master_key');
  const resp = await fetch(`/api/evaluations/${eid}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(masterKey ? { 'X-Master-Key': masterKey } : {}),
    },
    body: JSON.stringify({ input_prompt: inputPrompt }),
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
          onEvent(JSON.parse(payload));
        } catch { /* */ }
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
