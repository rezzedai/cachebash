import { usePolling } from './usePolling';
import { useAuth } from '../contexts/AuthContext';
import { RelayMessage } from '../types';

export function useMessages(sessionId: string = 'flynn') {
  const { api } = useAuth();

  const result = usePolling<RelayMessage[]>({
    fetcher: async () => {
      if (!api) return [];

      const response = await api.getMessages(sessionId, {
        markAsRead: false, // Don't mark as read on fetch, let user explicitly do so
      });

      // Map response to RelayMessage type
      const messages: RelayMessage[] = (response.messages || []).map((m: any) => ({
        id: m.id || m.messageId,
        source: m.source || '',
        target: m.target || '',
        message: m.message || '',
        message_type: m.message_type || 'STATUS',
        priority: m.priority || 'normal',
        status: m.status || 'delivered',
        createdAt: m.createdAt,
        threadId: m.threadId,
        context: m.context,
      }));

      // Sort by createdAt descending (newest first)
      messages.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA;
      });

      return messages;
    },
    interval: 10000,
    enabled: !!api,
  });

  const messages = result.data || [];

  // Calculate unread count (messages with status !== 'read')
  const unreadCount = messages.filter(
    (m) => m.status !== 'read' && m.status !== 'archived'
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
