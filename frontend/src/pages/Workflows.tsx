import { useEffect, useState, useRef } from 'react';
import {
  Card, Spin, message, Typography, Space, Button, Input, Empty, Tag, Row, Col,
  Table, Modal, Select, Steps, Drawer, Collapse, Alert, Tooltip, Popconfirm,
  Divider, Badge,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SaveOutlined, PlayCircleOutlined,
  CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, NodeIndexOutlined,
  ApartmentOutlined, ArrowUpOutlined, ArrowDownOutlined, CopyOutlined,
  FileTextOutlined, RobotOutlined, HistoryOutlined, RollbackOutlined,
} from '@ant-design/icons';
import { workflowApi, runWorkflowStream, type VersionSnapshot } from '@/api/endpoints/workflow';
import { agentApi } from '@/api/endpoints/agent';
import type {
  Agent, Workflow, WorkflowNode, WorkflowRun, WorkflowValidation,
  WorkflowSseEvent, WorkflowNodeResult,
} from '@/types';

const { Text, Paragraph, Title } = Typography;
const { TextArea } = Input;

// 运行中节点的状态聚合（用于 Steps 展示）
interface RuntimeNodeState {
  id: string;
  name: string;
  agent_id: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  content?: string;
  error?: string;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  startedAt?: string;
  finishedAt?: string;
}

// 节点状态 → Steps status
const NODE_STATUS_TO_STEP: Record<RuntimeNodeState['status'], 'wait' | 'process' | 'finish' | 'error'> = {
  pending: 'wait',
  running: 'process',
  completed: 'finish',
  failed: 'error',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'default',
  running: 'processing',
  completed: 'success',
  failed: 'error',
  canceled: 'warning',
};

