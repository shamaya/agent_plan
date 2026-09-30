import { useEffect, useState, useRef } from 'react';
import {
  Card, Spin, message, Typography, Space, Button, Input, Empty, Tag, Row, Col,
  Table, Modal, Select, Drawer, Alert, Tooltip, Popconfirm, Divider, Collapse,
  Progress, Slider, Tabs, Badge, Steps,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SaveOutlined, PlayCircleOutlined,
  CloseCircleOutlined, AuditOutlined,
  RobotOutlined, LineChartOutlined, FileTextOutlined, TrophyOutlined,
  HistoryOutlined, RollbackOutlined,
} from '@ant-design/icons';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  Legend, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import { evaluationApi, runEvaluationStream } from '@/api/endpoints/evaluation';
import type { VersionSnapshot } from '@/api/endpoints/workflow';
import { agentApi } from '@/api/endpoints/agent';
import { providerApi } from '@/api/endpoints/provider';
import type {
  Agent, Evaluation, EvaluationCriterion, EvaluationRun, EvaluationSseEvent,
  Model,
} from '@/types';

const { Text, Paragraph, Title } = Typography;
const { TextArea } = Input;

const STATUS_COLOR: Record<string, string> = {
  pending: 'default',
  running: 'processing',
  completed: 'success',
  failed: 'error',
};

// 得分颜色
function scoreColor(s: number): string {
  if (s >= 4.5) return '#52c41a';
  if (s >= 3.5) return '#52c41a';
  if (s >= 2.5) return '#faad14';
  if (s >= 1.5) return '#fa8c16';
  return '#f5222d';
}

