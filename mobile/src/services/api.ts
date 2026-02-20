const API_URL = 'https://cachebash-mcp-922749444863.us-central1.run.app/v1/mcp';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface McpToolResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export class CacheBashAPIError extends Error {
  constructor(
    message: string,
    public code?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'CacheBashAPIError';
  }
}

class CacheBashAPI {
  private apiKey: string;
  private baseUrl: string;
  private sessionId: string | null = null;
  private initPromise: Promise<void> | null = null;
  private requestQueue: Promise<unknown> = Promise.resolve();

  constructor(apiKey: string, baseUrl: string = API_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async initialize(): Promise<void> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'cachebash-mobile', version: '1.0.0' },
      },
    };

    try {
      const resp = await this.sendXHR(JSON.stringify(request));

      const mcpSessionId = resp.headers['mcp-session-id'];
      if (!mcpSessionId) {
        throw new CacheBashAPIError('Server did not return Mcp-Session-Id header');
      }

      this.sessionId = mcpSessionId;
    } catch (error) {
      this.sessionId = null;
      if (error instanceof CacheBashAPIError) throw error;
      throw new CacheBashAPIError(
        error instanceof Error ? error.message : 'Unknown initialization error',
        undefined,
        error
      );
    }
  }

  private async ensureInitialized(): Promise<void> {
    // If already initialized, return immediately
    if (this.sessionId) {
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    // Start initialization
    this.initPromise = this.initialize();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async call<T>(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<T> {
    // Serialize all requests — concurrent requests on the same MCP session
    // cause the server to mix up responses
    return new Promise<T>((resolve, reject) => {
      this.requestQueue = this.requestQueue.then(async () => {
        try {
          const result = await this.executeCall<T>(toolName, args);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private sendXHR(body: string): Promise<{ status: number; text: string; headers: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', this.baseUrl, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', `Bearer ${this.apiKey}`);
      if (this.sessionId) {
        xhr.setRequestHeader('Mcp-Session-Id', this.sessionId);
      }
      xhr.onload = () => {
        const headers: Record<string, string> = {};
        const sessionHeader = xhr.getResponseHeader('mcp-session-id');
        if (sessionHeader) headers['mcp-session-id'] = sessionHeader;
        resolve({ status: xhr.status, text: xhr.responseText, headers });
      };
      xhr.onerror = () => reject(new CacheBashAPIError('Network error'));
      xhr.ontimeout = () => reject(new CacheBashAPIError('Request timeout'));
      xhr.timeout = 15000;
      xhr.send(body);
    });
  }

  private async executeCall<T>(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<T> {
    await this.ensureInitialized();

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    };

    // Retry up to 3 times
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const resp = await this.sendXHR(JSON.stringify(request));

        if (resp.status === 204 || !resp.text || resp.text.trim() === '') {
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          throw new CacheBashAPIError('Empty response', resp.status);
        }

        if (resp.status >= 400) {
          throw new CacheBashAPIError(`HTTP ${resp.status}`, resp.status);
        }

        const jsonResponse: JsonRpcResponse<McpToolResult> = JSON.parse(resp.text);

        if (jsonResponse.error) {
          throw new CacheBashAPIError(jsonResponse.error.message, jsonResponse.error.code);
        }

        if (!jsonResponse.result?.content?.[0]?.text) {
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          throw new CacheBashAPIError('No result in response');
        }

        return JSON.parse(jsonResponse.result.content[0].text) as T;
      } catch (error) {
        if (attempt === MAX_RETRIES - 1) {
          if (error instanceof CacheBashAPIError) throw error;
          throw new CacheBashAPIError(
            error instanceof Error ? error.message : 'Unknown error',
            undefined,
            error
          );
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    throw new CacheBashAPIError('Max retries exceeded');
  }

  // Sessions
  async listSessions(params?: {
    state?: 'working' | 'blocked' | 'pinned' | 'complete' | 'all';
    limit?: number;
    programId?: string;
    includeArchived?: boolean;
  }): Promise<any> {
    return this.call('list_sessions', params || {});
  }

  async createSession(params: {
    name: string;
    programId?: string;
    projectName?: string;
    state?: 'working' | 'blocked' | 'complete' | 'pinned';
    status?: string;
    progress?: number;
  }): Promise<any> {
    return this.call('create_session', params);
  }

  async updateSession(params: {
    status: string;
    sessionId?: string;
    progress?: number;
    state?: 'working' | 'blocked' | 'complete' | 'pinned';
    projectName?: string;
    lastHeartbeat?: boolean;
  }): Promise<any> {
    return this.call('update_session', params);
  }

  // Tasks
  async getTasks(params?: {
    status?: 'created' | 'active' | 'all';
    target?: string;
    limit?: number;
    type?: 'task' | 'question' | 'dream' | 'sprint' | 'sprint-story' | 'all';
  }): Promise<any> {
    return this.call('get_tasks', params || {});
  }

  async createTask(params: {
    title: string;
    target: string;
    instructions?: string;
    priority?: 'low' | 'normal' | 'high';
    action?: 'interrupt' | 'sprint' | 'parallel' | 'queue' | 'backlog';
    type?: 'task' | 'question' | 'dream' | 'sprint' | 'sprint-story';
    source?: string;
    threadId?: string;
    replyTo?: string;
  }): Promise<any> {
    return this.call('create_task', params);
  }

  async claimTask(
    taskId: string,
    sessionId?: string
  ): Promise<any> {
    return this.call('claim_task', { taskId, sessionId });
  }

  async completeTask(
    taskId: string,
    tokens_in?: number,
    tokens_out?: number,
    cost_usd?: number
  ): Promise<any> {
    return this.call('complete_task', {
      taskId,
      tokens_in,
      tokens_out,
      cost_usd,
    });
  }

  // Messages
  async getMessages(
    sessionId: string,
    params?: {
      message_type?:
        | 'PING'
        | 'PONG'
        | 'HANDSHAKE'
        | 'DIRECTIVE'
        | 'STATUS'
        | 'ACK'
        | 'QUERY'
        | 'RESULT';
      priority?: 'low' | 'normal' | 'high';
      target?: string;
      markAsRead?: boolean;
    }
  ): Promise<any> {
    return this.call('get_messages', { sessionId, ...params });
  }

  async sendMessage(params: {
    source: string;
    target: string;
    message: string;
    message_type:
      | 'PING'
      | 'PONG'
      | 'HANDSHAKE'
      | 'DIRECTIVE'
      | 'STATUS'
      | 'ACK'
      | 'QUERY'
      | 'RESULT';
    context?: string;
    priority?: 'low' | 'normal' | 'high';
    action?: 'interrupt' | 'sprint' | 'parallel' | 'queue' | 'backlog';
    sessionId?: string;
    threadId?: string;
    reply_to?: string;
    payload?: Record<string, unknown>;
  }): Promise<any> {
    return this.call('send_message', params);
  }

  async queryMessageHistory(params: {
    threadId?: string;
    source?: string;
    target?: string;
    message_type?:
      | 'PING'
      | 'PONG'
      | 'HANDSHAKE'
      | 'DIRECTIVE'
      | 'STATUS'
      | 'ACK'
      | 'QUERY'
      | 'RESULT';
    status?: string;
    since?: string;
    until?: string;
    limit?: number;
  }): Promise<any> {
    return this.call('query_message_history', params);
  }

  // Questions
  async askQuestion(params: {
    question: string;
    options?: string[];
    priority?: 'low' | 'normal' | 'high';
    context?: string;
    threadId?: string;
    inReplyTo?: string;
    encrypt?: boolean;
  }): Promise<any> {
    return this.call('ask_question', params);
  }

  async getResponse(questionId: string): Promise<any> {
    return this.call('get_response', { questionId });
  }

  // Alerts
  async sendAlert(params: {
    message: string;
    alertType?: 'error' | 'warning' | 'success' | 'info';
    priority?: 'low' | 'normal' | 'high';
    context?: string;
    sessionId?: string;
  }): Promise<any> {
    return this.call('send_alert', params);
  }

  // Fleet
  async getFleetHealth(): Promise<any> {
    return this.call('get_fleet_health', {});
  }

  async getCommsMetrics(params?: {
    period?: 'today' | 'this_week' | 'this_month' | 'all';
  }): Promise<any> {
    return this.call('get_comms_metrics', params || {});
  }

  async getCostSummary(params?: {
    period?: 'today' | 'this_week' | 'this_month' | 'all';
    groupBy?: 'program' | 'type' | 'none';
    programFilter?: string;
  }): Promise<any> {
    return this.call('get_cost_summary', params || {});
  }

  // Sprints
  async getSprint(sprintId: string): Promise<any> {
    return this.call('get_sprint', { sprintId });
  }

  async createSprint(params: {
    projectName: string;
    branch: string;
    stories: Array<{
      id: string;
      title: string;
      wave?: number;
      complexity?: 'normal' | 'high';
      dependencies?: string[];
      maxRetries?: number;
      retryPolicy?: 'none' | 'auto_retry' | 'escalate';
    }>;
    sessionId?: string;
    config?: {
      maxConcurrent?: number;
      orchestratorModel?: string;
      subagentModel?: string;
    };
  }): Promise<any> {
    return this.call('create_sprint', params);
  }

  async updateSprintStory(params: {
    sprintId: string;
    storyId: string;
    status?: 'queued' | 'active' | 'complete' | 'failed' | 'skipped';
    progress?: number;
    currentAction?: string;
    model?: string;
  }): Promise<any> {
    return this.call('update_sprint_story', params);
  }

  async addStoryToSprint(params: {
    sprintId: string;
    story: {
      id: string;
      title: string;
      complexity?: 'normal' | 'high';
      dependencies?: string[];
    };
    insertionMode?: 'current_wave' | 'next_wave' | 'backlog';
  }): Promise<any> {
    return this.call('add_story_to_sprint', params);
  }

  async completeSprint(
    sprintId: string,
    summary?: {
      completed?: number;
      failed?: number;
      skipped?: number;
      duration?: number;
    }
  ): Promise<any> {
    return this.call('complete_sprint', { sprintId, summary });
  }

  // Groups
  async listGroups(): Promise<any> {
    return this.call('list_groups', {});
  }
}

export default CacheBashAPI;
