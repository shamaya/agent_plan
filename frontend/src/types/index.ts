// 全局实体类型（与后端 schemas 对齐）

export interface Provider {
  id: number;
  name: string;
  kind: 'chat' | 'embedding' | 'both';
  base_url: string;
  has_key: boolean;
  key_preview: string;
  headers: Record<string, unknown>;
  enabled: boolean;
  created_at?: string;
  model_count: number;
}

export interface Model {
  id: number;
  provider_id: number;
  model_name: string;
  context_window: number;
  max_tokens: number;
  is_default: boolean;
  enabled: boolean;
  created_at?: string;
}

export interface ProviderTestResult {
  ok: boolean;
  models: string[];
  error: string;
}

export interface Skill {
  id: number;
  name: string;
  category: string;
  description: string;
  prompt_template: string;
  parameters_schema: Record<string, unknown>;
  tool_chain: unknown[];
  version: number;
  enabled: boolean;
  parent_version_id?: number | null;
  created_at?: string;
}

export interface SkillVersion {
  id: number;
  skill_id: number;
  version: number;
  snapshot: Record<string, unknown>;
  created_at?: string;
}

export interface McpServer {
  id: number;
  name: string;
  transport_type: 'stdio' | 'sse' | 'http';
  config: Record<string, unknown>;
  enabled: boolean;
  health_status: 'unknown' | 'healthy' | 'unhealthy';
  last_check_at?: string;
  created_at?: string;
  tools_count: number;
}

export interface McpTool {
  id: number;
  server_id: number;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  discovered_at?: string;
}

export interface ToolInvokeResult {
  ok: boolean;
  result: unknown;
  error: string;
}

export interface KnowledgeBase {
  id: number;
  name: string;
  description: string;
  embedding_provider_id?: number | null;
  chunk_config: Record<string, unknown>;
  created_at?: string;
  docs_count: number;
}

export interface KbDocument {
  id: number;
  kb_id: number;
  filename: string;
  mime: string;
  status: string;
  chunks_count: number;
  source_uri: string;
  error: string;
  created_at?: string;
}

export interface ChunkHit {
  chunk_id: number;
  doc_id: number;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface ChunkRead {
  id: number;
  doc_id: number;
  kb_id: number;
  ordinal: number;
  text: string;
  chroma_id: string;
  meta: Record<string, unknown>;
}

export interface SearchResult {
  query: string;
  hits: ChunkHit[];
}

export interface Agent {
  id: number;
  name: string;
  system_prompt: string;
  model_id?: number | null;
  skill_ids: number[];
  mcp_server_ids: number[];
  kb_ids: number[];
  constraint_profile_id?: number | null;
  context_config: Record<string, unknown>;
  version: number;
  created_at?: string;
}

export interface AgentVersion {
  id: number;
  agent_id: number;
  version: number;
  snapshot: Record<string, unknown>;
  note: string;
  created_at?: string;
}

export interface AgentExport {
  name: string;
  system_prompt: string;
  model_name: string;
  skill_names: string[];
  mcp_server_names: string[];
  kb_names: string[];
  constraint_profile_name: string;
  context_config: Record<string, unknown>;
  version: string;
}

export interface Conversation {
  id: number;
  agent_id?: number | null;
  title: string;
  summary: string;
  compression_state: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: unknown[];
  tool_results?: unknown[];
  token_count: number;
  is_compressed_summary: boolean;
  created_at?: string;
}

export interface ConstraintProfile {
  id: number;
  name: string;
  max_iterations: number;
  token_budget: number;
  allowed_tools: unknown[];
  forbidden_actions: unknown[];
  tool_failure_threshold: number;
  compression_policy: Record<string, unknown>;
  created_at?: string;
}

export interface RecoveryRule {
  id: number;
  agent_id?: number | null;
  trigger: Record<string, unknown>;
  action: 'disable_tool' | 'downgrade' | 'retry_with_advice';
  advice: string;
  source_trace_id?: number | null;
  created_at?: string;
}

export interface Trace {
  id: number;
  conversation_id?: number | null;
  agent_id?: number | null;
  iteration: number;
  step_type: 'llm_call' | 'tool_call' | 'retrieval' | 'compression' | 'constraint_check';
  tool_name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  latency_ms: number;
  token_in: number;
  token_out: number;
  status: 'ok' | 'error';
  error: string;
  created_at?: string;
}

export interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  allowed_agent_ids: number[];
  enabled: boolean;
  expires_at?: string | null;
  last_used_at?: string | null;
  call_count: number;
  created_at?: string;
}

export interface ApiKeyCreated extends ApiKey {
  key: string; // 明文 key，仅创建时返回
}

export interface Stats {
  providers: number;
  models: number;
  skills: number;
  mcp_servers: number;
  mcp_tools: number;
  knowledge_bases: number;
  agents: number;
  conversations: number;
  traces: number;
  recent_traces: Trace[];
  total_token_in: number;
  total_token_out: number;
  error_count: number;
  avg_latency_ms: number;
}

export interface ErrorGroup {
  error_key: string;
  count: number;
  sample: string;
  last_at: string;
}

export interface TokenStats {
  agent_id: number | null;
  agent_name: string;
  token_in: number;
  token_out: number;
  call_count: number;
  avg_latency_ms: number;
}

// ===== SSE 事件（agent chat 流式） =====
export type SseEvent =
  | { type: 'session'; conversation_id: number; agent_id: number }
  | { type: 'token'; text: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: unknown }
  | {
      type: 'compression';
      pre_tokens: number;
      post_tokens: number;
      compressed_range: [number, number] | number[];
      summary: string;
    }
  | { type: 'trace_step'; [k: string]: unknown }
  | { type: 'done'; final: string }
  | { type: 'error'; message: string };

export interface CompressionState {
  pre_tokens?: number;
  post_tokens?: number;
  range?: number[];
  count?: number;
  last_at?: string;
  summary_msg_id?: number;
}