export default function Evaluations() {
  const [loading, setLoading] = useState(true);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<{ value: number; label: string }[]>([]);
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const [editing, setEditing] = useState<Evaluation | null>(null);
  const [saving, setSaving] = useState(false);

  // 运行抽屉
  const [runDrawerOpen, setRunDrawerOpen] = useState(false);
  const [runPrompt, setRunPrompt] = useState('用一句话介绍你自己。');
  const [runPhase, setRunPhase] = useState<'idle' | 'agent' | 'judge' | 'done' | 'failed'>('idle');
  const [runResult, setRunResult] = useState<{
    overall_score: number;
    criteria: Record<string, { score: number; reason: string }>;
    response_preview: string;
    judge_raw_preview: string;
    error: string;
  }>({ overall_score: 0, criteria: {}, response_preview: '', judge_raw_preview: '', error: '' });
  const abortRef = useRef<AbortController | null>(null);

  // 运行历史
  const [runs, setRuns] = useState<EvaluationRun[]>([]);

  // 版本历史
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // 初始化
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [evalList, agentList] = await Promise.all([evaluationApi.list(), agentApi.list()]);
        setEvaluations(evalList);
        setAgents(agentList);
        // 加载所有模型
        try {
          const providers = await providerApi.list();
          const enabled = providers.filter((p) => p.enabled && (p.kind === 'chat' || p.kind === 'both'));
          const modelLists = await Promise.all(enabled.map((p) => providerApi.models(p.id)));
          const opts: { value: number; label: string }[] = [];
          enabled.forEach((p, i) => {
            (modelLists[i] || []).forEach((m: Model) => {
              opts.push({ value: m.id, label: `${m.model_name}（${p.name}）` });
            });
          });
          setModels(opts);
        } catch { /* */ }
        if (evalList.length > 0) setSelectedId(evalList[0].id);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 选中时加载详情 + 运行历史
  useEffect(() => {
    if (!selectedId) { setEditing(null); setRuns([]); return; }
    (async () => {
      try {
        const [ev, runList] = await Promise.all([
          evaluationApi.get(selectedId),
          evaluationApi.listRuns(selectedId),
        ]);
        setEditing(ev);
        setRuns(runList);
      } catch { /* */ }
    })();
  }, [selectedId]);

  // ===== 新建 =====
  const create = async () => {
    if (agents.length === 0) { message.warning('请先创建 Agent'); return; }
    try {
      const ev = await evaluationApi.create({
        name: `评估 ${evaluations.length + 1}`,
        agent_id: agents[0].id,
        description: '',
        criteria: [
          { id: 'accuracy', name: '准确性', description: '回答是否准确', weight: 1, rubric: '' },
          { id: 'completeness', name: '完整性', description: '是否完整回答', weight: 1, rubric: '' },
          { id: 'clarity', name: '清晰性', description: '表达是否清晰', weight: 1, rubric: '' },
        ],
      });
      setEvaluations([ev, ...evaluations]);
      setSelectedId(ev.id);
      message.success('已新建评估（含 3 个默认准则）');
    } catch { /* */ }
  };

  // ===== 编辑 =====
  const updateCriterion = (idx: number, patch: Partial<EvaluationCriterion>) => {
    if (!editing) return;
    const criteria = [...editing.criteria];
    criteria[idx] = { ...criteria[idx], ...patch };
    setEditing({ ...editing, criteria });
  };

  const addCriterion = () => {
    if (!editing) return;
    const newId = `c${Date.now().toString(36)}`;
    const c: EvaluationCriterion = {
      id: newId, name: `准则 ${editing.criteria.length + 1}`,
      description: '', weight: 1, rubric: '',
    };
    setEditing({ ...editing, criteria: [...editing.criteria, c] });
  };

  const removeCriterion = (idx: number) => {
    if (!editing) return;
    setEditing({ ...editing, criteria: editing.criteria.filter((_, i) => i !== idx) });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const ev = await evaluationApi.update(editing.id, {
        name: editing.name, description: editing.description,
        criteria: editing.criteria,
        judge_model_id: editing.judge_model_id ?? null,
      });
      setEditing(ev);
      setEvaluations(evaluations.map((e) => (e.id === ev.id ? ev : e)));
      message.success('已保存');
    } catch { /* */ } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    try {
      await evaluationApi.remove(editing.id);
      const rest = evaluations.filter((e) => e.id !== editing.id);
      setEvaluations(rest);
      setSelectedId(rest[0]?.id);
      message.success('已删除');
    } catch { /* */ }
  };

  // ===== 版本历史 =====
  const openVersionDrawer = async () => {
    if (!editing) return;
    setVersionDrawerOpen(true);
    setVersionsLoading(true);
    try {
      setVersions(await evaluationApi.listVersions(editing.id));
    } catch { /* */ } finally {
      setVersionsLoading(false);
    }
  };

  const saveSnapshot = async () => {
    if (!editing) return;
    const note = window.prompt('版本备注（可选）', '');
    if (note === null) return;
    try {
      await evaluationApi.saveVersion(editing.id, note);
      message.success('已保存版本快照');
      setVersions(await evaluationApi.listVersions(editing.id));
    } catch { /* */ }
  };

  const rollbackTo = async (versionId: number) => {
    if (!editing) return;
    try {
      const ev = await evaluationApi.rollbackVersion(editing.id, versionId);
      message.success('已回滚');
      setEditing(ev);
      setEvaluations(evaluations.map((e) => (e.id === ev.id ? ev : e)));
      setVersions(await evaluationApi.listVersions(editing.id));
    } catch { /* */ }
  };

  // ===== 运行 =====
  const openRun = () => {
    if (!editing || editing.criteria.length === 0) {
      message.warning('请先配置评估准则');
      return;
    }
    setRunPhase('idle');
    setRunResult({ overall_score: 0, criteria: {}, response_preview: '', judge_raw_preview: '', error: '' });
    setRunDrawerOpen(true);
  };

  const startRun = async () => {
    if (!editing) return;
    if (!runPrompt.trim()) { message.warning('请输入测试 prompt'); return; }
    setRunPhase('agent');
    setRunResult({ overall_score: 0, criteria: {}, response_preview: '', judge_raw_preview: '', error: '' });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await runEvaluationStream(editing.id, runPrompt.trim(), (evt: EvaluationSseEvent) => {
        handleSse(evt);
      }, ctrl.signal);
    } catch (e) {
      setRunPhase('failed');
      setRunResult((r) => ({ ...r, error: (e as Error).message }));
    } finally {
      abortRef.current = null;
      try {
        const runList = await evaluationApi.listRuns(editing.id);
        setRuns(runList);
      } catch { /* */ }
    }
  };

  const stopRun = () => {
    abortRef.current?.abort();
    setRunPhase('failed');
    setRunResult((r) => ({ ...r, error: '已手动中断' }));
  };

  const handleSse = (evt: EvaluationSseEvent) => {
    switch (evt.type) {
      case 'evaluation_start':
        setRunPhase('agent');
        break;
      case 'agent_done':
        setRunResult((r) => ({ ...r, response_preview: evt.response_preview }));
        setRunPhase('judge');
        break;
      case 'judge_done':
        setRunResult((r) => ({
          ...r,
          overall_score: evt.overall_score,
          criteria: evt.criteria,
          judge_raw_preview: evt.judge_raw_preview,
        }));
        break;
      case 'evaluation_done':
        setRunResult((r) => ({
          ...r,
          overall_score: evt.overall_score,
          criteria: evt.criteria,
        }));
        setRunPhase('done');
        message.success(`评估完成，总分 ${evt.overall_score}`);
        break;
      case 'evaluation_error':
      case 'error':
        setRunPhase('failed');
        setRunResult((r) => ({ ...r, error: (evt as any).error || (evt as any).message || '评估失败' }));
        break;
    }
  };

  // ===== 历史详情 =====
  const [historyDetail, setHistoryDetail] = useState<EvaluationRun | null>(null);
  const openHistory = async (runId: number) => {
    try {
      const r = await evaluationApi.getRun(runId);
      setHistoryDetail(r);
    } catch { /* */ }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', padding: 48 }} />;

  return (
    <div>
      <Title level={4}>
        <AuditOutlined style={{ marginRight: 8 }} />
        评估框架（LLM-as-Judge）
      </Title>
      <Paragraph type="secondary">
        用 LLM 当裁判，按自定义准则对 Agent 输出打分（0-5 分）。多次运行形成趋势，折线图跟踪总分变化，雷达图展示各准则得分分布。
      </Paragraph>

      <Row gutter={16}>
        {/* 左：评估列表 */}
        <Col span={6}>
          <Card
            title={`评估 (${evaluations.length})`}
            size="small"
            extra={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={create}>新建</Button>}
            bodyStyle={{ padding: 0 }}
          >
            <div style={{ maxHeight: 600, overflow: 'auto' }}>
              {evaluations.length === 0 ? (
                <Empty description="暂无评估" style={{ padding: 24 }} />
              ) : (
                evaluations.map((e) => (
                  <div
                    key={e.id}
                    onClick={() => setSelectedId(e.id)}
                    style={{
                      padding: '10px 14px', cursor: 'pointer',
                      borderBottom: '1px solid #f0f0f0',
                      background: e.id === selectedId ? '#e6f4ff' : undefined,
                    }}
                  >
                    <Space direction="vertical" size={0} style={{ width: '100%' }}>
                      <Space>
                        <AuditOutlined />
                        <Text strong={e.id === selectedId}>{e.name}</Text>
                      </Space>
                      <Space size={4}>
                        <Tag color="blue"><RobotOutlined /> {e.agent_name}</Tag>
                        <Tag color="purple">{e.criteria.length} 准则</Tag>
                      </Space>
                    </Space>
                  </div>
                ))
              )}
            </div>
          </Card>
        </Col>

        {/* 右：编辑器 + 趋势 */}
        <Col span={18}>
          {!editing ? (
            <Card>
              <Empty description="请选择或新建评估">
                <Button type="primary" icon={<PlusOutlined />} onClick={create}>新建评估</Button>
              </Empty>
            </Card>
          ) : (
            <Tabs
              defaultActiveKey="config"
              items={[
                {
                  key: 'config',
                  label: '评估配置',
                  children: (
                    <Card
                      title={
                        <Space>
                          <Input
                            value={editing.name}
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                            style={{ width: 280 }}
                          />
                          <Tag color="blue"><RobotOutlined /> {editing.agent_name}</Tag>
                          <Tag color="purple">{editing.criteria.length} 准则</Tag>
                        </Space>
                      }
                      extra={
                        <Space>
                          <Button icon={<SaveOutlined />} type="primary" loading={saving} onClick={save}>保存</Button>
                          <Button type="primary" ghost icon={<PlayCircleOutlined />} onClick={openRun}>运行评估</Button>
                          <Button icon={<HistoryOutlined />} onClick={openVersionDrawer}>版本历史</Button>
                          <Popconfirm title="删除此评估？" onConfirm={remove}>
                            <Button danger icon={<DeleteOutlined />}>删除</Button>
                          </Popconfirm>
                        </Space>
                      }
                    >
                      <Row gutter={12} style={{ marginBottom: 16 }}>
                        <Col span={12}>
                          <Text strong style={{ display: 'block', marginBottom: 4 }}>被评估 Agent</Text>
                          <Select
                            value={editing.agent_id}
                            onChange={(v) => setEditing({ ...editing, agent_id: v })}
                            style={{ width: '100%' }}
                            options={agents.map((a) => ({ label: a.name, value: a.id }))}
                          />
                        </Col>
                        <Col span={12}>
                          <Text strong style={{ display: 'block', marginBottom: 4 }}>
                            评分模型（judge，留空用 Agent 自身 model）
                          </Text>
                          <Select
                            value={editing.judge_model_id ?? null}
                            onChange={(v) => setEditing({ ...editing, judge_model_id: v })}
                            style={{ width: '100%' }}
                            allowClear
                            placeholder="不选则使用被评估 Agent 的 model"
                            options={models}
                          />
                        </Col>
                      </Row>
                      <div style={{ marginBottom: 16 }}>
                        <Text strong style={{ display: 'block', marginBottom: 4 }}>描述</Text>
                        <Input
                          value={editing.description}
                          onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                          placeholder="一句话说明评估目的"
                        />
                      </div>

                      <div style={{ marginBottom: 8 }}>
                        <Space>
                          <Text strong>评估准则</Text>
                          <Button size="small" icon={<PlusOutlined />} onClick={addCriterion}>添加准则</Button>
                        </Space>
                      </div>

                      {editing.criteria.length === 0 ? (
                        <Empty description="暂无准则" />
                      ) : (
                        editing.criteria.map((c, idx) => (
                          <Card key={c.id + '_' + idx} size="small" style={{ marginBottom: 8 }}
                            title={
                              <Space>
                                <Tag color="geekblue">#{idx + 1}</Tag>
                                <Input
                                  value={c.name}
                                  onChange={(e) => updateCriterion(idx, { name: e.target.value })}
                                  style={{ width: 160 }}
                                  placeholder="准则名"
                                />
                                <Text type="secondary" style={{ fontSize: 12 }}>({c.id})</Text>
                              </Space>
                            }
                            extra={
                              <Popconfirm title="删除此准则？" onConfirm={() => removeCriterion(idx)}>
                                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            }
                          >
                            <Row gutter={8}>
                              <Col span={14}>
                                <Text type="secondary" style={{ fontSize: 12 }}>描述</Text>
                                <Input
                                  value={c.description}
                                  onChange={(e) => updateCriterion(idx, { description: e.target.value })}
                                  placeholder="准则说明"
                                  size="small"
                                />
                              </Col>
                              <Col span={6}>
                                <Text type="secondary" style={{ fontSize: 12 }}>权重：{c.weight}</Text>
                                <Slider
                                  min={0} max={5} step={0.1} value={c.weight}
                                  onChange={(v) => updateCriterion(idx, { weight: v })}
                                  marks={{ 0: '0', 1: '1', 3: '3', 5: '5' }}
                                />
                              </Col>
                              <Col span={4} style={{ textAlign: 'right' }}>
                                <Tag color="gold" style={{ fontSize: 16, padding: '4px 12px' }}>×{c.weight}</Tag>
                              </Col>
                            </Row>
                            <div style={{ marginTop: 8 }}>
                              <Text type="secondary" style={{ fontSize: 12 }}>评分标准（rubric，可选）</Text>
                              <Input
                                value={c.rubric}
                                onChange={(e) => updateCriterion(idx, { rubric: e.target.value })}
                                placeholder="如：5分=完全准确，3分=部分准确，1分=错误"
                                size="small"
                              />
                            </div>
                          </Card>
                        ))
                      )}
                    </Card>
                  ),
                },
                {
                  key: 'trend',
                  label: (
                    <Space>
                      趋势图
                      {runs.length > 0 && <Badge count={runs.length} />}
                    </Space>
                  ),
                  children: <TrendTab runs={runs} evaluation={editing} />,
                },
                {
                  key: 'history',
                  label: (
                    <Space>
                      运行历史
                      {runs.length > 0 && <Badge count={runs.length} />}
                    </Space>
                  ),
                  children: (
                    <HistoryTab runs={runs} onOpenHistory={openHistory} />
                  ),
                },
              ]}
            />
          )}
        </Col>
      </Row>

      {/* 运行抽屉 */}
      <Drawer
        title="运行评估"
        open={runDrawerOpen}
        onClose={() => setRunDrawerOpen(false)}
        width={760}
        extra={
          runPhase === 'agent' || runPhase === 'judge' ? (
            <Button danger icon={<CloseCircleOutlined />} onClick={stopRun}>中断</Button>
          ) : (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={startRun}>开始评估</Button>
          )
        }
      >
        <RunPanel
          evaluation={editing}
          runPrompt={runPrompt}
          setRunPrompt={setRunPrompt}
          runPhase={runPhase}
          runResult={runResult}
        />
      </Drawer>

      {/* 历史详情 */}
      <Modal
        title={`运行 #${historyDetail?.id} 详情`}
        open={!!historyDetail}
        onCancel={() => setHistoryDetail(null)}
        footer={<Button onClick={() => setHistoryDetail(null)}>关闭</Button>}
        width={760}
      >
        {historyDetail && <HistoryDetail run={historyDetail} />}
      </Modal>

      {/* 版本历史抽屉 */}
      <Drawer
        title="版本历史"
        placement="right"
        open={versionDrawerOpen}
        onClose={() => setVersionDrawerOpen(false)}
        width={560}
        extra={
          <Button type="primary" icon={<SaveOutlined />} onClick={saveSnapshot}>
            保存当前版本
          </Button>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          每次保存会自动生成「更新前快照」，也可手动保存带备注的版本。点击「回滚」将当前评估恢复到该版本（回滚前会自动存一份当前状态）。
        </Typography.Paragraph>
        <Spin spinning={versionsLoading}>
          {versions.length === 0 ? (
            <Empty description="暂无版本，点击「保存当前版本」创建" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {versions.map((v) => (
                <Card key={v.id} size="small"
                  extra={
                    <Popconfirm title={`确定回滚到 v${v.version}？当前状态会被自动保存。`}
                      onConfirm={() => rollbackTo(v.id)}>
                      <Button size="small" icon={<RollbackOutlined />}>回滚</Button>
                    </Popconfirm>
                  }
                >
                  <Space>
                    <Tag color="blue">v{v.version}</Tag>
                    <Text strong>{v.note || '（无备注）'}</Text>
                  </Space>
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(v.created_at).toLocaleString('zh-CN')}
                    </Text>
                  </div>
                  <Collapse ghost size="small" style={{ marginTop: 4 }}>
                    <Collapse.Panel header="查看快照内容" key="snap">
                      <pre style={{ fontSize: 12, background: '#fafafa', padding: 8, borderRadius: 4, maxHeight: 260, overflow: 'auto' }}>
                        {JSON.stringify(v.snapshot, null, 2)}
                      </pre>
                    </Collapse.Panel>
                  </Collapse>
                </Card>
              ))}
            </div>
          )}
        </Spin>
      </Drawer>
    </div>
  );
}

