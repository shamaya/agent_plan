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
  approval_config?: { enabled: boolean; tools: string[] };
  routing_config?: {
    enabled: boolean;
    simple_model_id?: number | null;
    complex_model_id?: number | null;
    threshold: number;
  };
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

export interface AgentWorker {
  id: number;
  supervisor_id: number;
  worker_id: number;
  worker_name: string;
  role_description: string;
  sort_order: number;
  created_at?: string;
}

export interface AgentWorkerCreate {
  worker_id: number;
  role_description: string;
  sort_order: number;
}

export interface AgentMemory {
  id: number;
  agent_id: number;
  content: string;
  memory_type: 'fact' | 'preference' | 'episodic';
  importance: number;
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface AgentMemoryCreate {
  content: string;
  memory_type: string;
  importance: number;
  metadata?: Record<string, unknown>;
}

export interface AgentMemoryUpdate {
  content?: string;
  memory_type?: string;
  importance?: number;
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
  images?: string[];
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
  step_type: 'llm_call' | 'tool_call' | 'retrieval' | 'compression' | 'constraint_check' | 'routing';
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
  | { type: 'approval_request'; approval_id: string; tool: string; args: Record<string, unknown> }
  | {
      type: 'routing';
      complexity: number;
      label: string;
      model_id: number | null;
      reason: string;
      signals: Record<string, unknown>;
    }
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

// ===== DAG 工作流 =====
export interface WorkflowNode {
  id: string;
  name: string;
  agent_id: number;
  prompt_template: string;
  depends_on: string[];
  variables?: Record<string, unknown>;
}

export interface Workflow {
  id: number;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  created_at?: string;
  updated_at?: string;
}

export interface WorkflowNodeResult {
  status: 'pending' | 'running' | 'completed' | 'failed';
  content?: string;
  tool_calls?: { name: string; args: Record<string, unknown> }[];
  agent_id?: number;
  error?: string;
  started_at?: string;
  finished_at?: string;
}

export interface WorkflowRun {
  id: number;
  workflow_id: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'canceled';
  input: Record<string, unknown>;
  node_results: Record<string, WorkflowNodeResult>;
  started_at?: string | null;
  finished_at?: string | null;
  error: string;
}

export interface WorkflowValidation {
  ok: boolean;
  errors: string[];
}

// 工作流 SSE 事件
export type WorkflowSseEvent =
  | { type: 'run_created'; run_id: number; workflow_id: number }
  | { type: 'workflow_start'; run_id: number; workflow_id: number; node_count: number }
  | { type: 'node_start'; node_id: string; node_name: string; agent_id: number; index: number; total: number; rendered_prompt: string }
  | { type: 'node_done'; node_id: string; node_name: string; content: string; tool_calls: { name: string; args: Record<string, unknown> }[]; content_preview: string }
  | { type: 'node_error'; node_id: string; error: string }
  | { type: 'workflow_done'; run_id: number; status: string; final_output: string }
  | { type: 'workflow_error'; error?: string; errors?: string[]; node_id?: string }
  | { type: 'error'; message: string };

// ===== 评估框架（LLM-as-Judge） =====
export interface EvaluationCriterion {
  id: string;
  name: string;
  description: string;
  weight: number;
  rubric: string;
}

export interface Evaluation {
  id: number;
  name: string;
  agent_id: number;
  agent_name: string;
  description: string;
  criteria: EvaluationCriterion[];
  judge_model_id?: number | null;
  judge_model_name: string;
  created_at?: string;
  updated_at?: string;
}

export interface EvaluationRun {
  id: number;
  evaluation_id: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input_prompt: string;
  results: {
    overall_score: number;
    criteria: Record<string, { score: number; reason: string }>;
    response: string;
    judge_raw: string;
    judge_model_id?: number;
  };
  started_at?: string | null;
  finished_at?: string | null;
  error: string;
}

export type EvaluationSseEvent =
  | { type: 'run_created'; run_id: number; evaluation_id: number }
  | { type: 'evaluation_start'; run_id: number; evaluation_id: number; criteria_count: number }
  | { type: 'agent_start'; agent_id: number; prompt: string }
  | { type: 'agent_done'; response_preview: string; response_len: number; tool_calls: { name: string; args: Record<string, unknown> }[] }
  | { type: 'judge_start'; criteria_count: number }
  | { type: 'judge_done'; overall_score: number; criteria: Record<string, { score: number; reason: string }>; judge_raw_preview: string }
  | { type: 'evaluation_done'; run_id: number; overall_score: number; criteria: Record<string, { score: number; reason: string }> }
  | { type: 'evaluation_error'; error: string }
  | { type: 'error'; message: string };

// ===== Guardrail 输出校验 =====
export interface GuardrailRule {
  id: number;
  name: string;
  agent_id?: number | null;
  agent_name: string;
  type: 'regex' | 'length' | 'keyword' | 'json_format' | 'json_schema' | 'starts_with';
  config: Record<string, unknown>;
  action: 'reject' | 'retry' | 'append_warning';
  retry_count: number;
  enabled: boolean;
  sort_order: number;
  created_at?: string;
}

export interface GuardrailCheckResult {
  rule_id: number;
  rule_name: string;
  passed: boolean;
  message: string;
  action: string;
}

export interface GuardrailBatchResult {
  passed: boolean;
  results: GuardrailCheckResult[];
  violated_rule_ids: number[];
}

export const GUARDRAIL_TYPES = [
  { value: 'regex', label: '正则匹配' },
  { value: 'length', label: '长度约束' },
  { value: 'keyword', label: '禁用关键词' },
  { value: 'json_format', label: 'JSON 格式' },
  { value: 'json_schema', label: 'JSON Schema' },
  { value: 'starts_with', label: '前缀匹配' },
] as const;

export const GUARDRAIL_ACTIONS = [
  { value: 'retry', label: '重试（追加反馈）' },
  { value: 'reject', label: '拒绝（先重试，耗尽后拒绝）' },
  { value: 'append_warning', label: '追加警告（保留输出）' },
] as const;

// ===== Prompt 模板市场 =====
export interface PromptTemplate {
  id: number;
  name: string;
  description: string;
  category: string;
  content: string;
  variables: { name: string; description: string; default: unknown }[];
  tags: string[];
  is_public: boolean;
  usage_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface PromptCacheStats {
  total_entries: number;
  total_hits: number;
  total_token_saved: number;
}

export interface PromptCacheEntry {
  id: number;
  model_name: string;
  prompt: string;
  response: string;
  hit_count: number;
  token_in: number;
  token_out: number;
  last_used_at?: string;
  created_at?: string;
}

export const PROMPT_CATEGORIES = [
  { value: 'general', label: '通用' },
  { value: 'coding', label: '编程' },
  { value: 'writing', label: '写作' },
  { value: 'analysis', label: '分析' },
  { value: 'role', label: '角色扮演' },
  { value: 'translation', label: '翻译' },
  { value: 'other', label: '其他' },
] as const;
