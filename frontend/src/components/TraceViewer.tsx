import { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  Card,
  Empty,
  Segmented,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { Trace } from '@/types';

// step_type 中文映射
const STEP_TYPE_LABEL: Record<Trace['step_type'], string> = {
  llm_call: 'LLM调用',
  tool_call: '工具调用',
  retrieval: '检索',
  compression: '上下文压缩',
  constraint_check: '约束检查',
  routing: '智能路由',
};

// step_type 颜色
const STEP_TYPE_COLOR: Record<Trace['step_type'], string> = {
  llm_call: '#1677ff',
  tool_call: '#52c41a',
  retrieval: '#722ed1',
  compression: '#fa8c16',
  constraint_check: '#13c2c2',
  routing: '#2f54eb',
};

interface TraceViewerProps {
  traces: Trace[];
  loading?: boolean;
}

type Metric = 'latency' | 'token';

interface ChartRow {
  trace: Trace;
  label: string;
  metric: number;
}

// 图表 Tooltip 自定义内容
function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
}) {
  if (!active || !payload || !payload.length) return null;
  const t = payload[0].payload.trace;
  return (
    <Card size="small" style={{ maxWidth: 360, fontSize: 12 }}>
      <div style={{ lineHeight: 1.6 }}>
        <div>
          <b>{STEP_TYPE_LABEL[t.step_type]}</b>
          {t.tool_name ? ` · ${t.tool_name}` : ''}
        </div>
        <div>耗时: {t.latency_ms} ms</div>
        <div>
          Token: 入 {t.token_in} / 出 {t.token_out}
        </div>
        <div>
          状态: <Tag color={t.status === 'ok' ? 'green' : 'red'}>{t.status}</Tag>
        </div>
        {t.error ? (
          <div style={{ color: '#cf1322' }}>错误: {t.error}</div>
        ) : null}
      </div>
    </Card>
  );
}

export default function TraceViewer({ traces, loading }: TraceViewerProps) {
  const [metric, setMetric] = useState<Metric>('latency');

  // 图表行：按 created_at 升序，便于瀑布展示
  const rows: ChartRow[] = useMemo(() => {
    return [...traces]
      .sort((a, b) => {
        const ta = a.created_at || '';
        const tb = b.created_at || '';
        return ta.localeCompare(tb);
      })
      .map((t) => ({
        trace: t,
        label: `${t.iteration}-${STEP_TYPE_LABEL[t.step_type]}`,
        metric:
          metric === 'latency'
            ? t.latency_ms
            : t.token_in + t.token_out,
      }));
  }, [traces, metric]);

  const columns: ColumnsType<Trace> = useMemo(
    () => [
      { title: 'Iter', dataIndex: 'iteration', width: 60 },
      {
        title: '步骤',
        dataIndex: 'step_type',
        width: 110,
        render: (v: Trace['step_type']) => (
          <Tag color={STEP_TYPE_COLOR[v]}>{STEP_TYPE_LABEL[v]}</Tag>
        ),
      },
      {
        title: '工具',
        dataIndex: 'tool_name',
        width: 140,
        ellipsis: true,
        render: (v: string) => v || '-',
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 80,
        render: (v: Trace['status']) => (
          <Tag color={v === 'ok' ? 'green' : 'red'}>{v}</Tag>
        ),
      },
      { title: '耗时(ms)', dataIndex: 'latency_ms', width: 100 },
      { title: 'Token入', dataIndex: 'token_in', width: 90 },
      { title: 'Token出', dataIndex: 'token_out', width: 90 },
      {
        title: '错误',
        dataIndex: 'error',
        ellipsis: true,
        render: (v: string) => v || '-',
      },
      {
        title: '时间',
        dataIndex: 'created_at',
        width: 160,
        render: (v?: string) =>
          v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-',
      },
    ],
    [],
  );

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin />
      </div>
    );
  }

  if (!traces.length) {
    return (
      <Empty
        description="暂无 Trace 数据"
        style={{ padding: 48 }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Typography.Text type="secondary">
          共 {traces.length} 条 Trace
        </Typography.Text>
        <Segmented
          size="small"
          value={metric === 'latency' ? '耗时ms' : 'Token量'}
          onChange={(v) =>
            setMetric(v === 'Token量' ? 'token' : 'latency')
          }
          options={['耗时ms', 'Token量']}
        />
      </div>

      {/* 图表容器固定高度 320px，确保 ResponsiveContainer 有明确高度 */}
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 8, right: 20, bottom: 8, left: 20 }}
          >
            <XAxis type="number" dataKey="metric" />
            <YAxis
              type="category"
              dataKey="label"
              width={140}
              tick={{ fontSize: 12 }}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fillOpacity: 0.1 }} />
            <Bar dataKey="metric" radius={[0, 4, 4, 0]}>
              {rows.map((r, i) => (
                <Cell
                  key={i}
                  fill={STEP_TYPE_COLOR[r.trace.step_type]}
                  stroke={r.trace.status === 'error' ? '#cf1322' : 'transparent'}
                  strokeWidth={r.trace.status === 'error' ? 2 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <Table<Trace>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={traces}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        scroll={{ x: 'max-content' }}
      />
    </div>
  );
}
