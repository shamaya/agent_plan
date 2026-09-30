import { create } from 'zustand';
import type { ChatMessage, Conversation, SseEvent } from '@/types';
import { agentApi } from '@/api/endpoints/agent';

// 流式过程中累积的 assistant 帧卡片
export interface ToolCallFrame {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: 'pending' | 'ok' | 'error';
}

export interface CompressionFrame {
  pre_tokens: number;
  post_tokens: number;
  compressed_range: number[];
  summary: string;
  at: number; // 序号，用于排序展示
}

export interface RoutingFrame {
  complexity: number;
  label: string;
  model_id: number | null;
  reason: string;
  signals: Record<string, unknown>;
  at: number; // 序号，用于排序展示
}

interface ChatState {
  agentId: number | null;
  conversationId: number | null;
  conversations: Conversation[];
  // 已完成的消息（含历史回放 + 已结束的流式帧）
  messages: ChatMessage[];
  // 当前流式帧（token 拼接 + 工具卡片）
  streamingContent: string;
  streamingTools: ToolCallFrame[];
  compressions: CompressionFrame[];
  routings: RoutingFrame[];
  streaming: boolean;
  error: string | null;
  abortCtrl: AbortController | null;
  // HITL 审批
  pendingApprovals: { approval_id: string; tool: string; args: Record<string, unknown>; resolved?: boolean; approved?: boolean }[];

  // actions
  setAgent: (id: number | null) => void;
  loadConversations: () => Promise<void>;
  selectConversation: (convId: number | null) => Promise<void>;
  send: (message: string, images?: string[]) => Promise<void>;
  stop: () => void;
  reset: () => void;
  resolveApproval: (approvalId: string, approved: boolean, reason?: string) => Promise<void>;
}

let toolIdSeq = 0;
const nextToolId = () => `tc_${Date.now()}_${toolIdSeq++}`;