export default function Workflows() {
  const [loading, setLoading] = useState(true);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<WorkflowValidation | null>(null);

  // 运行抽屉
  const [runDrawerOpen, setRunDrawerOpen] = useState(false);
  const [runInput, setRunInput] = useState('{\n  "topic": "AI Agent 平台"\n}');
  const [runtimeNodes, setRuntimeNodes] = useState<RuntimeNodeState[]>([]);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [runError, setRunError] = useState<string>('');
  const [finalOutput, setFinalOutput] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  // 运行历史
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  // 版本历史
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // ===== 初始化 =====
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [wfList, agentList] = await Promise.all([workflowApi.list(), agentApi.list()]);
        setWorkflows(wfList);
        setAgents(agentList);
        if (wfList.length > 0) {
          setSelectedId(wfList[0].id);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 选中 workflow 时加载详情 + 运行历史
  useEffect(() => {
    if (!selectedId) {
      setEditing(null);
      setRuns([]);
      return;
    }
    (async () => {
      try {
        const [wf, runList] = await Promise.all([
          workflowApi.get(selectedId),
          workflowApi.listRuns(selectedId),
        ]);
        setEditing(wf);
        setRuns(runList);
        setValidation(null);
      } catch { /* */ }
    })();
  }, [selectedId]);

  // ===== 新建 =====
  const createWorkflow = async () => {
    try {
      const wf = await workflowApi.create({
        name: `工作流 ${workflows.length + 1}`,
        description: '',
        nodes: [],
      });
      setWorkflows([wf, ...workflows]);
      setSelectedId(wf.id);
      message.success('已新建空工作流');
    } catch { /* */ }
  };

  // 加载示例模板（一串链路：调研 → 起草 → 润色）
  const loadExample = async () => {
    if (!editing) return;
    if (agents.length < 3) {
      message.warning('加载示例需要至少 3 个 Agent（调研/起草/润色）');
      return;
    }
    const nodes: WorkflowNode[] = [
      {
        id: 'research', name: '调研', agent_id: agents[0].id,
        prompt_template: '请调研以下主题，输出 3 条要点：\n{{input.topic}}',
        depends_on: [],
      },
      {
        id: 'draft', name: '起草', agent_id: agents[1 % agents.length].id,
        prompt_template: '基于以下调研结果，起草一份 200 字以内的文章草稿：\n{{upstream.research}}',
        depends_on: ['research'],
      },
      {
        id: 'polish', name: '润色', agent_id: agents[2 % agents.length].id,
        prompt_template: '请润色以下草稿，使其更加专业简洁：\n{{upstream.draft}}',
        depends_on: ['draft'],
      },
    ];
    const wf = await workflowApi.update(editing.id, {
      name: editing.name, description: editing.description, nodes,
    });
    setEditing(wf);
    setWorkflows(workflows.map((w) => (w.id === wf.id ? wf : w)));
    message.success('已加载示例：调研→起草→润色');
  };

  // ===== 节点编辑 =====
  const updateNode = (idx: number, patch: Partial<WorkflowNode>) => {
    if (!editing) return;
    const nodes = [...editing.nodes];
    nodes[idx] = { ...nodes[idx], ...patch };
    setEditing({ ...editing, nodes });
  };

  // 替换全部节点（JSON 编辑用）
  const replaceNodes = (nodes: WorkflowNode[]) => {
    if (!editing) return;
    setEditing({ ...editing, nodes });
  };

  const addNode = () => {
    if (!editing) return;
    const newId = `n${editing.nodes.length + 1}_${Date.now().toString(36).slice(-4)}`;
    const node: WorkflowNode = {
      id: newId, name: `节点 ${editing.nodes.length + 1}`,
      agent_id: agents[0]?.id ?? 0, prompt_template: '', depends_on: [],
    };
    setEditing({ ...editing, nodes: [...editing.nodes, node] });
  };

  const removeNode = (idx: number) => {
    if (!editing) return;
    const removedId = editing.nodes[idx].id;
    // 从其他节点的 depends_on 中清理
    const nodes = editing.nodes
      .filter((_, i) => i !== idx)
      .map((n) => ({ ...n, depends_on: n.depends_on.filter((d) => d !== removedId) }));
    setEditing({ ...editing, nodes });
  };

  const moveNode = (idx: number, direction: -1 | 1) => {
    if (!editing) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= editing.nodes.length) return;
    const nodes = [...editing.nodes];
    [nodes[idx], nodes[newIdx]] = [nodes[newIdx], nodes[idx]];
    setEditing({ ...editing, nodes });
  };

  // ===== 保存 / 校验 =====
  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const wf = await workflowApi.update(editing.id, {
        name: editing.name, description: editing.description, nodes: editing.nodes,
      });
      setEditing(wf);
      setWorkflows(workflows.map((w) => (w.id === wf.id ? wf : w)));
      message.success('已保存');
    } catch { /* */ } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    if (!editing) return;
    try {
      const result = await workflowApi.validateDraft({
        name: editing.name, description: editing.description, nodes: editing.nodes,
      });
      setValidation(result);
      if (result.ok) message.success('DAG 校验通过');
      else message.warning(`校验失败：${result.errors.length} 处错误`);
    } catch { /* */ }
  };

  const remove = async () => {
    if (!editing) return;
    try {
      await workflowApi.remove(editing.id);
      const rest = workflows.filter((w) => w.id !== editing.id);
      setWorkflows(rest);
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
      setVersions(await workflowApi.listVersions(editing.id));
    } catch { /* */ } finally {
      setVersionsLoading(false);
    }
  };

  const saveSnapshot = async () => {
    if (!editing) return;
    const note = window.prompt('版本备注（可选）', '');
    if (note === null) return;
    try {
      await workflowApi.saveVersion(editing.id, note);
      message.success('已保存版本快照');
      setVersions(await workflowApi.listVersions(editing.id));
    } catch { /* */ }
  };

  const rollbackTo = async (versionId: number) => {
    if (!editing) return;
    try {
      const wf = await workflowApi.rollbackVersion(editing.id, versionId);
      message.success('已回滚');
      setEditing(wf);
      setWorkflows(workflows.map((w) => (w.id === wf.id ? wf : w)));
      setVersions(await workflowApi.listVersions(editing.id));
    } catch { /* */ }
  };

  // ===== 运行 =====
  const openRunDrawer = async () => {
    // 先校验
    if (!editing || editing.nodes.length === 0) {
      message.warning('工作流为空');
      return;
    }
    try {
      const result = await workflowApi.validateDraft({
        name: editing.name, description: editing.description, nodes: editing.nodes,
      });
      setValidation(result);
      if (!result.ok) {
        message.error('DAG 校验失败，请先修复');
        return;
      }
    } catch {
      return;
    }
    // 初始化运行时状态
    setRuntimeNodes(editing.nodes.map((n) => ({
      id: n.id, name: n.name || n.id, agent_id: n.agent_id,
      status: 'pending', toolCalls: [],
    })));
    setRunStatus('idle');
    setRunError('');
    setFinalOutput('');
    setRunDrawerOpen(true);
  };

  const startRun = async () => {
    if (!editing) return;
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(runInput || '{}');
    } catch {
      message.error('输入参数 JSON 解析失败');
      return;
    }
    setRuntimeNodes((prev) => prev.map((n) => ({ ...n, status: 'pending', content: undefined, error: undefined, toolCalls: [] })));
    setRunStatus('running');
    setRunError('');
    setFinalOutput('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await runWorkflowStream(editing.id, input, (evt: WorkflowSseEvent) => {
        handleSseEvent(evt);
      }, ctrl.signal);
    } catch (e) {
      const err = (e as Error).message || '运行失败';
      setRunError(err);
      setRunStatus('failed');
    } finally {
      abortRef.current = null;
      // 刷新运行历史
      try {
        const runList = await workflowApi.listRuns(editing.id);
        setRuns(runList);
      } catch { /* */ }
    }
  };

  const stopRun = () => {
    abortRef.current?.abort();
    setRunStatus('failed');
    setRunError('已手动中断');
  };

  const handleSseEvent = (evt: WorkflowSseEvent) => {
    switch (evt.type) {
      case 'workflow_start':
        setRunStatus('running');
        break;
      case 'node_start':
        setRuntimeNodes((prev) => prev.map((n) =>
          n.id === evt.node_id ? { ...n, status: 'running', startedAt: new Date().toISOString() } : n,
        ));
        break;
      case 'node_done':
        setRuntimeNodes((prev) => prev.map((n) =>
          n.id === evt.node_id ? {
            ...n, status: 'completed', content: evt.content,
            toolCalls: evt.tool_calls || [],
            finishedAt: new Date().toISOString(),
          } : n,
        ));
        break;
      case 'node_error':
        setRuntimeNodes((prev) => prev.map((n) =>
          n.id === evt.node_id ? { ...n, status: 'failed', error: evt.error, finishedAt: new Date().toISOString() } : n,
        ));
        setRunError(evt.error);
        setRunStatus('failed');
        break;
      case 'workflow_done':
        setRunStatus('completed');
        setFinalOutput(evt.final_output);
        message.success('工作流执行完成');
        break;
      case 'workflow_error':
        setRunStatus('failed');
        setRunError(evt.error || (evt.errors || []).join('; '));
        break;
      case 'error':
        setRunStatus('failed');
        setRunError(evt.message);
        break;
    }
  };

  // ===== 历史详情 =====
  const [historyDetail, setHistoryDetail] = useState<WorkflowRun | null>(null);
  const openHistory = async (runId: number) => {
    try {
      const r = await workflowApi.getRun(runId);
      setHistoryDetail(r);
    } catch { /* */ }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', padding: 48 }} />;

  return (
    <div>
      <Title level={4}>
        <ApartmentOutlined style={{ marginRight: 8 }} />
        DAG 工作流
      </Title>
      <Paragraph type="secondary">
        将多个 Agent 按拓扑序编排：上游节点的输出通过 <Text code>{'{{upstream.<node_id>}}'}</Text> 注入下游节点的 prompt。
        输入参数通过 <Text code>{'{{input.<key>}}'}</Text> 引用。支持实时流式运行、节点级进度查看。
      </Paragraph>

      <Row gutter={16}>
        {/* 左：工作流列表 */}
        <Col span={6}>
          <Card
            title={`工作流 (${workflows.length})`}
            size="small"
            extra={
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={createWorkflow}>
                新建
              </Button>
            }
            bodyStyle={{ padding: 0 }}
          >
            <div style={{ maxHeight: 600, overflow: 'auto' }}>
              {workflows.length === 0 ? (
                <Empty description="暂无工作流" style={{ padding: 24 }} />
              ) : (
                workflows.map((w) => (
                  <div
                    key={w.id}
                    onClick={() => setSelectedId(w.id)}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f0f0f0',
                      background: w.id === selectedId ? '#e6f4ff' : undefined,
                    }}
                  >
                    <Space direction="vertical" size={0} style={{ width: '100%' }}>
                      <Space>
                        <NodeIndexOutlined />
                        <Text strong={w.id === selectedId}>{w.name}</Text>
                      </Space>
                      <Space size={4}>
                        <Tag color="blue">{w.nodes.length} 节点</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>ID: {w.id}</Text>
                      </Space>
                    </Space>
                  </div>
                ))
              )}
            </div>
          </Card>
        </Col>

        {/* 右：编辑器 */}
        <Col span={18}>
          {!editing ? (
            <Card>
              <Empty description="请选择或新建一个工作流">
                <Button type="primary" icon={<PlusOutlined />} onClick={createWorkflow}>
                  新建工作流
                </Button>
              </Empty>
            </Card>
          ) : (
            <Card
              title={
                <Space>
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    style={{ width: 280 }}
                    placeholder="工作流名称"
                  />
                  <Tag color="blue">{editing.nodes.length} 节点</Tag>
                </Space>
              }
              extra={
                <Space>
                  <Button size="small" onClick={loadExample}>加载示例</Button>
                  <Button size="small" icon={<CheckCircleOutlined />} onClick={validate}>校验</Button>
                  <Button size="small" icon={<SaveOutlined />} type="primary" loading={saving} onClick={save}>保存</Button>
                  <Button size="small" type="primary" ghost icon={<PlayCircleOutlined />} onClick={openRunDrawer}>运行</Button>
                  <Button size="small" icon={<HistoryOutlined />} onClick={openVersionDrawer}>版本历史</Button>
                  <Popconfirm title="删除此工作流？" onConfirm={remove}>
                    <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              }
            >
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>描述</Text>
                <Input
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="一句话说明工作流用途"
                />
              </div>

              {validation && !validation.ok && (
                <Alert
                  type="error"
                  style={{ marginBottom: 16 }}
                  message="DAG 校验失败"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  }
                  onClose={() => setValidation(null)}
                />
              )}
              {validation && validation.ok && (
                <Alert
                  type="success"
                  style={{ marginBottom: 16 }}
                  message="DAG 校验通过"
                  closable
                  onClose={() => setValidation(null)}
                />
              )}

              {/* 节点编辑 + 拓扑可视化 + 历史 三个 Tab */}
              <TabsSection
                editing={editing}
                agents={agents}
                onAddNode={addNode}
                onRemoveNode={removeNode}
                onMoveNode={moveNode}
                onUpdateNode={updateNode}
                onReplaceNodes={replaceNodes}
                runs={runs}
                runsLoading={runsLoading}
                onOpenHistory={openHistory}
              />
            </Card>
          )}
        </Col>
      </Row>

      {/* 运行抽屉 */}
      <Drawer
        title="运行工作流"
        open={runDrawerOpen}
        onClose={() => setRunDrawerOpen(false)}
        width={760}
        extra={
          runStatus === 'running' ? (
            <Button danger icon={<CloseCircleOutlined />} onClick={stopRun}>中断</Button>
          ) : (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={startRun}>开始运行</Button>
          )
        }
      >
        <RunPanel
          runInput={runInput}
          setRunInput={setRunInput}
          runtimeNodes={runtimeNodes}
          runStatus={runStatus}
          runError={runError}
          finalOutput={finalOutput}
        />
      </Drawer>

      {/* 历史详情 Modal */}
      <Modal
        title={`运行 #${historyDetail?.id} 详情`}
        open={!!historyDetail}
        onCancel={() => setHistoryDetail(null)}
        footer={<Button onClick={() => setHistoryDetail(null)}>关闭</Button>}
        width={760}
      >
        {historyDetail && <HistoryDetail run={historyDetail} agents={agents} />}
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
          每次保存会自动生成「更新前快照」，也可手动保存带备注的版本。点击「回滚」将当前工作流恢复到该版本（回滚前会自动存一份当前状态）。
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

