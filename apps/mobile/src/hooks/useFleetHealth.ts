import { usePolling } from './usePolling';
import { useAuth } from '../contexts/AuthContext';

export interface ProgramHealth {
  programId: string;
  heartbeatAge: number; // seconds since last heartbeat
  pendingMessages: number;
  pendingTasks: number;
  isHealthy: boolean; // heartbeat < 120s
}

export function useFleetHealth() {
  const { api } = useAuth();

  const result = usePolling<ProgramHealth[]>({
    fetcher: async () => {
      if (!api) return [];

      const data = await api.getFleetHealth();
      // The API returns program health info — map to our type
      // The actual shape may vary, so be defensive
      const programs = data.programs || data.fleet || [];

      return programs.map((p: any) => ({
        programId: p.programId || p.id || 'unknown',
        heartbeatAge: p.heartbeatAge || p.heartbeat_age || 0,
        pendingMessages: p.pendingMessages || p.pending_messages || 0,
        pendingTasks: p.pendingTasks || p.pending_tasks || 0,
        isHealthy: (p.heartbeatAge || p.heartbeat_age || 0) < 120,
      }));
    },
    interval: 30000, // 30s — health data doesn't need fast polling
    enabled: !!api,
    cacheKey: 'fleet-health',
  });

  const programs = result.data || [];
  const healthyCount = programs.filter(p => p.isHealthy).length;
  const totalCount = programs.length;

  return {
    programs,
    healthyCount,
    totalCount,
    error: result.error,
    isLoading: result.isLoading,
    refetch: result.refetch,
    lastUpdated: result.lastUpdated,
    isCached: result.isCached,
  };
}
