import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Form, Input, Button, Select, Card, Spin, message, Typography, Space, Row, Col,
  Drawer, Modal, Input as AntInput, Empty, Tag, Divider,
} from 'antd';
import { HistoryOutlined, BugOutlined } from '@ant-design/icons';
import { agentApi } from '@/api/endpoints/agent';
import { providerApi } from '@/api/endpoints/provider';
import { skillApi } from '@/api/endpoints/skill';
import { mcpApi } from '@/api/endpoints/mcp';
import { knowledgeApi } from '@/api/endpoints/knowledge';
import { harnessApi } from '@/api/endpoints/harness';
import type {
  Agent, Model, Provider, Skill, McpServer, KnowledgeBase, ConstraintProfile,
  AgentVersion,
} from '@/types';

const { TextArea } = Input;

interface Option { label: string; value: number }

// JSON 文本编辑子组件（带校验）
function JsonField({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    try {
      const parsed = JSON.stringify(value ?? {}, null, 2);
      setText(parsed);
      setErr('');
    } catch {
      setText('');
    }
  }, [value]);
  return (
    <Form.Item label={label} validateStatus={err ? 'error' : ''} help={err || 'JSON 格式'}>
      <TextArea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setErr('');
          } catch (ex) {
            setErr('JSON 格式错误：' + (ex as Error).message);
          }
        }}
        autoSize={{ minRows: 3, maxRows: 10 }}
        style={{ fontFamily: 'monospace', fontSize: 12 }}
      />
    </Form.Item>
  );
}