// ===== Tabs 区：节点编辑 / 拓扑可视化 / 运行历史 =====
function TabsSection({
  editing, agents, onAddNode, onRemoveNode, onMoveNode, onUpdateNode, onReplaceNodes, runs, runsLoading, onOpenHistory,
}: {
  editing: Workflow;
  agents: Agent[];
  onAddNode: () => void;
  onRemoveNode: (idx: number) => void;
  onMoveNode: (idx: number, direction: -1 | 1) => void;
  onUpdateNode: (idx: number, patch: Partial<WorkflowNode>) => void;
  onReplaceNodes: (nodes: WorkflowNode[]) => void;
  runs: WorkflowRun[];
  runsLoading: boolean;
  onOpenHistory: (runId: number) => void;
}) {
  const [tab, setTab] = useState<'nodes' | 'topo' | 'json' | 'history'>('nodes');

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button type={tab === 'nodes' ? 'primary' : 'default'} size="small" onClick={() => setTab('nodes')}>节点编辑</Button>
        <Button type={tab === 'topo' ? 'primary' : 'default'} size="small" onClick={() => setTab('topo')}>拓扑可视化</Button>
        <Button type={tab === 'json' ? 'primary' : 'default'} size="small" onClick={() => setTab('json')}>JSON 编辑</Button>
        <Button type={tab === 'history' ? 'primary' : 'default'} size="small" onClick={() => setTab('history')}>
          运行历史 {runs.length > 0 && <Badge count={runs.length} style={{ marginLeft: 4 }} />}
        </Button>
      </Space>

      {tab === 'nodes' && (
        <NodeEditorTab
          editing={editing}
          agents={agents}
          onAddNode={onAddNode}
          onRemoveNode={onRemoveNode}
          onMoveNode={onMoveNode}
          onUpdateNode={onUpdateNode}
        />
      )}
      {tab === 'topo' && <TopologyTab editing={editing} agents={agents} />}
      {tab === 'json' && (
        <JsonTab editing={editing} onApply={onReplaceNodes} />
      )}
      {tab === 'history' && (
        <HistoryTab runs={runs} loading={runsLoading} onOpenHistory={onOpenHistory} />
      )}
    </div>
  );
}

