import { useEffect, useState } from 'react';
import {
  Card, Spin, message, Typography, Space, Button, Input, Empty, Tag, Row, Col,
  Table, Modal, Select, Alert, Tooltip, Popconfirm, Switch, InputNumber,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SaveOutlined, EditOutlined, CheckCircleOutlined,
  CloseCircleOutlined, SafetyCertificateOutlined, ExperimentOutlined,
} from '@ant-design/icons';
import { guardrailApi } from '@/api/endpoints/guardrail';
import { agentApi } from '@/api/endpoints/agent';
import type {
  GuardrailRule, GuardrailBatchResult, GUARDRAIL_TYPES, GUARDRAIL_ACTIONS,
} from '@/types';

const { Text, Paragraph, Title } = Typography;
const { TextArea } = Input;

const TYPE_OPTIONS = [
  { value: 'regex', label: '正则匹配' },
  { value: 'length', label: '长度约束' },
  { value: 'keyword', label: '禁用关键词' },
  { value: 'json_format', label: 'JSON 格式' },
  { value: 'json_schema', label: 'JSON Schema' },
  { value: 'starts_with', label: '前缀匹配' },
];

const ACTION_OPTIONS = [
  { value: 'retry', label: '重试' },
  { value: 'reject', label: '拒绝' },
  { value: 'append_warning', label: '追加警告' },
];

const TYPE_DESC: Record<string, string> = {
  regex: '用正则匹配输出。negate=true 表示「不允许匹配」。',
  length: '限制输出字符长度（min ~ max）。',
  keyword: '输出不能包含指定关键词列表。',
  json_format: '要求输出是合法 JSON，可指定必需字段。',
  json_schema: '按 JSON Schema 校验输出（支持 type/required）。',
  starts_with: '输出必须以指定前缀开头。',
};

// 根据类型生成默认 config
function defaultConfig(type: string): Record<string, unknown> {
  switch (type) {
    case 'regex': return { pattern: '', negate: false };
    case 'length': return { min: 0, max: 1000 };
    case 'keyword': return { keywords: [] };
    case 'json_format': return { required_fields: [] };
    case 'json_schema': return { schema: { type: 'object', required: [] } };
    case 'starts_with': return { prefix: '' };
    default: return {};
  }
}

