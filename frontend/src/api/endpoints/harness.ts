import { http } from '../client';
import type { ConstraintProfile, RecoveryRule, Trace } from '@/types';

export const harnessApi = {
  listProfiles: () => http.get<ConstraintProfile[]>('/constraints'),
  getProfile: (id: number) => http.get<ConstraintProfile>(`/constraints/${id}`),
  createProfile: (body: Partial<ConstraintProfile>) =>
    http.post<ConstraintProfile>('/constraints', body),
  updateProfile: (id: number, body: Partial<ConstraintProfile>) =>
    http.put<ConstraintProfile>(`/constraints/${id}`, body),
  removeProfile: (id: number) =>
    http.del<{ ok: boolean }>(`/constraints/${id}`),
  listRules: () => http.get<RecoveryRule[]>('/recovery-rules'),
  createRule: (body: Partial<RecoveryRule>) =>
    http.post<RecoveryRule>('/recovery-rules', body),
  removeRule: (id: number) =>
    http.del<{ ok: boolean }>(`/recovery-rules/${id}`),
  learnFromFailure: (traceId: number) =>
    http.post<{ rule_draft: RecoveryRule; trace_summary: Record<string, unknown> }>(
      `/traces/${traceId}/learn-from-failure`,
    ),
};