// 节点编辑 Tab
function NodeEditorTab({
  editing, agents, onAddNode, onRemoveNode, onMoveNode, onUpdateNode,
}: {
  editing: Workflow;
  agents: Agent[];
  onAddNode: () => void;
  onRemoveNode: (idx: number) => void;
  onMoveNode: (idx: number, direction: -1 | 1) => void;
  onUpdateNode: (idx: number, patch: Partial<WorkflowNode>) => void;
}) {
  if (editing.nodes.length === 0) {
    return (
      <Empty description="暂无节点">
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={onAddNode}>添加节点</Button>
        </Space>
      </Empty>
    );
  }
  return (
    <div>
      <div style={{ marginBottom: 12, textAlign: 'right' }}>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={onAddNode}>添加节点</Button>
      </div>
      {editing.nodes.map((node, idx) => (
        <Card
          key={node.id + '_' + idx}
          size="small"
          style={{ marginBottom: 12 }}
          title={
            <Space>
              <Tag color="geekblue">#{idx + 1}</Tag>
              <Text strong>{node.name || node.id}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>({node.id})</Text>
              {node.depends_on.length > 0 && (
                <Tag color="orange">依赖：{node.depends_on.join(', ')}</Tag>
              )}
            </Space>
          }
          extra={
            <Space size={2}>
              <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={idx === 0} onClick={() => onMoveNode(idx, -1)} />
              <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={idx === editing.nodes.length - 1} onClick={() => onMoveNode(idx, 1)} />
              <Popconfirm title="删除此节点？" onConfirm={() => onRemoveNode(idx)}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          }
        >
          <Row gutter={12}>
            <Col span={6}>
              <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>节点 ID</Text>
              <Input
                value={node.id}
                onChange={(e) => onUpdateNode(idx, { id: e.target.value })}
                placeholder="如 research"
                size="small"
              />
            </Col>
            <Col span={6}>
              <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>节点名称</Text>
              <Input
                value={node.name}
                onChange={(e) => onUpdateNode(idx, { name: e.target.value })}
                placeholder="如 调研"
                size="small"
              />
            </Col>
            <Col span={6}>
              <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>执行 Agent</Text>
              <Select
                value={node.agent_id}
                onChange={(v) => onUpdateNode(idx, { agent_id: v })}
                style={{ width: '100%' }}
                size="small"
                options={agents.map((a) => ({ label: `${a.name} (ID:${a.id})`, value: a.id }))}
                placeholder="选择 Agent"
              />
            </Col>
            <Col span={6}>
              <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>依赖节点（拓扑序）</Text>
              <Select
                mode="multiple"
                value={node.depends_on}
                onChange={(v) => onUpdateNode(idx, { depends_on: v })}
                style={{ width: '100%' }}
                size="small"
                options={editing.nodes
                  .filter((_, i) => i !== idx)
                  .map((n) => ({ label: `${n.name || n.id} (${n.id})`, value: n.id }))}
                placeholder="无依赖（起点）"
              />
            </Col>
          </Row>
          <Divider style={{ margin: '12px 0' }} />
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
              Prompt 模板（支持 <Text code>{'{{input.key}}'}</Text> / <Text code>{'{{upstream.node_id}}'}</Text>）
            </Text>
            <TextArea
              value={node.prompt_template}
              onChange={(e) => onUpdateNode(idx, { prompt_template: e.target.value })}
              placeholder="如：请调研：{{input.topic}}\n上游产物：{{upstream.research}}"
              autoSize={{ minRows: 3, maxRows: 10 }}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </div>
        </Card>
      ))}
    </div>
  );
}

