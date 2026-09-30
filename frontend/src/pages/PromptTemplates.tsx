import { useEffect, useState } from 'react';
import {
  Card, Spin, message, Typography, Space, Button, Input, Empty, Tag, Row, Col,
  Modal, Select, Tabs, Statistic, Progress, Popconfirm, Switch, Table, InputNumber,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SaveOutlined, EditOutlined, CheckCircleOutlined,
  FireOutlined, AppstoreOutlined, ThunderboltOutlined, CopyOutlined,
  ExperimentOutlined, ClearOutlined, SaveFilled,
} from '@ant-design/icons';
import { promptApi } from '@/api/endpoints/prompt';
import { agentApi } from '@/api/endpoints/agent';
import type {
  PromptTemplate, PromptCacheStats, PromptCacheEntry,
} from '@/types';

const { Text, Paragraph, Title } = Typography;
const { TextArea } = Input;

const CATEGORY_OPTIONS = [
  { value: 'general', label: '通用' },
  { value: 'coding', label: '编程' },
  { value: 'writing', label: '写作' },
  { value: 'analysis', label: '分析' },
  { value: 'role', label: '角色扮演' },
  { value: 'translation', label: '翻译' },
  { value: 'other', label: '其他' },
];

const CATEGORY_COLOR: Record<string, string> = {
  general: 'default', coding: 'blue', writing: 'green', analysis: 'purple',
  role: 'orange', translation: 'cyan', other: 'default',
};

// 从内容中提取 {{var}} 变量名
function extractVars(content: string): string[] {
  const matches = content.match(/\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g) || [];
  const names = matches.map((m) => m.replace(/[{} ]/g, ''));
  return [...new Set(names)];
}