export default function Guardrails() {
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<GuardrailRule[]>([]);
  const [agents, setAgents] = useState<{ value: number; label: string }[]>([]);
  const [filterAgentId, setFilterAgentId] = useState<number | undefined>(undefined);

  // 编辑弹窗
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<GuardrailRule | null>(null);
  const [saving, setSaving] = useState(false);

  // 测试面板
  const [testOpen, setTestOpen] = useState(false);
  const [testContent, setTestContent] = useState('');
  const [testResult, setTestResult] = useState<GuardrailBatchResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [ruleList, agentList] = await Promise.all([
          guardrailApi.list(),
          agentApi.list(),
        ]);
        setRules(ruleList);
        setAgents([{ value: 0, label: '全局（所有 Agent）' },
          ...agentList.map((a) => ({ value: a.id, label: a.name }))]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadRules = async () => {
    try {
      const list = await guardrailApi.list(filterAgentId);
      setRules(list);
    } catch { /* */ }
  };

  const openCreate = () => {
    setEditing({
      id: 0, name: '', agent_id: null, agent_name: '',
      type: 'keyword', config: defaultConfig('keyword'),
      action: 'retry', retry_count: 1, enabled: true, sort_order: rules.length,
    });
    setEditorOpen(true);
  };

  const openEdit = (r: GuardrailRule) => {
    setEditing({ ...r, config: { ...defaultConfig(r.type), ...r.config } });
    setEditorOpen(true);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { message.warning('请输入规则名称'); return; }
    setSaving(true);
    try {
      if (editing.id) {
        await guardrailApi.update(editing.id, {
          name: editing.name, agent_id: editing.agent_id ?? null,
          type: editing.type, config: editing.config,
          action: editing.action, retry_count: editing.retry_count,
          enabled: editing.enabled, sort_order: editing.sort_order,
        });
        message.success('已更新');
      } else {
        await guardrailApi.create({
          name: editing.name, agent_id: editing.agent_id ?? null,
          type: editing.type, config: editing.config,
          action: editing.action, retry_count: editing.retry_count,
          enabled: editing.enabled, sort_order: editing.sort_order,
        });
        message.success('已创建');
      }
      setEditorOpen(false);
      loadRules();
    } catch { /* */ } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await guardrailApi.remove(id);
      message.success('已删除');
      loadRules();
    } catch { /* */ }
  };

  const toggleEnabled = async (r: GuardrailRule) => {
    try {
      await guardrailApi.update(r.id, { enabled: !r.enabled });
      setRules(rules.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled } : x));
    } catch { /* */ }
  };

  // 测试
  const runTest = async () => {
    if (!testContent.trim()) { message.warning('请输入待校验文本'); return; }
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await guardrailApi.test({
        content: testContent,
        agent_id: filterAgentId ?? undefined,
      });
      setTestResult(res);
    } catch { /* */ } finally {
      setTestLoading(false);
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', padding: 48 }} />;

  return (
    <div>
      <Title level={4}>
        <SafetyCertificateOutlined style={{ marginRight: 8 }} />
        Guardrails 输出校验
      </Title>
      <Paragraph type="secondary">
        对 Agent 输出做规则校验：正则 / 长度 / 关键词 / JSON 格式 / JSON Schema / 前缀。
        违规时可自动重试（追加反馈让 LLM 修正）、拒绝、或追加警告。
        规则 agent_id 为空时对所有 Agent 生效。
      </Paragraph>

      <Card
        title={
          <Space>
            <Select
              value={filterAgentId}
              onChange={(v) => { setFilterAgentId(v); setTimeout(loadRules, 0); }}
              style={{ width: 240 }}
              options={agents}
              placeholder="按 Agent 筛选"
              allowClear
            />
            <Tag color="blue">{rules.length} 条规则</Tag>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ExperimentOutlined />} onClick={() => setTestOpen(true)}>测试校验</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建规则</Button>
          </Space>
        }
      >
        {rules.length === 0 ? (
          <Empty description="暂无规则">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建规则</Button>
          </Empty>
        ) : (
          <Table
            size="small"
            dataSource={rules}
            rowKey="id"
            pagination={{ pageSize: 10 }}
            columns={[
              {
                title: '名称', dataIndex: 'name', width: 160,
                render: (name: string, r) => (
                  <Space>
                    <Text strong>{name}</Text>
                    {!r.enabled && <Tag color="default">已禁用</Tag>}
                  </Space>
                ),
              },
              { title: '类型', dataIndex: 'type', width: 100,
                render: (t: string) => <Tag color="blue">{TYPE_OPTIONS.find((o) => o.value === t)?.label || t}</Tag> },
              {
                title: '作用范围', dataIndex: 'agent_id', width: 120,
                render: (id: number | null, r) => id ? (
                  <Tag color="green">{r.agent_name}</Tag>
                ) : <Tag color="gold">全局</Tag>,
              },
              {
                title: '规则配置', dataIndex: 'config',
                render: (cfg: Record<string, unknown>) => (
                  <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                    {JSON.stringify(cfg).slice(0, 80)}
                  </Text>
                ),
              },
              {
                title: '动作', dataIndex: 'action', width: 100,
                render: (a: string, r) => (
                  <Space size={2}>
                    <Tag color={a === 'reject' ? 'red' : a === 'retry' ? 'orange' : 'blue'}>
                      {ACTION_OPTIONS.find((o) => o.value === a)?.label || a}
                    </Tag>
                    {a !== 'append_warning' && <Text type="secondary" style={{ fontSize: 11 }}>×{r.retry_count}</Text>}
                  </Space>
                ),
              },
              {
                title: '启用', width: 60,
                render: (_: unknown, r) => (
                  <Switch size="small" checked={r.enabled} onChange={() => toggleEnabled(r)} />
                ),
              },
              {
                title: '操作', key: 'action', width: 120,
                render: (_: unknown, r) => (
                  <Space size={2}>
                    <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
                    <Popconfirm title="删除此规则？" onConfirm={() => remove(r.id)}>
                      <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      {/* 编辑弹窗 */}
      <Modal
        title={editing?.id ? '编辑规则' : '新建规则'}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        width={640}
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
                <Text strong style={{ display: 'block', marginBottom: 4 }}>规则名称</Text>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="如：禁止输出敏感词" />
              </Col>
              <Col span={10}>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>作用范围</Text>
                <Select
                  value={editing.agent_id ?? null}
                  onChange={(v) => setEditing({ ...editing, agent_id: v })}
                  style={{ width: '100%' }}
                  options={agents}
                  placeholder="全局（所有 Agent）"
                />
              </Col>
            </Row>

            <Row gutter={12} style={{ marginBottom: 12 }}>
              <Col span={8}>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>规则类型</Text>
                <Select
                  value={editing.type}
                  onChange={(v) => setEditing({ ...editing, type: v, config: defaultConfig(v) })}
                  style={{ width: '100%' }}
                  options={TYPE_OPTIONS}
                />
              </Col>
              <Col span={8}>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>违规动作</Text>
                <Select
                  value={editing.action}
                  onChange={(v) => setEditing({ ...editing, action: v })}
                  style={{ width: '100%' }}
                  options={ACTION_OPTIONS}
                />
              </Col>
              <Col span={8}>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>重试次数</Text>
                <InputNumber
                  value={editing.retry_count}
                  onChange={(v) => setEditing({ ...editing, retry_count: v ?? 1 })}
                  min={0} max={5}
                  style={{ width: '100%' }}
                  disabled={editing.action === 'append_warning'}
                />
              </Col>
            </Row>

            <Alert type="info" style={{ marginBottom: 12 }} message={TYPE_DESC[editing.type] || ''} />

            {/* 按类型渲染配置表单 */}
            <ConfigEditor rule={editing} onChange={(cfg) => setEditing({ ...editing, config: cfg })} />

            <div style={{ marginTop: 12 }}>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>排序（数字越小越先校验）</Text>
              <InputNumber
                value={editing.sort_order}
                onChange={(v) => setEditing({ ...editing, sort_order: v ?? 0 })}
                min={0}
                style={{ width: 120 }}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* 测试面板 */}
      <Modal
        title={<Space><ExperimentOutlined /> 测试校验</Space>}
        open={testOpen}
        onCancel={() => setTestOpen(false)}
        width={640}
        footer={
          <Space>
            <Button onClick={() => setTestOpen(false)}>关闭</Button>
            <Button type="primary" icon={<ExperimentOutlined />} loading={testLoading} onClick={runTest}>运行校验</Button>
          </Space>
        }
      >
        <Text strong style={{ display: 'block', marginBottom: 4 }}>待校验文本</Text>
        <TextArea
          value={testContent}
          onChange={(e) => setTestContent(e.target.value)}
          autoSize={{ minRows: 4, maxRows: 8 }}
          placeholder="输入一段文本，测试当前筛选的规则"
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          将使用当前筛选（{filterAgentId ? `Agent#${filterAgentId}` : '全部'}）的已启用规则校验。
        </Text>

        {testResult && (
          <div style={{ marginTop: 16 }}>
            <Alert
              type={testResult.passed ? 'success' : 'error'}
              showIcon
              icon={testResult.passed ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              message={testResult.passed ? '全部通过' : `未通过（${testResult.violated_rule_ids.length} 条规则）`}
              style={{ marginBottom: 12 }}
            />
            {testResult.results.map((r) => (
              <Card key={r.rule_id} size="small" style={{ marginBottom: 8 }}
                styles={{ body: { padding: 8 } }}
                title={
                  <Space>
                    {r.passed ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <CloseCircleOutlined style={{ color: '#f5222d' }} />}
                    <Text strong>{r.rule_name}</Text>
                    <Tag color={r.passed ? 'green' : 'red'}>{r.passed ? '通过' : '未通过'}</Tag>
                    <Tag>{ACTION_OPTIONS.find((o) => o.value === r.action)?.label || r.action}</Tag>
                  </Space>
                }
              >
                {r.message && <Text type="secondary" style={{ fontSize: 12 }}>{r.message}</Text>}
              </Card>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

// 按规则类型渲染配置表单
function ConfigEditor({ rule, onChange }: {
  rule: GuardrailRule;
  onChange: (cfg: Record<string, unknown>) => void;
}) {
  const cfg = rule.config || {};
  const setCfg = (patch: Record<string, unknown>) => onChange({ ...cfg, ...patch });

  if (rule.type === 'regex') {
    return (
      <Row gutter={12}>
        <Col span={16}>
          <Text type="secondary" style={{ fontSize: 12 }}>正则 pattern</Text>
          <Input
            value={String(cfg.pattern || '')}
            onChange={(e) => setCfg({ pattern: e.target.value })}
            placeholder="如：\\d+"
          />
        </Col>
        <Col span={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>取反（negate）</Text>
          <div style={{ marginTop: 4 }}>
            <Switch checked={!!cfg.negate} onChange={(c) => setCfg({ negate: c })} />
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
              {cfg.negate ? '不允许匹配' : '要求匹配'}
            </Text>
          </div>
        </Col>
      </Row>
    );
  }

  if (rule.type === 'length') {
    return (
      <Row gutter={12}>
        <Col span={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>最小长度</Text>
          <InputNumber value={Number(cfg.min || 0)} onChange={(v) => setCfg({ min: v || 0 })} min={0} style={{ width: '100%' }} />
        </Col>
        <Col span={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>最大长度</Text>
          <InputNumber value={cfg.max as number} onChange={(v) => setCfg({ max: v })} min={0} style={{ width: '100%' }} />
        </Col>
      </Row>
    );
  }

  if (rule.type === 'keyword') {
    const keywords: string[] = Array.isArray(cfg.keywords) ? cfg.keywords : [];
    return (
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>禁用关键词（每行一个）</Text>
        <TextArea
          value={keywords.join('\n')}
          onChange={(e) => setCfg({ keywords: e.target.value.split('\n').filter(Boolean) })}
          autoSize={{ minRows: 3, maxRows: 8 }}
          placeholder="如：&#10;密码&#10;token&#10;密钥"
        />
      </div>
    );
  }

  if (rule.type === 'json_format') {
    const required: string[] = Array.isArray(cfg.required_fields) ? cfg.required_fields : [];
    return (
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>必需字段（每行一个，留空则只校验合法 JSON）</Text>
        <TextArea
          value={required.join('\n')}
          onChange={(e) => setCfg({ required_fields: e.target.value.split('\n').filter(Boolean) })}
          autoSize={{ minRows: 2, maxRows: 6 }}
          placeholder="如：&#10;answer&#10;reasoning"
        />
      </div>
    );
  }

  if (rule.type === 'json_schema') {
    return (
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          JSON Schema（支持 type/required，编辑后点空白处生效）
        </Text>
        <TextArea
          value={JSON.stringify(cfg.schema || { type: 'object', required: [] }, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              setCfg({ schema: parsed });
            } catch { /* 编辑中忽略 */ }
          }}
          autoSize={{ minRows: 6, maxRows: 12 }}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </div>
    );
  }

  if (rule.type === 'starts_with') {
    return (
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>前缀</Text>
        <Input
          value={String(cfg.prefix || '')}
          onChange={(e) => setCfg({ prefix: e.target.value })}
          placeholder="如：根据"
        />
      </div>
    );
  }

  return <Empty description="未知类型" />;
}
