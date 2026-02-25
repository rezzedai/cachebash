import { usePolling } from './usePolling';
import { useAuth } from '../contexts/AuthContext';
import { Session, Program } from '../types';

interface SessionsData {
  sessions: Session[];
  programs: Program[];
}

export function useSessions() {
  const { api } = useAuth();

  const result = usePolling<SessionsData>({
    fetcher: async () => {
      if (!api) return { sessions: [], programs: [] };

      const response = await api.listSessions({ state: 'all', limit: 50 });

      // Map response to Session type
      const sessions: Session[] = (response.sessions || []).map((s: any) => ({
        id: s.id || s.sessionId,
        name: s.name || s.status || '',
        programId: s.programId,
        status: s.status || '',
        state: s.state || 'working',
        progress: s.progress,
        projectName: s.projectName,
        createdAt: s.createdAt,
        lastUpdate: s.lastUpdate || s.createdAt,
        lastHeartbeat: s.lastHeartbeat,
      }));

      // Build programs map from sessions with a programId
      // Group by programId, take the latest session for each program
      const programMap = new Map<string, Program>();

      for (const session of sessions) {
        const pid = session.programId;
        if (!pid) continue; // Skip anonymous sessions

        const existing = programMap.get(pid);

        if (
          !existing ||
          new Date(session.lastUpdate).getTime() >
            new Date(existing.lastHeartbeat || '').getTime()
        ) {
          programMap.set(pid, {
            id: pid,
            name: pid,
            state: session.state || 'offline',
            status: session.status,
            progress: session.progress,
            lastHeartbeat: session.lastHeartbeat || session.lastUpdate,
            sessionId: session.id,
          });
        }
      }

      // Sort programs: working first, then blocked, then active, then done/complete, then offline
      const stateOrder: Record<string, number> = {
        working: 0,
        blocked: 1,
        active: 2,
        pinned: 3,
        done: 4,
        complete: 5,
        offline: 6,
      };

      const programs = Array.from(programMap.values()).sort((a, b) => {
        return (stateOrder[a.state] ?? 9) - (stateOrder[b.state] ?? 9);
      });

      return { sessions, programs };
    },
    interval: 15000,
    enabled: !!api,
    cacheKey: 'sessions',
  });

  return {
    sessions: result.data?.sessions || [],
    programs: result.data?.programs || [],
    data: result.data,
    error: result.error,
    isLoading: result.isLoading,
    refetch: result.refetch,
    lastUpdated: result.lastUpdated,
    isCached: result.isCached,
  };
}
