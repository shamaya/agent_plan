import { useEffect, useState } from 'react';
import { Card, Col, Row, Spin, Statistic, Table, Typography, Button, Space } from 'antd';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { traceApi } from '@/api/endpoints/trace';
import type { Stats, Trace } from '@/types';
import type { ColumnsType } from 'antd/es/table';

const STEP_TYPE_LABEL: Record<Trace['step_type'], string> = {
  llm_call: 'LLM 调用',
  tool_call: '工具调用',
  retrieval: '检索',
  compression: '上下文压缩',
  constraint_check: '约束检查',
  routing: '智能路由',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await traceApi.stats();
        if (!cancelled) setStats(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !stats) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  const cards: { label: string; value: number; path?: string }[] = [
    { label: 'Providers', value: stats.providers, path: '/providers' },
    { label: '模型', value: stats.models },
    { label: 'Skills', value: stats.skills, path: '/skills' },
    { label: 'MCP 服务', value: stats.mcp_servers, path: '/mcp' },
    { label: 'MCP 工具', value: stats.mcp_tools },
    { label: '知识库', value: stats.knowledge_bases, path: '/knowledge' },
    { label: 'Agents', value: stats.agents, path: '/agents' },
    { label: '会话', value: stats.conversations, path: '/chat' },
    { label: 'Traces', value: stats.traces, path: '/traces' },
  ];

  const statCards = [
    { label: '总输入 Token', value: stats.total_token_in.toLocaleString(), color: '#6366f1' },
    { label: '总输出 Token', value: stats.total_token_out.toLocaleString(), color: '#10b981' },
    { label: '错误数', value: stats.error_count, color: stats.error_count > 0 ? '#ef4444' : '#64748b' },
    { label: '平均延迟', value: `${stats.avg_latency_ms} ms`, color: '#f59e0b' },
  ];

  const columns: ColumnsType<Trace> = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    {
      title: '步骤类型',
      dataIndex: 'step_type',
      width: 140,
      render: (v: Trace['step_type']) => STEP_TYPE_LABEL[v] || v,
    },
    { title: '迭代', dataIndex: 'iteration', width: 80 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => v,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      width: 100,
      render: (_, r) => (
        <a onClick={() => navigate(`/traces/${r.id}`)}>查看</a>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={[16, 16]}>
        {cards.map((c) => (
          <Col key={c.label} xs={12} sm={8} md={6} lg={6} xl={6}>
            <Card
              className="app-stat-card"
              hoverable={!!c.path}
              onClick={c.path ? () => navigate(c.path!) : undefined}
              style={{ cursor: c.path ? 'pointer' : 'default' }}
            >
              <Statistic title={c.label} value={c.value} />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 用量与错误统计 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {statCards.map((s) => (
          <Col key={s.label} xs={12} sm={12} md={6} lg={6} xl={6}>
            <Card className="app-stat-card">
              <div style={{ color: s.color, fontSize: 12, fontWeight: 500 }}>{s.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)', marginTop: 4 }}>
                {s.value}
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card title="最近 Traces">
            <Table<Trace>
              rowKey="id"
              size="small"
              columns={columns}
              dataSource={stats.recent_traces}
              pagination={{ pageSize: 8, showSizeChanger: false }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card title="快捷入口">
            <Space wrap>
              <Button type="primary" onClick={() => navigate('/providers')}>
                管理 Provider
              </Button>
              <Button onClick={() => navigate('/agents')}>Agent 配置</Button>
              <Button onClick={() => navigate('/chat')}>开始对话</Button>
              <Button onClick={() => navigate('/traces')}>查看全部 Trace</Button>
            </Space>
          </Card>
        </Col>
      </Row>

      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
        平台概览：聚合 LLM Provider、Skill、MCP、知识库、Agent、会话、监控 Trace 七大模块的核心计数。
      </Typography.Paragraph>
    </div>
  );
}
