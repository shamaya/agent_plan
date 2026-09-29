import { useCallback, useEffect, useRef, useState } from 'react';
import { Editor, type OnMount } from '@monaco-editor/react';
import { Alert, App, Button, Card, Space, Tag } from 'antd';

interface JsonSchemaFormProps {
  value: unknown;
  onChange?: (val: unknown) => void;
  height?: number;
  placeholder?: string;
}

// 将任意值序列化为 JSON 字符串
function safeStringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return '';
    }
  }
  // 字符串/数字/布尔也尝试 JSON 化
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

function tryParse(s: string): ParseResult {
  const trimmed = s.trim();
  if (!trimmed) return { ok: false, error: '内容为空' };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// 简单深比较：用 JSON 文本对比
function deepEqualText(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export default function JsonSchemaForm({
  value,
  onChange,
  height = 200,
  placeholder,
}: JsonSchemaFormProps) {
  const { message } = App.useApp();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [text, setText] = useState<string>(() => safeStringify(value));
  const [error, setError] = useState<string | null>(null);
  const [valid, setValid] = useState<boolean>(true);

  // 外部 value 引用变化时，若与当前文本 parse 出的值不同则同步编辑器
  useEffect(() => {
    const current = tryParse(text);
    if (current.ok && deepEqualText(current.value, value)) {
      return; // 一致，不覆盖用户输入
    }
    // 当前文本非法或值不一致：仅当 value 是对象/数组或基础类型时同步
    const next = safeStringify(value);
    setText(next);
    setError(null);
    setValid(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleTextChange = useCallback(
    (next: string) => {
      setText(next);
      const parsed = tryParse(next);
      if (parsed.ok) {
        setError(null);
        setValid(true);
        onChange?.(parsed.value);
      } else {
        setError(parsed.error);
        setValid(false);
        // 不回调 onChange，允许用户继续编辑修复
      }
    },
    [onChange],
  );

  const handleFormat = useCallback(() => {
    const parsed = tryParse(text);
    if (parsed.ok) {
      const formatted = JSON.stringify(parsed.value, null, 2);
      setText(formatted);
      setError(null);
      setValid(true);
      onChange?.(parsed.value);
      message.success('已格式化');
    } else {
      setError(parsed.error);
      setValid(false);
      message.error('JSON 格式错误，无法格式化');
    }
  }, [text, onChange, message]);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  return (
    <Card
      size="small"
      styles={{ body: { padding: 8 } }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <Space size={8}>
          <Tag color={valid ? 'green' : 'red'}>
            {valid ? '合法' : '格式错误'}
          </Tag>
        </Space>
        <Button size="small" onClick={handleFormat}>
          格式化
        </Button>
      </div>

      <div style={{ height }} aria-label={placeholder}>
        <Editor
          height={height}
          defaultLanguage="json"
          language="json"
          theme="vs-dark"
          value={text}
          onChange={(v) => handleTextChange(v ?? '')}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            tabSize: 2,
          }}
        />
      </div>

      {error && (
        <Alert
          type="error"
          message={error}
          style={{ marginTop: 8 }}
          showIcon
        />
      )}
    </Card>
  );
}