// 运行面板
function RunPanel({
  evaluation, runPrompt, setRunPrompt, runPhase, runResult,
}: {
  evaluation: Evaluation | null;
  runPrompt: string;
  setRunPrompt: (v: string) => void;
  runPhase: 'idle' | 'agent' | 'judge' | 'done' | 'failed';
  runResult: {
    overall_score: number;
    criteria: Record<string, { score: number; reason: string }>;
    response_preview: string;
    judge_raw_preview: string;
    error: string;
  };
}) {
  if (!evaluation) return null;

  const phases = [
    { key: 'idle', title: '等待' },
    { key: 'agent', title: '调用 Agent' },
    { key: 'judge', title: 'LLM 评分' },
    { key: 'done', title: '完成' },
  ];
  const phaseIndex = runPhase === 'failed' ? -1 : phases.findIndex((p) => p.key === runPhase);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>测试 Prompt</Text>
        <TextArea
          value={runPrompt}
          onChange={(e) => setRunPrompt(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 8 }}
          disabled={runPhase === 'agent' || runPhase === 'judge'}
          placeholder="发送给被评估 Agent 的 prompt"
        />
      </div>

      {/* 阶段进度 */}
      <Steps
        current={phaseIndex}
        status={runPhase === 'failed' ? 'error' : 'process'}
        size="small"
        style={{ marginBottom: 24 }}
        items={phases.map((p) => ({ title: p.title }))}
      />

      {runPhase === 'failed' && runResult.error && (
        <Alert type="error" message={runResult.error} style={{ marginBottom: 16 }} />
      )}

      {/* Agent 响应预览 */}
      {runResult.response_preview && (
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            <RobotOutlined /> Agent 响应（{runResult.response_preview.length} 字符）
          </Text>
          <div style={{ background: '#fafafa', padding: 12, borderRadius: 6, maxHeight: 200, overflow: 'auto' }}>
            <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13 }}>
              {runResult.response_preview}
            </Paragraph>
          </div>
        </div>
      )}

      {/* 评分结果 */}
      {(runPhase === 'judge' || runPhase === 'done') && (
        <div>
          <Space style={{ marginBottom: 16 }} align="center">
            <TrophyOutlined style={{ fontSize: 32, color: '#faad14' }} />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>总分（加权平均）</Text>
              <div>
                <Text style={{ fontSize: 36, fontWeight: 'bold', color: scoreColor(runResult.overall_score) }}>
                  {runResult.overall_score || 0}
                </Text>
                <Text type="secondary" style={{ fontSize: 16 }}> / 5.0</Text>
              </div>
            </div>
          </Space>

          {/* 各准则得分 */}
          {Object.keys(runResult.criteria).length > 0 && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 12 }}>各准则得分</Text>
              <Row gutter={[12, 12]}>
                {evaluation.criteria.map((c) => {
                  const r = runResult.criteria[c.id];
                  const score = r?.score ?? 0;
                  return (
                    <Col span={12} key={c.id}>
                      <Card size="small" style={{ borderLeft: `3px solid ${scoreColor(score)}` }}>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                          <Text strong>{c.name}</Text>
                          <Text style={{ fontSize: 20, fontWeight: 'bold', color: scoreColor(score) }}>
                            {score}
                            <Text type="secondary" style={{ fontSize: 12 }}>/5</Text>
                          </Text>
                        </Space>
                        <Progress
                          percent={(score / 5) * 100}
                          showInfo={false}
                          size="small"
                          strokeColor={scoreColor(score)}
                          style={{ margin: '8px 0' }}
                        />
                        {r?.reason && (
                          <Text type="secondary" style={{ fontSize: 12 }}>{r.reason}</Text>
                        )}
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            </div>
          )}
        </div>
      )}

      {/* judge 原始输出 */}
      {runResult.judge_raw_preview && (
        <div style={{ marginTop: 16 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Judge 原始输出（片段）</Text>
          <pre style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 11, maxHeight: 150, overflow: 'auto' }}>
            {runResult.judge_raw_preview}
          </pre>
        </div>
      )}
    </div>
  );
}

