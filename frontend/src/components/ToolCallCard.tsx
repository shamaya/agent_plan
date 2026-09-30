import { Collapse, Tag, Typography } from 'antd';
import {
  LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined, ToolOutlined,
  TeamOutlined,
} from '@ant-design/icons';

export interface ToolCallView {
  id?: string;
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: 'pending' | 'ok' | 'error';
}

// 委托工具检测
function isDelegation(toolName: string) {
  return toolName === 'delegate' || toolName === 'assign_task';
}

// 工具调用卡片：可折叠（默认折叠，执行中展开），内嵌在 assistant 气泡内
export default function ToolCallCard({ call }: { call: ToolCallView }) {
  const statusColor =
    call.status === 'pending' ? 'processing' : call.status === 'ok' ? 'success' : 'error';
  const statusIcon =
    call.status === 'pending' ? <LoadingOutlined /> :
    call.status === 'ok' ? <CheckCircleOutlined /> : <CloseCircleOutlined />;
  const statusText =
    call.status === 'pending' ? '执行中' : call.status === 'ok' ? '成功' : '失败';

  const isDeleg = isDelegation(call.tool);

  // 委托任务名（agent_name 或 worker_id）
  const delegTarget = String(call.args.agent_name || call.args.worker_id || '?');
  const delegTask = String(call.args.task || '');

  // 委托结果解析
  const renderDelegationResult = () => {
    if (call.status === 'pending') return <Typography.Text type="secondary">等待 Worker 响应…</Typography.Text>;
    const raw = call.error ?? call.result;
    let parsed: Record<string, unknown> | null = null;
    if (typeof raw === 'object' && raw !== null) {
      parsed = raw as Record<string, unknown>;
    } else if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch { /* not json */ }
    }
    const workerName = parsed?.worker as string | undefined;
    const result = parsed?.result as string | undefined;
    const error = parsed?.error as string | undefined;
    return (
      <div>
        {workerName && <Tag color="geekblue" style={{ marginBottom: 4 }}>{workerName}</Tag>}
        {error ? (
          <Typography.Text type="danger" style={{ fontSize: 13 }}>{error}</Typography.Text>
        ) : (
          <div style={{ background: '#f0f5ff', padding: 8, borderRadius: 6, border: '1px solid #d6e4ff', fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {result || (typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2))}
          </div>
        )}
      </div>
    );
  };

  const renderResult = () => {
    if (isDeleg) return renderDelegationResult();
    if (call.status === 'pending') return <Typography.Text type="secondary">等待结果…</Typography.Text>;
    const raw = call.error ?? call.result;
    let text: string;
    if (typeof raw === 'string') text = raw;
    else {
      try { text = JSON.stringify(raw, null, 2); } catch { text = String(raw); }
    }
    return (
      <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {text}
      </pre>
    );
  };

  return (
    <div className="tool-card" style={{ margin: '6px 0' }}>
      <Collapse
        size="small"
        style={{
          background: isDeleg ? '#f0f5ff' : '#f8fafc',
          border: isDeleg ? '1px solid #d6e4ff' : undefined,
        }}
        defaultActiveKey={call.status === 'pending' ? ['1'] : []}
      items={[
        {
          key: '1',
          label: (
            <span>
              {isDeleg ? (
                <TeamOutlined style={{ marginRight: 6, color: '#2f54eb' }} />
              ) : (
                <ToolOutlined style={{ marginRight: 6 }} />
              )}
              {isDeleg ? (
                <>
                  <Typography.Text style={{ color: '#2f54eb', fontWeight: 500 }}>
                    委托 → {delegTarget}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    {delegTask.length > 40 ? delegTask.slice(0, 40) + '…' : delegTask}
                  </Typography.Text>
                </>
              ) : (
                <Typography.Text code>{call.tool}</Typography.Text>
              )}
              <Tag color={statusColor} icon={statusIcon} style={{ marginLeft: 8 }}>
                {statusText}
              </Tag>
            </span>
          ),
          children: (
            <div>
              <div style={{ marginBottom: 6 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {isDeleg ? '委托任务' : '参数'}
                </Typography.Text>
                <pre style={{ margin: '4px 0 0', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {isDeleg ? delegTask : JSON.stringify(call.args, null, 2)}
                </pre>
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {isDeleg ? 'Worker 响应' : call.status === 'error' ? '错误' : '结果'}
                </Typography.Text>
                <div style={{ marginTop: 4 }}>{renderResult()}</div>
              </div>
            </div>
          ),
        },
      ]}
      />
    </div>
  );
}