// 拓扑可视化 Tab：用 antd Steps 展示拓扑序
function TopologyTab({ editing, agents }: { editing: Workflow; agents: Agent[] }) {
  if (editing.nodes.length === 0) {
    return <Empty description="暂无节点，无法可视化" />;
  }
  // 客户端做拓扑排序
  const ordered = topologicalSortClient(editing.nodes);
  const agentName = (id: number) => agents.find((a) => a.id === id)?.name || `Agent#${id}`;

  return (
    <div>
      <Alert
        type="info"
        showIcon
        message="按拓扑序执行"
        description="工作流按依赖关系自动排序，节点串行执行；上游输出通过 {{upstream.<node_id>}} 注入下游 prompt。"
        style={{ marginBottom: 16 }}
      />
      <Steps
        direction="vertical"
        size="small"
        current={-1}
        items={ordered.map((n, i) => ({
          title: (
            <Space>
              <Tag color="geekblue">#{i + 1}</Tag>
              <Text strong>{n.name || n.id}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>({n.id})</Text>
            </Space>
          ),
          description: (
            <div>
              <Space size={4} style={{ marginBottom: 4 }}>
                <Tag color="blue"><RobotOutlined /> {agentName(n.agent_id)}</Tag>
                {n.depends_on.length > 0 ? (
                  <Tag color="orange">依赖：{n.depends_on.join(' / ')}</Tag>
                ) : (
                  <Tag color="green">起点</Tag>
                )}
              </Space>
              {n.prompt_template && (
                <div style={{ background: '#fafafa', padding: 8, borderRadius: 4, fontSize: 12, fontFamily: 'monospace' }}>
                  {n.prompt_template.length > 200
                    ? n.prompt_template.slice(0, 200) + '...'
                    : n.prompt_template}
                </div>
              )}
            </div>
          ),
          status: 'wait',
        }))}
      />
    </div>
  );
}

