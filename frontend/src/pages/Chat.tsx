import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Layout as AntLayout, Select, Button, List, Input, Drawer, Typography, Space, Tag, Empty, Spin, Tooltip,
} from 'antd';
import {
  PlusOutlined, CompressOutlined, SendOutlined, StopOutlined, RobotOutlined,
} from '@ant-design/icons';
import { useChatStore } from '@/stores/useChatStore';
import { agentApi } from '@/api/endpoints/agent';
import type { Agent, ChatMessage as ChatMessageType } from '@/types';
import ChatMessage, { type ChatMessageView } from '@/components/ChatMessage';
import CompressionDiff from '@/components/CompressionDiff';

const { Sider, Content } = AntLayout;
const { TextArea } = Input;

export default function Chat() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [input, setInput] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const store = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();

  // 初始加载 agent 列表
  useEffect(() => {
    setLoadingAgents(true);
    agentApi
      .list()
      .then(setAgents)
      .finally(() => setLoadingAgents(false));
  }, []);

  // url ?agent= 联动
  useEffect(() => {
    const a = params.get('agent');
    if (a) {
      const id = Number(a);
      if (id && id !== store.agentId) {
        store.setAgent(id);
      }
    }
  }, [params]);

  // agent 切换后加载会话列表
  useEffect(() => {
    if (store.agentId) {
      store.loadConversations();
      setParams({ agent: String(store.agentId) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.agentId]);

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [store.messages, store.streamingContent, store.streamingTools]);

  // 组装渲染视图
  const views: ChatMessageView[] = store.messages.map((m: ChatMessageType) => ({
    role: m.role,
    content: m.content,
    toolCalls: (m.tool_calls as { name: string; arguments: Record<string, unknown>; id?: string }[])?.map(
      (tc) => ({ name: tc.name, args: tc.arguments, id: tc.id }),
    ),
    toolResults: m.tool_results as { name: string; result: unknown }[],
    isCompressedSummary: m.is_compressed_summary,
  }));
  if (store.streaming) {
    views.push({
      role: 'assistant',
      content: store.streamingContent,
      toolCalls: store.streamingTools.map((t) => ({ name: t.tool, args: t.args })),
      toolResults: store.streamingTools.map((t) => ({ name: t.tool, result: t.result })),
      streaming: true,
    });
  }

  const send = () => {
    const text = input.trim();
    if (!text || store.streaming) return;
    setInput('');
    store.send(text);
  };

  const onSelectAgent = (id: number) => {
    store.setAgent(id);
  };

  const onSelectConv = (convId: number) => {
    store.selectConversation(convId);
  };

  const compCount = store.compressions.length;

  return (
    <AntLayout style={{ height: 'calc(100vh - 200px)', background: '#fff' }}>
      <Sider width={268} theme="light" style={{ borderRight: '1px solid #e2e8f0', overflow: 'auto', background: '#fff' }}>
        <div style={{ padding: 12 }}>
          <Typography.Text strong>选择 Agent</Typography.Text>
          <Spin spinning={loadingAgents} size="small">
            <Select
              style={{ width: '100%', marginTop: 8 }}
              placeholder="选择一个 Agent"
              value={store.agentId ?? undefined}
              onChange={onSelectAgent}
              options={agents.map((a) => ({ label: a.name, value: a.id }))}
              notFoundContent="请先在 Agent 页创建"
            />
          </Spin>
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <Button block icon={<PlusOutlined />} onClick={() => store.reset()}>
            新对话
          </Button>
        </div>
        <Typography.Text type="secondary" style={{ padding: '0 12px' }}>
          会话历史
        </Typography.Text>
        <List
          size="small"
          dataSource={store.conversations}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无会话" /> }}
          renderItem={(c) => (
            <List.Item
              className={c.id === store.conversationId ? 'chat-list-item-active' : ''}
              style={{
                cursor: 'pointer',
                padding: '10px 12px',
                border: 'none',
                borderRadius: 8,
              }}
              onClick={() => onSelectConv(c.id)}
            >
              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <Typography.Text ellipsis style={{ maxWidth: 200 }}>
                  {c.title || `会话 #${c.id}`}
                </Typography.Text>
                {(c.compression_state as { count?: number })?.count ? (
                  <Tag color="orange" icon={<CompressOutlined />} style={{ marginTop: 2 }}>
                    压缩 {(c.compression_state as { count?: number }).count} 次
                  </Tag>
                ) : null}
              </Space>
            </List.Item>
          )}
        />
      </Sider>

      <Content className="chat-canvas" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.6)' }}>
          <Space>
            <RobotOutlined />
            <Typography.Text strong>{store.conversationId ? `会话 #${store.conversationId}` : '新对话'}</Typography.Text>
          </Space>
          <Tooltip title="查看上下文压缩详情">
            <Button
              icon={<CompressOutlined />}
              onClick={() => setDrawerOpen(true)}
              disabled={compCount === 0}
            >
              压缩 {compCount > 0 && <Tag color="orange" style={{ marginLeft: 4 }}>{compCount}</Tag>}
            </Button>
          </Tooltip>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          {views.length === 0 ? (
            <Empty description={store.agentId ? '输入消息开始对话' : '请先在左侧选择 Agent'} style={{ marginTop: 80 }} />
          ) : (
            views.map((v, i) => <ChatMessage key={i} msg={v} />)
          )}
          <div ref={bottomRef} />
        </div>

        {store.error && (
          <div style={{ padding: '4px 16px' }}>
            <Typography.Text type="danger">⚠ {store.error}</Typography.Text>
          </div>
        )}

        <div style={{ padding: '14px 18px', borderTop: '1px solid #e2e8f0', background: '#fff' }}>
          <Space.Compact style={{ width: '100%' }}>
            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={store.agentId ? '输入消息，Enter 发送，Shift+Enter 换行' : '请先选择 Agent'}
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={!store.agentId}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
          </Space.Compact>
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            {store.streaming ? (
              <Button danger icon={<StopOutlined />} onClick={store.stop}>
                停止
              </Button>
            ) : (
              <Button type="primary" icon={<SendOutlined />} onClick={send} disabled={!store.agentId || !input.trim()}>
                发送
              </Button>
            )}
          </div>
        </div>
      </Content>

      <Drawer
        title="上下文压缩详情"
        placement="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={520}
      >
        <Typography.Paragraph type="secondary">
          当对话历史 token 接近上下文窗口阈值时（默认 80%），系统自动将较早的对话送 LLM 做结构化摘要，保留近 N 轮原文，降低上下文占用同时不丢失关键信息。
        </Typography.Paragraph>
        <CompressionDiff frames={store.compressions} />
      </Drawer>
    </AntLayout>
  );
}
