import { usePolling } from './usePolling';
import { useAuth } from '../contexts/AuthContext';
import { Sprint } from '../types';

export function useSprints() {
  const { api } = useAuth();

  const result = usePolling<Sprint[]>({
    fetcher: async () => {
      if (!api) return [];

      // Get sprint-type tasks to find sprint IDs
      const response = await api.getTasks({ type: 'sprint', status: 'all', limit: 20 });
      const sprintTasks = response.tasks || [];

      // Fetch full sprint data for each
      const sprints: Sprint[] = [];
      for (const task of sprintTasks) {
        try {
          const sprintData = await api.getSprint(task.id);
          if (sprintData) {
            sprints.push({
              id: sprintData.id || task.id,
              projectName: sprintData.projectName || task.title,
              branch: sprintData.branch || '',
              stories: (sprintData.stories || []).map((s: any) => ({
                id: s.id,
                title: s.title,
                status: s.status || 'queued',
                progress: s.progress || 0,
                currentAction: s.currentAction,
                wave: s.wave,
              })),
              status: sprintData.status || task.status,
              createdAt: sprintData.createdAt || task.createdAt,
            });
          }
        } catch {
          // Sprint may have been cleaned up
        }
      }

      // Sort by createdAt descending
      sprints.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return sprints;
    },
    interval: 15000,
    enabled: !!api,
    cacheKey: 'sprints',
  });

  return {
    sprints: result.data || [],
    error: result.error,
    isLoading: result.isLoading,
    refetch: result.refetch,
    lastUpdated: result.lastUpdated,
    isCached: result.isCached,
  };
}
