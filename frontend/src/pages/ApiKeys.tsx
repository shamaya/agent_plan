import { useCallback, useEffect, useState } from 'react';
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
import { CopyOutlined, KeyOutlined, PlusOutlined, CodeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { apikeyApi } from '@/api/endpoints/apikey';
import { agentApi } from '@/api/endpoints/agent';
import type { ApiKey, ApiKeyCreated, Agent } from '@/types';
import type { ColumnsType } from 'antd/es/table';

interface FormValues {
  name: string;
  allowed_agent_ids: number[];
  expires_at?: string;
}

export default function ApiKeys() {
  const { message, modal } = App.useApp();
  const [list, setList] = useState<ApiKey[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  // 创建成功后展示明文 key
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null);
  // 代码生成器
  const [genOpen, setGenOpen] = useState(false);
  const [genLang, setGenLang] = useState<'curl' | 'python' | 'javascript'>('curl');
  const [genAgentId, setGenAgentId] = useState<number | undefined>();
  const [genMessage, setGenMessage] = useState('你好，请介绍你自己');

  const generateCode = (): string => {
    const agentId = genAgentId ?? agents[0]?.id;
    const baseUrl = window.location.origin;
    const code: Record<string, string> = {
      curl: `curl -X POST '${baseUrl}/api/v1/agents/${agentId}/invoke' \\
  -H 'X-API-Key: <你的 API Key>' \\
  -H 'Content-Type: application/json' \\
  -d '{"message": "${genMessage.replace(/"/g, '\\"')}"}'`,
      python: `import requests

url = "${baseUrl}/api/v1/agents/${agentId}/invoke"
headers = {
    "X-API-Key": "<你的 API Key>",
    "Content-Type": "application/json",
}
payload = {
    "message": "${genMessage}",
    # "variables": {"lang": "中文"},      # 可选
    # "conversation_id": 8,                # 可选，续接对话
    # "callback_url": "https://...",       # 可选，异步 Webhook
}
resp = requests.post(url, headers=headers, json=payload, timeout=300)
print(resp.json())`,
      javascript: `const baseUrl = "${baseUrl}";
const agentId = ${agentId};

const resp = await fetch(\`\${baseUrl}/api/v1/agents/\${agentId}/invoke\`, {
  method: "POST",
  headers: {
    "X-API-Key": "<你的 API Key>",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    message: "${genMessage}",
    // variables: { lang: "中文" },   // 可选
    // conversation_id: 8,             // 可选，续接对话
    // callback_url: "https://...",    // 可选，异步 Webhook
  }),
});
const data = await resp.json();
console.log(data);`,
    };
    return code[genLang];
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [data, ag] = await Promise.all([apikeyApi.list(), agentApi.list()]);
      setList(data);
      setAgents(ag);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setCreatedKey(null);
    form.resetFields();
    form.setFieldsValue({ name: '', allowed_agent_ids: [] });
    setOpen(true);
  };

  const openEdit = (k: ApiKey) => {
    setEditing(k);
    setCreatedKey(null);
    form.setFieldsValue({
      name: k.name,
      allowed_agent_ids: k.allowed_agent_ids || [],
    });
    setOpen(true);
  };

  const handleSave = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      setSaving(true);
      if (editing) {
        await apikeyApi.update(editing.id, {
          name: values.name,
          allowed_agent_ids: values.allowed_agent_ids,
        });
        message.success('更新成功');
        setOpen(false);
      } else {
        const created = await apikeyApi.create({
          name: values.name,
          allowed_agent_ids: values.allowed_agent_ids,
          expires_at: values.expires_at || null,
        });
        setCreatedKey(created);
        message.success('创建成功，请立即复制保存明文 Key');
      }
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (k: ApiKey) => {
    modal.confirm({
      title: `删除 API Key "${k.name}"？`,
      content: '此操作不可撤销，第三方将立即无法调用',
      okType: 'danger',
      onOk: async () => {
        await apikeyApi.remove(k.id);
        message.success('已删除');
        await load();
      },
    });
  };

  const handleToggle = async (k: ApiKey, enabled: boolean) => {
    try {
      await apikeyApi.update(k.id, { enabled });
      message.success(enabled ? '已启用' : '已停用');
      await load();
    } catch {
      // swallowed
    }
  };

  const copyKey = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制到剪贴板');
    } catch {
      message.error('复制失败，请手动选择复制');
    }
  };

  const columns: ColumnsType<ApiKey> = [
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: 'Key 前缀',
      dataIndex: 'key_prefix',
      width: 130,
      render: (v: string) => (
        <Typography.Text code copyable={false}>
          {v}••••
        </Typography.Text>
      ),
    },
    {
      title: '授权 Agent',
      dataIndex: 'allowed_agent_ids',
      width: 160,
      render: (ids: number[]) =>
        !ids || ids.length === 0 ? (
          <Tag color="green">全部</Tag>
        ) : (
          <Space size={2} wrap>
            {ids.map((id) => {
              const a = agents.find((x) => x.id === id);
              return <Tag key={id}>{a ? a.name : `#${id}`}</Tag>;
            })}
          </Space>
        ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 80,
      render: (v: boolean, r) => (
        <Switch size="small" checked={v} onChange={(c) => handleToggle(r, c)} />
      ),
    },
    {
      title: '调用次数',
      dataIndex: 'call_count',
      width: 90,
      align: 'center' as const,
    },
    {
      title: '最后使用',
      dataIndex: 'last_used_at',
      width: 170,
      render: (v?: string) => (v ? dayjs(v).format('MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
    },
    {
      title: '操作',
      width: 160,
      render: (_, r) => (
        <Space size="small">
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
            第三方接入
          </Typography.Title>
        </Col>
        <Col>
          <Space>
            <Button icon={<CodeOutlined />} onClick={() => setGenOpen(true)}>
              代码生成器
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建 API Key
            </Button>
          </Space>
        </Col>
      </Row>

      <Table<ApiKey>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={{ pageSize: 10 }}
      />

      <Card
        size="small"
        title="调用文档"
        style={{ marginTop: 16, background: '#fafafa' }}
      >
        <Typography.Paragraph>
          第三方通过如下 REST 端点调用智能体，请求头携带{' '}
          <Typography.Text code>X-API-Key</Typography.Text>：
        </Typography.Paragraph>
        <pre style={{ background: '#f5f5f5', padding: 12, fontSize: 13, overflow: 'auto' }}>
{`POST /api/v1/agents/{agent_id}/invoke
Header: X-API-Key: <你的 key>
Content-Type: application/json

Body:
{
  "message": "用户问题",
  "variables": { "lang": "中文" },          // 可选，替换 system_prompt 中的 {{lang}}
  "conversation_id": 8,                     // 可选，续接已有对话
  "callback_url": "https://your.com/cb",    // 可选，带此字段则转异步 Webhook
  "timeout": 60                              // 可选，秒，上限 300
}

同步返回:
{ "content": "...", "tool_calls": [...], "conversation_id": 8, "error": "" }

异步（带 callback_url）立即返回:
{ "task_id": "...", "status": "processing", "conversation_id": 8 }
# 完成后结果会 POST 到 callback_url`}
        </pre>
      </Card>

      <Modal
        title={editing ? '编辑 API Key' : '新建 API Key'}
        open={open}
        onOk={handleSave}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText={editing ? '保存' : '创建'}
        width={520}
      >
        {createdKey ? (
          <div style={{ padding: '8px 0' }}>
            <Typography.Paragraph type="warning" strong>
              以下明文 Key 仅显示一次，请立即复制保存，关闭后无法再查看！
            </Typography.Paragraph>
            <Input.Group compact>
              <Input
                value={createdKey.key}
                readOnly
                style={{ width: 'calc(100% - 90px)' }}
              />
              <Button
                icon={<CopyOutlined />}
                onClick={() => copyKey(createdKey.key)}
                style={{ width: 90 }}
              >
                复制
              </Button>
            </Input.Group>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
              Key 前缀：<Typography.Text code>{createdKey.key_prefix}</Typography.Text>
              ，授权 Agent：
              {createdKey.allowed_agent_ids.length === 0
                ? '全部'
                : createdKey.allowed_agent_ids.join(', ')}
            </Typography.Paragraph>
            <Button type="primary" block onClick={() => setOpen(false)}>
              我已保存，关闭
            </Button>
          </div>
        ) : (
          <Form form={form} layout="vertical">
            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true, message: '请输入名称' }]}
            >
              <Input placeholder="如：客户A-订单助手" />
            </Form.Item>
            <Form.Item name="allowed_agent_ids" label="授权 Agent（留空=全部）">
              <Select
                mode="multiple"
                placeholder="选择可调用的 Agent，留空表示全部"
                options={agents.map((a) => ({ label: a.name, value: a.id }))}
                optionFilterProp="label"
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 代码生成器抽屉 */}
      <Drawer
        title="API 调用代码生成器"
        open={genOpen}
        onClose={() => setGenOpen(false)}
        width={680}
      >
        <Typography.Paragraph type="secondary">
          选择语言与 Agent，生成可直接运行的调用代码。
        </Typography.Paragraph>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space>
            <Select
              value={genLang}
              onChange={(v) => setGenLang(v)}
              style={{ width: 140 }}
              options={[
                { label: 'cURL', value: 'curl' },
                { label: 'Python', value: 'python' },
                { label: 'JavaScript', value: 'javascript' },
              ]}
            />
            <Select
              placeholder="选择 Agent"
              value={genAgentId}
              onChange={(v) => setGenAgentId(v)}
              style={{ width: 220 }}
              options={agents.map((a) => ({ label: a.name, value: a.id }))}
            />
          </Space>
          <Input.TextArea
            value={genMessage}
            onChange={(e) => setGenMessage(e.target.value)}
            rows={2}
            placeholder="测试消息"
          />
          <div>
            <Button
              icon={<CopyOutlined />}
              onClick={() => copyKey(generateCode())}
              style={{ marginBottom: 8 }}
            >
              复制代码
            </Button>
          </div>
          <pre
            style={{
              background: '#1e1e1e',
              color: '#d4d4d4',
              padding: 16,
              margin: 0,
              fontSize: 13,
              borderRadius: 8,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              maxHeight: '60vh',
            }}
          >
            {generateCode()}
          </pre>
        </Space>
      </Drawer>
    </div>
  );
}
