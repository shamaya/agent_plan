import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Spin, message, Typography, Space, Button, Input, Empty,
  Tag, Row, Col, Table, Modal, Select, Slider, Tooltip, Popconfirm,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, RobotOutlined, BulbOutlined,
  ThunderboltOutlined, SearchOutlined, EditOutlined, CheckOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { agentApi } from '@/api/endpoints/agent';
import type { Agent, AgentMemory } from '@/types';

const { Text, Paragraph, Title } = Typography;
const { TextArea } = Input;

// 记忆类型 → 标签颜色
const TYPE_COLOR: Record<string, string> = {
  fact: 'blue',
  preference: 'green',
  episodic: 'orange',
};
const TYPE_LABEL: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  episodic: '事件',
};

export default function Memory() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<number | undefined>();
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [searchText, setSearchText] = useState('');
  const [extracting, setExtracting] = useState(false);

  // 新增/编辑 弹窗
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<AgentMemory | null>(null);
  const [form, setForm] = useState({
    content: '',
    memory_type: 'fact' as string,
    importance: 0.5,
  });
  const [saving, setSaving] = useState(false);

  // 初始化加载所有 Agent
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const list = await agentApi.list();
        setAgents(list);
        if (list.length > 0 && !selectedAgentId) {
          setSelectedAgentId(list[0].id);
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMemories = useCallback(async (agentId: number) => {
    try {
      const mems = await agentApi.listMemories(agentId);
      setMemories(mems);
    } catch { /* toast by interceptor */ }
  }, []);

  useEffect(() => {
    if (selectedAgentId) loadMemories(selectedAgentId);
    else setMemories([]);
  }, [selectedAgentId, loadMemories]);

  // 搜索过滤
  const filteredMemories = searchText.trim()
    ? memories.filter((m) =>
        m.content.toLowerCase().includes(searchText.toLowerCase().trim()),
      )
    : memories;

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  // ===== 新增/编辑记忆 =====
  const openCreate = () => {
    setEditingMemory(null);
    setForm({ content: '', memory_type: 'fact', importance: 0.5 });
    setEditorOpen(true);
  };

  const openEdit = (m: AgentMemory) => {
    setEditingMemory(m);
    setForm({
      content: m.content,
      memory_type: m.memory_type,
      importance: m.importance,
    });
    setEditorOpen(true);
  };

  const saveMemory = async () => {
    if (!selectedAgentId || !form.content.trim()) {
      message.warning('请填写记忆内容');
      return;
    }
    setSaving(true);
    try {
      if (editingMemory) {
        await agentApi.updateMemory(selectedAgentId, editingMemory.id, {
          content: form.content.trim(),
          memory_type: form.memory_type,
          importance: form.importance,
        });
        message.success('记忆已更新');
      } else {
        await agentApi.createMemory(selectedAgentId, {
          content: form.content.trim(),
          memory_type: form.memory_type,
          importance: form.importance,
        });
        message.success('记忆已新增');
      }
      setEditorOpen(false);
      await loadMemories(selectedAgentId);
    } catch { /* */ } finally {
      setSaving(false);
    }
  };

  const removeMemory = async (memoryId: number) => {
    if (!selectedAgentId) return;
    try {
      await agentApi.deleteMemory(selectedAgentId, memoryId);
      message.success('记忆已删除');
      await loadMemories(selectedAgentId);
    } catch { /* */ }
  };

  // ===== 提取记忆 =====
  const extractMemories = async () => {
    if (!selectedAgentId) return;
    setExtracting(true);
    try {
      const res = await agentApi.extractMemories(selectedAgentId);
      if (res.extracted > 0) {
        message.success(`成功提取 ${res.extracted} 条记忆`);
      } else {
        message.info('暂无可提取的记忆（需要先有对话）');
      }
      await loadMemories(selectedAgentId);
    } catch { /* */ } finally {
      setExtracting(false);
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', padding: 48 }} />;

  return (
    <div>
      <Title level={4}>
        <BulbOutlined style={{ marginRight: 8 }} />
        长期记忆
      </Title>
      <Paragraph type="secondary">
        Agent 的跨会话记忆。对话结束后自动提取值得记住的事实、偏好、事件，下次对话时自动注入相关记忆。
        也可在此手动新增、编辑、删除，或一键从历史对话中提取记忆。
      </Paragraph>

      <Row gutter={16}>
        {/* 左：Agent 列表 */}
        <Col span={6}>
          <Card
            title="Agent 列表"
            size="small"
            bodyStyle={{ padding: 0 }}
          >
            <div style={{ maxHeight: 600, overflow: 'auto' }}>
              {agents.map((a) => (
                <div
                  key={a.id}
                  onClick={() => setSelectedAgentId(a.id)}
                  style={{
                    padding: '10px 14px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f0f0f0',
                    background: a.id === selectedAgentId ? '#e6f4ff' : undefined,
                  }}
                >
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <Space>
                      <RobotOutlined />
                      <Text strong={a.id === selectedAgentId}>{a.name}</Text>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      ID: {a.id}
                    </Text>
                  </Space>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        {/* 右：记忆管理 */}
        <Col span={18}>
          {selectedAgent ? (
            <Card
              title={
                <Space>
                  <span>{selectedAgent.name}</span>
                  <Tag color="purple">{memories.length} 条记忆</Tag>
                </Space>
              }
              extra={
                <Space>
                  <Button
                    size="small"
                    onClick={() => navigate(`/agents/${selectedAgent.id}/edit`)}
                  >
                    编辑 Agent
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<ThunderboltOutlined />}
                    onClick={extractMemories}
                    loading={extracting}
                  >
                    提取记忆
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={openCreate}
                  >
                    新增记忆
                  </Button>
                </Space>
              }
            >
              {/* 搜索框 */}
              <Input
                placeholder="搜索记忆内容..."
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                allowClear
                style={{ width: '100%', marginBottom: 16 }}
              />

              {filteredMemories.length === 0 ? (
                <Empty
                  description={
                    searchText.trim()
                      ? '未找到匹配的记忆'
                      : '暂无记忆（对话后会自动提取，也可手动新增）'
                  }
                >
                  {!searchText.trim() && (
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={openCreate}
                    >
                      手动新增
                    </Button>
                  )}
                </Empty>
              ) : (
                <Table
                  size="small"
                  dataSource={filteredMemories}
                  rowKey="id"
                  pagination={{
                    pageSize: 10,
                    showSizeChanger: true,
                    showTotal: (total) => `共 ${total} 条`,
                  }}
                  columns={[
                    {
                      title: '内容',
                      dataIndex: 'content',
                      render: (content: string) => (
                        <Tooltip title={content}>
                          <Text
                            style={{
                              display: 'block',
                              maxWidth: 400,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {content}
                          </Text>
                        </Tooltip>
                      ),
                    },
                    {
                      title: '类型',
                      dataIndex: 'memory_type',
                      width: 90,
                      render: (type: string) => (
                        <Tag color={TYPE_COLOR[type] || 'default'}>
                          {TYPE_LABEL[type] || type}
                        </Tag>
                      ),
                    },
                    {
                      title: '重要度',
                      dataIndex: 'importance',
                      width: 120,
                      render: (val: number) => {
                        const pct = Math.round(val * 100);
                        const color = val >= 0.8 ? '#f5222d' : val >= 0.5 ? '#fa8c16' : '#52c41a';
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div
                              style={{
                                width: 50,
                                height: 6,
                                borderRadius: 3,
                                background: '#f0f0f0',
                                overflow: 'hidden',
                              }}
                            >
                              <div
                                style={{
                                  width: `${pct}%`,
                                  height: '100%',
                                  background: color,
                                  borderRadius: 3,
                                }}
                              />
                            </div>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {val.toFixed(1)}
                            </Text>
                          </div>
                        );
                      },
                    },
                    {
                      title: '更新时间',
                      dataIndex: 'updated_at',
                      width: 150,
                      render: (ts?: string) =>
                        ts ? new Date(ts).toLocaleString('zh-CN') : '-',
                    },
                    {
                      title: '操作',
                      key: 'action',
                      width: 100,
                      render: (_: unknown, row: AgentMemory) => (
                        <Space size={4}>
                          <Button
                            size="small"
                            type="link"
                            icon={<EditOutlined />}
                            onClick={() => openEdit(row)}
                          >
                            编辑
                          </Button>
                          <Popconfirm
                            title="删除此记忆？"
                            onConfirm={() => removeMemory(row.id)}
                          >
                            <Button
                              size="small"
                              type="link"
                              danger
                              icon={<DeleteOutlined />}
                            >
                              删除
                            </Button>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              )}

              {/* 说明区 */}
              <div style={{ marginTop: 16, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
                <Paragraph style={{ margin: 0, fontSize: 13 }}>
                  <Tag color="blue">事实</Tag>
                  客观信息（用户名、项目、技术栈等）　
                  <Tag color="green">偏好</Tag>
                  用户习惯（喜欢简洁回复、偏好 Python 等）　
                  <Tag color="orange">事件</Tag>
                  重要决策（做了什么、解决了什么）
                </Paragraph>
                <Paragraph style={{ margin: '8px 0 0', fontSize: 12 }} type="secondary">
                  提取记忆：从该 Agent 最近 5 个对话中用 LLM 自动提取值得记住的内容。
                  记忆会在下次对话时按相关性自动注入 system prompt。
                </Paragraph>
              </div>
            </Card>
          ) : (
            <Empty description="请选择一个 Agent" />
          )}
        </Col>
      </Row>

      {/* 新增/编辑弹窗 */}
      <Modal
        title={editingMemory ? '编辑记忆' : '新增记忆'}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        footer={
          <Space>
            <Button icon={<CloseOutlined />} onClick={() => setEditorOpen(false)}>
              取消
            </Button>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              loading={saving}
              onClick={saveMemory}
            >
              保存
            </Button>
          </Space>
        }
        width={560}
      >
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            记忆内容
          </Text>
          <TextArea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="如：用户偏好使用 Python，项目基于 FastAPI + React"
            autoSize={{ minRows: 3, maxRows: 8 }}
          />
        </div>

        <Row gutter={16}>
          <Col span={10}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              类型
            </Text>
            <Select
              value={form.memory_type}
              onChange={(v) => setForm({ ...form, memory_type: v })}
              style={{ width: '100%' }}
              options={[
                { label: '事实（客观信息）', value: 'fact' },
                { label: '偏好（用户习惯）', value: 'preference' },
                { label: '事件（重要决策）', value: 'episodic' },
              ]}
            />
          </Col>
          <Col span={14}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              重要度：{form.importance.toFixed(1)}
            </Text>
            <Slider
              min={0}
              max={1}
              step={0.1}
              value={form.importance}
              onChange={(v) => setForm({ ...form, importance: v })}
              marks={{
                0: '0',
                0.5: '0.5',
                1: '1.0',
              }}
            />
          </Col>
        </Row>
      </Modal>
    </div>
  );
}
