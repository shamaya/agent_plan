import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { skillApi } from '@/api/endpoints/skill';
import { providerApi } from '@/api/endpoints/provider';
import type { Skill, SkillVersion, Model } from '@/types';
import type { ColumnsType } from 'antd/es/table';

interface FormValues {
  name: string;
  category: string;
  description: string;
  prompt_template: string;
  parameters_schema: string;
  tool_chain: string;
  enabled: boolean;
}

const emptyValues: FormValues = {
  name: '',
  category: '',
  description: '',
  prompt_template: '',
  parameters_schema: '{}',
  tool_chain: '[]',
  enabled: true,
};

function tryParseJson(text: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

export default function Skills() {
  const { message, modal } = App.useApp();
  const [list, setList] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [form] = Form.useForm<FormValues>();
  const [paramsValid, setParamsValid] = useState(true);
  const [chainValid, setChainValid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [currentSkill, setCurrentSkill] = useState<Skill | null>(null);
  // Skill 测试
  const [testOpen, setTestOpen] = useState(false);
  const [testSkill, setTestSkill] = useState<Skill | null>(null);
  const [testParams, setTestParams] = useState('{}');
  const [testModelId, setTestModelId] = useState<number | undefined>();
  const [testResult, setTestResult] = useState<{ rendered_prompt: string; llm_response?: string; error?: string } | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  // 模型选项
  const [modelOptions, setModelOptions] = useState<{ label: string; value: number }[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [data, providers] = await Promise.all([
        skillApi.list(),
        providerApi.list(),
      ]);
      setList(data);
      // 加载模型选项（用于 skill 测试）
      const enabledProviders = providers.filter((p) => p.enabled && (p.kind === 'chat' || p.kind === 'both'));
      const modelLists = await Promise.all(enabledProviders.map((p) => providerApi.models(p.id)));
      const mOpts: { label: string; value: number }[] = [];
      enabledProviders.forEach((p, i) => {
        (modelLists[i] || []).forEach((m: Model) => {
          if (m.enabled) mOpts.push({ label: `${p.name} / ${m.model_name}`, value: m.id });
        });
      });
      setModelOptions(mOpts);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue(emptyValues);
    setParamsValid(true);
    setChainValid(true);
    setOpen(true);
  };

  const openEdit = (s: Skill) => {
    setEditing(s);
    form.setFieldsValue({
      name: s.name,
      category: s.category,
      description: s.description,
      prompt_template: s.prompt_template,
      parameters_schema: s.parameters_schema
        ? JSON.stringify(s.parameters_schema, null, 2)
        : '{}',
      tool_chain: s.tool_chain ? JSON.stringify(s.tool_chain, null, 2) : '[]',
      enabled: s.enabled,
    });
    setParamsValid(true);
    setChainValid(true);
    setOpen(true);
  };

  const handleSave = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const paramsRes = tryParseJson(values.parameters_schema || '{}');
    if (!paramsRes.ok) {
      setParamsValid(false);
      message.error('parameters_schema JSON 格式错误');
      return;
    }
    const chainRes = tryParseJson(values.tool_chain || '[]');
    if (!chainRes.ok) {
      setChainValid(false);
      message.error('tool_chain JSON 格式错误');
      return;
    }
    const body: Partial<Skill> = {
      name: values.name,
      category: values.category,
      description: values.description,
      prompt_template: values.prompt_template,
      parameters_schema: paramsRes.value as Record<string, unknown>,
      tool_chain: chainRes.value as unknown[],
      enabled: values.enabled,
    };
    try {
      setSaving(true);
      if (editing) {
        await skillApi.update(editing.id, body);
        message.success('更新成功');
      } else {
        await skillApi.create(body);
        message.success('创建成功');
      }
      setOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImporting(true);
      const content = await file.text();
      const created = await skillApi.importMd(content);
      message.success(`导入成功：${created.name}`);
      await load();
    } catch {
      message.error('导入失败：请检查 MD 格式（需 YAML frontmatter + body）');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const handleDelete = (s: Skill) => {
    modal.confirm({
      title: `删除 Skill "${s.name}"？`,
      content: '此操作不可撤销',
      okType: 'danger',
      onOk: async () => {
        await skillApi.remove(s.id);
        message.success('已删除');
        await load();
      },
    });
  };

  const handleToggle = async (s: Skill, enabled: boolean) => {
    try {
      await skillApi.toggleEnable(s.id, enabled);
      message.success(enabled ? '已启用' : '已停用');
      await load();
    } catch {
      // swallowed
    }
  };

  const handleNewVersion = async (s: Skill) => {
    try {
      await skillApi.newVersion(s.id);
      message.success('已新建版本（基于当前快照）');
      await load();
    } catch {
      // swallowed
    }
  };

  const openVersions = async (s: Skill) => {
    setCurrentSkill(s);
    setVersionsOpen(true);
    setVersionsLoading(true);
    try {
      const v = await skillApi.versions(s.id);
      setVersions(v);
    } finally {
      setVersionsLoading(false);
    }
  };

  const openTest = (s: Skill) => {
    setTestSkill(s);
    setTestParams(s.parameters_schema ? JSON.stringify(s.parameters_schema, null, 2) : '{}');
    setTestResult(null);
    setTestOpen(true);
  };

  const runTest = async () => {
    if (!testSkill) return;
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(testParams || '{}');
    } catch {
      message.error('参数 JSON 格式错误');
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    try {
      const r = await skillApi.test(testSkill.id, params, testModelId);
      if (r.ok) {
        setTestResult({ rendered_prompt: r.rendered_prompt, llm_response: r.llm_response, error: r.error });
      } else {
        setTestResult({ rendered_prompt: '', error: r.error || '测试失败' });
      }
    } finally {
      setTestLoading(false);
    }
  };

  const renderSnapshot = (snap: Record<string, unknown>) => {
    const keys = Object.keys(snap);
    const summary: string[] = [];
    for (const k of ['name', 'category', 'version']) {
      if (k in snap) summary.push(`${k}: ${String((snap as Record<string, unknown>)[k])}`);
    }
    return (
      <div>
        <Typography.Text type="secondary">{summary.join(' | ')}</Typography.Text>
        <pre
          style={{
            background: '#fafafa',
            padding: 8,
            marginTop: 6,
            fontSize: 12,
            maxHeight: 160,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {JSON.stringify(snap, null, 2)}
        </pre>
        <Typography.Text type="secondary">字段：{keys.join(', ')}</Typography.Text>
      </div>
    );
  };

  const columns: ColumnsType<Skill> = [
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: '分类',
      dataIndex: 'category',
      width: 110,
      render: (v: string) => (v ? <Tag color="blue">{v}</Tag> : <Tag>未分类</Tag>),
    },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: '版本',
      dataIndex: 'version',
      width: 70,
      align: 'center' as const,
      render: (v: number) => <Tag color="geekblue">v{v}</Tag>,
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (v: boolean, r) => (
        <Switch size="small" checked={v} onChange={(c) => handleToggle(r, c)} />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      width: 320,
      render: (_, r) => (
        <Space size="small" wrap>
          <a onClick={() => openEdit(r)}>编辑</a>
          <a onClick={() => openTest(r)}>测试</a>
          <a onClick={() => handleNewVersion(r)}>新建版本</a>
          <a onClick={() => openVersions(r)}>版本历史</a>
          <a style={{ color: '#ff4d4f' }} onClick={() => handleDelete(r)}>
            删除
          </a>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
        <Col>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Skill 管理
          </Typography.Title>
        </Col>
        <Col>
          <Space>
            <Button type="primary" onClick={openCreate}>
              新建 Skill
            </Button>
            <Button
              icon={<UploadOutlined />}
              loading={importing}
              onClick={() => importInputRef.current?.click()}
            >
              导入 MD
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".md,.markdown,.txt"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
          </Space>
        </Col>
      </Row>

      <Table<Skill>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title={editing ? '编辑 Skill' : '新建 Skill'}
        open={open}
        onOk={handleSave}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        destroyOnClose
        width={760}
      >
        <Form<FormValues>
          form={form}
          layout="vertical"
          initialValues={emptyValues}
          preserve={false}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="名称"
                rules={[{ required: true, message: '请输入名称' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="category" label="分类">
                <Input placeholder="如 retrieval、analysis" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="prompt_template"
            label="Prompt 模板"
            rules={[{ required: true, message: '请输入模板' }]}
          >
            <Input.TextArea rows={5} placeholder={'{{param}} 可被替换'} />
          </Form.Item>
          <Form.Item
            name="parameters_schema"
            label="参数 Schema（JSON）"
            validateStatus={paramsValid ? undefined : 'error'}
            help={paramsValid ? undefined : 'JSON 格式错误'}
          >
            <Input.TextArea
              rows={3}
              placeholder={'{"query": {"type": "string"}}'}
              onChange={(e) => setParamsValid(tryParseJson(e.target.value || '{}').ok)}
            />
          </Form.Item>
          <Form.Item
            name="tool_chain"
            label="工具链（JSON 数组）"
            validateStatus={chainValid ? undefined : 'error'}
            help={chainValid ? undefined : 'JSON 格式错误'}
          >
            <Input.TextArea
              rows={3}
              placeholder={'["search","summarize"]'}
              onChange={(e) => setChainValid(tryParseJson(e.target.value || '[]').ok)}
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={currentSkill ? `版本历史 - ${currentSkill.name}` : '版本历史'}
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        width={680}
      >
        <Table<SkillVersion>
          rowKey="id"
          size="small"
          loading={versionsLoading}
          dataSource={versions}
          pagination={false}
          columns={[
            { title: '版本', dataIndex: 'version', width: 80 },
            {
              title: '创建时间',
              dataIndex: 'created_at',
              width: 170,
              render: (v?: string) =>
                v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-',
            },
            {
              title: '快照',
              dataIndex: 'snapshot',
              render: (snap: Record<string, unknown>) => renderSnapshot(snap),
            },
          ]}
        />
      </Drawer>

      {/* Skill 测试抽屉 */}
      <Drawer
        title={testSkill ? `测试 Skill - ${testSkill.name}` : '测试 Skill'}
        open={testOpen}
        onClose={() => setTestOpen(false)}
        width={640}
      >
        <Typography.Paragraph type="secondary">
          填入参数值（替换 <code>{'{{key}}'}</code> 占位符），可选模型实际运行。
        </Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item label="参数（JSON）">
            <Input.TextArea
              value={testParams}
              onChange={(e) => setTestParams(e.target.value)}
              rows={4}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Form.Item>
          <Form.Item label="运行模型（可选，留空仅渲染模板）">
            <Select
              placeholder="选择模型实际运行"
              options={modelOptions}
              allowClear
              value={testModelId}
              onChange={setTestModelId}
            />
          </Form.Item>
          <Button type="primary" loading={testLoading} onClick={runTest}>
            运行测试
          </Button>
        </Form>
        {testResult && (
          <div style={{ marginTop: 16 }}>
            {testResult.error && (
              <Card size="small" style={{ marginBottom: 10 }} title="错误">
                <Typography.Text type="danger">{testResult.error}</Typography.Text>
              </Card>
            )}
            {testResult.rendered_prompt && (
              <Card size="small" style={{ marginBottom: 10 }} title="渲染后的 Prompt">
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, margin: 0 }}>
                  {testResult.rendered_prompt}
                </pre>
              </Card>
            )}
            {testResult.llm_response && (
              <Card size="small" title="LLM 响应">
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  {testResult.llm_response}
                </div>
              </Card>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
