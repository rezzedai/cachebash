import React, { useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet, ActivityIndicator } from 'react-native';
import { useMessages } from '../hooks/useMessages';
import { theme } from '../theme';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RelayMessage, RelayMessageType } from '../types';
import { timeAgo, getMessageTypeColor } from '../utils';

type MessagesScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

interface Channel {
  programId: string;
  lastMessage: RelayMessage;
  unreadCount: number;
}

export default function MessagesScreen({ navigation }: MessagesScreenProps) {
  const { messages, unreadCount, isLoading, refetch, error } = useMessages();

  // Group messages by source (program) and get the latest message per channel
  const channels = useMemo(() => {
    const channelMap = new Map<string, Channel>();

    messages.forEach((message) => {
      // Group by conversation partner — the program that isn't iso/flynn
      const programId = (message.source === 'iso' || message.source === 'flynn')
        ? message.target
        : message.source;

      // Skip empty programId
      if (!programId) return;

      if (!channelMap.has(programId)) {
        channelMap.set(programId, {
          programId,
          lastMessage: message,
          unreadCount: message.status !== 'read' && message.status !== 'archived' ? 1 : 0,
        });
      } else {
        const channel = channelMap.get(programId)!;

        // Update unread count
        if (message.status !== 'read' && message.status !== 'archived') {
          channel.unreadCount += 1;
        }

        // Keep the latest message
        const currentMsgTime = new Date(channel.lastMessage.createdAt).getTime();
        const newMsgTime = new Date(message.createdAt).getTime();
        if (newMsgTime > currentMsgTime) {
          channel.lastMessage = message;
        }
      }
    });

    // Convert to array and sort by last message time
    return Array.from(channelMap.values()).sort((a, b) => {
      const timeA = new Date(a.lastMessage.createdAt).getTime();
      const timeB = new Date(b.lastMessage.createdAt).getTime();
      return timeB - timeA;
    });
  }, [messages]);

  const renderChannel = ({ item }: { item: Channel }) => {
    const typeColor = getMessageTypeColor(item.lastMessage.message_type);

    return (
      <TouchableOpacity
        style={styles.channelRow}
        onPress={() => navigation.navigate('ChannelDetail', { programId: item.programId })}
        activeOpacity={0.7}
        accessibilityLabel={`Channel with ${item.programId.toUpperCase()}, ${item.unreadCount} unread`}
        accessibilityRole="button"
      >
        <View style={styles.channelLeft}>
          <View style={[styles.programDot, { backgroundColor: typeColor }]} />
          <View style={styles.channelContent}>
            <Text style={styles.programName}>{(item.programId || 'Unknown').toUpperCase()}</Text>
            <Text style={styles.messagePreview} numberOfLines={1} ellipsizeMode="tail">
              {(item.lastMessage.source === 'iso' || item.lastMessage.source === 'flynn') ? 'You: ' : ''}{item.lastMessage.message}
            </Text>
          </View>
        </View>

        <View style={styles.channelRight}>
          <Text style={styles.timestamp}>{timeAgo(item.lastMessage.createdAt)}</Text>
          {item.unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <View style={styles.unreadDot} />
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading && messages.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  if (error && messages.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.errorText}>Failed to load messages</Text>
          <TouchableOpacity
            onPress={refetch}
            style={styles.retryButton}
            accessibilityRole="button"
            accessibilityLabel="Retry loading messages"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (messages.length === 0 && !isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>◈ No messages yet</Text>
          <Text style={styles.emptyHintText}>Pull down to refresh</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={channels}
        renderItem={renderChannel}
        keyExtractor={(item) => item.programId}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor={theme.colors.primary}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  listContent: {
    paddingTop: theme.spacing.sm,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  channelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  programDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: theme.spacing.md,
  },
  channelContent: {
    flex: 1,
  },
  programName: {
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  messagePreview: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  channelRight: {
    alignItems: 'flex-end',
    marginLeft: theme.spacing.md,
  },
  timestamp: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  unreadBadge: {
    marginTop: theme.spacing.xs,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.textMuted,
  },
  emptyHintText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  errorText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.error,
    marginBottom: theme.spacing.md,
  },
  retryButton: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  retryText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    fontWeight: '600',
  },
});
