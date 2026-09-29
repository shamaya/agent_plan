import axios, { AxiosError } from 'axios';
import { message } from 'antd';

// 统一 axios 实例：baseURL=/api（开发经 vite proxy，生产经 nginx 反代）
export const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// 请求拦截：如有 master key（前端 localStorage 存）则注入
api.interceptors.request.use((config) => {
  const masterKey = localStorage.getItem('agent_master_key');
  if (masterKey) {
    config.headers = config.headers || {};
    (config.headers as Record<string, string>)['X-Master-Key'] = masterKey;
  }
  return config;
});

// 响应拦截：统一错误吐司
api.interceptors.response.use(
  (resp) => resp,
  (err: AxiosError<{ detail?: string; message?: string }>) => {
    const detail =
      err.response?.data?.detail ||
      err.response?.data?.message ||
      err.message ||
      '请求失败';
    // 401/403 提示鉴权
    if (err.response?.status === 401 || err.response?.status === 403) {
      message.error('鉴权失败，请检查 Master Key');
    } else {
      message.error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    return Promise.reject(err);
  },
);

// 通用 GET/POST 封装（可选，简化页面代码）
export const http = {
  get: <T>(url: string, params?: Record<string, unknown>) =>
    api.get<T>(url, { params }).then((r) => r.data),
  post: <T>(url: string, body?: unknown) =>
    api.post<T>(url, body).then((r) => r.data),
  put: <T>(url: string, body?: unknown) =>
    api.put<T>(url, body).then((r) => r.data),
  del: <T>(url: string) => api.delete<T>(url).then((r) => r.data),
};
