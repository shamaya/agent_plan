import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Modal,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { traceApi } from '@/api/endpoints/trace';
import { harnessApi } from '@/api/endpoints/harness';
import type { Trace } from '@/types';

const STEP_TYPE_LABEL: Record<Trace['step_type'], string> = {
  llm_call: 'LLM 调用',
  tool_call: '工具调用',
  retrieval: '检索',
  compression: '上下文压缩',
  constraint_check: '约束检查',
};

const STATUS_COLOR: Record<Trace['status'], string> = {
  ok: 'green',
  error: 'red',
};

function preBlock(data: unknown) {
  return (
    <pre
      style={{
        background: '#fafafa',
        padding: 10,
        margin: 0,
        maxHeight: 360,
        overflow: 'auto',
        fontSize: 12,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default function TraceDetail() {
  const { id } = useParams<{ id: string }>();
  const traceId = Number(id);
  const { message } = App.useApp();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(true);
  const [learnOpen, setLearnOpen] = useState(false);
  const [learnResult, setLearnResult] = useState<{
    rule_draft: unknown;
    trace_summary: Record<string, unknown>;
  } | null>(null);
  const [learning, setLearning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const t = await traceApi.get(traceId);
        if (!cancelled) setTrace(t);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  const openLearn = async () => {
    setLearnResult(null);
    setLearnOpen(true);
    try {
      setLearning(true);
      const r = await harnessApi.learnFromFailure(traceId);
      setLearnResult(r);
      message.success('已生成规则草稿');
    } finally {
      setLearning(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!trace) {
    return <Alert type="warning" message={`Trace #${traceId} 不存在`} />;
  }

  const isCompression = trace.step_type === 'compression';
  const output = (trace.output || {}) as Record<string, unknown>;
  const summary = typeof output.summary === 'string' ? output.summary : null;
  const preTokens = typeof output.pre_tokens === 'number' ? output.pre_tokens : null;
  const postTokens = typeof output.post_tokens === 'number' ? output.post_tokens : null;

  return (
    <div>
      <Space style={{ marginBottom: 12 }} align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          Trace #{trace.id}
        </Typography.Title>
        {trace.status === 'error' && (
          <Button danger onClick={openLearn}>
            从失败学习
          </Button>
        )}
      </Space>

      <Card title="元信息" style={{ marginBottom: 12 }}>
        <Descriptions column={3} size="small" bordered>
          <Descriptions.Item label="步骤类型">
            <Tag color="blue">{STEP_TYPE_LABEL[trace.step_type] || trace.step_type}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="迭代">{trace.iteration}</Descriptions.Item>
          <Descriptions.Item label="工具">{trace.tool_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={STATUS_COLOR[trace.status]}>{trace.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Latency(ms)">{trace.latency_ms}</Descriptions.Item>
          <Descriptions.Item label="Token 入">{trace.token_in}</Descriptions.Item>
          <Descriptions.Item label="Token 出">{trace.token_out}</Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {trace.created_at ? dayjs(trace.created_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="会话 ID">
            {trace.conversation_id ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Agent ID">{trace.agent_id ?? '-'}</Descriptions.Item>
          {trace.error && (
            <Descriptions.Item label="错误" span={3}>
              <Typography.Text type="danger">{trace.error}</Typography.Text>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {isCompression && summary && (
        <Card
          title="上下文压缩 - 高亮信息"
          style={{ marginBottom: 12 }}
          styles={{ body: { background: '#fffbe6' } }}
        >
          <Space size="large" wrap>
            <Statistic title="压缩前 Token" value={preTokens ?? '-'} />
            <Statistic
              title="压缩后 Token"
              value={postTokens ?? '-'}
              valueStyle={{ color: '#52c41a' }}
            />
            {preTokens != null && postTokens != null && preTokens > 0 && (
              <Statistic
                title="节省比例"
                value={((preTokens - postTokens) / preTokens * 100).toFixed(1)}
                suffix="%"
                valueStyle={{ color: '#fa8c16' }}
              />
            )}
          </Space>
          <Typography.Paragraph style={{ marginTop: 12 }} strong>
            摘要：
          </Typography.Paragraph>
          <pre
            style={{
              background: '#fff7e6',
              border: '1px solid #ffd591',
              padding: 10,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {summary}
          </pre>
        </Card>
      )}

      <Card title="输入" style={{ marginBottom: 12 }}>
        {preBlock(trace.input || {})}
      </Card>
      <Card title="输出">
        {preBlock(trace.output || {})}
      </Card>

      <Modal
        title="从失败 Trace 学习"
        open={learnOpen}
        onCancel={() => setLearnOpen(false)}
        footer={null}
        width={720}
      >
        {learning ? (
          <Typography.Text>正在分析 Trace 并生成规则草稿…</Typography.Text>
        ) : learnResult ? (
          <div>
            <Typography.Text strong>规则草稿：</Typography.Text>
            <pre
              style={{
                background: '#fafafa',
                padding: 10,
                marginTop: 6,
                maxHeight: 240,
                overflow: 'auto',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
              }}
            >
              {JSON.stringify(learnResult.rule_draft, null, 2)}
            </pre>
            <Typography.Text strong>Trace 摘要：</Typography.Text>
            <pre
              style={{
                background: '#fafafa',
                padding: 10,
                marginTop: 6,
                maxHeight: 160,
                overflow: 'auto',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
              }}
            >
              {JSON.stringify(learnResult.trace_summary, null, 2)}
            </pre>
          </div>
        ) : (
          <Typography.Text type="secondary">无结果</Typography.Text>
        )}
      </Modal>
    </div>
  );
}
