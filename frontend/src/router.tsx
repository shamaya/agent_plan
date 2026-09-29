import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// 按页 lazy，降低首屏体积
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Providers = lazy(() => import('./pages/Providers'));
const Skills = lazy(() => import('./pages/Skills'));
const McpServers = lazy(() => import('./pages/McpServers'));
const Knowledge = lazy(() => import('./pages/Knowledge'));
const KnowledgeDetail = lazy(() => import('./pages/KnowledgeDetail'));
const Agents = lazy(() => import('./pages/Agents'));
const AgentEditor = lazy(() => import('./pages/AgentEditor'));
const Chat = lazy(() => import('./pages/Chat'));
const Traces = lazy(() => import('./pages/Traces'));
const TraceDetail = lazy(() => import('./pages/TraceDetail'));
const Harness = lazy(() => import('./pages/Harness'));
const ApiKeys = lazy(() => import('./pages/ApiKeys'));

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/providers" element={<Providers />} />
      <Route path="/skills" element={<Skills />} />
      <Route path="/mcp" element={<McpServers />} />
      <Route path="/knowledge" element={<Knowledge />} />
      <Route path="/knowledge/:id" element={<KnowledgeDetail />} />
      <Route path="/agents" element={<Agents />} />
      <Route path="/agents/new" element={<AgentEditor />} />
      <Route path="/agents/:id/edit" element={<AgentEditor />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/traces" element={<Traces />} />
      <Route path="/traces/:id" element={<TraceDetail />} />
      <Route path="/harness" element={<Harness />} />
      <Route path="/apikeys" element={<ApiKeys />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
