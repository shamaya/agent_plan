import { http } from '../client';
import type { ApiKey, ApiKeyCreated } from '@/types';

export const apikeyApi = {
  list: () => http.get<ApiKey[]>('/apikeys'),
  create: (body: {
    name: string;
    allowed_agent_ids: number[];
    expires_at?: string | null;
  }) => http.post<ApiKeyCreated>('/apikeys', body),
  update: (
    id: number,
    body: Partial<{
      name: string;
      allowed_agent_ids: number[];
      enabled: boolean;
      expires_at: string | null;
    }>,
  ) => http.put<ApiKey>(`/apikeys/${id}`, body),
  remove: (id: number) => http.del<{ ok: boolean }>(`/apikeys/${id}`),
};