// 趋势图 Tab
function TrendTab({ runs, evaluation }: { runs: EvaluationRun[]; evaluation: Evaluation }) {
  if (runs.length === 0) {
    return (
      <Card>
        <Empty description="暂无运行记录，先去运行一次评估" />
      </Card>
    );
  }
  const completed = runs.filter((r) => r.status === 'completed');
  if (completed.length === 0) {
    return (
      <Card>
        <Empty description="暂无成功的运行记录" />
      </Card>
    );
  }

  // 折线图数据：x=运行序号，y=总分 + 各准则
  const lineData = completed.map((r, i) => {
    const row: Record<string, number | string> = { index: `#${i + 1}` };
    row['总分'] = r.results?.overall_score ?? 0;
    evaluation.criteria.forEach((c) => {
      row[c.name] = r.results?.criteria?.[c.id]?.score ?? 0;
    });
    return row;
  });

  // 雷达图数据：各准则平均分
  const radarData = evaluation.criteria.map((c) => {
    const scores = completed.map((r) => r.results?.criteria?.[c.id]?.score ?? 0);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return { criterion: c.name, score: Number(avg.toFixed(2)) };
  });

  return (
    <Row gutter={16}>
      <Col span={16}>
        <Card title={<Space><LineChartOutlined /> 总分趋势</Space>} size="small">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="index" />
              <YAxis domain={[0, 5]} />
              <RTooltip />
              <Legend />
              <Line type="monotone" dataKey="总分" stroke="#1890ff" strokeWidth={3} dot={{ r: 5 }} />
              {evaluation.criteria.map((c) => (
                <Line
                  key={c.id}
                  type="monotone"
                  dataKey={c.name}
                  stroke="#999"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </Col>
      <Col span={8}>
        <Card title={<Space><AuditOutlined /> 准则均分雷达</Space>} size="small">
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="criterion" tick={{ fontSize: 11 }} />
              <PolarRadiusAxis domain={[0, 5]} />
              <Radar name="均分" dataKey="score" stroke="#1890ff" fill="#1890ff" fillOpacity={0.4} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>
      </Col>
    </Row>
  );
}

// 历史 Tab
function HistoryTab({ runs, onOpenHistory }: { runs: EvaluationRun[]; onOpenHistory: (id: number) => void }) {
  if (runs.length === 0) {
    return <Empty description="暂无运行记录" />;
  }
  return (
    <Table
      size="small"
      dataSource={runs}
      rowKey="id"
      pagination={{ pageSize: 10 }}
      onRow={(r) => ({ onClick: () => onOpenHistory(r.id), style: { cursor: 'pointer' } })}
      columns={[
        { title: 'ID', dataIndex: 'id', width: 60 },
        {
          title: '状态', dataIndex: 'status', width: 90,
          render: (s: string) => <Tag color={STATUS_COLOR[s] || 'default'}>{s}</Tag>,
        },
        {
          title: '总分', dataIndex: 'results', width: 80,
          render: (r: EvaluationRun['results']) => {
            const s = r?.overall_score;
            return s != null ? (
              <Text strong style={{ color: scoreColor(s) }}>{s}</Text>
            ) : <Text type="secondary">-</Text>;
          },
        },
        {
          title: '输入 Prompt', dataIndex: 'input_prompt',
          render: (p: string) => (
            <Tooltip title={p}>
              <Text style={{ fontSize: 12 }}>{p.slice(0, 60)}...</Text>
            </Tooltip>
          ),
        },
        {
          title: '开始', dataIndex: 'started_at', width: 150,
          render: (ts?: string | null) => ts ? new Date(ts).toLocaleString('zh-CN') : '-',
        },
        {
          title: '操作', key: 'action', width: 80,
          render: (_: unknown, r: EvaluationRun) => (
            <Button size="small" type="link" icon={<FileTextOutlined />}
              onClick={(e) => { e.stopPropagation(); onOpenHistory(r.id); }}>
              详情
            </Button>
          ),
        },
      ]}
    />
  );
}

// 历史详情
function HistoryDetail({ run }: { run: EvaluationRun }) {
  return (
    <div>
      <Row gutter={12}>
        <Col span={6}>
          <Text type="secondary" style={{ fontSize: 12 }}>状态</Text>
          <div><Tag color={STATUS_COLOR[run.status]}>{run.status}</Tag></div>
        </Col>
        <Col span={6}>
          <Text type="secondary" style={{ fontSize: 12 }}>总分</Text>
          <div>
            <Text strong style={{ fontSize: 20, color: scoreColor(run.results?.overall_score || 0) }}>
              {run.results?.overall_score ?? '-'}
            </Text>
          </div>
        </Col>
        <Col span={6}>
          <Text type="secondary" style={{ fontSize: 12 }}>开始</Text>
          <div><Text style={{ fontSize: 12 }}>{run.started_at ? new Date(run.started_at).toLocaleString('zh-CN') : '-'}</Text></div>
        </Col>
        <Col span={6}>
          <Text type="secondary" style={{ fontSize: 12 }}>结束</Text>
          <div><Text style={{ fontSize: 12 }}>{run.finished_at ? new Date(run.finished_at).toLocaleString('zh-CN') : '-'}</Text></div>
        </Col>
      </Row>
      {run.error && <Alert type="error" message={run.error} style={{ marginTop: 12 }} />}

      <Divider />
      <Text strong style={{ display: 'block', marginBottom: 8 }}>输入 Prompt</Text>
      <div style={{ background: '#fafafa', padding: 10, borderRadius: 6, fontSize: 13 }}>{run.input_prompt}</div>

      {run.results?.response && (
        <>
          <Text strong style={{ display: 'block', margin: '12px 0 8px' }}>Agent 响应</Text>
          <div style={{ background: '#fafafa', padding: 10, borderRadius: 6, fontSize: 13, maxHeight: 200, overflow: 'auto' }}>
            <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{run.results.response}</Paragraph>
          </div>
        </>
      )}

      {run.results?.criteria && Object.keys(run.results.criteria).length > 0 && (
        <>
          <Text strong style={{ display: 'block', margin: '12px 0 8px' }}>评分详情</Text>
          {Object.entries(run.results.criteria).map(([cid, r]) => (
            <Card key={cid} size="small" style={{ marginBottom: 8, borderLeft: `3px solid ${scoreColor(r.score)}` }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Text strong>{cid}</Text>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: scoreColor(r.score) }}>{r.score}/5</Text>
              </Space>
              {r.reason && <Text type="secondary" style={{ fontSize: 12 }}>{r.reason}</Text>}
            </Card>
          ))}
        </>
      )}

      {run.results?.judge_raw && (
        <>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>Judge 原始输出</Text>
          <pre style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 11, maxHeight: 200, overflow: 'auto' }}>
            {run.results.judge_raw}
          </pre>
        </>
      )}
    </div>
  );
}