export default function AgentEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modelOptions, setModelOptions] = useState<Option[]>([]);
  const [skillOptions, setSkillOptions] = useState<Option[]>([]);
  const [mcpOptions, setMcpOptions] = useState<Option[]>([]);
  const [kbOptions, setKbOptions] = useState<Option[]>([]);
  const [profileOptions, setProfileOptions] = useState<Option[]>([]);
  const [contextConfig, setContextConfig] = useState<Record<string, unknown>>({ top_k: 4 });
  // 版本管理
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  // 调试沙箱
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugMsg, setDebugMsg] = useState('');
  const [debugResp, setDebugResp] = useState('');
  const [debugLoading, setDebugLoading] = useState(false);

  const isEdit = !!id;

  // 并行加载所有 options
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [providers, skills, servers, kbs, profiles] = await Promise.all([
          providerApi.list(),
          skillApi.list(),
          mcpApi.listServers(),
          knowledgeApi.list(),
          harnessApi.listProfiles(),
        ]);
        // 模型选项：每个 enabled provider 拉模型
        const enabledProviders = providers.filter((p) => p.enabled && (p.kind === 'chat' || p.kind === 'both'));
        const modelLists = await Promise.all(enabledProviders.map((p) => providerApi.models(p.id)));
        const mOpts: Option[] = [];
        enabledProviders.forEach((p, i) => {
          (modelLists[i] || []).forEach((m: Model) => {
            if (m.enabled) mOpts.push({ label: `${p.name} / ${m.model_name}`, value: m.id });
          });
        });
        setModelOptions(mOpts);
        setSkillOptions(skills.map((s: Skill) => ({ label: `${s.name}${s.enabled ? '' : '(禁用)'}`, value: s.id })));
        setMcpOptions(servers.map((s: McpServer) => ({ label: `${s.name}${s.enabled ? '' : '(禁用)'}`, value: s.id })));
        setKbOptions(kbs.map((k: KnowledgeBase) => ({ label: k.name, value: k.id })));
        setProfileOptions(profiles.map((c: ConstraintProfile) => ({ label: c.name, value: c.id })));

        if (id) {
          const a = await agentApi.get(Number(id));
          form.setFieldsValue({
            name: a.name,
            system_prompt: a.system_prompt,
            model_id: a.model_id ?? undefined,
            skill_ids: a.skill_ids,
            mcp_server_ids: a.mcp_server_ids,
            kb_ids: a.kb_ids,
            constraint_profile_id: a.constraint_profile_id ?? undefined,
          });
          setContextConfig(a.context_config ?? { top_k: 4 });
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const body = { ...values, context_config: contextConfig };
      if (id) {
        await agentApi.update(Number(id), body);
        message.success('更新成功');
      } else {
        await agentApi.create(body);
        message.success('创建成功');
      }
      navigate('/agents');
    } catch (e) {
      // 校验失败或 API 错误（API 错误已由拦截器吐司）
    } finally {
      setSaving(false);
    }
  };

  // ===== 版本管理 =====
  const saveVersion = async () => {
    if (!id) return;
    Modal.confirm({
      title: '保存版本快照',
      content: '为当前 Agent 配置保存一个版本快照，可随时回滚。',
      onOk: async () => {
        try {
          await agentApi.saveVersion(Number(id), '手动保存');
          message.success('版本已保存');
          await loadVersions();
        } catch { /* */ }
      },
    });
  };

  const loadVersions = async () => {
    if (!id) return;
    const v = await agentApi.listVersions(Number(id));
    setVersions(v);
  };

  const openVersions = async () => {
    setVersionsOpen(true);
    await loadVersions();
  };

  const rollback = async (vid: number) => {
    if (!id) return;
    Modal.confirm({
      title: '回滚到此版本？',
      content: '当前配置将被该版本快照覆盖，并自动生成新版本记录。',
      onOk: async () => {
        try {
          await agentApi.rollbackVersion(Number(id), vid);
          message.success('已回滚');
          setVersionsOpen(false);
          // 重新加载表单
          const a = await agentApi.get(Number(id));
          form.setFieldsValue({
            name: a.name, system_prompt: a.system_prompt,
            model_id: a.model_id ?? undefined, skill_ids: a.skill_ids,
            mcp_server_ids: a.mcp_server_ids, kb_ids: a.kb_ids,
            constraint_profile_id: a.constraint_profile_id ?? undefined,
          });
          setContextConfig(a.context_config ?? { top_k: 4 });
        } catch { /* */ }
      },
    });
  };

  // ===== 调试沙箱 =====
  const runDebug = async () => {
    if (!id || !debugMsg.trim()) return;
    setDebugLoading(true);
    setDebugResp('');
    try {
      // 复用 chat SSE，收集最终结果
      const resp = await fetch(`/api/agents/${id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: debugMsg, conversation_id: null }),
      });
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let final = '';
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'done') final = evt.final;
              else if (evt.type === 'token') final += evt.text;
              else if (evt.type === 'error') { final = `错误：${evt.message}`; break; }
            } catch { /* */ }
          }
        }
      }
      setDebugResp(final);
    } catch (e) {
      setDebugResp(`请求失败：${(e as Error).message}`);
    } finally {
      setDebugLoading(false);
    }
  };

  return (
    <Spin spinning={loading}>
      <Card
        title={isEdit ? '编辑 Agent' : '新建 Agent'}
        extra={
          <Space>
            {isEdit && (
              <>
                <Button icon={<BugOutlined />} onClick={() => setDebugOpen(true)}>
                  调试
                </Button>
                <Button icon={<HistoryOutlined />} onClick={openVersions}>
                  版本
                </Button>
              </>
            )}
            <Button onClick={() => navigate('/agents')}>返回</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" initialValues={{ skill_ids: [], mcp_server_ids: [], kb_ids: [] }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Agent 名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="如：客服助手" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="使用模型" name="model_id" tooltip="从已启用的 chat/both 类型 provider 的模型中选择">
                <Select
                  placeholder="选择模型"
                  options={modelOptions}
                  allowClear
                  notFoundContent="请先在 Provider 页配置并启用 chat 模型"
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="System Prompt" name="system_prompt" tooltip="Agent 的系统提示词，定义其角色与行为">
            <TextArea
              placeholder="你是一个……"
              autoSize={{ minRows: 4, maxRows: 12 }}
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label="启用 Skill" name="skill_ids" tooltip="选中的 skill 描述会注入 system prompt">
                <Select mode="multiple" placeholder="多选 Skill" options={skillOptions} allowClear />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="MCP 服务" name="mcp_server_ids" tooltip="这些 server 的工具会作为可调用工具暴露给 LLM">
                <Select mode="multiple" placeholder="多选 MCP server" options={mcpOptions} allowClear />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="知识库" name="kb_ids" tooltip="对话时按用户消息检索这些知识库注入上下文">
                <Select mode="multiple" placeholder="多选知识库" options={kbOptions} allowClear />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="约束 Profile" name="constraint_profile_id" tooltip="Harness 工程层：迭代上限/Token 预算/工具白名单/压缩策略">
                <Select placeholder="选择约束（可选，留空用默认）" options={profileOptions} allowClear />
              </Form.Item>
            </Col>
            <Col span={12}>
              <JsonField label="上下文配置 context_config" value={contextConfig} onChange={(v) => setContextConfig(v as Record<string, unknown>)} />
            </Col>
          </Row>

          <Space>
            <Button type="primary" loading={saving} onClick={onSubmit}>
              {isEdit ? '保存' : '创建'}
            </Button>
            <Button onClick={() => navigate('/agents')}>取消</Button>
            {isEdit && (
              <Button onClick={saveVersion}>保存版本快照</Button>
            )}
          </Space>
        </Form>
      </Card>

      {/* 版本历史抽屉 */}
      <Drawer
        title="版本历史"
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        width={600}
      >
        {versions.length === 0 ? (
          <Empty description="暂无版本，点击「保存版本快照」创建" />
        ) : (
          versions.map((v) => (
            <Card key={v.id} size="small" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <Space>
                  <Tag color="geekblue">v{v.version}</Tag>
                  <Typography.Text type="secondary">{v.note}</Typography.Text>
                </Space>
                <Button size="small" type="link" onClick={() => rollback(v.id)}>
                  回滚到此版本
                </Button>
              </div>
              <pre
                style={{
                  background: '#f8fafc', padding: 8, marginTop: 8,
                  fontSize: 12, maxHeight: 120, overflow: 'auto',
                  whiteSpace: 'pre-wrap', borderRadius: 6,
                }}
              >
                {JSON.stringify(v.snapshot, null, 2)}
              </pre>
            </Card>
          ))
        )}
      </Drawer>

      {/* 调试沙箱抽屉 */}
      <Drawer
        title="调试沙箱 — 直接测试当前 Agent"
        open={debugOpen}
        onClose={() => setDebugOpen(false)}
        width={640}
      >
        <Typography.Paragraph type="secondary">
          在此输入消息直接调用当前 Agent（需先保存配置），无需跳转到对话页。
        </Typography.Paragraph>
        <TextArea
          value={debugMsg}
          onChange={(e) => setDebugMsg(e.target.value)}
          placeholder="输入测试消息…"
          autoSize={{ minRows: 3, maxRows: 6 }}
        />
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <Button type="primary" loading={debugLoading} onClick={runDebug}>
            运行
          </Button>
        </div>
        {debugResp && (
          <Card size="small" style={{ marginTop: 12 }} title="响应">
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{debugResp}</div>
          </Card>
        )}
      </Drawer>
    </Spin>
  );
}
