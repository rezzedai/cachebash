import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSessions } from '../hooks/useSessions';
import { useMessages } from '../hooks/useMessages';
import { useTasks } from '../hooks/useTasks';
import { theme } from '../theme';
import { timeAgo, getStateColor } from '../utils';

type Props = NativeStackScreenProps<any, 'ProgramDetail'>;

function getStateLabel(state: string): string {
  const labels: Record<string, string> = {
    working: 'Working',
    blocked: 'Blocked',
    complete: 'Complete',
    done: 'Done',
    active: 'Active',
    pinned: 'Pinned',
    offline: 'Offline',
  };
  return labels[state] || state;
}

export default function ProgramDetailScreen({ route, navigation }: Props) {
  const { programId } = route.params || {};
  const { programs, sessions, refetch: refetchSessions } = useSessions();
  const { messages, refetch: refetchMessages } = useMessages();
  const { tasks, refetch: refetchTasks } = useTasks();

  const [refreshing, setRefreshing] = React.useState(false);

  // Find the program data
  const program = useMemo(
    () => programs.find((p) => p.id === programId),
    [programs, programId]
  );

  // Find session data for this program
  const programSession = useMemo(
    () => sessions.find((s) => s.programId === programId || s.id === program?.sessionId),
    [sessions, programId, program]
  );

  // Filter messages for this program (from or to this program)
  const programMessages = useMemo(
    () =>
      messages
        .filter((m) => m.source === programId || m.target === programId)
        .slice(0, 5),
    [messages, programId]
  );

  // Filter tasks for this program (source or target matches)
  const programTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (t.source === programId || t.target === programId) &&
          (t.status === 'created' || t.status === 'active')
      ),
    [tasks, programId]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchSessions(), refetchMessages(), refetchTasks()]);
    setRefreshing(false);
  }, [refetchSessions, refetchMessages, refetchTasks]);

  if (!program) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Program not found</Text>
        </View>
      </View>
    );
  }

  const heartbeatText = program.lastHeartbeat
    ? timeAgo(program.lastHeartbeat)
    : 'never';

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* Header Section */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.programName}>{program.name.toUpperCase()}</Text>
            <View
              style={[
                styles.stateBadge,
                { backgroundColor: getStateColor(program.state) + '20' },
              ]}
            >
              <View
                style={[
                  styles.stateDot,
                  { backgroundColor: getStateColor(program.state) },
                ]}
              />
              <Text
                style={[
                  styles.stateText,
                  { color: getStateColor(program.state) },
                ]}
              >
                {getStateLabel(program.state)}
              </Text>
            </View>
          </View>

          {program.status && (
            <View style={styles.statusCard}>
              <Text style={styles.statusLabel}>Current Status</Text>
              <Text style={styles.statusText}>{program.status}</Text>
            </View>
          )}

          {program.progress !== undefined && program.progress > 0 && (
            <View style={styles.progressSection}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressLabel}>Progress</Text>
                <Text style={styles.progressValue}>{program.progress}%</Text>
              </View>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${program.progress}%`,
                      backgroundColor: getStateColor(program.state),
                    },
                  ]}
                />
              </View>
            </View>
          )}
        </View>

        {/* Info Grid */}
        <View style={styles.infoGrid}>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Last Heartbeat</Text>
            <Text style={styles.infoValue}>{heartbeatText}</Text>
          </View>
          {programSession && (
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>Session</Text>
              <Text style={styles.infoValue} numberOfLines={1}>
                {programSession.name}
              </Text>
            </View>
          )}
        </View>

        {/* Recent Messages Section */}
        {programMessages.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Messages</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{programMessages.length}</Text>
              </View>
            </View>
            <View style={styles.messageList}>
              {programMessages.map((message) => (
                <View key={message.id} style={styles.messageCard}>
                  <View style={styles.messageHeader}>
                    <View style={styles.messageDirection}>
                      <Text style={styles.messageDirectionLabel}>
                        {message.source === programId ? 'to' : 'from'}
                      </Text>
                      <Text style={styles.messageDirectionValue}>
                        {message.source === programId
                          ? message.target
                          : message.source}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.messageTypeBadge,
                        { backgroundColor: theme.colors.primaryDim + '30' },
                      ]}
                    >
                      <Text style={styles.messageTypeText}>
                        {message.message_type}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.messageText} numberOfLines={2}>
                    {message.message}
                  </Text>
                  <Text style={styles.messageTime}>
                    {timeAgo(message.createdAt)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Active Tasks Section */}
        {programTasks.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Active Tasks</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{programTasks.length}</Text>
              </View>
            </View>
            <View style={styles.taskList}>
              {programTasks.map((task) => (
                <TouchableOpacity
                  key={task.id}
                  style={styles.taskCard}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('TaskDetail', { task })}
                >
                  <View style={styles.taskHeader}>
                    <View
                      style={[
                        styles.taskStatusDot,
                        {
                          backgroundColor:
                            task.status === 'active'
                              ? theme.colors.primary
                              : theme.colors.warning,
                        },
                      ]}
                    />
                    <Text style={styles.taskStatus}>
                      {task.status === 'active' ? 'Active' : 'Pending'}
                    </Text>
                  </View>
                  <Text style={styles.taskTitle} numberOfLines={2}>
                    {task.title}
                  </Text>
                  <View style={styles.taskMeta}>
                    <Text style={styles.taskMetaText}>
                      {task.source === programId ? 'to' : 'from'}{' '}
                      {task.source === programId ? task.target : task.source}
                    </Text>
                    <Text style={styles.taskMetaText}>
                      {timeAgo(task.createdAt)}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Empty States */}
        {programMessages.length === 0 && programTasks.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No recent activity</Text>
            <Text style={styles.emptyStateSubtext}>
              Messages and tasks will appear here when they become available
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  errorText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.error,
    textAlign: 'center',
  },

  // Header
  header: {
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.md,
  },
  programName: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
    flex: 1,
    letterSpacing: 2,
  },
  stateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.lg,
    marginLeft: theme.spacing.sm,
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stateText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  statusLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: '500',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
  },
  statusText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    lineHeight: theme.fontSize.md * 1.4,
  },
  progressSection: {
    marginBottom: theme.spacing.md,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  progressLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.textSecondary,
  },
  progressValue: {
    fontSize: theme.fontSize.md,
    fontWeight: '700',
    color: theme.colors.text,
  },
  progressBar: {
    height: 6,
    backgroundColor: theme.colors.surface,
    borderRadius: 3,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },

  // Info Grid
  infoGrid: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  infoCard: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  infoLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: '500',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
  },
  infoValue: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
  },

  // Section
  section: {
    marginBottom: theme.spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
  },
  badge: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '700',
    color: theme.colors.background,
  },

  // Message List
  messageList: {
    gap: theme.spacing.sm,
  },
  messageCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  messageDirection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    flex: 1,
  },
  messageDirectionLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  messageDirectionValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text,
  },
  messageTypeBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  messageTypeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  messageText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    lineHeight: theme.fontSize.sm * 1.5,
    marginBottom: theme.spacing.xs,
  },
  messageTime: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },

  // Task List
  taskList: {
    gap: theme.spacing.sm,
  },
  taskCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  taskStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  taskStatus: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  taskTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    lineHeight: theme.fontSize.md * 1.4,
  },
  taskMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  taskMetaText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.xl * 2,
  },
  emptyStateText: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  emptyStateSubtext: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
});
