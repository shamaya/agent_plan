import { Collapse, Tag, Typography } from 'antd';
import {
  LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined, ToolOutlined,
} from '@ant-design/icons';

export interface ToolCallView {
  id?: string;
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: 'pending' | 'ok' | 'error';
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

  const renderResult = () => {
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
        style={{ background: '#f8fafc' }}
        defaultActiveKey={call.status === 'pending' ? ['1'] : []}
      items={[
        {
          key: '1',
          label: (
            <span>
              <ToolOutlined style={{ marginRight: 6 }} />
              <Typography.Text code>{call.tool}</Typography.Text>
              <Tag color={statusColor} icon={statusIcon} style={{ marginLeft: 8 }}>
                {statusText}
              </Tag>
            </span>
          ),
          children: (
            <div>
              <div style={{ marginBottom: 6 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>参数</Typography.Text>
                <pre style={{ margin: '4px 0 0', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {JSON.stringify(call.args, null, 2)}
                </pre>
              </div>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {call.status === 'error' ? '错误' : '结果'}
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