export const useChatStore = create<ChatState>((set, get) => ({
  agentId: null,
  conversationId: null,
  conversations: [],
  messages: [],
  streamingContent: '',
  streamingTools: [],
  compressions: [],
  routings: [],
  streaming: false,
  error: null,
  abortCtrl: null,
  pendingApprovals: [],

  setAgent: (id) =>
    set({ agentId: id, conversationId: null, messages: [], compressions: [], routings: [], conversations: [] }),

  loadConversations: async () => {
    const { agentId } = get();
    const list = await agentApi.conversations();
    const filtered = agentId ? list.filter((c) => c.agent_id === agentId) : list;
    set({ conversations: filtered });
  },

  selectConversation: async (convId) => {
    set({ conversationId: convId, messages: [], compressions: [], routings: [], error: null });
    if (!convId) return;
    const msgs = await agentApi.conversationMessages(convId);
    // 将 tool 消息的 tool_results 合并到最近的 assistant 消息上，使 ToolCallCard 能正确显示状态
    const merged = [...msgs];
    let lastAssistantIdx = -1;
    for (let i = 0; i < merged.length; i++) {
      if (merged[i].role === 'assistant') {
        lastAssistantIdx = i;
      } else if (merged[i].role === 'tool' && lastAssistantIdx >= 0) {
        const target = merged[lastAssistantIdx];
        const toolResults = merged[i].tool_results as { name: string; result: unknown }[] | undefined;
        if (toolResults && toolResults.length) {
          target.tool_results = [...(target.tool_results || []), ...toolResults];
        }
      }
    }
    set({ messages: merged });
  },

  send: async (message, images) => {
    const { agentId, conversationId, streaming } = get();
    if (!agentId) {
      set({ error: '请先选择 Agent' });
      return;
    }
    if (streaming) return;

    // 先把 user 消息塞进列表（即时渲染）
    const userMsg: ChatMessage = {
      id: -Date.now(),
      conversation_id: conversationId ?? 0,
      role: 'user',
      content: message,
      images: images && images.length ? images : undefined,
      tool_calls: [],
      tool_results: [],
      token_count: 0,
      is_compressed_summary: false,
    };
    set((s) => ({
      messages: [...s.messages, userMsg],
      streaming: true,
      streamingContent: '',
      streamingTools: [],
      routings: [], // 新一轮发送清空旧路由记录
      error: null,
    }));

    const ctrl = new AbortController();
    set({ abortCtrl: ctrl });

    try {
      const masterKey = localStorage.getItem('agent_master_key');
      const resp = await fetch(`/api/agents/${agentId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(masterKey ? { 'X-Master-Key': masterKey } : {}),
        },
        body: JSON.stringify({ message, conversation_id: conversationId, images: images || [] }),
        signal: ctrl.signal,
      });
      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => '');
        set({ error: `请求失败 ${resp.status} ${errText}` });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const flush = async () => {
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of chunk.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const payload = trimmed.slice(6);
            if (!payload) continue;
            let evt: SseEvent;
            try {
              evt = JSON.parse(payload);
            } catch {
              continue;
            }
            handleEvent(evt, set, get);
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        await flush();
      }
      buffer += decoder.decode();
      await flush();

      // 流结束，把累积的 assistant 帧落盘进 messages
      const { streamingContent, streamingTools } = get();
      if (streamingContent || streamingTools.length) {
        const finalMsg: ChatMessage = {
          id: -Date.now() - 1,
          conversation_id: conversationId ?? 0,
          role: 'assistant',
          content: streamingContent,
          tool_calls: streamingTools.map((t) => ({ id: t.id, name: t.tool, arguments: t.args })),
          tool_results: streamingTools.map((t) => ({ name: t.tool, result: t.result ?? t.error })),
          token_count: 0,
          is_compressed_summary: false,
        };
        set((s) => ({ messages: [...s.messages, finalMsg], streamingContent: '', streamingTools: [] }));
      }
      // 刷新会话列表（新对话已落库）
      get().loadConversations();
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // 主动中断，不报错
      } else {
        set({ error: (e as Error).message || '对话出错' });
      }
    } finally {
      set({ streaming: false, abortCtrl: null });
    }
  },

  stop: () => {
    const { abortCtrl, streamingContent, streamingTools, messages } = get();
    abortCtrl?.abort();
    // 保留已生成的部分回复（标记为 interrupted）
    if (streamingContent.trim()) {
      messages.push({
        role: 'assistant',
        content: streamingContent,
        tool_calls: streamingTools.map((t) => ({ name: t.tool, arguments: t.args, id: t.id })),
        tool_results: streamingTools.filter((t) => t.result).map((t) => ({ name: t.tool, result: t.result })),
        interrupted: true,
      } as any);
    }
    set({
      streaming: false,
      abortCtrl: null,
      streamingContent: '',
      streamingTools: [],
      messages,
    });
  },

  reset: () =>
    set({
      conversationId: null,
      messages: [],
      compressions: [],
      routings: [],
      streamingContent: '',
      streamingTools: [],
      error: null,
      pendingApprovals: [],
    }),

  resolveApproval: async (approvalId: string, approved: boolean, reason?: string) => {
    try {
      await agentApi.resolveApproval(approvalId, approved, reason);
      set((s) => ({
        pendingApprovals: s.pendingApprovals.map((a) =>
          a.approval_id === approvalId
            ? { ...a, resolved: true, approved }
            : a,
        ),
      }));
    } catch (e) {
      console.error('审批提交失败', e);
    }
  },
}));

// 事件分发
function handleEvent(
  evt: SseEvent,
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
) {
  switch (evt.type) {
    case 'session':
      set(() => ({ conversationId: evt.conversation_id }));
      break;
    case 'token':
      set((s) => ({ streamingContent: s.streamingContent + evt.text }));
      break;
    case 'tool_call':
      set((s) => ({
        streamingTools: [
          ...s.streamingTools,
          { id: nextToolId(), tool: evt.tool, args: evt.args, status: 'pending' },
        ],
      }));
      break;
    case 'tool_result': {
      set((s) => ({
        streamingTools: s.streamingTools.map((t) =>
          t.tool === evt.tool && t.status === 'pending'
            ? {
                ...t,
                result: evt.result,
                status: typeof evt.result === 'object' && evt.result && 'error' in (evt.result as Record<string, unknown>) ? 'error' : 'ok',
              }
            : t,
        ),
      }));
      break;
    }
    case 'compression':
      set((s) => ({
        compressions: [
          ...s.compressions,
          {
            pre_tokens: evt.pre_tokens,
            post_tokens: evt.post_tokens,
            compressed_range: evt.compressed_range,
            summary: evt.summary,
            at: s.compressions.length,
          },
        ],
      }));
      break;
    case 'routing':
      set((s) => ({
        routings: [
          ...s.routings,
          {
            complexity: evt.complexity,
            label: evt.label,
            model_id: evt.model_id,
            reason: evt.reason,
            signals: evt.signals,
            at: s.routings.length,
          },
        ],
      }));
      break;
    case 'trace_step':
      // 前端 TraceViewer 通过单独接口拉取，此处忽略实时 trace_step
      break;
    case 'approval_request':
      set((s) => ({
        pendingApprovals: [
          ...s.pendingApprovals,
          { approval_id: evt.approval_id, tool: evt.tool, args: evt.args },
        ],
      }));
      break;
    case 'done':
      // 流结束标志，send() 的 finally 会处理收尾
      break;
    case 'error':
      set(() => ({ error: evt.message }));
      break;
  }
}
