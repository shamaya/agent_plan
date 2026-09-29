import { Card, Empty, Tag, Collapse, Typography, Row, Col, Statistic, Tooltip as AntTooltip } from 'antd';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { CompressOutlined } from '@ant-design/icons';
import type { CompressionFrame } from '@/stores/useChatStore';

interface Props {
  frames: CompressionFrame[];
}

// 对话上下文自动压缩可视化：压缩前后 token 对比 + 节省比例 + 被压缩范围 + 摘要预览
export default function CompressionDiff({ frames }: Props) {
  if (!frames.length) {
    return <Empty description="尚未触发上下文压缩" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const totalPre = frames.reduce((s, f) => s + f.pre_tokens, 0);
  const totalPost = frames.reduce((s, f) => s + f.post_tokens, 0);
  const totalSaved = totalPre - totalPost;
  const ratio = totalPre > 0 ? ((totalSaved / totalPre) * 100).toFixed(1) : '0.0';

  const data = frames.map((f) => ({
    name: `第${f.at + 1}次`,
    压缩前: f.pre_tokens,
    压缩后: f.post_tokens,
    range: f.compressed_range,
  }));

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Statistic title="压缩次数" value={frames.length} prefix={<CompressOutlined />} />
        </Col>
        <Col span={8}>
          <Statistic
            title="累计节省 Token"
            value={totalSaved}
            valueStyle={{ color: '#52c41a' }}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="节省比例"
            value={ratio}
            suffix="%"
            valueStyle={{ color: '#fa8c16' }}
          />
        </Col>
      </Row>

      <Card size="small" title="压缩前后 Token 对比" style={{ marginBottom: 16 }}>
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip
                formatter={(v: number, name) => [`${v} token`, name]}
                labelFormatter={(_, payload) => {
                  const r = payload?.[0]?.payload?.range;
                  return r ? `压缩范围: ${r[0]} ~ ${r[1]}` : '';
                }}
              />
              <Legend />
              <Bar dataKey="压缩前" fill="#d9d9d9" radius={[4, 4, 0, 0]} />
              <Bar dataKey="压缩后" fill="#52c41a" radius={[4, 4, 0, 0]}>
                {data.map((_, i) => <Cell key={i} fill="#52c41a" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Typography.Text strong>压缩摘要详情</Typography.Text>
      <Collapse
        style={{ marginTop: 8 }}
        items={frames.map((f, i) => ({
          key: String(i),
          label: (
            <span>
              <Tag color="orange">第{i + 1}次</Tag>
              <Typography.Text type="secondary">
                {f.pre_tokens} → {f.post_tokens} token，节省{' '}
                <Typography.Text strong style={{ color: '#52c41a' }}>
                  {f.pre_tokens - f.post_tokens}
                </Typography.Text>
                （范围 {f.compressed_range[0]} ~ {f.compressed_range[1]}）
              </Typography.Text>
            </span>
          ),
          children: (
            <AntTooltip title="此摘要由 LLM 对旧对话历史结构化压缩生成，保留关键事实/已用工具/已决策/未解决/偏好">
              <pre
                style={{
                  background: '#fafafa',
                  padding: 12,
                  borderRadius: 6,
                  maxHeight: 240,
                  overflow: 'auto',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {f.summary}
              </pre>
            </AntTooltip>
          ),
        }))}
      />
    </div>
  );
}
