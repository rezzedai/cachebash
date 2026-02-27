import React, { useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useMessages } from '../hooks/useMessages';
import { useGroups } from '../hooks/useGroups';
import { theme } from '../theme';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RelayMessage, RelayMessageType } from '../types';
import { timeAgo, getMessageTypeColor, haptic } from '../utils';
import EmptyState from '../components/EmptyState';

type MessagesScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

interface Channel {
  programId: string;
  lastMessage: RelayMessage;
  unreadCount: number;
}

export default function MessagesScreen({ navigation }: MessagesScreenProps) {
  const { messages, unreadCount, isLoading, refetch, error, markAsRead } = useMessages();
  const { groups } = useGroups();

  useFocusEffect(
    React.useCallback(() => {
      markAsRead();
    }, [markAsRead])
  );

  // Group messages by source (program) and get the latest message per channel
  const channels = useMemo(() => {
    const channelMap = new Map<string, Channel>();

    messages.forEach((message) => {
      // Group by conversation partner — the party that isn't the user (admin)
      let programId: string;
      if (message.source === 'admin') {
        programId = message.target;
      } else if (message.target === 'admin') {
        programId = message.source;
      } else {
        // Messages between programs — group by the non-iso party
        programId = message.source === 'iso' ? message.target : message.source;
      }

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

  const renderChannel = ({ item, index }: { item: Channel; index: number }) => {
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
              {(item.lastMessage.source === 'iso' || item.lastMessage.source === 'admin') ? 'You: ' : ''}{item.lastMessage.message}
            </Text>
          </View>
        </View>

        <View style={styles.channelRight}>
          <Text style={styles.timestamp}>{timeAgo(item.lastMessage.createdAt)}</Text>
          {item.unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>
                {item.unreadCount > 99 ? '99+' : item.unreadCount}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderSeparator = () => <View style={styles.separator} />;

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
        <EmptyState
          icon="💬"
          title="No Messages Yet"
          description="Messages from your connected agents will appear here."
        />
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
        ItemSeparatorComponent={renderSeparator}
        maxToRenderPerBatch={10}
        initialNumToRender={15}
        windowSize={5}
        ListHeaderComponent={
          <>
            {/* Multicast Groups */}
            {groups.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>Groups</Text>
                <View style={styles.groupList}>
                  {groups.map((group) => (
                    <TouchableOpacity
                      key={group.name}
                      style={styles.groupCard}
                      onPress={() => {
                        haptic.light();
                        navigation.navigate('ChannelDetail', { programId: group.name });
                      }}
                      activeOpacity={0.7}
                      accessibilityLabel={`Group ${group.name}, ${group.members.length} members`}
                      accessibilityRole="button"
                    >
                      <View style={styles.groupHeader}>
                        <Text style={styles.groupName}>{group.name.toUpperCase()}</Text>
                        <Text style={styles.groupCount}>{group.members.length} members</Text>
                      </View>
                      <Text style={styles.groupMembers} numberOfLines={1}>
                        {group.members.join(', ')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Channels Section Header */}
            {channels.length > 0 && (
              <Text style={styles.sectionHeader}>Channels</Text>
            )}
          </>
        }
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
  section: {
    marginBottom: theme.spacing.md,
  },
  sectionHeader: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  groupList: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  groupCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  groupName: {
    fontSize: theme.fontSize.md,
    fontWeight: '700',
    color: theme.colors.primary,
    letterSpacing: 0.5,
  },
  groupCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  groupMembers: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.surface,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
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
    backgroundColor: theme.colors.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.background,
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