// JSON 编辑 Tab
function JsonTab({ editing, onApply }: {
  editing: Workflow;
  onApply: (nodes: WorkflowNode[]) => void;
}) {
  const [text, setText] = useState('');
  const [parseError, setParseError] = useState('');

  useEffect(() => {
    setText(JSON.stringify(editing.nodes, null, 2));
    setParseError('');
  }, [editing.id, editing.nodes.length]);

  const apply = () => {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        setParseError('根节点必须是数组');
        return;
      }
      setParseError('');
      onApply(parsed as WorkflowNode[]);
      message.success('已应用 JSON');
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Button type="primary" size="small" icon={<CheckCircleOutlined />} onClick={apply}>应用 JSON</Button>
        <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(text); message.success('已复制'); }}>复制</Button>
        <Text type="secondary" style={{ fontSize: 12 }}>直接编辑 nodes JSON 数组</Text>
      </Space>
      {parseError && <Alert type="error" message={parseError} style={{ marginBottom: 8 }} />}
      <TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoSize={{ minRows: 16, maxRows: 30 }}
        style={{ fontFamily: 'monospace', fontSize: 12 }}
      />
    </div>
  );
}

// 历史记录 Tab
function HistoryTab({ runs, loading, onOpenHistory }: {
  runs: WorkflowRun[];
  loading: boolean;
  onOpenHistory: (runId: number) => void;
}) {
  if (runs.length === 0) {
    return <Empty description="暂无运行记录" />;
  }
  return (
    <Table
      size="small"
      loading={loading}
      dataSource={runs}
      rowKey="id"
      pagination={{ pageSize: 10 }}
      onRow={(r) => ({ onClick: () => onOpenHistory(r.id), style: { cursor: 'pointer' } })}
      columns={[
        { title: 'ID', dataIndex: 'id', width: 60 },
        {
          title: '状态', dataIndex: 'status', width: 100,
          render: (s: string) => <Tag color={STATUS_COLOR[s] || 'default'}>{s}</Tag>,
        },
        {
          title: '节点结果', dataIndex: 'node_results', width: 120,
          render: (nr: Record<string, WorkflowNodeResult>) => {
            const entries = Object.entries(nr);
            const okCount = entries.filter(([, v]) => v.status === 'completed').length;
            return <Text>{okCount}/{entries.length} 完成</Text>;
          },
        },
        {
          title: '输入', dataIndex: 'input', width: 200,
          render: (inp: Record<string, unknown>) => (
            <Tooltip title={JSON.stringify(inp, null, 2)}>
              <Text style={{ fontSize: 12 }}>{JSON.stringify(inp).slice(0, 80)}...</Text>
            </Tooltip>
          ),
        },
        {
          title: '开始时间', dataIndex: 'started_at', width: 160,
          render: (ts?: string | null) => ts ? new Date(ts).toLocaleString('zh-CN') : '-',
        },
        {
          title: '结束时间', dataIndex: 'finished_at', width: 160,
          render: (ts?: string | null) => ts ? new Date(ts).toLocaleString('zh-CN') : '-',
        },
        {
          title: '操作', key: 'action', width: 80,
          render: (_: unknown, r: WorkflowRun) => (
            <Button size="small" type="link" icon={<FileTextOutlined />} onClick={(e) => { e.stopPropagation(); onOpenHistory(r.id); }}>
              详情
            </Button>
          ),
        },
      ]}
    />
  );
}

