import { useCallback, useEffect, useRef, useState } from 'react';
import { Input, Space, Table, Tag, Typography, Tabs, Card, Statistic, Button, Empty } from 'antd';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { traceApi } from '@/api/endpoints/trace';
import type { Trace, ErrorGroup, TokenStats } from '@/types';
import type { ColumnsType } from 'antd/es/table';

const STEP_TYPE_LABEL: Record<Trace['step_type'], string> = {
  llm_call: 'LLM 调用',
  tool_call: '工具调用',
  retrieval: '检索',
  compression: '上下文压缩',
  constraint_check: '约束检查',
  routing: '智能路由',
};

const STATUS_COLOR: Record<Trace['status'], string> = {
  ok: 'green',
  error: 'red',
};

export default function Traces() {
  const navigate = useNavigate();
  const [list, setList] = useState<Trace[]>([]);
  const [loading, setLoading] = useState(false);
  const [convIdInput, setConvIdInput] = useState('');
  const [convId, setConvId] = useState<number | undefined>(undefined);
  // 错误聚合
  const [errorGroups, setErrorGroups] = useState<ErrorGroup[]>([]);
  const [errorLoading, setErrorLoading] = useState(false);
  // Token 统计
  const [tokenStats, setTokenStats] = useState<TokenStats[]>([]);
  const [tokenLoading, setTokenLoading] = useState(false);
  // 实时流
  const [live, setLive] = useState(false);
  const liveRef = useRef<EventSource | null>(null);

  const load = useCallback(
    async (id?: number) => {
      try {
        setLoading(true);
        const data = await traceApi.list(id);
        setList(data);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load(convId);
  }, [load, convId]);

  const loadErrors = async () => {
    setErrorLoading(true);
    try {
      setErrorGroups(await traceApi.errors());
    } finally {
      setErrorLoading(false);
    }
  };

  const loadTokens = async () => {
    setTokenLoading(true);
    try {
      setTokenStats(await traceApi.tokens());
    } finally {
      setTokenLoading(false);
    }
  };

  const onTabChange = (key: string) => {
    if (key === 'errors') loadErrors();
    if (key === 'tokens') loadTokens();
  };

  // 实时流：SSE 订阅
  const toggleLive = () => {
    if (live) {
      liveRef.current?.close();
      liveRef.current = null;
      setLive(false);
      return;
    }
    const es = new EventSource('/api/traces/stream');
    es.onmessage = (evt) => {
      try {
        const t = JSON.parse(evt.data) as Trace;
        setList((prev) => [t, ...prev].slice(0, 200));
      } catch {
        /* */
      }
    };
    es.onerror = () => {
      es.close();
      liveRef.current = null;
      setLive(false);
    };
    liveRef.current = es;
    setLive(true);
  };

  useEffect(() => {
    return () => {
      liveRef.current?.close();
    };
  }, []);

  const handleSearch = (val: string) => {
    setConvIdInput(val);
  };

  const onSearch = () => {
    const v = convIdInput.trim();
    if (v === '') {
      setConvId(undefined);
    } else {
      const n = Number(v);
      if (!Number.isNaN(n) && n > 0) {
        setConvId(n);
      }
    }
  };

  const columns: ColumnsType<Trace> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '迭代', dataIndex: 'iteration', width: 70, align: 'center' as const },
    {
      title: '步骤类型',
      dataIndex: 'step_type',
      width: 130,
      render: (v: Trace['step_type']) => <Tag color="blue">{STEP_TYPE_LABEL[v] || v}</Tag>,
    },
    { title: '工具', dataIndex: 'tool_name', width: 160, render: (v: string) => v || '-' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: Trace['status']) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
    },
    { title: 'Latency(ms)', dataIndex: 'latency_ms', width: 110, align: 'right' as const },
    { title: 'Token 入', dataIndex: 'token_in', width: 100, align: 'right' as const },
    { title: 'Token 出', dataIndex: 'token_out', width: 100, align: 'right' as const },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      width: 90,
      render: (_, r) => <a onClick={() => navigate(`/traces/${r.id}`)}>查看</a>,
    },
  ];

  const errorCols: ColumnsType<ErrorGroup> = [
    { title: '错误键', dataIndex: 'error_key', width: 200, render: (v) => <Tag color="orange">{v}</Tag> },
    { title: '样本', dataIndex: 'sample', ellipsis: true },
    { title: '次数', dataIndex: 'count', width: 90, align: 'right' as const, render: (v) => <Tag color="red">{v}</Tag> },
    {
      title: '最近时间',
      dataIndex: 'last_at',
      width: 170,
      render: (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
  ];

  const tokenCols: ColumnsType<TokenStats> = [
    { title: 'Agent ID', dataIndex: 'agent_id', width: 100 },
    { title: 'Agent 名称', dataIndex: 'agent_name', render: (v) => v || '-' },
    { title: '入 Token', dataIndex: 'token_in', align: 'right' as const },
    { title: '出 Token', dataIndex: 'token_out', align: 'right' as const },
    { title: '调用次数', dataIndex: 'call_count', width: 100, align: 'right' as const },
    {
      title: '平均延迟',
      dataIndex: 'avg_latency_ms',
      width: 110,
      align: 'right' as const,
      render: (v) => `${v} ms`,
    },
  ];

  return (
    <div>
      <Tabs
        defaultActiveKey="list"
        onChange={onTabChange}
        items={[
          {
            key: 'list',
            label: 'Trace 列表',
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  <Button
                    type={live ? 'primary' : 'default'}
                    onClick={toggleLive}
                    style={{ marginRight: 12 }}
                  >
                    {live ? '● 实时中（点击停止）' : '开启实时流'}
                  </Button>
                  实时流通过 SSE 订阅最新 Trace。
                </Typography.Paragraph>
                <Space style={{ marginBottom: 12 }}>
                  <Input.Search
                    placeholder="按 conversation_id 筛选（留空显示全部）"
                    value={convIdInput}
                    onChange={(e) => handleSearch(e.target.value)}
                    onSearch={onSearch}
                    enterButton
                    allowClear
                    style={{ width: 360 }}
                  />
                  {convId !== undefined && (
                    <a
                      onClick={() => {
                        setConvIdInput('');
                        setConvId(undefined);
                      }}
                    >
                      清除筛选
                    </a>
                  )}
                </Space>
                <Table<Trace>
                  rowKey="id"
                  loading={loading}
                  columns={columns}
                  dataSource={list}
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                  size="small"
                />
              </>
            ),
          },
          {
            key: 'errors',
            label: '错误聚合',
            children: (
              <Card
                extra={<Button onClick={loadErrors} size="small">刷新</Button>}
              >
                <Table<ErrorGroup>
                  rowKey="error_key"
                  loading={errorLoading}
                  columns={errorCols}
                  dataSource={errorGroups}
                  size="small"
                  pagination={{ pageSize: 20 }}
                />
                {errorGroups.length === 0 && !errorLoading && (
                  <Empty description="暂无错误" />
                )}
              </Card>
            ),
          },
          {
            key: 'tokens',
            label: 'Token 统计',
            children: (
              <Card extra={<Button onClick={loadTokens} size="small">刷新</Button>}>
                <Table<TokenStats>
                  rowKey="agent_id"
                  loading={tokenLoading}
                  columns={tokenCols}
                  dataSource={tokenStats}
                  size="small"
                  pagination={{ pageSize: 20 }}
                />
                <div style={{ marginTop: 16 }}>
                  <Space size="large">
                    <Statistic
                      title="总入 Token"
                      value={tokenStats.reduce((a, b) => a + (b.token_in ?? 0), 0)}
                    />
                    <Statistic
                      title="总出 Token"
                      value={tokenStats.reduce((a, b) => a + (b.token_out ?? 0), 0)}
                    />
                    <Statistic
                      title="总调用次数"
                      value={tokenStats.reduce((a, b) => a + (b.call_count ?? 0), 0)}
                    />
                  </Space>
                </div>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
