import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Layout as AntLayout, Select, Button, List, Input, Drawer, Typography, Space, Tag, Empty, Spin, Tooltip, Card,
} from 'antd';
import {
  PlusOutlined, CompressOutlined, SendOutlined, StopOutlined, RobotOutlined,
  SafetyCertificateOutlined, CheckOutlined, CloseOutlined, ForkOutlined,
  PictureOutlined, LinkOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { useChatStore } from '@/stores/useChatStore';
import { agentApi } from '@/api/endpoints/agent';
import type { Agent, ChatMessage as ChatMessageType } from '@/types';
import ChatMessage, { type ChatMessageView } from '@/components/ChatMessage';
import CompressionDiff from '@/components/CompressionDiff';
import { RoutingFrame } from '@/stores/useChatStore';

// 路由决策小卡片：插入到消息流中，让用户看到本次回答用了哪个模型 + 原因
function RoutingCard({ r }: { r: RoutingFrame }) {
  const isComplex = r.label === 'complex' || r.label.startsWith('complex');
  const color = isComplex ? '#e6f4ff' : '#f6ffed';
  const border = isComplex ? '#91caff' : '#b7eb8f';
  const tagColor = isComplex ? 'blue' : 'green';
  const labelText = ({
    simple: '简单模型',
    complex: '复杂模型',
    complex_fallback_simple: '复杂(回退简单)',
    simple_fallback_complex: '简单(回退复杂)',
    fallback: '默认模型',
    default: '默认模型',
  } as Record<string, string>)[r.label] || r.label;
  return (
    <div style={{ margin: '6px 0' }}>
      <div style={{
        background: color, border: `1px solid ${border}`, borderRadius: 8,
        padding: '8px 12px', fontSize: 12,
      }}>
        <Space size={8} wrap>
          <Tag color={tagColor} icon={<ForkOutlined />}>智能路由</Tag>
          <Typography.Text strong>复杂度 {(r.complexity * 100).toFixed(0)}%</Typography.Text>
          <Tag>{labelText}</Tag>
          <Typography.Text type="secondary">{r.reason}</Typography.Text>
        </Space>
      </div>
    </div>
  );
}

const { Sider, Content } = AntLayout;
const { TextArea } = Input;

export default function Chat() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [routingDrawerOpen, setRoutingDrawerOpen] = useState(false);
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
  }, [store.messages, store.streamingContent, store.streamingTools, store.routings]);

  // 组装渲染视图
  const views: ChatMessageView[] = store.messages.map((m: ChatMessageType) => ({
    role: m.role,
    content: m.content,
    toolCalls: (m.tool_calls as { name: string; arguments: Record<string, unknown>; id?: string }[])?.map(
      (tc) => ({ name: tc.name, args: tc.arguments, id: tc.id }),
    ),
    toolResults: m.tool_results as { name: string; result: unknown }[],
    isCompressedSummary: m.is_compressed_summary,
    interrupted: (m as any).interrupted,
    images: m.images,
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
    if ((!text && images.length === 0) || store.streaming) return;
    setInput('');
    setImages([]);
    store.send(text, images.length ? images : undefined);
  };

  // 本地图片转 base64 data URL（避免后端存储负担，直接把图片数据随请求发给视觉模型）
  const onFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const addImageUrl = (url: string) => {
    const trimmed = url.trim();
    if (trimmed) setImages((prev) => [...prev, trimmed]);
  };

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const onSelectAgent = (id: number) => {
    store.setAgent(id);
  };

  const onSelectConv = (convId: number) => {
    store.selectConversation(convId);
  };

  const compCount = store.compressions.length;
  const routeCount = store.routings.length;
  const latestRouting = store.routings[store.routings.length - 1];

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
            {latestRouting && (
              <Tooltip title={latestRouting.reason}>
                <Tag color={latestRouting.label === 'complex' || latestRouting.label.startsWith('complex') ? 'blue' : 'green'} icon={<ForkOutlined />}>
                  路由：{(latestRouting.complexity * 100).toFixed(0)}% · {latestRouting.label}
                </Tag>
              </Tooltip>
            )}
          </Space>
          <Space>
            <Tooltip title="查看智能路由决策">
              <Button
                icon={<ForkOutlined />}
                onClick={() => setRoutingDrawerOpen(true)}
                disabled={routeCount === 0}
              >
                路由 {routeCount > 0 && <Tag color="blue" style={{ marginLeft: 4 }}>{routeCount}</Tag>}
              </Button>
            </Tooltip>
            <Tooltip title="查看上下文压缩详情">
              <Button
                icon={<CompressOutlined />}
                onClick={() => setDrawerOpen(true)}
                disabled={compCount === 0}
              >
                压缩 {compCount > 0 && <Tag color="orange" style={{ marginLeft: 4 }}>{compCount}</Tag>}
              </Button>
            </Tooltip>
          </Space>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          {views.length === 0 ? (
            <Empty description={store.agentId ? '输入消息开始对话' : '请先在左侧选择 Agent'} style={{ marginTop: 80 }} />
          ) : (
            <>
              {/* 渲染消息流；streaming 帧前先显示本轮路由决策卡 */}
              {views.map((v, i) => {
                const isStreaming = v.streaming;
                const elems: ReactNode[] = [];
                if (isStreaming && store.routings.length > 0) {
                  store.routings.forEach((r, idx) => elems.push(<RoutingCard key={`r-${idx}`} r={r} />));
                }
                elems.push(<ChatMessage key={i} msg={v} />);
                return <Fragment key={i}>{elems}</Fragment>;
              })}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {store.error && (
          <div style={{ padding: '4px 16px' }}>
            <Typography.Text type="danger">⚠ {store.error}</Typography.Text>
          </div>
        )}

        {/* HITL 审批卡片 */}
        {store.pendingApprovals.filter((a) => !a.resolved).length > 0 && (
          <div style={{ padding: '8px 16px', background: '#fffbe6', borderTop: '1px solid #ffe58f' }}>
            {store.pendingApprovals.filter((a) => !a.resolved).map((a) => (
              <div
                key={a.approval_id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', marginBottom: 6, background: '#fff',
                  border: '1px solid #ffd591', borderRadius: 8,
                }}
              >
                <Space>
                  <SafetyCertificateOutlined style={{ color: '#fa8c16', fontSize: 18 }} />
                  <div>
                    <Typography.Text strong>审批请求</Typography.Text>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      工具 <Typography.Text code>{a.tool}</Typography.Text> 需要确认
                    </Typography.Text>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      参数: {JSON.stringify(a.args).slice(0, 100)}
                    </Typography.Text>
                  </div>
                </Space>
                <Space>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    onClick={() => store.resolveApproval(a.approval_id, true)}
                  >
                    批准
                  </Button>
                  <Button
                    danger
                    icon={<CloseOutlined />}
                    onClick={() => store.resolveApproval(a.approval_id, false)}
                  >
                    拒绝
                  </Button>
                </Space>
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: '14px 18px', borderTop: '1px solid #e2e8f0', background: '#fff' }}>
          {/* 多模态：已选图片预览 */}
          {images.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {images.map((src, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img
                    src={src}
                    alt={`upload-${i}`}
                    style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<CloseOutlined />}
                    onClick={() => removeImage(i)}
                    style={{ position: 'absolute', top: -6, right: -6, background: '#fff', borderRadius: '50%', padding: 0, width: 20, height: 20 }}
                  />
                </div>
              ))}
            </div>
          )}
          <TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={store.agentId ? '输入消息，Enter 发送，Shift+Enter 换行（可附加图片）' : '请先选择 Agent'}
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={!store.agentId}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <Tooltip title="上传本地图片（转为 base64 发送给视觉模型）">
                <label style={{ margin: 0, cursor: 'pointer' }}>
                  <Button icon={<PictureOutlined />} disabled={!store.agentId}>
                    <input type="file" accept="image/*" multiple onChange={onFileUpload} style={{ display: 'none' }} />
                    上传图片
                  </Button>
                </label>
              </Tooltip>
              <Tooltip title="添加网络图片 URL">
                <Button
                  icon={<LinkOutlined />}
                  disabled={!store.agentId}
                  onClick={() => {
                    const url = window.prompt('输入图片 URL');
                    if (url) addImageUrl(url);
                  }}
                >
                  图片 URL
                </Button>
              </Tooltip>
              {images.length > 0 && (
                <Tag color="blue">{images.length} 张图片</Tag>
              )}
            </Space>
            {store.streaming ? (
              <Button danger icon={<StopOutlined />} onClick={store.stop}>
                停止
              </Button>
            ) : (
              <Button type="primary" icon={<SendOutlined />} onClick={send} disabled={!store.agentId || (!input.trim() && images.length === 0)}>
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

      <Drawer
        title="智能路由决策"
        placement="right"
        open={routingDrawerOpen}
        onClose={() => setRoutingDrawerOpen(false)}
        width={560}
      >
        <Typography.Paragraph type="secondary">
          启用智能路由后，Agent 在每次调用 LLM 前会基于消息长度、代码块、推理关键词、历史工具调用等信号评估复杂度，按阈值切换到简单/复杂模型，平衡成本与质量。
        </Typography.Paragraph>
        {store.routings.length === 0 ? (
          <Empty description="本次对话暂无路由决策（未启用或未触发）" />
        ) : (
          store.routings.map((r, i) => (
            <Card key={i} size="small" style={{ marginBottom: 10 }}>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space>
                  <Tag color={r.label === 'complex' || r.label.startsWith('complex') ? 'blue' : 'green'}>
                    {r.label}
                  </Tag>
                  <Typography.Text strong>复杂度 {(r.complexity * 100).toFixed(0)}%</Typography.Text>
                  <Typography.Text type="secondary">model #{r.model_id ?? '默认'}</Typography.Text>
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.reason}
                </Typography.Text>
                <pre style={{
                  background: '#f8fafc', padding: 8, marginTop: 4, fontSize: 11,
                  maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap', borderRadius: 6,
                }}>
                  {JSON.stringify(r.signals, null, 2)}
                </pre>
              </Space>
            </Card>
          ))
        )}
      </Drawer>
    </AntLayout>
  );
}
