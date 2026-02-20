import { usePolling } from './usePolling';
import { useAuth } from '../contexts/AuthContext';
import { Task } from '../types';

interface UseTasksOptions {
  status?: 'created' | 'active' | 'all';
  target?: string;
}

export function useTasks(filter?: UseTasksOptions) {
  const { api } = useAuth();

  const result = usePolling<Task[]>({
    fetcher: async () => {
      if (!api) return [];

      const response = await api.getTasks({
        status: filter?.status || 'all',
        target: filter?.target,
        limit: 100,
      });

      // Map response to Task type
      const tasks: Task[] = (response.tasks || []).map((t: any) => ({
        id: t.id || t.taskId,
        type: t.type || 'task',
        title: t.title || '',
        instructions: t.instructions,
        status: t.status || 'created',
        source: t.source,
        target: t.target,
        priority: t.priority || 'normal',
        action: t.action || 'queue',
        projectId: t.projectId,
        createdAt: t.createdAt,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        options: t.options,
        question: t.question,
        response: t.response,
      }));

      // Sort by createdAt descending (newest first)
      tasks.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA;
      });

      return tasks;
    },
    interval: 10000,
    enabled: !!api,
  });

  const tasks = result.data || [];

  // Calculate counts
  const pendingCount = tasks.filter((t) => t.status === 'created').length;
  const activeCount = tasks.filter((t) => t.status === 'active').length;

  return {
    tasks,
    pendingCount,
    activeCount,
    error: result.error,
    isLoading: result.isLoading,
    refetch: result.refetch,
    lastUpdated: result.lastUpdated,
  };
}
