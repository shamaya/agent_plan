import { http } from '../client';
import type { Trace, Stats, ErrorGroup, TokenStats } from '@/types';

export const traceApi = {
  list: (convId?: number) =>
    http.get<Trace[]>('/traces', convId ? { conv_id: convId } : undefined),
  get: (id: number) => http.get<Trace>(`/traces/${id}`),
  stats: () => http.get<Stats>('/stats'),
  errors: (limit = 20) => http.get<ErrorGroup[]>('/stats/errors', { limit }),
  tokens: () => http.get<TokenStats[]>('/stats/tokens'),
};
