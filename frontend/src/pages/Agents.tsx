import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Col,
  Row,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ImportOutlined, ExportOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { agentApi } from '@/api/endpoints/agent';
import { providerApi } from '@/api/endpoints/provider';
import type { Agent, AgentExport, Model, Provider } from '@/types';
import type { ColumnsType } from 'antd/es/table';

export default function Agents() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [list, setList] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [modelMap, setModelMap] = useState<Record<number, { provider: Provider; model: Model }>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [agents, ps] = await Promise.all([agentApi.list(), providerApi.list()]);
      setList(agents);
      setProviders(ps);
      const map: Record<number, { provider: Provider; model: Model }> = {};
      await Promise.all(
        ps.map(async (p) => {
          try {
            const ms = await providerApi.models(p.id);
            ms.forEach((m) => {
              map[m.id] = { provider: p, model: m };
            });
          } catch {
            // ignored
          }
        }),
      );
      setModelMap(map);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const modelName = (id?: number | null) => {
    if (!id) return <Tag>未配置</Tag>;
    const entry = modelMap[id];
    if (!entry) return <Tag color="orange">model#{id}</Tag>;
    return (
      <Tag color="blue">
        {entry.provider.name}/{entry.model.model_name}
      </Tag>
    );
  };

  const handleDelete = (a: Agent) => {
    modal.confirm({
      title: `删除 Agent "${a.name}"？`,
      content: '此操作不可撤销',
      okType: 'danger',
      onOk: async () => {
        await agentApi.remove(a.id);
        message.success('已删除');
        await load();
      },
    });
  };

  const handleExport = async (a: Agent) => {
    try {
      const e = await agentApi.exportAgent(a.id);
      const blob = new Blob([JSON.stringify(e, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `agent_${e.name}.json`;
      link.click();
      URL.revokeObjectURL(url);
      message.success('已导出');
    } catch {
      message.error('导出失败');
    }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const content = await file.text();
        const data = JSON.parse(content) as AgentExport;
        await agentApi.importAgent(data);
        message.success('导入成功');
        await load();
      } catch {
        message.error('导入失败：请检查 JSON 格式');
      }
    };
    input.click();
  };

  const columns: ColumnsType<Agent> = [
    { title: '名称', dataIndex: 'name', width: 180 },
    {
      title: '模型',
      dataIndex: 'model_id',
      width: 220,
      render: (v?: number | null) => modelName(v),
    },
    {
      title: 'Skills',
      dataIndex: 'skill_ids',
      width: 90,
      align: 'center' as const,
      render: (v: number[]) => v?.length || 0,
    },
    {
      title: 'MCP',
      dataIndex: 'mcp_server_ids',
      width: 90,
      align: 'center' as const,
      render: (v: number[]) => v?.length || 0,
    },
    {
      title: '知识库',
      dataIndex: 'kb_ids',
      width: 90,
      align: 'center' as const,
      render: (v: number[]) => v?.length || 0,
    },
    {
      title: '约束 Profile',
      dataIndex: 'constraint_profile_id',
      width: 110,
      render: (v?: number | null) => (v ? <Tag color="gold">#{v}</Tag> : <Tag>默认</Tag>),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      width: 220,
      render: (_, r) => (
        <Space size="small">
          <a onClick={() => navigate(`/agents/${r.id}/edit`)}>编辑</a>
          <a onClick={() => navigate('/chat')}>对话</a>
          <a onClick={() => handleExport(r)}>导出</a>
          <a style={{ color: '#ff4d4f' }} onClick={() => handleDelete(r)}>
            删除
          </a>
        </Space>
      ),
    },
  ];

  const summary = useMemo(() => {
    const totalSkills = list.reduce((s, a) => s + (a.skill_ids?.length || 0), 0);
    const totalMcp = list.reduce((s, a) => s + (a.mcp_server_ids?.length || 0), 0);
    const totalKb = list.reduce((s, a) => s + (a.kb_ids?.length || 0), 0);
    return { totalSkills, totalMcp, totalKb };
  }, [list]);

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
        <Col>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Agent
          </Typography.Title>
        </Col>
        <Col>
          <Space>
            <Button icon={<ImportOutlined />} onClick={handleImport}>
              导入
            </Button>
            <Button type="primary" onClick={() => navigate('/agents/new')}>
              新建 Agent
            </Button>
          </Space>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col>
          <Typography.Text type="secondary">
            共 {providers.length} 个 Provider 可用，模型缓存总数 {Object.keys(modelMap).length}；
            全部 Agent 累计 Skills {summary.totalSkills}、MCP {summary.totalMcp}、
            知识库 {summary.totalKb}
          </Typography.Text>
        </Col>
      </Row>

      <Table<Agent>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={{ pageSize: 10 }}
      />
    </div>
  );
}
