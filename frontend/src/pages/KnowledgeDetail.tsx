import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  List,
  Progress,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { knowledgeApi } from '@/api/endpoints/knowledge';
import type { ChunkHit, ChunkRead, KbDocument, KnowledgeBase, SearchResult } from '@/types';
import type { ColumnsType } from 'antd/es/table';

const DOC_STATUS_COLOR: Record<string, string> = {
  uploaded: 'default',
  parsed: 'blue',
  chunked: 'cyan',
  embedded: 'green',
  failed: 'red',
};

function tryParseJson(text: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

export default function KnowledgeDetail() {
  const { id } = useParams<{ id: string }>();
  const kbId = Number(id);
  const { message, modal } = App.useApp();

  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('documents');

  // documents
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  // search
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(4);
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<ChunkHit[]>([]);

  // settings
  const [chunkText, setChunkText] = useState('');
  const [description, setDescription] = useState('');
  const [chunkValid, setChunkValid] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  // chunk 预览
  const [chunksOpen, setChunksOpen] = useState(false);
  const [chunksDoc, setChunksDoc] = useState<KbDocument | null>(null);
  const [chunks, setChunks] = useState<ChunkRead[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);

  const loadKb = useCallback(async () => {
    try {
      setLoading(true);
      const data = await knowledgeApi.get(kbId);
      setKb(data);
      const chunkStr = data.chunk_config
        ? JSON.stringify(data.chunk_config, null, 2)
        : '{}';
      setChunkText(chunkStr);
      setDescription(data.description || '');
      setChunkValid(true);
    } finally {
      setLoading(false);
    }
  }, [kbId]);

  const loadDocs = useCallback(async () => {
    try {
      setDocsLoading(true);
      const list = await knowledgeApi.documents(kbId);
      setDocs(list);
    } finally {
      setDocsLoading(false);
    }
  }, [kbId]);

  useEffect(() => {
    loadKb();
    loadDocs();
  }, [loadKb, loadDocs]);

  const handleUpload = async (file: File) => {
    try {
      setUploading(true);
      await knowledgeApi.uploadDocument(kbId, file);
      message.success(`已上传 ${file.name}，正在后台处理`);
      await loadDocs();
    } finally {
      setUploading(false);
    }
    return false; // 阻止 antd 默认上传
  };

  const handleDeleteDoc = (doc: KbDocument) => {
    modal.confirm({
      title: `删除文档 "${doc.filename}"？`,
      content: '相关向量与 chunk 将一并删除',
      okType: 'danger',
      onOk: async () => {
        await knowledgeApi.removeDocument(kbId, doc.id);
        message.success('已删除');
        await loadDocs();
      },
    });
  };

  const handleSearch = async () => {
    if (!query.trim()) {
      message.warning('请输入检索文本');
      return;
    }
    try {
      setSearching(true);
      const r: SearchResult = await knowledgeApi.search(kbId, query, topK);
      setHits(r.hits || []);
      if (!r.hits || r.hits.length === 0) {
        message.info('无匹配结果');
      }
    } finally {
      setSearching(false);
    }
  };

  const openChunks = async (doc: KbDocument) => {
    setChunksDoc(doc);
    setChunksOpen(true);
    setChunksLoading(true);
    try {
      setChunks(await knowledgeApi.chunks(kbId, doc.id));
    } finally {
      setChunksLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    const r = tryParseJson(chunkText || '{}');
    if (!r.ok) {
      setChunkValid(false);
      message.error('chunk_config JSON 格式错误');
      return;
    }
    try {
      setSavingSettings(true);
      await knowledgeApi.update(kbId, {
        description,
        chunk_config: r.value as Record<string, unknown>,
      });
      message.success('已保存');
      await loadKb();
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!kb) {
    return <Alert type="warning" message={`知识库 #${kbId} 不存在`} />;
  }

  const docColumns: ColumnsType<KbDocument> = [
    { title: '文件名', dataIndex: 'filename', width: 200, ellipsis: true },
    { title: 'MIME', dataIndex: 'mime', width: 140 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: string) => (
        <Tag color={DOC_STATUS_COLOR[v] || 'default'}>{v}</Tag>
      ),
    },
    { title: 'Chunks', dataIndex: 'chunks_count', width: 80, align: 'center' as const },
    {
      title: '错误',
      dataIndex: 'error',
      ellipsis: true,
      render: (v: string) => (v ? <Typography.Text type="danger">{v}</Typography.Text> : '-'),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      width: 130,
      render: (_, r) => (
        <Space size="small">
          <a onClick={() => openChunks(r)}>查看分块</a>
          <a style={{ color: '#ff4d4f' }} onClick={() => handleDeleteDoc(r)}>
            删除
          </a>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card title={`知识库 - ${kb.name}`} style={{ marginBottom: 12 }}>
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="名称">{kb.name}</Descriptions.Item>
          <Descriptions.Item label="文档数">{kb.docs_count}</Descriptions.Item>
          <Descriptions.Item label="描述" span={2}>
            {kb.description || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Embedding Provider">
            {kb.embedding_provider_id ? (
              <Tag color="purple">#{kb.embedding_provider_id}</Tag>
            ) : (
              <Tag>本地默认</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {kb.created_at ? dayjs(kb.created_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Chunk 配置" span={2}>
            <pre
              style={{
                background: '#fafafa',
                padding: 8,
                margin: 0,
                fontSize: 12,
                whiteSpace: 'pre-wrap',
              }}
            >
              {JSON.stringify(kb.chunk_config, null, 2)}
            </pre>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'documents',
            label: '文档',
            children: (
              <div>
                <Upload.Dragger
                  accept=".pdf,.docx,.doc,.txt,.md,.csv,.html,.json"
                  multiple={false}
                  showUploadList={false}
                  beforeUpload={(file) => {
                    handleUpload(file as unknown as File);
                    return false;
                  }}
                  disabled={uploading}
                  style={{ marginBottom: 12 }}
                >
                  {uploading ? (
                    <Typography.Text>上传中…</Typography.Text>
                  ) : (
                    <>
                      <p style={{ margin: 0 }}>点击或拖拽文件到此区域上传</p>
                      <p style={{ margin: 0, fontSize: 12, color: '#999' }}>
                        支持 PDF / DOCX / TXT / MD / CSV / HTML / JSON
                      </p>
                    </>
                  )}
                </Upload.Dragger>
                <Table<KbDocument>
                  rowKey="id"
                  size="small"
                  loading={docsLoading}
                  columns={docColumns}
                  dataSource={docs}
                  pagination={{ pageSize: 10 }}
                />
              </div>
            ),
          },
          {
            key: 'search',
            label: '检索测试',
            children: (
              <div>
                <Input.TextArea
                  rows={4}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="输入检索文本"
                />
                <Space style={{ marginTop: 8 }}>
                  <InputNumber
                    min={1}
                    max={20}
                    value={topK}
                    onChange={(v) => setTopK(typeof v === 'number' ? v : 4)}
                    addonBefore="top_k"
                  />
                  <Button type="primary" loading={searching} onClick={handleSearch}>
                    检索
                  </Button>
                </Space>
                <List
                  style={{ marginTop: 12 }}
                  bordered
                  dataSource={hits}
                  locale={{ emptyText: '暂无结果' }}
                  renderItem={(hit, idx) => (
                    <List.Item>
                      <div style={{ width: '100%' }}>
                        <Space style={{ marginBottom: 6 }} wrap>
                          <Tag color="blue">#{idx + 1}</Tag>
                          <Tag color="green">score: {hit.score.toFixed(4)}</Tag>
                          <Tag>doc_id: {hit.doc_id}</Tag>
                          <Tag>chunk_id: {hit.chunk_id}</Tag>
                        </Space>
                        <Progress
                          percent={Math.min(100, Math.round(hit.score * 100))}
                          size="small"
                          status="active"
                          style={{ marginBottom: 6 }}
                        />
                        <pre
                          style={{
                            background: '#fafafa',
                            padding: 8,
                            margin: 0,
                            fontSize: 12,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                          }}
                        >
                          {hit.text}
                        </pre>
                      </div>
                    </List.Item>
                  )}
                />
              </div>
            ),
          },
          {
            key: 'settings',
            label: '设置',
            children: (
              <div style={{ maxWidth: 720 }}>
                <Form layout="vertical">
                  <Form.Item label="描述">
                    <Input.TextArea
                      rows={2}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Form.Item>
                  <Form.Item
                    label="Chunk 配置（JSON）"
                    validateStatus={chunkValid ? undefined : 'error'}
                    help={chunkValid ? undefined : 'JSON 格式错误'}
                  >
                    <Input.TextArea
                      rows={6}
                      value={chunkText}
                      onChange={(e) => {
                        setChunkText(e.target.value);
                        setChunkValid(tryParseJson(e.target.value || '{}').ok);
                      }}
                    />
                  </Form.Item>
                  <Button
                    type="primary"
                    loading={savingSettings}
                    onClick={handleSaveSettings}
                  >
                    保存
                  </Button>
                </Form>
              </div>
            ),
          },
        ]}
      />

      {/* Chunk 预览抽屉 */}
      <Drawer
        title={chunksDoc ? `分块预览 - ${chunksDoc.filename}` : '分块预览'}
        open={chunksOpen}
        onClose={() => setChunksOpen(false)}
        width={720}
      >
        <Typography.Paragraph type="secondary">
          展示该文档切分后的所有 chunk 内容（仅前 50 条）。
        </Typography.Paragraph>
        <List
          loading={chunksLoading}
          bordered
          dataSource={chunks}
          locale={{ emptyText: '暂无分块' }}
          renderItem={(c, idx) => (
            <List.Item>
              <div style={{ width: '100%' }}>
                <Space style={{ marginBottom: 6 }}>
                  <Tag color="geekblue">#{idx + 1}</Tag>
                  <Tag>chunk_id: {c.id}</Tag>
                  <Tag>{c.text.length} 字</Tag>
                </Space>
                <pre
                  style={{
                    background: '#fafafa',
                    padding: 8,
                    margin: 0,
                    fontSize: 13,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    borderRadius: 6,
                  }}
                >
                  {c.text}
                </pre>
              </div>
            </List.Item>
          )}
        />
      </Drawer>
    </div>
  );
}
