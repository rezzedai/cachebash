/**
 * CacheBash v2 Mobile Types
 * Client-side TypeScript interfaces mirroring server types
 * Uses ISO 8601 date strings instead of Firestore timestamps
 */

// Enums and discriminated union types
export type Priority = 'low' | 'normal' | 'high';
export type Action = 'interrupt' | 'sprint' | 'parallel' | 'queue' | 'backlog';
export type TaskType = 'task' | 'question' | 'dream' | 'sprint' | 'sprint-story';
export type TaskStatus = 'created' | 'active' | 'done' | 'failed' | 'expired';
export type RelayMessageType = 'PING' | 'PONG' | 'HANDSHAKE' | 'DIRECTIVE' | 'STATUS' | 'ACK' | 'QUERY' | 'RESULT';
export type SessionState = 'working' | 'blocked' | 'complete' | 'pinned' | 'done' | 'active';
export type SprintStoryStatus = 'queued' | 'active' | 'complete' | 'failed' | 'skipped';

// Core entities
export interface Task {
  id: string;
  type: TaskType;
  title: string;
  instructions?: string;
  status: TaskStatus;
  source?: string;
  target?: string;
  priority: Priority;
  action: Action;
  projectId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  // Question-type tasks
  options?: string[];
  question?: string;
  response?: string;
}

export interface RelayMessage {
  id: string;
  source: string;
  target: string;
  message: string;
  message_type: RelayMessageType;
  priority: Priority;
  status: string;
  createdAt: string;
  threadId?: string;
  context?: string;
}

export interface Session {
  id: string;
  name: string;
  programId?: string;
  status: string;
  state: SessionState;
  progress?: number;
  projectName?: string;
  createdAt: string;
  lastUpdate: string;
  lastHeartbeat?: string;
}

export interface Question {
  id: string;
  question: string;
  context?: string;
  options?: string[];
  response?: string;
  priority: Priority;
  createdAt: string;
}

export interface Sprint {
  id: string;
  projectName: string;
  branch: string;
  stories: SprintStory[];
  status: string;
  createdAt: string;
}

export interface SprintStory {
  id: string;
  title: string;
  status: SprintStoryStatus;
  progress?: number;
  currentAction?: string;
  wave?: number;
}

// Derived types
export interface Program {
  id: string;
  name: string;
  state: SessionState | 'offline';
  status?: string;
  progress?: number;
  lastHeartbeat?: string;
  sessionId?: string;
  projectName?: string;
}
