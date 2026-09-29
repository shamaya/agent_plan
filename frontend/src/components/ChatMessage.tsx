import { Typography, Tag, Tooltip } from 'antd';
import { RobotOutlined, UserOutlined, CompressOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import ToolCallCard, { type ToolCallView } from './ToolCallCard';

export interface ChatMessageView {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: { name: string; args: Record<string, unknown>; id?: string }[];
  toolResults?: { name: string; result: unknown }[];
  isCompressedSummary?: boolean;
  streaming?: boolean;
}

// 单条消息气泡；assistant 内嵌工具调用卡片
export default function ChatMessage({ msg }: { msg: ChatMessageView }) {
  const isUser = msg.role === 'user';
  const isAssistant = msg.role === 'assistant';
  const isSummary = msg.isCompressedSummary;

  // 压缩摘要：整宽橙底特殊样式
  if (isSummary) {
    return (
      <div style={{ margin: '8px 0' }}>
        <div
          style={{
            background: 'linear-gradient(90deg, #fff7e6, #fffbe6)',
            border: '1px solid #ffd591',
            borderRadius: 8,
            padding: '10px 14px',
          }}
        >
          <Tag color="orange" icon={<CompressOutlined />} style={{ marginBottom: 6 }}>
            上下文已自动压缩
          </Tag>
          <Tooltip title="此段由 LLM 对更早的对话历史结构化压缩生成，注入 system 以保留上下文，原文仍可溯源">
            <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13 }}>
              {msg.content}
            </Typography.Paragraph>
          </Tooltip>
        </div>
      </div>
    );
  }

  // 工具消息：缩进小字
  if (msg.role === 'tool') {
    return (
      <div style={{ margin: '2px 0 2px 32px', fontSize: 12 }}>
        <Typography.Text type="secondary">工具结果：</Typography.Text>
        <pre style={{ margin: '4px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#595959' }}>
          {msg.content}
        </pre>
      </div>
    );
  }

  const align = isUser ? 'flex-end' : 'flex-start';
  const bubbleClass = isUser ? 'bubble-user' : 'bubble-assistant';
  const avatarClass = isUser ? 'chat-avatar chat-avatar-user' : 'chat-avatar chat-avatar-assistant';
  const icon = isUser ? <UserOutlined /> : <RobotOutlined />;

  // 组装 tool 视图：按 name 消费 results（同名多次调用按顺序匹配）
  const consumedResults = new Set<number>();
  const toolViews: ToolCallView[] = (msg.toolCalls || []).map((tc) => {
    const trIdx = msg.toolResults?.findIndex((r, i) => r.name === tc.name && !consumedResults.has(i));
    const tr = trIdx !== undefined && trIdx >= 0 ? msg.toolResults![trIdx] : undefined;
    if (trIdx !== undefined && trIdx >= 0) consumedResults.add(trIdx);
    const isErr = tr && typeof tr.result === 'object' && tr.result && 'error' in (tr.result as Record<string, unknown>);
    return {
      id: tc.id,
      tool: tc.name,
      args: tc.args,
      result: tr?.result,
      status: tr ? (isErr ? 'error' : 'ok') : 'pending',
    };
  });

  return (
    <div style={{ display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row', gap: 10, margin: '10px 0' }}>
      <div className={avatarClass}>{icon}</div>
      <div style={{ maxWidth: '76%' }}>
        <div style={{ marginBottom: 4, color: 'var(--muted)', fontSize: 12, textAlign: isUser ? 'right' : 'left' }}>
          {isUser ? '我' : msg.streaming ? 'Assistant（生成中）' : 'Assistant'}
        </div>
        <div className={bubbleClass} style={{ padding: '12px 16px' }}>
          {msg.streaming && !msg.content && toolViews.length === 0 && (
            <Typography.Text type="secondary">思考中…</Typography.Text>
          )}
          {msg.content && (
            isUser ? (
              <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {msg.content}
              </Typography.Paragraph>
            ) : (
              <div className="chat-markdown" style={{ margin: 0 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {msg.content}
                </ReactMarkdown>
              </div>
            )
          )}
          {msg.streaming && <span className="cursor-blink">▋</span>}
          {toolViews.map((t, i) => (
            <ToolCallCard key={t.id || i} call={t} />
          ))}
        </div>
      </div>
    </div>
  );
}
