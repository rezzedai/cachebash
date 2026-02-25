import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export interface Group {
  name: string;
  members: string[];
}

export function useGroups() {
  const { api } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!api) return;

    const fetchGroups = async () => {
      setIsLoading(true);
      try {
        const data = await api.listGroups();
        // Response shape may vary — be defensive
        const groupList = data.groups || data || [];
        setGroups(
          groupList.map((g: any) => ({
            name: g.name || g.id || 'unknown',
            members: g.members || g.programs || [],
          }))
        );
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load groups'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchGroups();
  }, [api]);

  return { groups, isLoading, error };
}
