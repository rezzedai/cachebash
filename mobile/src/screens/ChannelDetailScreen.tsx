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
} from 'react-native';
import { useMessages } from '../hooks/useMessages';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RelayMessage, RelayMessageType } from '../types';
import { timeAgo, getMessageTypeColor } from '../utils';

type Props = NativeStackScreenProps<any, 'ChannelDetail'>;

export default function ChannelDetailScreen({ route, navigation }: Props) {
  const { programId } = route.params || {};
  const { api } = useAuth();
  const { messages: allMessages, refetch, isLoading } = useMessages();
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const sendingRef = useRef(false);
  const lastSentRef = useRef<{ text: string; timestamp: number } | null>(null);

  // Filter messages for this specific program
  const channelMessages = useMemo(() => {
    return allMessages.filter((msg) => msg.source === programId || msg.target === programId);
  }, [allMessages, programId]);

  // Set header title to program name
  useEffect(() => {
    if (programId) {
      navigation.setOptions({ title: programId.toUpperCase() });
    }
  }, [programId, navigation]);

  const handleSend = async () => {
    if (!inputText.trim() || !api || !programId) return;

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

    setSendError(null);
    setIsSending(true);

    try {
      await api.sendMessage({
        source: 'flynn',
        target: programId,
        message: messageText,
        message_type: 'DIRECTIVE',
        priority: 'normal',
      });

      // Track last sent for deduplication
      lastSentRef.current = { text: messageText, timestamp: now };

      // Clear input only after successful send
      setInputText('');

      // Refetch messages to show the new one
      await refetch();

      // Scroll to bottom after sending
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.error('Failed to send message:', error);
      setSendError('Failed to send');
      setTimeout(() => setSendError(null), 3000); // Auto-dismiss after 3s
    } finally {
      setIsSending(false);
      sendingRef.current = false;
    }
  };

  const renderMessage = ({ item }: { item: RelayMessage }) => {
    const isFromUser = item.source === 'flynn';
    const typeColor = getMessageTypeColor(item.message_type);

    return (
      <View style={[styles.messageRow, isFromUser && styles.messageRowRight]}>
        <View style={[styles.messageBubble, isFromUser && styles.messageBubbleUser]}>
          <Text style={styles.messageSource}>{item.source.toUpperCase()}</Text>
          <Text style={styles.messageText}>{item.message}</Text>
          <View style={styles.messageFooter}>
            <View style={[styles.typeBadge, { backgroundColor: typeColor }]}>
              <Text style={styles.typeText}>{item.message_type}</Text>
            </View>
            <Text style={styles.messageTime}>{timeAgo(item.createdAt)}</Text>
          </View>
        </View>
      </View>
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
      {isLoading && channelMessages.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : channelMessages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No messages yet</Text>
          <Text style={styles.emptySubtext}>Start a conversation with {programId.toUpperCase()}</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={channelMessages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
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
          accessibilityLabel="Send message"
          accessibilityRole="button"
        >
          {isSending ? (
            <ActivityIndicator size="small" color={theme.colors.text} />
          ) : (
            <Text style={styles.sendButtonText}>Send</Text>
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
});
