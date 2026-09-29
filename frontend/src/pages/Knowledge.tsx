import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { knowledgeApi } from '@/api/endpoints/knowledge';
import { providerApi } from '@/api/endpoints/provider';
import type { KnowledgeBase, Provider } from '@/types';
import type { ColumnsType } from 'antd/es/table';

interface FormValues {
  name: string;
  description: string;
  embedding_provider_id: number | null;
  chunk_config: string;
}

const DEFAULT_CHUNK = JSON.stringify({ chunk_size: 500, overlap: 50 }, null, 2);

const emptyValues: FormValues = {
  name: '',
  description: '',
  embedding_provider_id: null,
  chunk_config: DEFAULT_CHUNK,
};

function tryParseJson(text: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

function chunkSummary(cfg: Record<string, unknown>): string {
  if (!cfg || typeof cfg !== 'object') return '-';
  const parts: string[] = [];
  if ('chunk_size' in cfg) parts.push(`size=${cfg.chunk_size}`);
  if ('overlap' in cfg) parts.push(`overlap=${cfg.overlap}`);
  return parts.length ? parts.join(' / ') : JSON.stringify(cfg);
}

export default function Knowledge() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [list, setList] = useState<KnowledgeBase[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [chunkValid, setChunkValid] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [data, ps] = await Promise.all([knowledgeApi.list(), providerApi.list()]);
      setList(data);
      setProviders(ps);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const embeddingProviders = useMemo(
    () => providers.filter((p) => p.kind === 'embedding' || p.kind === 'both'),
    [providers],
  );

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue(emptyValues);
    setChunkValid(true);
    setOpen(true);
  };

  const handleSave = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const chunkRes = tryParseJson(values.chunk_config || DEFAULT_CHUNK);
    if (!chunkRes.ok) {
      setChunkValid(false);
      message.error('chunk_config JSON 格式错误');
      return;
    }
    const body: Partial<KnowledgeBase> = {
      name: values.name,
      description: values.description,
      embedding_provider_id: values.embedding_provider_id,
      chunk_config: chunkRes.value as Record<string, unknown>,
    };
    try {
      setSaving(true);
      await knowledgeApi.create(body);
      message.success('创建成功');
      setOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (kb: KnowledgeBase) => {
    modal.confirm({
      title: `删除知识库 "${kb.name}"？`,
      content: '所有文档与索引将一并删除',
      okType: 'danger',
      onOk: async () => {
        await knowledgeApi.remove(kb.id);
        message.success('已删除');
        await load();
      },
    });
  };

  const columns: ColumnsType<KnowledgeBase> = [
    { title: '名称', dataIndex: 'name', width: 200 },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: 'Embedding Provider',
      dataIndex: 'embedding_provider_id',
      width: 180,
      render: (v?: number | null) =>
        v ? <Tag color="purple">{v}</Tag> : <Tag>本地默认</Tag>,
    },
    { title: '文档数', dataIndex: 'docs_count', width: 90, align: 'center' as const },
    {
      title: 'Chunk 配置',
      dataIndex: 'chunk_config',
      width: 160,
      render: (cfg: Record<string, unknown>) => chunkSummary(cfg),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      width: 160,
      render: (_, r) => (
        <Space size="small">
          <a onClick={() => navigate(`/knowledge/${r.id}`)}>进入</a>
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
            知识库
          </Typography.Title>
        </Col>
        <Col>
          <Button type="primary" onClick={openCreate}>
            新建知识库
          </Button>
        </Col>
      </Row>

      <Table<KnowledgeBase>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={{ pageSize: 10 }}
        onRow={(r) => ({
          onClick: () => navigate(`/knowledge/${r.id}`),
          style: { cursor: 'pointer' },
        })}
      />

      <Modal
        title="新建知识库"
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
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="embedding_provider_id" label="Embedding Provider">
            <Select
              allowClear
              placeholder="可选；不选则使用本地默认"
              options={embeddingProviders.map((p) => ({
                value: p.id,
                label: `${p.name} (${p.kind})`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="chunk_config"
            label="Chunk 配置（JSON）"
            validateStatus={chunkValid ? undefined : 'error'}
            help={chunkValid ? undefined : 'JSON 格式错误'}
          >
            <Input.TextArea
              rows={4}
              onChange={(e) => setChunkValid(tryParseJson(e.target.value || '{}').ok)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
