import { useCallback, useEffect, useState } from 'react';
import {
  App,
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { harnessApi } from '@/api/endpoints/harness';
import type { ConstraintProfile, RecoveryRule } from '@/types';
import type { ColumnsType } from 'antd/es/table';

const ACTION_COLOR: Record<RecoveryRule['action'], string> = {
  disable_tool: 'red',
  downgrade: 'orange',
  retry_with_advice: 'blue',
};

const ACTION_LABEL: Record<RecoveryRule['action'], string> = {
  disable_tool: '禁用工具',
  downgrade: '降级模型',
  retry_with_advice: '带建议重试',
};

const DEFAULT_COMPRESSION = JSON.stringify(
  { enabled: true, trigger_ratio: 0.8, keep_recent_turns: 4 },
  null,
  2,
);

const DEFAULT_ALLOWED_TOOLS = JSON.stringify(['*'], null, 2);
const DEFAULT_FORBIDDEN = JSON.stringify([], null, 2);

function tryParseJson(text: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

interface ProfileFormValues {
  name: string;
  max_iterations: number;
  token_budget: number;
  allowed_tools: string;
  forbidden_actions: string;
  tool_failure_threshold: number;
  compression_policy: string;
}

export default function Harness() {
  const { message, modal } = App.useApp();

  const [tab, setTab] = useState('profiles');

  // ===== Profiles =====
  const [profiles, setProfiles] = useState<ConstraintProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ConstraintProfile | null>(null);
  const [profileForm] = Form.useForm<ProfileFormValues>();
  const [allowedValid, setAllowedValid] = useState(true);
  const [forbiddenValid, setForbiddenValid] = useState(true);
  const [compressionValid, setCompressionValid] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);

  const loadProfiles = useCallback(async () => {
    try {
      setProfilesLoading(true);
      setProfiles(await harnessApi.listProfiles());
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  // ===== Rules =====
  const [rules, setRules] = useState<RecoveryRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);
  const [learnTraceId, setLearnTraceId] = useState<number | null>(null);
  const [learnResult, setLearnResult] = useState<{
    rule_draft: RecoveryRule;
    trace_summary: Record<string, unknown>;
  } | null>(null);
  const [learning, setLearning] = useState(false);
  const [savingRule, setSavingRule] = useState(false);

  const loadRules = useCallback(async () => {
    try {
      setRulesLoading(true);
      setRules(await harnessApi.listRules());
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
    loadRules();
  }, [loadProfiles, loadRules]);

  // ===== Profile handlers =====
  const openCreateProfile = () => {
    setEditingProfile(null);
    profileForm.resetFields();
    profileForm.setFieldsValue({
      name: '',
      max_iterations: 8,
      token_budget: 32000,
      allowed_tools: DEFAULT_ALLOWED_TOOLS,
      forbidden_actions: DEFAULT_FORBIDDEN,
      tool_failure_threshold: 3,
      compression_policy: DEFAULT_COMPRESSION,
    });
    setAllowedValid(true);
    setForbiddenValid(true);
    setCompressionValid(true);
    setProfileOpen(true);
  };

  const openEditProfile = (p: ConstraintProfile) => {
    setEditingProfile(p);
    profileForm.setFieldsValue({
      name: p.name,
      max_iterations: p.max_iterations,
      token_budget: p.token_budget,
      allowed_tools: p.allowed_tools ? JSON.stringify(p.allowed_tools, null, 2) : '[]',
      forbidden_actions: p.forbidden_actions
        ? JSON.stringify(p.forbidden_actions, null, 2)
        : '[]',
      tool_failure_threshold: p.tool_failure_threshold,
      compression_policy: p.compression_policy
        ? JSON.stringify(p.compression_policy, null, 2)
        : DEFAULT_COMPRESSION,
    });
    setAllowedValid(true);
    setForbiddenValid(true);
    setCompressionValid(true);
    setProfileOpen(true);
  };

  const handleSaveProfile = async () => {
    let v: ProfileFormValues;
    try {
      v = await profileForm.validateFields();
    } catch {
      return;
    }
    const allowedRes = tryParseJson(v.allowed_tools || '[]');
    const forbiddenRes = tryParseJson(v.forbidden_actions || '[]');
    const compRes = tryParseJson(v.compression_policy || DEFAULT_COMPRESSION);
    if (!allowedRes.ok) {
      setAllowedValid(false);
      message.error('allowed_tools JSON 格式错误');
      return;
    }
    if (!forbiddenRes.ok) {
      setForbiddenValid(false);
      message.error('forbidden_actions JSON 格式错误');
      return;
    }
    if (!compRes.ok) {
      setCompressionValid(false);
      message.error('compression_policy JSON 格式错误');
      return;
    }
    const body: Partial<ConstraintProfile> = {
      name: v.name,
      max_iterations: v.max_iterations,
      token_budget: v.token_budget,
      allowed_tools: allowedRes.value as unknown[],
      forbidden_actions: forbiddenRes.value as unknown[],
      tool_failure_threshold: v.tool_failure_threshold,
      compression_policy: compRes.value as Record<string, unknown>,
    };
    try {
      setProfileSaving(true);
      if (editingProfile) {
        await harnessApi.updateProfile(editingProfile.id, body);
        message.success('更新成功');
      } else {
        await harnessApi.createProfile(body);
        message.success('创建成功');
      }
      setProfileOpen(false);
      await loadProfiles();
    } finally {
      setProfileSaving(false);
    }
  };

  const handleDeleteProfile = (p: ConstraintProfile) => {
    modal.confirm({
      title: `删除约束 Profile "${p.name}"？`,
      okType: 'danger',
      onOk: async () => {
        await harnessApi.removeProfile(p.id);
        message.success('已删除');
        await loadProfiles();
      },
    });
  };

  // ===== Learn from failure =====
  const openLearn = () => {
    setLearnTraceId(null);
    setLearnResult(null);
    setLearnOpen(true);
  };

  const handleLearn = async () => {
    if (!learnTraceId) {
      message.warning('请输入 Trace ID');
      return;
    }
    try {
      setLearning(true);
      const r = await harnessApi.learnFromFailure(learnTraceId);
      setLearnResult(r);
      message.success('已生成规则草稿');
    } finally {
      setLearning(false);
    }
  };

  const handleSaveRule = async () => {
    if (!learnResult) return;
    try {
      setSavingRule(true);
      await harnessApi.createRule({
        ...learnResult.rule_draft,
        // 显式带上 source_trace_id（若草稿已带则保留）
        source_trace_id: learnResult.rule_draft.source_trace_id ?? learnTraceId,
      });
      message.success('已保存为规则');
      setLearnOpen(false);
      await loadRules();
    } finally {
      setSavingRule(false);
    }
  };

  const handleDeleteRule = (r: RecoveryRule) => {
    modal.confirm({
      title: '删除回收规则？',
      okType: 'danger',
      onOk: async () => {
        await harnessApi.removeRule(r.id);
        message.success('已删除');
        await loadRules();
      },
    });
  };

  const profileColumns: ColumnsType<ConstraintProfile> = [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: 'Max 迭代', dataIndex: 'max_iterations', width: 100, align: 'center' as const },
    { title: 'Token 预算', dataIndex: 'token_budget', width: 120, align: 'right' as const },
    {
      title: '允许工具',
      dataIndex: 'allowed_tools',
      width: 140,
      ellipsis: true,
      render: (v: unknown[]) =>
        Array.isArray(v) ? v.map((t, i) => <Tag key={i}>{String(t)}</Tag>) : '-',
    },
    {
      title: '失败阈值',
      dataIndex: 'tool_failure_threshold',
      width: 100,
      align: 'center' as const,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      width: 160,
      render: (_, r) => (
        <Space size="small">
          <a onClick={() => openEditProfile(r)}>编辑</a>
          <a style={{ color: '#ff4d4f' }} onClick={() => handleDeleteProfile(r)}>
            删除
          </a>
        </Space>
      ),
    },
  ];

  const ruleColumns: ColumnsType<RecoveryRule> = [
    { title: 'Agent', dataIndex: 'agent_id', width: 90, render: (v) => v ?? '-' },
    {
      title: '触发',
      dataIndex: 'trigger',
      ellipsis: true,
      render: (v: Record<string, unknown>) => JSON.stringify(v),
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 130,
      render: (v: RecoveryRule['action']) => (
        <Tag color={ACTION_COLOR[v]}>{ACTION_LABEL[v] || v}</Tag>
      ),
    },
    {
      title: '建议',
      dataIndex: 'advice',
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: '来源 Trace',
      dataIndex: 'source_trace_id',
      width: 110,
      render: (v?: number | null) => (v ? <Tag>#{v}</Tag> : '-'),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      width: 90,
      render: (_, r) => (
        <a style={{ color: '#ff4d4f' }} onClick={() => handleDeleteRule(r)}>
          删除
        </a>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={4}>Harness 工程</Typography.Title>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'profiles',
            label: '约束 Profile',
            children: (
              <div>
                <Button type="primary" style={{ marginBottom: 12 }} onClick={openCreateProfile}>
                  新建约束 Profile
                </Button>
                <Table<ConstraintProfile>
                  rowKey="id"
                  size="small"
                  loading={profilesLoading}
                  columns={profileColumns}
                  dataSource={profiles}
                  pagination={{ pageSize: 10 }}
                />
              </div>
            ),
          },
          {
            key: 'rules',
            label: '错误回收规则',
            children: (
              <div>
                <Button type="primary" style={{ marginBottom: 12 }} onClick={openLearn}>
                  从失败 Trace 学习
                </Button>
                <Table<RecoveryRule>
                  rowKey="id"
                  size="small"
                  loading={rulesLoading}
                  columns={ruleColumns}
                  dataSource={rules}
                  pagination={{ pageSize: 10 }}
                />
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={editingProfile ? '编辑约束 Profile' : '新建约束 Profile'}
        open={profileOpen}
        onOk={handleSaveProfile}
        onCancel={() => setProfileOpen(false)}
        confirmLoading={profileSaving}
        destroyOnClose
        width={680}
      >
        <Form<ProfileFormValues>
          form={profileForm}
          layout="vertical"
          preserve={false}
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="max_iterations"
                label="最大迭代数"
                rules={[{ required: true }]}
              >
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="token_budget"
                label="Token 预算"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="tool_failure_threshold"
                label="工具失败阈值"
                rules={[{ required: true }]}
              >
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="allowed_tools"
            label="允许的工具（JSON 数组，['*'] 表示全部）"
            validateStatus={allowedValid ? undefined : 'error'}
            help={allowedValid ? undefined : 'JSON 格式错误'}
          >
            <Input.TextArea
              rows={2}
              onChange={(e) => setAllowedValid(tryParseJson(e.target.value || '[]').ok)}
            />
          </Form.Item>
          <Form.Item
            name="forbidden_actions"
            label="禁止动作（JSON 数组）"
            validateStatus={forbiddenValid ? undefined : 'error'}
            help={forbiddenValid ? undefined : 'JSON 格式错误'}
          >
            <Input.TextArea
              rows={2}
              onChange={(e) => setForbiddenValid(tryParseJson(e.target.value || '[]').ok)}
            />
          </Form.Item>
          <Form.Item
            name="compression_policy"
            label="压缩策略（JSON）"
            validateStatus={compressionValid ? undefined : 'error'}
            help={compressionValid ? undefined : 'JSON 格式错误'}
          >
            <Input.TextArea
              rows={4}
              onChange={(e) => setCompressionValid(tryParseJson(e.target.value || '{}').ok)}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="从失败 Trace 学习"
        open={learnOpen}
        onCancel={() => setLearnOpen(false)}
        width={720}
        footer={[
          <Button key="close" onClick={() => setLearnOpen(false)}>
            关闭
          </Button>,
          <Button
            key="learn"
            type="primary"
            loading={learning}
            onClick={handleLearn}
            disabled={!learnTraceId}
          >
            学习
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={savingRule}
            onClick={handleSaveRule}
            disabled={!learnResult}
          >
            保存为规则
          </Button>,
        ]}
      >
        <Form layout="vertical">
          <Form.Item label="Trace ID">
            <InputNumber
              min={1}
              style={{ width: '100%' }}
              value={learnTraceId ?? undefined}
              onChange={(v) => setLearnTraceId(typeof v === 'number' ? v : null)}
              placeholder="失败的 Trace ID"
            />
          </Form.Item>
        </Form>
        {learnResult && (
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
        )}
      </Modal>
    </div>
  );
}
