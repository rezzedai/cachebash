import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { useMessages } from '../hooks/useMessages';
import { useAuth } from '../contexts/AuthContext';
import { useConnectivity } from '../contexts/ConnectivityContext';
import { enqueueMessage, drainQueue, getQueuedMessages, QueuedMessage } from '../services/offlineQueue';
import { theme } from '../theme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RelayMessage, RelayMessageType } from '../types';
import { timeAgo, getMessageTypeColor } from '../utils';
import { haptic } from '../utils/haptics';

type Props = NativeStackScreenProps<any, 'ChannelDetail'>;

interface OptimisticMessage {
  id: string; // temp id like `optimistic_${Date.now()}`
  source: string;
  target: string;
  message: string;
  message_type: RelayMessageType;
  priority: string;
  status: string;
  createdAt: string;
  isOptimistic: true;
  isFailed?: boolean;
}

export default function ChannelDetailScreen({ route, navigation }: Props) {
  const { programId } = route.params || {};
  const { api } = useAuth();
  const { messages: allMessages, refetch, isLoading } = useMessages();
  const { isConnected, isInternetReachable } = useConnectivity();
  const isOffline = !isConnected || isInternetReachable === false;
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null); // null = all types
  const [searchText, setSearchText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const sendingRef = useRef(false);
  const lastSentRef = useRef<{ text: string; timestamp: number } | null>(null);

  // Filter messages for this specific program and merge with optimistic messages
  const displayMessages = useMemo(() => {
    // Filter real messages for this channel
    const real = allMessages.filter((msg) => msg.source === programId || msg.target === programId);

    // Filter out optimistic messages that have been confirmed by real messages
    const activeOptimistic = optimisticMessages.filter(opt => {
      // Check if a real message matches this optimistic one
      return !real.some(realMsg =>
        realMsg.source === opt.source &&
        realMsg.target === opt.target &&
        realMsg.message === opt.message &&
        Math.abs(new Date(realMsg.createdAt).getTime() - new Date(opt.createdAt).getTime()) < 30000
      );
    });

    let combined = [...real, ...activeOptimistic];

    // Apply type filter
    if (typeFilter) {
      combined = combined.filter(msg => msg.message_type === typeFilter);
    }

    // Apply search filter
    if (searchText.trim()) {
      const query = searchText.trim().toLowerCase();
      combined = combined.filter(msg => msg.message.toLowerCase().includes(query));
    }

    // Sort ascending (oldest first, newest at bottom) for chat-like display
    combined.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return combined;
  }, [allMessages, programId, optimisticMessages, typeFilter, searchText]);

  // Set header title to program name
  useEffect(() => {
    if (programId) {
      navigation.setOptions({
        title: programId.toUpperCase(),
        headerRight: () => (
          <TouchableOpacity onPress={() => navigation.navigate('ProgramDetail', { programId })}>
            <Text style={{ color: theme.colors.primary, fontSize: 14, fontWeight: '600' }}>Profile</Text>
          </TouchableOpacity>
        ),
      });
    }
  }, [programId, navigation]);

  // Mark unread messages as read when channel is opened
  useEffect(() => {
    if (!api || !programId) return;

    const unreadIds = allMessages
      .filter(
        (msg) =>
          (msg.source === programId || msg.target === programId) &&
          msg.status !== 'read' &&
          msg.status !== 'archived' &&
          msg.source !== 'admin'
      )
      .map((msg) => msg.id);

    if (unreadIds.length > 0) {
      api.markMessagesRead(unreadIds).catch(() => {});
    }
  }, [api, programId, allMessages]);

  // Drain offline queue when connectivity returns
  useEffect(() => {
    if (isOffline || !api) return;

    drainQueue(async (msg) => {
      await api.sendMessage({
        source: msg.source,
        target: msg.target,
        message: msg.message,
        message_type: msg.message_type as any,
        priority: msg.priority as any,
      });
    }).then((sent) => {
      if (sent > 0) {
        refetch();
        // Clear optimistic queued messages
        setOptimisticMessages(prev => prev.filter(m => m.status !== 'queued'));
      }
    }).catch(() => {});
  }, [isOffline, api, refetch]);

  const handleSend = async () => {
    if (!inputText.trim() || !programId) return;

    // Prevent double-send via ref (synchronous check)
    if (sendingRef.current) return;
    sendingRef.current = true;

    const messageText = inputText.trim();

    // Request deduplication: ignore if same message sent within 2 seconds
    const now = Date.now();
    if (lastSentRef.current?.text === messageText && now - lastSentRef.current.timestamp < 2000) {
      sendingRef.current = false;
      return;
    }

    const tempId = `optimistic_${Date.now()}`;

    // Optimistic insert
    const optimistic: OptimisticMessage = {
      id: tempId,
      source: 'admin',
      target: programId,
      message: messageText,
      message_type: 'DIRECTIVE',
      priority: 'normal',
      status: isOffline ? 'queued' : 'sending',
      createdAt: new Date().toISOString(),
      isOptimistic: true,
    };

    setOptimisticMessages(prev => [...prev, optimistic]);
    setInputText(''); // Clear immediately for quick follow-up messages

    haptic.medium();
    setSendError(null);

    // If offline, queue the message for later
    if (isOffline || !api) {
      await enqueueMessage({
        source: 'admin',
        target: programId,
        message: messageText,
        message_type: 'DIRECTIVE',
        priority: 'normal',
      });
      haptic.light();
      setSendError('Queued — will send when online');
      setTimeout(() => setSendError(null), 3000);
      sendingRef.current = false;
      return;
    }

    setIsSending(true);

    try {
      await api.sendMessage({
        source: 'admin',
        target: programId,
        message: messageText,
        message_type: 'DIRECTIVE',
        priority: 'normal',
      });

      haptic.success();

      // Track last sent for deduplication
      lastSentRef.current = { text: messageText, timestamp: now };

      // Refetch messages to show the new one
      await refetch();

      // Clean up confirmed optimistic message
      setOptimisticMessages(prev => prev.filter(m => m.id !== tempId));
    } catch (error) {
      console.error('Failed to send message:', error);
      // Mark optimistic message as failed
      setOptimisticMessages(prev =>
        prev.map(m => m.id === tempId ? { ...m, isFailed: true, status: 'failed' } : m)
      );
      haptic.error();
      setSendError('Failed to send');
      setTimeout(() => setSendError(null), 3000); // Auto-dismiss after 3s
    } finally {
      setIsSending(false);
      sendingRef.current = false;
    }
  };

  const handleRetry = async (message: OptimisticMessage) => {
    // Remove the failed message
    setOptimisticMessages(prev => prev.filter(m => m.id !== message.id));

    const tempId = `optimistic_${Date.now()}`;
    const retryMsg: OptimisticMessage = {
      ...message,
      id: tempId,
      isFailed: false,
      status: 'sending',
      createdAt: new Date().toISOString(),
    };
    setOptimisticMessages(prev => [...prev, retryMsg]);

    try {
      await api!.sendMessage({
        source: 'admin',
        target: programId,
        message: message.message,
        message_type: 'DIRECTIVE',
        priority: 'normal',
      });
      haptic.success();
      await refetch();
      setOptimisticMessages(prev => prev.filter(m => m.id !== tempId));
    } catch {
      setOptimisticMessages(prev =>
        prev.map(m => m.id === tempId ? { ...m, isFailed: true, status: 'failed' } : m)
      );
      haptic.error();
    }
  };

  const renderMessage = ({ item }: { item: RelayMessage | OptimisticMessage }) => {
    const isFromUser = item.source === 'admin';
    const isOptimistic = 'isOptimistic' in item && item.isOptimistic;
    const isFailed = isOptimistic && 'isFailed' in item && item.isFailed;
    const typeColor = getMessageTypeColor(item.message_type);

    return (
      <TouchableOpacity
        style={[styles.messageRow, isFromUser && styles.messageRowRight]}
        onPress={isFailed ? () => handleRetry(item as OptimisticMessage) : undefined}
        disabled={!isFailed}
        activeOpacity={isFailed ? 0.7 : 1}
      >
        <View style={[
          styles.messageBubble,
          isFromUser && styles.messageBubbleUser,
          isOptimistic && !isFailed && styles.messageBubbleOptimistic,
          isFailed && styles.messageBubbleFailed,
        ]}>
          <Text style={styles.messageSource}>{item.source.toUpperCase()}</Text>
          <Text style={styles.messageText}>{item.message}</Text>
          <View style={styles.messageFooter}>
            <View style={[styles.typeBadge, { backgroundColor: typeColor }]}>
              <Text style={styles.typeText}>{item.message_type}</Text>
            </View>
            {isOptimistic && !isFailed ? (
              <ActivityIndicator size="small" color={theme.colors.textMuted} style={{ marginLeft: theme.spacing.sm }} />
            ) : isFailed ? (
              <Text style={styles.failedText}>Tap to retry</Text>
            ) : (
              <Text style={styles.messageTime}>{timeAgo(item.createdAt)}</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (!programId) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No program selected</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Filter Bar */}
      <View style={styles.filterBar}>
        <TouchableOpacity
          style={styles.filterToggle}
          onPress={() => {
            haptic.selection();
            setShowFilters(!showFilters);
          }}
          accessibilityLabel={showFilters ? 'Hide filters' : 'Show filters'}
          accessibilityRole="button"
        >
          <Text style={styles.filterToggleText}>
            {showFilters ? '▼ Filters' : '▶ Filters'}
          </Text>
          {(typeFilter || searchText.trim()) && (
            <View style={styles.filterActiveDot} />
          )}
        </TouchableOpacity>

        {showFilters && (
          <View style={styles.filterContent}>
            {/* Search */}
            <TextInput
              style={styles.searchInput}
              placeholder="Search messages..."
              placeholderTextColor={theme.colors.textMuted}
              value={searchText}
              onChangeText={setSearchText}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Search messages"
            />

            {/* Type filter chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.typeFilterRow}
            >
              {[null, 'DIRECTIVE', 'RESULT', 'STATUS', 'QUERY', 'ACK'].map((type) => {
                const isActive = typeFilter === type;
                const label = type || 'All';
                const color = type ? getMessageTypeColor(type as RelayMessageType) : theme.colors.textSecondary;
                return (
                  <TouchableOpacity
                    key={label}
                    style={[
                      styles.typeChip,
                      isActive && { borderColor: color, backgroundColor: color + '15' },
                    ]}
                    onPress={() => {
                      haptic.selection();
                      setTypeFilter(type);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                  >
                    <Text style={[styles.typeChipText, isActive && { color }]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>

      {isLoading && displayMessages.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : displayMessages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>◈ No messages yet</Text>
          <Text style={styles.emptySubtext}>Start a conversation with {programId.toUpperCase()}</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={displayMessages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          maxToRenderPerBatch={15}
          initialNumToRender={20}
          windowSize={7}
          inverted={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          refreshControl={
            <RefreshControl
              refreshing={isLoading && displayMessages.length > 0}
              onRefresh={refetch}
              tintColor={theme.colors.primary}
            />
          }
        />
      )}

      {sendError && (
        <View style={styles.sendErrorBanner}>
          <Text style={styles.sendErrorText}>{sendError}</Text>
        </View>
      )}

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Send a message..."
          placeholderTextColor={theme.colors.textMuted}
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={2000}
          editable={!isSending}
          accessibilityLabel="Message input"
          accessibilityHint="Type a message to send"
        />
        <TouchableOpacity
          style={[styles.sendButton, (!inputText.trim() || isSending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || isSending}
          activeOpacity={0.7}
          accessibilityLabel={isOffline ? "Queue message for sending when online" : "Send message"}
          accessibilityRole="button"
        >
          {isSending ? (
            <ActivityIndicator size="small" color={theme.colors.text} />
          ) : (
            <Text style={styles.sendButtonText}>{isOffline ? 'Queue' : 'Send'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  emptyText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.sm,
  },
  emptySubtext: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  errorText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.error,
    textAlign: 'center',
  },
  messageList: {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
  },
  messageRow: {
    marginBottom: theme.spacing.md,
    alignItems: 'flex-start',
  },
  messageRowRight: {
    alignItems: 'flex-end',
  },
  messageBubble: {
    maxWidth: '80%',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  messageBubbleUser: {
    backgroundColor: theme.colors.surfaceElevated,
    borderColor: theme.colors.primary,
  },
  messageBubbleOptimistic: {
    opacity: 0.6,
  },
  messageBubbleFailed: {
    borderColor: theme.colors.error,
    opacity: 0.8,
  },
  messageSource: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    fontWeight: '600',
    marginBottom: theme.spacing.xs,
  },
  messageText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    lineHeight: 22,
    marginBottom: theme.spacing.sm,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.spacing.xs,
  },
  typeBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
  },
  typeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.text,
    fontWeight: '600',
  },
  messageTime: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginLeft: theme.spacing.sm,
  },
  failedText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.error,
    fontWeight: '500',
    marginLeft: theme.spacing.sm,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    maxHeight: 100,
    marginRight: theme.spacing.sm,
  },
  sendButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 60,
    height: 40,
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.textMuted,
    opacity: 0.5,
  },
  sendButtonText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    fontWeight: '600',
  },
  sendErrorBanner: {
    backgroundColor: theme.colors.error + '15',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  sendErrorText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.error,
    textAlign: 'center',
    fontWeight: '500',
  },
  filterBar: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  filterToggleText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textMuted,
  },
  filterActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.primary,
  },
  filterContent: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  searchInput: {
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
  },
  typeFilterRow: {
    gap: theme.spacing.sm,
  },
  typeChip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  typeChipText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
});
