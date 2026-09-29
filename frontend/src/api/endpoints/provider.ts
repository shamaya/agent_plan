import { http } from '../client';
import type { Provider, Model, ProviderTestResult } from '@/types';

export const providerApi = {
  list: () => http.get<Provider[]>('/providers'),
  get: (id: number) => http.get<Provider>(`/providers/${id}`),
  create: (body: Partial<Provider> & { api_key?: string }) =>
    http.post<Provider>('/providers', body),
  update: (id: number, body: Partial<Provider> & { api_key?: string }) =>
    http.put<Provider>(`/providers/${id}`, body),
  remove: (id: number) => http.del<{ ok: boolean }>(`/providers/${id}`),
  test: (id: number) => http.post<ProviderTestResult>(`/providers/${id}/test`),
  models: (id: number) => http.get<Model[]>(`/providers/${id}/models`),
  upsertModels: (id: number, models: Partial<Model>[]) =>
    http.post<Model[]>(`/providers/${id}/models`, { models }),
};
