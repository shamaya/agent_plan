import { http } from '../client';
import type { GuardrailRule, GuardrailBatchResult } from '@/types';

export const guardrailApi = {
  list: (agentId?: number) =>
    http.get<GuardrailRule[]>('/guardrails', agentId != null ? { agent_id: agentId } : undefined),
  get: (id: number) => http.get<GuardrailRule>(`/guardrails/${id}`),
  create: (body: Partial<GuardrailRule>) => http.post<GuardrailRule>('/guardrails', body),
  update: (id: number, body: Partial<GuardrailRule>) =>
    http.put<GuardrailRule>(`/guardrails/${id}`, body),
  remove: (id: number) => http.del<{ ok: boolean }>(`/guardrails/${id}`),
  test: (body: { content: string; rule_ids?: number[]; agent_id?: number }) =>
    http.post<GuardrailBatchResult>('/guardrails/test', body),
};
