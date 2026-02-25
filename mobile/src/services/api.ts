const BASE_URL = 'https://cachebash-mcp-922749444863.us-central1.run.app/v1';

interface RestResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; issues?: unknown[] };
  meta?: { timestamp: string };
}

export class CacheBashAPIError extends Error {
  constructor(
    message: string,
    public code?: number | string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'CacheBashAPIError';
  }
}

class CacheBashAPI {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const resp = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        if (resp.status === 204 || resp.headers.get('content-length') === '0') {
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          throw new CacheBashAPIError('Empty response', resp.status);
        }

        const json: RestResponse<T> = await resp.json();

        if (!resp.ok || !json.success) {
          throw new CacheBashAPIError(
            json.error?.message || `HTTP ${resp.status}`,
            json.error?.code || resp.status,
            json.error?.issues
          );
        }

        return json.data as T;
      } catch (error) {
        if (error instanceof CacheBashAPIError) {
          if (attempt === MAX_RETRIES - 1) throw error;
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        if (attempt === MAX_RETRIES - 1) {
          throw new CacheBashAPIError(
            error instanceof Error ? error.message : 'Network error',
            undefined,
            error
          );
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    throw new CacheBashAPIError('Max retries exceeded');
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  private queryString(params: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      }
    }
    return parts.length > 0 ? `?${parts.join('&')}` : '';
  }

  // Sessions
  async listSessions(params?: {
    state?: 'working' | 'blocked' | 'pinned' | 'complete' | 'all';
    limit?: number;
    programId?: string;
    includeArchived?: boolean;
  }): Promise<any> {
    return this.get(`/sessions${this.queryString(params || {})}`);
  }

  async createSession(params: {
    name: string;
    programId?: string;
    projectName?: string;
    state?: 'working' | 'blocked' | 'complete' | 'pinned';
    status?: string;
    progress?: number;
  }): Promise<any> {
    return this.post('/sessions', params);
  }

  async updateSession(params: {
    status: string;
    sessionId?: string;
    progress?: number;
    state?: 'working' | 'blocked' | 'complete' | 'pinned';
    projectName?: string;
    lastHeartbeat?: boolean;
  }): Promise<any> {
    const { sessionId, ...body } = params;
    const id = sessionId || 'default';
    return this.patch(`/sessions/${encodeURIComponent(id)}`, body);
  }

  // Tasks
  async getTasks(params?: {
    status?: 'created' | 'active' | 'all';
    target?: string;
    limit?: number;
    type?: 'task' | 'question' | 'dream' | 'sprint' | 'sprint-story' | 'all';
  }): Promise<any> {
    return this.get(`/tasks${this.queryString(params || {})}`);
  }

  async getTaskStats(): Promise<any> {
    return this.get('/tasks/stats');
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
    return this.post('/tasks', params);
  }

  async claimTask(
    taskId: string,
    sessionId?: string
  ): Promise<any> {
    return this.post(`/tasks/${encodeURIComponent(taskId)}/claim`, {
      ...(sessionId ? { sessionId } : {}),
    });
  }

  async completeTask(
    taskId: string,
    tokens_in?: number,
    tokens_out?: number,
    cost_usd?: number
  ): Promise<any> {
    return this.post(`/tasks/${encodeURIComponent(taskId)}/complete`, {
      ...(tokens_in !== undefined ? { tokens_in } : {}),
      ...(tokens_out !== undefined ? { tokens_out } : {}),
      ...(cost_usd !== undefined ? { cost_usd } : {}),
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
    return this.get(`/messages${this.queryString({ sessionId, ...params })}`);
  }

  async getUnreadMessages(sessionId?: string): Promise<any> {
    return this.get(`/messages/unread${this.queryString({ sessionId: sessionId || 'rest' })}`);
  }

  async markMessagesRead(messageIds: string[]): Promise<any> {
    return this.post('/messages/mark_read', { messageIds });
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
    return this.post('/messages', params);
  }

  async getSentMessages(params?: {
    target?: string;
    status?: string;
    threadId?: string;
    limit?: number;
  }): Promise<any> {
    return this.get(`/messages/sent${this.queryString(params || {})}`);
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
    return this.get(`/messages/history${this.queryString(params)}`);
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
    return this.post('/questions', params);
  }

  async getResponse(questionId: string): Promise<any> {
    return this.get(`/questions/${encodeURIComponent(questionId)}/response`);
  }

  // Alerts
  async sendAlert(params: {
    message: string;
    alertType?: 'error' | 'warning' | 'success' | 'info';
    priority?: 'low' | 'normal' | 'high';
    context?: string;
    sessionId?: string;
  }): Promise<any> {
    return this.post('/alerts', params);
  }

  // Fleet
  async getFleetHealth(): Promise<any> {
    return this.get('/fleet/health');
  }

  async getCommsMetrics(params?: {
    period?: 'today' | 'this_week' | 'this_month' | 'all';
  }): Promise<any> {
    return this.get(`/metrics/comms${this.queryString(params || {})}`);
  }

  async getCostSummary(params?: {
    period?: 'today' | 'this_week' | 'this_month' | 'all';
    groupBy?: 'program' | 'type' | 'none';
    programFilter?: string;
  }): Promise<any> {
    return this.get(`/metrics/cost-summary${this.queryString(params || {})}`);
  }

  // Sprints
  async getSprint(sprintId: string): Promise<any> {
    return this.get(`/sprints/${encodeURIComponent(sprintId)}`);
  }

  async getActiveSprints(): Promise<any> {
    return this.get('/sprints/active');
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
    return this.post('/sprints', params);
  }

  async updateSprintStory(params: {
    sprintId: string;
    storyId: string;
    status?: 'queued' | 'active' | 'complete' | 'failed' | 'skipped';
    progress?: number;
    currentAction?: string;
    model?: string;
  }): Promise<any> {
    const { sprintId, storyId, ...body } = params;
    return this.patch(
      `/sprints/${encodeURIComponent(sprintId)}/stories/${encodeURIComponent(storyId)}`,
      body
    );
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
    const { sprintId, ...body } = params;
    return this.post(`/sprints/${encodeURIComponent(sprintId)}/stories`, body);
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
    return this.post(`/sprints/${encodeURIComponent(sprintId)}/complete`, {
      ...(summary ? { summary } : {}),
    });
  }

  // Groups
  async listGroups(): Promise<any> {
    return this.get('/relay/groups');
  }

  // Program State
  async getProgramState(programId: string): Promise<any> {
    return this.get(`/program-state/${encodeURIComponent(programId)}`);
  }

  async updateProgramState(
    programId: string,
    state: Record<string, unknown>
  ): Promise<any> {
    return this.patch(`/program-state/${encodeURIComponent(programId)}`, state);
  }
}

export default CacheBashAPI;
