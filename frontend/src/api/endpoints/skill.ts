import { http } from '../client';
import type { Skill, SkillVersion } from '@/types';

export const skillApi = {
  list: () => http.get<Skill[]>('/skills'),
  get: (id: number) => http.get<Skill>(`/skills/${id}`),
  create: (body: Partial<Skill>) => http.post<Skill>('/skills', body),
  importMd: (content: string) =>
    http.post<Skill>('/skills/import-md', { content }),
  update: (id: number, body: Partial<Skill>) =>
    http.put<Skill>(`/skills/${id}`, body),
  remove: (id: number) => http.del<{ ok: boolean }>(`/skills/${id}`),
  newVersion: (id: number) =>
    http.post<SkillVersion>(`/skills/${id}/version`),
  toggleEnable: (id: number, enabled: boolean) =>
    http.post<Skill>(`/skills/${id}/enable`, { enabled }),
  versions: (id: number) => http.get<SkillVersion[]>(`/skills/${id}/versions`),
  test: (id: number, parameters: Record<string, unknown>, modelId?: number) =>
    http.post<{ ok: boolean; rendered_prompt: string; llm_response?: string; error?: string }>(
      `/skills/${id}/test`,
      { parameters, model_id: modelId },
    ),
};
