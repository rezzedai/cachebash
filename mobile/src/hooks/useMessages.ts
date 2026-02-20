import { usePolling } from './usePolling';
import { useAuth } from '../contexts/AuthContext';
import { RelayMessage } from '../types';

export function useMessages() {
  const { api } = useAuth();

  const result = usePolling<RelayMessage[]>({
    fetcher: async () => {
      if (!api) return [];

      // Fetch messages both TO and FROM iso (the hub) for full grid visibility
      const [toIso, fromIso] = await Promise.all([
        api.queryMessageHistory({ target: 'iso', limit: 30 }).catch(() => ({ messages: [] })),
        api.queryMessageHistory({ source: 'iso', limit: 30 }).catch(() => ({ messages: [] })),
      ]);

      // Merge and deduplicate by message id
      const seen = new Set<string>();
      const allMessages: RelayMessage[] = [];

      for (const m of [...(toIso.messages || []), ...(fromIso.messages || [])]) {
        const id = m.id || m.messageId;
        if (seen.has(id)) continue;
        seen.add(id);

        allMessages.push({
          id,
          source: m.source || '',
          target: m.target || '',
          message: m.message || '',
          message_type: m.message_type || 'STATUS',
          priority: m.priority || 'normal',
          status: m.status || 'delivered',
          createdAt: m.createdAt,
          threadId: m.threadId,
          context: m.context,
        });
      }

      // Sort by createdAt descending (newest first)
      allMessages.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA;
      });

      return allMessages;
    },
    interval: 15000,
    enabled: !!api,
  });

  const messages = result.data || [];

  // Count only incoming unread messages (not from iso/flynn, and not read/archived)
  const unreadCount = messages.filter(
    (msg) =>
      msg.source !== 'iso' &&
      msg.source !== 'flynn' &&
      msg.status !== 'read' &&
      msg.status !== 'archived'
  ).length;

  return {
    messages,
    unreadCount,
    error: result.error,
    isLoading: result.isLoading,
    refetch: result.refetch,
    lastUpdated: result.lastUpdated,
  };
}
