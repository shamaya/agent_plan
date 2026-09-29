import { useEffect, useState, useCallback } from 'react';
import {
  App,
  Button,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { providerApi } from '@/api/endpoints/provider';
import type { Model, Provider, ProviderTestResult } from '@/types';
import type { ColumnsType } from 'antd/es/table';

interface FormValues {
  name: string;
  kind: 'chat' | 'embedding' | 'both';
  base_url: string;
  api_key?: string;
  headers?: string;
  enabled: boolean;
}

const KIND_COLOR: Record<Provider['kind'], string> = {
  chat: 'blue',
  embedding: 'purple',
  both: 'magenta',
};

const emptyValues: FormValues = {
  name: '',
  kind: 'chat',
  base_url: '',
  api_key: '',
  headers: '{}',
  enabled: true,
};

function tryParseJson(text: string): { ok: boolean; value: unknown } {
  try {
    const v = JSON.parse(text);
    return { ok: true, value: v };
  } catch {
    return { ok: false, value: null };
  }
}

export default function Providers() {
  const { message, modal } = App.useApp();
  const [list, setList] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [form] = Form.useForm<FormValues>();
  const [headersValid, setHeadersValid] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modelsOpen, setModelsOpen] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<Provider | null>(null);
  const [bulkText, setBulkText] = useState('');
  const [bulkCtx, setBulkCtx] = useState<number>(4096);
  const [bulkMax, setBulkMax] = useState<number>(1024);

  const [testOpen, setTestOpen] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await providerApi.list();
      setList(data);
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
    setHeadersValid(true);
    setOpen(true);
  };

  const openEdit = (p: Provider) => {
    setEditing(p);
    form.setFieldsValue({
      name: p.name,
      kind: p.kind,
      base_url: p.base_url,
      api_key: '',
      headers: p.headers ? JSON.stringify(p.headers, null, 2) : '{}',
      enabled: p.enabled,
    });
    setHeadersValid(true);
    setOpen(true);
  };

  const handleSave = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const headersRes = tryParseJson(values.headers || '{}');
    if (!headersRes.ok) {
      setHeadersValid(false);
      message.error('headers JSON 格式错误');
      return;
    }
    const body: Partial<Provider> & { api_key?: string } = {
      name: values.name,
      kind: values.kind,
      base_url: values.base_url,
      headers: headersRes.value as Record<string, unknown>,
      enabled: values.enabled,
    };
    if (values.api_key && values.api_key.trim() !== '') {
      body.api_key = values.api_key;
    }
    try {
      setSaving(true);
      if (editing) {
        await providerApi.update(editing.id, body);
        message.success('更新成功');
      } else {
        await providerApi.create(body);
        message.success('创建成功');
      }
      setOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (p: Provider) => {
    modal.confirm({
      title: `删除 Provider "${p.name}"？`,
      content: '此操作不可撤销',
      okType: 'danger',
      onOk: async () => {
        await providerApi.remove(p.id);
        message.success('已删除');
        await load();
      },
    });
  };

  const handleTest = async (p: Provider) => {
    setTestLoading(true);
    setTestOpen(true);
    setTestResult(null);
    try {
      const r = await providerApi.test(p.id);
      setTestResult(r);
    } finally {
      setTestLoading(false);
    }
  };

  const openModels = async (p: Provider) => {
    setCurrentProvider(p);
    setModelsOpen(true);
    setBulkText('');
    setBulkCtx(4096);
    setBulkMax(1024);
    setModelsLoading(true);
    try {
      const list = await providerApi.models(p.id);
      setModels(list);
    } finally {
      setModelsLoading(false);
    }
  };

  const handleUpsert = async () => {
    if (!currentProvider) return;
    const names = bulkText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) {
      message.warning('请输入至少一个 model_name');
      return;
    }
    const models: Partial<Model>[] = names.map((n) => ({
      model_name: n,
      context_window: bulkCtx,
      max_tokens: bulkMax,
    }));
    try {
      setSaving(true);
      await providerApi.upsertModels(currentProvider.id, models);
      message.success(`已 upsert ${models.length} 个模型`);
      const list = await providerApi.models(currentProvider.id);
      setModels(list);
      setBulkText('');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleModel = async (m: Model, checked: boolean) => {
    try {
      await providerApi.upsertModels(currentProvider!.id, [
        { id: m.id, model_name: m.model_name, enabled: checked },
      ]);
      const list = await providerApi.models(currentProvider!.id);
      setModels(list);
    } catch {
      // swallowed
    }
  };

  const setDefaultModel = async (m: Model) => {
    try {
      await providerApi.upsertModels(currentProvider!.id, [
        { id: m.id, model_name: m.model_name, is_default: true },
      ]);
      message.success('已设为默认');
      const list = await providerApi.models(currentProvider!.id);
      setModels(list);
    } catch {
      // swallowed
    }
  };

  const columns: ColumnsType<Provider> = [
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: '类型',
      dataIndex: 'kind',
      width: 90,
      render: (v: Provider['kind']) => <Tag color={KIND_COLOR[v]}>{v}</Tag>,
    },
    { title: 'Base URL', dataIndex: 'base_url', ellipsis: true },
    {
      title: '密钥',
      dataIndex: 'has_key',
      width: 110,
      render: (_, r) => (r.has_key ? <Tag color="green">已配置</Tag> : <Tag>未配置</Tag>),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    { title: '模型数', dataIndex: 'model_count', width: 80, align: 'center' as const },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      width: 280,
      render: (_, r) => (
        <Space size="small" wrap>
          <a onClick={() => openEdit(r)}>编辑</a>
          <a onClick={() => handleTest(r)}>测试</a>
          <a onClick={() => openModels(r)}>模型</a>
          <a style={{ color: '#ff4d4f' }} onClick={() => handleDelete(r)}>
            删除
          </a>
        </Space>
      ),
    },
  ];

  const modelColumns: ColumnsType<Model> = [
    { title: '模型名', dataIndex: 'model_name' },
    { title: '上下文窗口', dataIndex: 'context_window', width: 120 },
    { title: 'Max Tokens', dataIndex: 'max_tokens', width: 120 },
    {
      title: '默认',
      dataIndex: 'is_default',
      width: 80,
      render: (v: boolean, r) =>
        v ? (
          <Tag color="gold">默认</Tag>
        ) : (
          <a onClick={() => setDefaultModel(r)}>设为默认</a>
        ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (v: boolean, r) => (
        <Switch size="small" checked={v} onChange={(c) => toggleModel(r, c)} />
      ),
    },
  ];

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
        <Col>
          <Typography.Title level={4} style={{ margin: 0 }}>
            LLM Provider
          </Typography.Title>
        </Col>
        <Col>
          <Button type="primary" onClick={openCreate}>
            新建 Provider
          </Button>
        </Col>
      </Row>

      <Table<Provider>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title={editing ? '编辑 Provider' : '新建 Provider'}
        open={open}
        onOk={handleSave}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        destroyOnClose
        width={640}
      >
        <Form<FormValues>
          form={form}
          layout="vertical"
          initialValues={emptyValues}
          preserve={false}
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="如 openai、azure-openai" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="kind" label="类型" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'chat', label: 'chat' },
                    { value: 'embedding', label: 'embedding' },
                    { value: 'both', label: 'both' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item
                name="base_url"
                label="Base URL"
                rules={[{ required: true, message: '请输入 Base URL' }]}
              >
                <Input placeholder="https://api.openai.com/v1" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="api_key"
            label="API Key"
            tooltip={editing ? '留空表示不修改原密钥' : '可选'}
          >
            <Input.Password placeholder="sk-..." />
          </Form.Item>
          <Form.Item
            name="headers"
            label="自定义 Headers（JSON）"
            validateStatus={headersValid ? undefined : 'error'}
            help={headersValid ? undefined : 'JSON 格式错误'}
          >
            <Input.TextArea
              rows={4}
              placeholder={'{"X-Org": "abc"}'}
              onChange={(e) => {
                const r = tryParseJson(e.target.value || '{}');
                setHeadersValid(r.ok);
              }}
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Provider 连接测试"
        open={testOpen}
        onCancel={() => setTestOpen(false)}
        footer={null}
      >
        {testLoading ? (
          <Typography.Text>正在测试连接…</Typography.Text>
        ) : testResult ? (
          <div>
            {testResult.ok ? (
              <Tag color="green">连接成功</Tag>
            ) : (
              <Tag color="red">连接失败</Tag>
            )}
            {testResult.error && (
              <Typography.Paragraph type="danger" style={{ marginTop: 8 }}>
                {testResult.error}
              </Typography.Paragraph>
            )}
            {testResult.models?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Typography.Text strong>可用模型：</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  {testResult.models.map((m) => (
                    <Tag key={m} color="blue">
                      {m}
                    </Tag>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <Typography.Text type="secondary">无结果</Typography.Text>
        )}
      </Modal>

      <Drawer
        title={currentProvider ? `模型 - ${currentProvider.name}` : '模型'}
        open={modelsOpen}
        onClose={() => setModelsOpen(false)}
        width={760}
      >
        <Table<Model>
          rowKey="id"
          size="small"
          loading={modelsLoading}
          columns={modelColumns}
          dataSource={models}
          pagination={false}
        />
        <Typography.Paragraph style={{ marginTop: 16 }} type="secondary">
          批量 upsert 模型：每行一个 model_name，统一使用下方 context_window / max_tokens。
        </Typography.Paragraph>
        <Input.TextArea
          rows={5}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={'gpt-4o\ngpt-4o-mini'}
        />
        <Row gutter={8} style={{ marginTop: 8 }}>
          <Col span={6}>
            <InputNumber
              style={{ width: '100%' }}
              addonBefore="ctx"
              min={0}
              value={bulkCtx}
              onChange={(v) => setBulkCtx(typeof v === 'number' ? v : 0)}
            />
          </Col>
          <Col span={6}>
            <InputNumber
              style={{ width: '100%' }}
              addonBefore="max"
              min={0}
              value={bulkMax}
              onChange={(v) => setBulkMax(typeof v === 'number' ? v : 0)}
            />
          </Col>
          <Col span={12}>
            <Button type="primary" loading={saving} onClick={handleUpsert} block>
              批量 Upsert
            </Button>
          </Col>
        </Row>
      </Drawer>
    </div>
  );
}