// 运行抽屉面板：输入 + 进度 Steps + 节点输出
function RunPanel({
  runInput, setRunInput, runtimeNodes, runStatus, runError, finalOutput,
}: {
  runInput: string;
  setRunInput: (v: string) => void;
  runtimeNodes: RuntimeNodeState[];
  runStatus: 'idle' | 'running' | 'completed' | 'failed';
  runError: string;
  finalOutput: string;
}) {
  return (
    <div>
      {/* 输入参数 */}
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          输入参数（JSON，将注入 <Text code>{'{{input.x}}'}</Text>）
        </Text>
        <TextArea
          value={runInput}
          onChange={(e) => setRunInput(e.target.value)}
          autoSize={{ minRows: 4, maxRows: 10 }}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
          disabled={runStatus === 'running'}
        />
      </div>

      {/* 状态提示 */}
      {runStatus !== 'idle' && (
        <Alert
          type={runStatus === 'completed' ? 'success' : runStatus === 'failed' ? 'error' : 'info'}
          showIcon
          icon={runStatus === 'running' ? <LoadingOutlined /> : undefined}
          message={
            runStatus === 'running' ? '运行中...' :
            runStatus === 'completed' ? '工作流执行完成' :
            `运行失败：${runError}`
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 节点进度 */}
      {runtimeNodes.length > 0 && (
        <div>
          <Text strong style={{ display: 'block', marginBottom: 12 }}>节点执行进度</Text>
          <Steps
            direction="vertical"
            size="small"
            current={runtimeNodes.findIndex((n) => n.status === 'running')}
            items={runtimeNodes.map((n) => ({
              status: NODE_STATUS_TO_STEP[n.status],
              title: (
                <Space>
                  <Text strong>{n.name}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>({n.id})</Text>
                </Space>
              ),
              description: (
                <NodeOutputPreview node={n} />
              ),
            }))}
          />
        </div>
      )}

      {/* 最终输出 */}
      {finalOutput && (
        <div style={{ marginTop: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />
            最终输出（最后一个节点）
          </Text>
          <div style={{ background: '#f6ffed', padding: 12, borderRadius: 6, border: '1px solid #b7eb8f' }}>
            <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{finalOutput}</Paragraph>
          </div>
        </div>
      )}
    </div>
  );
}

// 节点输出预览（折叠面板）
function NodeOutputPreview({ node }: { node: RuntimeNodeState }) {
  if (node.status === 'pending') {
    return <Text type="secondary" style={{ fontSize: 12 }}>等待中</Text>;
  }
  if (node.status === 'running') {
    return (
      <Space size={4}>
        <LoadingOutlined />
        <Text type="secondary" style={{ fontSize: 12 }}>执行中...</Text>
      </Space>
    );
  }
  if (node.status === 'failed') {
    return (
      <Alert type="error" message={node.error || '未知错误'} style={{ marginTop: 4 }} />
    );
  }
  // completed
  return (
    <Collapse
      size="small"
      ghost
      style={{ marginTop: 4 }}
      items={[{
        key: '1',
        label: (
          <Space size={4}>
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              完成（{(node.content || '').length} 字符
              {node.toolCalls.length > 0 && `，${node.toolCalls.length} 次工具调用`}）
            </Text>
          </Space>
        ),
        children: (
          <div>
            <div style={{ background: '#fafafa', padding: 8, borderRadius: 4, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>
              {node.content || '(空)'}
            </div>
            {node.toolCalls.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>工具调用：</Text>
                <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 12 }}>
                  {node.toolCalls.map((t, i) => (
                    <li key={i}>
                      <Tag color="blue">{t.name}</Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>{JSON.stringify(t.args).slice(0, 80)}</Text>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ),
      }]}
    />
  );
}

// 历史详情 Modal 内容
function HistoryDetail({ run, agents }: { run: WorkflowRun; agents: Agent[] }) {
  const agentName = (id?: number) => id ? (agents.find((a) => a.id === id)?.name || `Agent#${id}`) : '-';
  const entries = Object.entries(run.node_results || {});
  return (
    <div>
      <Row gutter={12}>
        <Col span={6}>
          <Text type="secondary" style={{ fontSize: 12 }}>运行 ID</Text>
          <div><Text strong>#{run.id}</Text></div>
        </Col>
        <Col span={6}>
          <Text type="secondary" style={{ fontSize: 12 }}>状态</Text>
          <div><Tag color={STATUS_COLOR[run.status]}>{run.status}</Tag></div>
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
      {run.error && (
        <Alert type="error" message={run.error} style={{ marginTop: 12 }} />
      )}
      <Divider style={{ margin: '12px 0' }} />
      <Text strong style={{ display: 'block', marginBottom: 8 }}>输入参数</Text>
      <pre style={{ background: '#fafafa', padding: 8, borderRadius: 4, fontSize: 12, maxHeight: 120, overflow: 'auto' }}>
        {JSON.stringify(run.input, null, 2)}
      </pre>
      <Text strong style={{ display: 'block', marginBottom: 8, marginTop: 12 }}>节点结果（{entries.length} 个）</Text>
      <Collapse
        items={entries.map(([nodeId, result]) => ({
          key: nodeId,
          label: (
            <Space>
              <Tag color={STATUS_COLOR[result.status]}>{result.status}</Tag>
              <Text strong>{nodeId}</Text>
              {result.agent_id && <Tag color="blue">{agentName(result.agent_id)}</Tag>}
              {result.error && <Text type="danger" style={{ fontSize: 12 }}>{result.error}</Text>}
            </Space>
          ),
          children: (
            <div>
              {result.error && <Alert type="error" message={result.error} style={{ marginBottom: 8 }} />}
              <div style={{ background: '#fafafa', padding: 8, borderRadius: 4, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                {result.content || '(空)'}
              </div>
              {result.tool_calls && result.tool_calls.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>工具调用：</Text>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 12 }}>
                    {result.tool_calls.map((t, i) => (
                      <li key={i}>
                        <Tag color="blue">{t.name}</Tag>
                        <Text type="secondary" style={{ fontSize: 11 }}>{JSON.stringify(t.args).slice(0, 100)}</Text>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
                {result.started_at ? `开始：${new Date(result.started_at).toLocaleString('zh-CN')}` : ''}
                {result.finished_at ? `　结束：${new Date(result.finished_at).toLocaleString('zh-CN')}` : ''}
              </Text>
            </div>
          ),
        }))}
      />
    </div>
  );
}

// ===== 客户端拓扑排序（用于可视化，与后端算法一致） =====
function topologicalSortClient(nodes: WorkflowNode[]): WorkflowNode[] {
  const map = new Map(nodes.map((n) => [n.id, n]));
  const inDeg = new Map(nodes.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, [] as string[]]));
  for (const n of nodes) {
    for (const dep of n.depends_on || []) {
      if (map.has(dep)) {
        adj.get(dep)!.push(n.id);
        inDeg.set(n.id, (inDeg.get(n.id) || 0) + 1);
      }
    }
  }
  const queue = nodes.filter((n) => (inDeg.get(n.id) || 0) === 0).map((n) => n.id);
  const result: WorkflowNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    result.push(map.get(id)!);
    for (const child of adj.get(id) || []) {
      inDeg.set(child, (inDeg.get(child) || 0) - 1);
      if ((inDeg.get(child) || 0) === 0) queue.push(child);
    }
  }
  // 处理环：把剩余节点也加上
  for (const n of nodes) {
    if (!result.find((r) => r.id === n.id)) result.push(n);
  }
  return result;
}