export default function PromptTemplates() {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [agents, setAgents] = useState<{ value: number; label: string }[]>([]);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);

  // 编辑
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [saving, setSaving] = useState(false);

  // 应用/渲染弹窗
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyTarget, setApplyTarget] = useState<PromptTemplate | null>(null);
  const [applyVars, setApplyVars] = useState<Record<string, string>>({});
  const [rendered, setRendered] = useState('');
  const [applyAgentId, setApplyAgentId] = useState<number | undefined>();

  // 缓存
  const [cacheStats, setCacheStats] = useState<PromptCacheStats | null>(null);
  const [cacheList, setCacheList] = useState<PromptCacheEntry[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [list, agentList] = await Promise.all([
          promptApi.list(undefined, false),
          agentApi.list(),
        ]);
        setTemplates(list);
        setAgents(agentList.map((a) => ({ value: a.id, label: a.name })));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadTemplates = async () => {
    try {
      setTemplates(await promptApi.list(category, showAll));
    } catch { /* */ }
  };

  const openCreate = () => {
    setEditing({
      id: 0, name: '', description: '', category: 'general',
      content: '', variables: [], tags: [], is_public: true, usage_count: 0,
    });
    setEditorOpen(true);
  };

  const openEdit = (t: PromptTemplate) => {
    setEditing({ ...t, variables: t.variables || [] });
    setEditorOpen(true);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { message.warning('请输入名称'); return; }
    if (!editing.content.trim()) { message.warning('请输入模板内容'); return; }
    setSaving(true);
    try {
      // 自动从 content 提取变量（合并用户手动添加的）
      const autoVars = extractVars(editing.content);
      const existingNames = (editing.variables || []).map((v) => v.name);
      const merged = [...(editing.variables || [])];
      for (const n of autoVars) {
        if (!existingNames.includes(n)) {
          merged.push({ name: n, description: '', default: '' });
        }
      }
      const body = {
        name: editing.name, description: editing.description, category: editing.category,
        content: editing.content, variables: merged, tags: editing.tags,
        is_public: editing.is_public,
      };
      if (editing.id) {
        await promptApi.update(editing.id, body);
        message.success('已更新');
      } else {
        await promptApi.create(body);
        message.success('已创建');
      }
      setEditorOpen(false);
      loadTemplates();
    } catch { /* */ } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await promptApi.remove(id);
      message.success('已删除');
      loadTemplates();
    } catch { /* */ }
  };

  const openApply = (t: PromptTemplate) => {
    setApplyTarget(t);
    const vars: Record<string, string> = {};
    (t.variables || []).forEach((v) => { vars[v.name] = String(v.default || ''); });
    setApplyVars(vars);
    setRendered('');
    setApplyAgentId(undefined);
    setApplyOpen(true);
  };

  const doRender = async () => {
    if (!applyTarget) return;
    try {
      const res = await promptApi.render(applyTarget.id, applyVars);
      setRendered(res.rendered);
    } catch { /* */ }
  };

  const doApply = async () => {
    if (!applyTarget || !applyAgentId) {
      message.warning('请选择目标 Agent');
      return;
    }
    try {
      await promptApi.apply(applyTarget.id, applyAgentId, applyVars);
      message.success(`已应用到 Agent（ID: ${applyAgentId}）`);
      setApplyOpen(false);
    } catch { /* */ }
  };

  // 缓存
  const loadCache = async () => {
    try {
      const [stats, list] = await Promise.all([promptApi.cacheStats(), promptApi.cacheList()]);
      setCacheStats(stats);
      setCacheList(list);
    } catch { /* */ }
  };

  const clearCache = async () => {
    try {
      const res = await promptApi.cacheClear();
      message.success(`已清空 ${res.cleared} 条缓存`);
      loadCache();
    } catch { /* */ }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', padding: 48 }} />;

  return (
    <div>
      <Title level={4}>
        <AppstoreOutlined style={{ marginRight: 8 }} />
        Prompt 模板市场
      </Title>
      <Paragraph type="secondary">
        可复用的 Prompt 模板。用 <Text code>{`{{变量名}}`}</Text> 定义占位符，可实时渲染预览，也可一键应用到 Agent 的 system_prompt。
        模板按使用量排序，支持分类筛选。
      </Paragraph>

      <Tabs
        defaultActiveKey="market"
        items={[
          {
            key: 'market',
            label: <Space><AppstoreOutlined /> 模板市场</Space>,
            children: (
              <div>
                <Card
                  title={
                    <Space>
                      <Select
                        value={category}
                        onChange={(v) => { setCategory(v); setTimeout(loadTemplates, 0); }}
                        style={{ width: 160 }}
                        options={CATEGORY_OPTIONS}
                        placeholder="全部分类"
                        allowClear
                      />
                      <Tag color="blue">{templates.length} 个模板</Tag>
                    </Space>
                  }
                  extra={
                    <Space>
                      <Switch checked={showAll} onChange={(c) => { setShowAll(c); setTimeout(loadTemplates, 0); }}
                        checkedChildren="含私有" unCheckedChildren="仅公开" />
                      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建模板</Button>
                    </Space>
                  }
                >
                  {templates.length === 0 ? (
                    <Empty description="暂无模板">
                      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建模板</Button>
                    </Empty>
                  ) : (
                    <Row gutter={[16, 16]}>
                      {templates.map((t) => (
                        <Col span={8} key={t.id}>
                          <Card
                            size="small"
                            hoverable
                            title={
                              <Space>
                                <Text strong>{t.name}</Text>
                                {t.is_public ? <Tag color="green">公开</Tag> : <Tag>私有</Tag>}
                              </Space>
                            }
                            extra={
                              <Space size={0}>
                                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(t)} />
                                <Popconfirm title="删除此模板？" onConfirm={() => remove(t.id)}>
                                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                              </Space>
                            }
                          >
                            <Space style={{ marginBottom: 8 }}>
                              <Tag color={CATEGORY_COLOR[t.category] || 'default'}>
                                {CATEGORY_OPTIONS.find((c) => c.value === t.category)?.label || t.category}
                              </Tag>
                              {t.tags?.map((tag) => (
                                <Tag key={tag} color="default">{tag}</Tag>
                              ))}
                            </Space>
                            <Paragraph
                              type="secondary"
                              style={{ fontSize: 12, marginBottom: 8, display: '-webkit-box',
                                WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                            >
                              {t.description || t.content.slice(0, 100)}
                            </Paragraph>
                            <div style={{ background: '#fafafa', padding: 8, borderRadius: 4, fontFamily: 'monospace',
                              fontSize: 11, maxHeight: 80, overflow: 'hidden', marginBottom: 8 }}>
                              {t.content.slice(0, 200)}
                            </div>
                            {(t.variables || []).length > 0 && (
                              <Space size={2} style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                                {(t.variables || []).map((v) => (
                                  <Tag key={v.name} color="blue" style={{ fontSize: 11 }}>{`{{${v.name}}}`}</Tag>
                                ))}
                              </Space>
                            )}
                            <Space>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                <FireOutlined /> {t.usage_count} 次使用
                              </Text>
                              <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />}
                                onClick={() => openApply(t)}>应用/预览</Button>
                            </Space>
                          </Card>
                        </Col>
                      ))}
                    </Row>
                  )}
                </Card>
              </div>
            ),
          },
          {
            key: 'cache',
            label: (
              <Space>
                <ThunderboltOutlined /> Prompt 缓存
                {cacheStats && <Tag color="green">命中 {cacheStats.total_hits}</Tag>}
              </Space>
            ),
            children: (
              <CacheTab
                stats={cacheStats}
                list={cacheList}
                onLoad={loadCache}
                onClear={clearCache}
              />
            ),
          },
        ]}
      />

      {/* 编辑弹窗 */}
      <Modal
        title={editing?.id ? '编辑模板' : '新建模板'}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        width={720}
        destroyOnClose
        footer={
          <Space>
            <Button onClick={() => setEditorOpen(false)}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>保存</Button>
          </Space>
        }
      >
        {editing && (
          <div>
            <Row gutter={12} style={{ marginBottom: 12 }}>
              <Col span={14}>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>模板名称</Text>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="如：Python 代码审查助手" />
              </Col>
              <Col span={10}>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>分类</Text>
                <Select value={editing.category} onChange={(v) => setEditing({ ...editing, category: v })}
                  style={{ width: '100%' }} options={CATEGORY_OPTIONS} />
              </Col>
            </Row>
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>描述</Text>
              <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                placeholder="一句话说明模板用途" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>
                模板内容（用 <Text code>{`{{变量名}}`}</Text> 定义占位符，保存时自动识别）
              </Text>
              <TextArea
                value={editing.content}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                autoSize={{ minRows: 8, maxRows: 20 }}
                style={{ fontFamily: 'monospace', fontSize: 13 }}
                placeholder={`你是一个专业的 {{role}}，请帮我 {{task}}。\n要求：\n1. 简洁明了\n2. 给出示例`}
              />
              {extractVars(editing.content).length > 0 && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  识别到变量：{extractVars(editing.content).map((v) => `{{${v}}}`).join(' ')}
                </Text>
              )}
            </div>
            <Row gutter={12}>
              <Col span={16}>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>标签（逗号分隔）</Text>
                <Input
                  value={editing.tags?.join(',') || ''}
                  onChange={(e) => setEditing({ ...editing, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="如：python, code-review"
                />
              </Col>
              <Col span={8}>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>公开</Text>
                <div style={{ marginTop: 4 }}>
                  <Switch checked={editing.is_public} onChange={(c) => setEditing({ ...editing, is_public: c })} />
                </div>
              </Col>
            </Row>
          </div>
        )}
      </Modal>

      {/* 应用/渲染弹窗 */}
      <Modal
        title={<Space><ThunderboltOutlined /> 应用模板：{applyTarget?.name}</Space>}
        open={applyOpen}
        onCancel={() => setApplyOpen(false)}
        width={680}
        footer={
          <Space>
            <Button onClick={() => setApplyOpen(false)}>关闭</Button>
            <Button icon={<ExperimentOutlined />} onClick={doRender}>渲染预览</Button>
            <Button type="primary" icon={<SaveFilled />} onClick={doApply}>应用到 Agent</Button>
          </Space>
        }
      >
        {applyTarget && (
          <div>
            {(applyTarget.variables || []).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>变量值</Text>
                <Row gutter={12}>
                  {(applyTarget.variables || []).map((v) => (
                    <Col span={12} key={v.name} style={{ marginBottom: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{`{{${v.name}}}`} {v.description}</Text>
                      <Input
                        value={applyVars[v.name] || ''}
                        onChange={(e) => setApplyVars({ ...applyVars, [v.name]: e.target.value })}
                        placeholder={String(v.default || '')}
                      />
                    </Col>
                  ))}
                </Row>
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>目标 Agent（应用时选择）</Text>
              <Select
                value={applyAgentId}
                onChange={setApplyAgentId}
                style={{ width: '100%' }}
                options={agents}
                placeholder="选择要应用到的 Agent"
                allowClear
              />
            </div>
            {rendered && (
              <div>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>
                  渲染结果 <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(rendered); message.success('已复制'); }}>复制</Button>
                </Text>
                <div style={{ background: '#f0f5ff', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
                  {rendered}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// 缓存 Tab
function CacheTab({ stats, list, onLoad, onClear }: {
  stats: PromptCacheStats | null;
  list: PromptCacheEntry[];
  onLoad: () => void;
  onClear: () => void;
}) {
  useEffect(() => { onLoad(); }, [onLoad]);

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24}>
          <Col span={8}>
            <Statistic title="缓存条目数" value={stats?.total_entries ?? 0} prefix={<AppstoreOutlined />} />
          </Col>
          <Col span={8}>
            <Statistic title="总命中次数" value={stats?.total_hits ?? 0} prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />} />
          </Col>
          <Col span={8}>
            <Statistic title="节省 Token" value={stats?.total_token_saved ?? 0} prefix={<ThunderboltOutlined style={{ color: '#faad14' }} />} />
          </Col>
        </Row>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Space>
            <Button icon={<ExperimentOutlined />} onClick={onLoad}>刷新</Button>
            <Popconfirm title="清空所有缓存？" onConfirm={onClear}>
              <Button danger icon={<ClearOutlined />}>清空缓存</Button>
            </Popconfirm>
          </Space>
        </div>
      </Card>

      <Card title="缓存条目">
        {list.length === 0 ? (
          <Empty description="暂无缓存（Agent 对话时自动生成）" />
        ) : (
          <Table
            size="small"
            dataSource={list}
            rowKey="id"
            pagination={{ pageSize: 10 }}
            columns={[
              { title: 'ID', dataIndex: 'id', width: 50 },
              { title: '模型', dataIndex: 'model_name', width: 160 },
              {
                title: 'Prompt', dataIndex: 'prompt',
                render: (p: string) => <Text style={{ fontSize: 12 }}>{p.slice(0, 60)}...</Text>,
              },
              {
                title: '响应', dataIndex: 'response',
                render: (r: string) => <Text style={{ fontSize: 12 }}>{r.slice(0, 60)}...</Text>,
              },
              {
                title: '命中', dataIndex: 'hit_count', width: 80,
                render: (n: number) => <Tag color="green">{n}</Tag>,
              },
              {
                title: 'Token(in/out)', width: 120,
                render: (_: unknown, r) => (
                  <Text type="secondary" style={{ fontSize: 12 }}>{r.token_in}/{r.token_out}</Text>
                ),
              },
              {
                title: '最后使用', dataIndex: 'last_used_at', width: 160,
                render: (ts?: string) => ts ? new Date(ts).toLocaleString('zh-CN') : '-',
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
