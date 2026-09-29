import { useCallback, useEffect, useState } from 'react';
import {
  App,
  Button,
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
import dayjs from 'dayjs';
import { mcpApi } from '@/api/endpoints/mcp';
import type { McpServer, McpTool, ToolInvokeResult } from '@/types';
import type { ColumnsType } from 'antd/es/table';

interface FormValues {
  name: string;
  transport_type: 'stdio' | 'sse' | 'http';
  config: string;
  enabled: boolean;
}

const HEALTH_COLOR: Record<McpServer['health_status'], string> = {
  healthy: 'green',
  unhealthy: 'red',
  unknown: 'default',
};

const HEALTH_LABEL: Record<McpServer['health_status'], string> = {
  healthy: '健康',
  unhealthy: '异常',
  unknown: '未知',
};

const TRANSPORT_COLOR: Record<McpServer['transport_type'], string> = {
  stdio: 'blue',
  sse: 'cyan',
  http: 'geekblue',
};

const SAMPLE_CONFIG: Record<McpServer['transport_type'], string> = {
  stdio: JSON.stringify({ command: 'npx', args: ['-y', 'some-mcp-server'] }, null, 2),
  sse: JSON.stringify({ url: 'http://localhost:8080/sse' }, null, 2),
  http: JSON.stringify({ url: 'http://localhost:8080/mcp', headers: {} }, null, 2),
};

const emptyValues: FormValues = {
  name: '',
  transport_type: 'stdio',
  config: SAMPLE_CONFIG.stdio,
  enabled: true,
};

function tryParseJson(text: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

export default function McpServers() {
  const { message, modal } = App.useApp();
  const [list, setList] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [form] = Form.useForm<FormValues>();
  const [configValid, setConfigValid] = useState(true);
  const [saving, setSaving] = useState(false);

  const [toolsOpen, setToolsOpen] = useState(false);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [currentServer, setCurrentServer] = useState<McpServer | null>(null);
  const [toolSearch, setToolSearch] = useState('');

  const [invokeOpen, setInvokeOpen] = useState(false);
  const [invokeTool, setInvokeTool] = useState<McpTool | null>(null);
  const [invokeArgs, setInvokeArgs] = useState('{}');
  const [invokeArgsValid, setInvokeArgsValid] = useState(true);
  const [invokeResult, setInvokeResult] = useState<ToolInvokeResult | null>(null);
  const [invoking, setInvoking] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await mcpApi.listServers();
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
    setConfigValid(true);
    setOpen(true);
  };

  const openEdit = (s: McpServer) => {
    setEditing(s);
    form.setFieldsValue({
      name: s.name,
      transport_type: s.transport_type,
      config: s.config ? JSON.stringify(s.config, null, 2) : '{}',
      enabled: s.enabled,
    });
    setConfigValid(true);
    setOpen(true);
  };

  const handleSave = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const configRes = tryParseJson(values.config || '{}');
    if (!configRes.ok) {
      setConfigValid(false);
      message.error('config JSON 格式错误');
      return;
    }
    const body: Partial<McpServer> = {
      name: values.name,
      transport_type: values.transport_type,
      config: configRes.value as Record<string, unknown>,
      enabled: values.enabled,
    };
    try {
      setSaving(true);
      if (editing) {
        await mcpApi.updateServer(editing.id, body);
        message.success('更新成功');
      } else {
        await mcpApi.createServer(body);
        message.success('创建成功');
      }
      setOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (s: McpServer) => {
    modal.confirm({
      title: `删除 MCP 服务 "${s.name}"？`,
      content: '此操作不可撤销',
      okType: 'danger',
      onOk: async () => {
        await mcpApi.removeServer(s.id);
        message.success('已删除');
        await load();
      },
    });
  };

  const handleConnect = async (s: McpServer) => {
    try {
      const r = await mcpApi.connect(s.id);
      if (r.ok) {
        message.success('连接成功');
      } else {
        message.warning(`连接返回：${r.error || '未知状态'}`);
      }
      await load();
    } catch {
      // swallowed
    }
  };

  const handleDiscover = async (s: McpServer) => {
    try {
      const tools = await mcpApi.discover(s.id);
      message.success(`发现 ${tools.length} 个工具`);
      await load();
    } catch {
      // swallowed
    }
  };

  const openTools = async (s: McpServer) => {
    setCurrentServer(s);
    setToolsOpen(true);
    setToolsLoading(true);
    try {
      const list = await mcpApi.tools(s.id);
      setTools(list);
    } finally {
      setToolsLoading(false);
    }
  };

  const openInvoke = (t: McpTool) => {
    setInvokeTool(t);
    const sample: Record<string, unknown> = {};
    const schema = t.input_schema as { properties?: Record<string, unknown> };
    if (schema?.properties) {
      for (const k of Object.keys(schema.properties)) {
        sample[k] = '';
      }
    }
    setInvokeArgs(Object.keys(sample).length ? JSON.stringify(sample, null, 2) : '{}');
    setInvokeArgsValid(true);
    setInvokeResult(null);
    setInvokeOpen(true);
  };

  const handleInvoke = async () => {
    if (!invokeTool) return;
    const r = tryParseJson(invokeArgs || '{}');
    if (!r.ok) {
      setInvokeArgsValid(false);
      message.error('args JSON 格式错误');
      return;
    }
    try {
      setInvoking(true);
      const result = await mcpApi.invoke(invokeTool.id, r.value as Record<string, unknown>);
      setInvokeResult(result);
      if (result.ok) {
        message.success('调用成功');
      } else {
        message.error(result.error || '调用失败');
      }
    } finally {
      setInvoking(false);
    }
  };

  const toolColumns: ColumnsType<McpTool> = [
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: '入参 Schema',
      dataIndex: 'input_schema',
      render: (v: Record<string, unknown>) => (
        <pre
          style={{
            background: '#fafafa',
            padding: 6,
            margin: 0,
            fontSize: 11,
            maxHeight: 80,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {v ? JSON.stringify(v, null, 2) : '{}'}
        </pre>
      ),
    },
    {
      title: '操作',
      width: 90,
      render: (_, r) => <a onClick={() => openInvoke(r)}>调用</a>,
    },
  ];

  const columns: ColumnsType<McpServer> = [
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: '传输',
      dataIndex: 'transport_type',
      width: 90,
      render: (v: McpServer['transport_type']) => (
        <Tag color={TRANSPORT_COLOR[v]}>{v}</Tag>
      ),
    },
    {
      title: '健康状态',
      dataIndex: 'health_status',
      width: 110,
      render: (v: McpServer['health_status']) => (
        <Tag color={HEALTH_COLOR[v]}>{HEALTH_LABEL[v]}</Tag>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    { title: '工具数', dataIndex: 'tools_count', width: 80, align: 'center' as const },
    {
      title: '最近检查',
      dataIndex: 'last_check_at',
      width: 170,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      width: 280,
      render: (_, r) => (
        <Space size="small" wrap>
          <a onClick={() => handleConnect(r)}>连接</a>
          <a onClick={() => handleDiscover(r)}>发现</a>
          <a onClick={() => openTools(r)}>工具</a>
          <a onClick={() => openEdit(r)}>编辑</a>
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
            MCP 服务
          </Typography.Title>
        </Col>
        <Col>
          <Button type="primary" onClick={openCreate}>
            新建 MCP 服务
          </Button>
        </Col>
      </Row>

      <Table<McpServer>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title={editing ? '编辑 MCP 服务' : '新建 MCP 服务'}
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
              <Form.Item name="transport_type" label="传输类型" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'stdio', label: 'stdio' },
                    { value: 'sse', label: 'sse' },
                    { value: 'http', label: 'http' },
                  ]}
                  onChange={(v: McpServer['transport_type']) => {
                    form.setFieldValue('config', SAMPLE_CONFIG[v]);
                    setConfigValid(true);
                  }}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="config"
            label="配置（JSON）"
            validateStatus={configValid ? undefined : 'error'}
            help={configValid ? undefined : 'JSON 格式错误'}
          >
            <Input.TextArea
              rows={6}
              onChange={(e) =>
                setConfigValid(tryParseJson(e.target.value || '{}').ok)
              }
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={currentServer ? `工具 - ${currentServer.name}` : '工具'}
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        width={760}
      >
        <Input.Search
          placeholder="按工具名称或描述筛选"
          value={toolSearch}
          onChange={(e) => setToolSearch(e.target.value)}
          allowClear
          style={{ marginBottom: 12 }}
        />
        <Table<McpTool>
          rowKey="id"
          size="small"
          loading={toolsLoading}
          columns={toolColumns}
          dataSource={tools.filter(
            (t) =>
              t.name.toLowerCase().includes(toolSearch.toLowerCase()) ||
              (t.description || '').toLowerCase().includes(toolSearch.toLowerCase()),
          )}
          pagination={false}
        />
      </Drawer>

      <Modal
        title={invokeTool ? `调用工具 - ${invokeTool.name}` : '调用工具'}
        open={invokeOpen}
        onCancel={() => setInvokeOpen(false)}
        footer={[
          <Button key="close" onClick={() => setInvokeOpen(false)}>
            关闭
          </Button>,
          <Button
            key="invoke"
            type="primary"
            loading={invoking}
            onClick={handleInvoke}
          >
            调用
          </Button>,
        ]}
        width={640}
      >
        <Typography.Text strong>输入参数（JSON）</Typography.Text>
        <Input.TextArea
          rows={6}
          value={invokeArgs}
          onChange={(e) => {
            setInvokeArgs(e.target.value);
            setInvokeArgsValid(tryParseJson(e.target.value || '{}').ok);
          }}
          style={{ marginTop: 4, borderColor: invokeArgsValid ? undefined : '#ff4d4f' }}
        />
        {!invokeArgsValid && (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            JSON 格式错误
          </Typography.Text>
        )}
        {invokeResult && (
          <div style={{ marginTop: 12 }}>
            <Typography.Text strong>结果：</Typography.Text>
            <pre
              style={{
                background: '#fafafa',
                padding: 8,
                marginTop: 4,
                maxHeight: 240,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: 12,
              }}
            >
              {JSON.stringify(invokeResult, null, 2)}
            </pre>
          </div>
        )}
      </Modal>
    </div>
  );
}
