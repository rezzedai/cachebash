import { useRef, useEffect } from 'react';
import { usePolling } from './usePolling';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { RelayMessage } from '../types';

export function useMessages() {
  const { api } = useAuth();
  const { notifyNewMessage } = useNotifications();
  const prevMessageIdsRef = useRef<Set<string>>(new Set());
  const isSeededRef = useRef(false);

  const result = usePolling<RelayMessage[]>({
    fetcher: async () => {
      if (!api) return [];

      // Fetch messages both TO and FROM orchestrator (the hub) for full visibility
      const [toOrch, fromOrch] = await Promise.all([
        api.queryMessageHistory({ target: 'orchestrator', limit: 30 }).catch(() => ({ messages: [] })),
        api.queryMessageHistory({ source: 'orchestrator', limit: 30 }).catch(() => ({ messages: [] })),
      ]);

      // Merge and deduplicate by message id
      const seen = new Set<string>();
      const allMessages: RelayMessage[] = [];

      for (const m of [...(toOrch.messages || []), ...(fromOrch.messages || [])]) {
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
    cacheKey: 'messages',
  });

  const messages = result.data || [];

  // Detect new messages and fire notifications
  useEffect(() => {
    if (!result.data || result.data.length === 0) return;

    const currentIds = new Set(result.data.map((m) => m.id));

    if (!isSeededRef.current) {
      // First load — seed the known IDs without notifying
      prevMessageIdsRef.current = currentIds;
      isSeededRef.current = true;
      return;
    }

    // Find genuinely new incoming messages
    for (const msg of result.data) {
      if (
        !prevMessageIdsRef.current.has(msg.id) &&
        msg.source !== 'orchestrator' &&
        msg.source !== 'admin'
      ) {
        notifyNewMessage({
          id: msg.id,
          source: msg.source,
          message: msg.message,
          message_type: msg.message_type,
          priority: msg.priority,
        });
      }
    }

    prevMessageIdsRef.current = currentIds;
  }, [result.data, notifyNewMessage]);

  // Count only incoming unread messages (not from orchestrator/admin, and not read/archived)
  const unreadCount = messages.filter(
    (msg) =>
      msg.source !== 'orchestrator' &&
      msg.source !== 'admin' &&
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
    isCached: result.isCached,
  };
}
