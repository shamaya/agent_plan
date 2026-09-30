import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Spin, message, Typography, Space, Select, Button, Input, Empty,
  Tag, Divider, Row, Col, Table,
} from 'antd';
import { PlusOutlined, DeleteOutlined, TeamOutlined, RobotOutlined } from '@ant-design/icons';
import { agentApi } from '@/api/endpoints/agent';
import type { Agent, AgentWorker } from '@/types';

const { Text, Paragraph, Title } = Typography;

export default function Collaboration() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<number | undefined>();
  const [workers, setWorkers] = useState<AgentWorker[]>([]);
  const [newWorkerId, setNewWorkerId] = useState<number | undefined>();
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [saving, setSaving] = useState(false);

  // 初始化加载所有 Agent
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const list = await agentApi.list();
        setAgents(list);
        if (list.length > 0 && !selectedAgentId) {
          setSelectedAgentId(list[0].id);
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载选中 Agent 的 Worker 池
  const loadWorkers = async (agentId: number) => {
    const w = await agentApi.listWorkers(agentId);
    setWorkers(w);
  };

  useEffect(() => {
    if (selectedAgentId) loadWorkers(selectedAgentId);
  }, [selectedAgentId]);

  const addWorker = async () => {
    if (!selectedAgentId || !newWorkerId) return;
    setSaving(true);
    try {
      await agentApi.addWorker(selectedAgentId, {
        worker_id: newWorkerId,
        role_description: newRoleDesc,
        sort_order: workers.length,
      });
      message.success('Worker 已添加');
      setNewWorkerId(undefined);
      setNewRoleDesc('');
      await loadWorkers(selectedAgentId);
    } catch { /* toast by interceptor */ } finally {
      setSaving(false);
    }
  };

  const removeWorker = async (workerRowId: number) => {
    if (!selectedAgentId) return;
    try {
      await agentApi.removeWorker(selectedAgentId, workerRowId);
      message.success('Worker 已移除');
      await loadWorkers(selectedAgentId);
    } catch { /* */ }
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const isManaged = workers.length > 0;
  // 可选 Worker 列表：排除自己和已添加的
  const existingWorkerIds = new Set(workers.map((w) => w.worker_id));
  const workerOptions = agents
    .filter((a) => a.id !== selectedAgentId && !existingWorkerIds.has(a.id))
    .map((a) => ({ label: a.name, value: a.id }));

  // 关系矩阵数据
  const relationRows = agents.map((a) => {
    // 找到哪些 supervisor 把当前 agent 当 worker
    return { key: a.id, agent: a };
  });

  if (loading) return <Spin size="large" style={{ display: 'block', padding: 48 }} />;

  return (
    <div>
      <Title level={4}>
        <TeamOutlined style={{ marginRight: 8 }} />
        多智能体协同
      </Title>
      <Paragraph type="secondary">
        配置 Agent 间的委托关系。Worker 池为空时，该 Agent 处于 Auto 模式，LLM 可通过
        <Text code>delegate(agent_name, task)</Text> 委托任意其他 Agent。配置 Worker 池后切换为
        Managed 模式，LLM 只能通过 <Text code>assign_task(worker_id, task)</Text> 委托指定 Worker。
      </Paragraph>

      <Row gutter={16}>
        {/* 左：Agent 列表 */}
        <Col span={6}>
          <Card title="Agent 列表" size="small" bodyStyle={{ padding: 0 }}>
            <div style={{ maxHeight: 500, overflow: 'auto' }}>
              {agents.map((a) => (
                <div
                  key={a.id}
                  onClick={() => setSelectedAgentId(a.id)}
                  style={{
                    padding: '10px 14px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f0f0f0',
                    background: a.id === selectedAgentId ? '#e6f4ff' : undefined,
                  }}
                >
                  <Space>
                    <RobotOutlined />
                    <Text strong={a.id === selectedAgentId}>{a.name}</Text>
                  </Space>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        {/* 右：Worker 池管理 */}
        <Col span={18}>
          {selectedAgent ? (
            <Card
              title={
                <Space>
                  <span>{selectedAgent.name}</span>
                  <Tag color={isManaged ? 'geekblue' : 'default'}>
                    {isManaged ? 'Managed 模式' : 'Auto 模式'}
                  </Tag>
                </Space>
              }
              extra={
                <Button size="small" onClick={() => navigate(`/agents/${selectedAgent.id}/edit`)}>
                  编辑 Agent
                </Button>
              }
            >
              {/* 添加 Worker */}
              <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
                <Select
                  placeholder="选择 Worker Agent"
                  options={workerOptions}
                  value={newWorkerId}
                  onChange={setNewWorkerId}
                  style={{ width: '35%' }}
                  showSearch
                  optionFilterProp="label"
                />
                <Input
                  placeholder="角色描述（如：数据查询专家）"
                  value={newRoleDesc}
                  onChange={(e) => setNewRoleDesc(e.target.value)}
                  style={{ width: '50%' }}
                />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={addWorker}
                  loading={saving}
                  disabled={!newWorkerId}
                  style={{ width: '15%' }}
                >
                  添加
                </Button>
              </Space.Compact>

              <Divider style={{ margin: '12px 0' }} />

              {workers.length === 0 ? (
                <Empty description="Worker 池为空（Auto 模式 — LLM 可委托任意 Agent）" />
              ) : (
                <Table
                  size="small"
                  dataSource={workers}
                  rowKey="id"
                  pagination={false}
                  columns={[
                    {
                      title: 'Worker',
                      dataIndex: 'worker_name',
                      render: (name: string, row: AgentWorker) => (
                        <Space>
                          <Tag color="geekblue">{name}</Tag>
                          <Text type="secondary">ID: {row.worker_id}</Text>
                        </Space>
                      ),
                    },
                    {
                      title: '角色描述',
                      dataIndex: 'role_description',
                      render: (desc: string) => desc || <Text type="secondary">（未设置）</Text>,
                    },
                    {
                      title: '操作',
                      key: 'action',
                      width: 80,
                      render: (_, row: AgentWorker) => (
                        <Button
                          size="small"
                          type="link"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => removeWorker(row.id)}
                        >
                          移除
                        </Button>
                      ),
                    },
                  ]}
                />
              )}

              {/* 模式说明 */}
              <div style={{ marginTop: 16, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
                {isManaged ? (
                  <Paragraph style={{ margin: 0, fontSize: 13 }}>
                    <Tag color="geekblue">Managed</Tag>
                    当前 Agent 的 system prompt 会自动注入 Worker 清单，LLM 通过
                    <Text code>assign_task(worker_id, task)</Text> 委托上述 Worker。
                    清空列表可回到 Auto 模式。
                  </Paragraph>
                ) : (
                  <Paragraph style={{ margin: 0, fontSize: 13 }}>
                    <Tag>Auto</Tag>
                    当前 Agent 的 system prompt 会自动注入所有其他 Agent 的清单，LLM 通过
                    <Text code>delegate(agent_name, task)</Text> 委托任意 Agent。
                    添加 Worker 后切换为 Managed 模式。
                  </Paragraph>
                )}
              </div>
            </Card>
          ) : (
            <Empty description="请选择一个 Agent" />
          )}
        </Col>
      </Row>
    </div>
  );
}
