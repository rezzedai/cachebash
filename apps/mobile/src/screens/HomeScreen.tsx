import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSessions } from '../hooks/useSessions';
import { useTasks } from '../hooks/useTasks';
import { useMessages } from '../hooks/useMessages';
import { useSprints } from '../hooks/useSprints';
import { useConnectivity } from '../contexts/ConnectivityContext';
import { theme } from '../theme';
import type { Program, Sprint, SprintStoryStatus } from '../types';
import { timeAgo, getStateColor, getStatusColor, getMessageTypeColor } from '../utils';
import { haptic } from '../utils/haptics';
import EmptyState from '../components/EmptyState';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type ExpandedCard = 'programs' | 'sessions' | 'tasks' | 'messages' | null;

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export default function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { sessions, programs, isLoading, refetch, error, isCached } = useSessions();
  const { tasks, pendingCount } = useTasks();
  const { messages, unreadCount } = useMessages();
  const { sprints } = useSprints();
  const { isConnected, isInternetReachable } = useConnectivity();

  const [refreshing, setRefreshing] = useState(false);
  const [expandedCard, setExpandedCard] = useState<ExpandedCard>(null);
  const [showError, setShowError] = useState(false);
  const errorCountRef = useRef(0);

  useEffect(() => {
    if (error) {
      errorCountRef.current += 1;
      if (errorCountRef.current >= 3) setShowError(true);
    } else {
      errorCountRef.current = 0;
      setShowError(false);
    }
  }, [error]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const toggleCard = (card: ExpandedCard) => {
    haptic.light();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedCard(expandedCard === card ? null : card);
  };

  // Total fleet programs count
  const programCount = useMemo(() => programs.length, [programs]);

  // Active sessions count (non-complete)
  const activeSessions = useMemo(
    () => sessions.filter((s) => s.state !== 'complete' && s.state !== 'done'),
    [sessions]
  );

  // Find most recent update time across all sessions
  const lastUpdateTime = useMemo(() => {
    return sessions.reduce((latest, session) => {
      const time = new Date(session.lastUpdate || session.createdAt).getTime();
      return time > latest ? time : latest;
    }, 0);
  }, [sessions]);

  const lastUpdateStr = lastUpdateTime
    ? timeAgo(new Date(lastUpdateTime).toISOString())
    : 'never';

  // Filter pending tasks
  const pendingTasks = useMemo(
    () => tasks.filter((t) => t.status === 'created'),
    [tasks]
  );

  // Filter pending questions (tasks of type 'question' with status 'created')
  const pendingQuestions = useMemo(
    () => tasks.filter((t) => t.type === 'question' && t.status === 'created'),
    [tasks]
  );

  // Filter received messages (exclude orchestrator/admin as source)
  const receivedMessages = useMemo(
    () => messages.filter((m) => m.source !== 'orchestrator' && m.source !== 'admin').slice(0, 10),
    [messages]
  );

  const handleProgramPress = (program: Program) => {
    haptic.light();
    navigation.navigate('ProgramDetail', { programId: program.id });
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + theme.spacing.sm }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.appTitle}>CacheBash</Text>
            <View style={styles.connectionIndicator}>
              <View
                style={[
                  styles.connectionDot,
                  { backgroundColor: (isConnected && isInternetReachable !== false) ? theme.colors.success : theme.colors.error },
                ]}
              />
            </View>
            <TouchableOpacity
              style={styles.healthLink}
              onPress={() => {
                haptic.light();
                navigation.navigate('FleetHealth');
              }}
              accessibilityLabel="View fleet health"
              accessibilityRole="button"
            >
              <Text style={styles.healthLinkText}>Health</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.lastUpdate}>
            {(isConnected && isInternetReachable !== false) ? 'Connected' : 'Offline'} • Updated {lastUpdateStr}{isCached ? ' • Cached' : ''}
          </Text>
        </View>

        {showError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>Unable to connect to Grid</Text>
            <TouchableOpacity
              onPress={onRefresh}
              accessibilityRole="button"
              accessibilityLabel="Retry connection"
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Empty State when no sessions and programs */}
        {!isLoading && sessions.length === 0 && programs.length === 0 ? (
          <EmptyState
            icon="📡"
            title="No Active Sessions"
            description="Connect an agent from your IDE to see it appear here. Run npx cachebash init to get started."
          />
        ) : (
          <>
        {/* Expandable Stat Cards */}
        <View style={styles.statsColumn}>

          {/* Programs Card */}
          <TouchableOpacity
            style={[
              styles.statCard,
              expandedCard === 'programs' && styles.statCardExpanded,
            ]}
            onPress={() => toggleCard('programs')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${programCount} Programs, tap to ${expandedCard === 'programs' ? 'collapse' : 'expand'}`}
          >
            <View style={styles.statCardHeader}>
              <View style={styles.statCardLeft}>
                <Text style={styles.statValue}>{programCount}</Text>
                <Text style={styles.statLabel}>Programs</Text>
              </View>
              <Text style={styles.expandArrow}>
                {expandedCard === 'programs' ? '\u25B2' : '\u25BC'}
              </Text>
            </View>
            <View style={[styles.statIndicator, { backgroundColor: theme.colors.success }]} />
          </TouchableOpacity>

          {expandedCard === 'programs' && (
            <View style={styles.expandedContent}>
              {/* Program List */}
              {programs.length === 0 ? (
                <Text style={styles.expandedEmptyText}>No programs online</Text>
              ) : (
                <View style={styles.programGrid}>
                  {programs.map((program) => (
                    <TouchableOpacity
                      key={program.id}
                      style={styles.programCard}
                      onPress={() => handleProgramPress(program)}
                      activeOpacity={0.7}
                      accessibilityLabel={`View ${program.name || program.id} details`}
                      accessibilityRole="button"
                    >
                      <View style={styles.programHeader}>
                        <Text style={styles.programName} numberOfLines={1} ellipsizeMode="tail">
                          {(program.name || program.id || '?').toUpperCase()}
                        </Text>
                        <View
                          style={[
                            styles.stateDot,
                            {
                              backgroundColor: program.state !== 'offline'
                                ? getStateColor(program.state)
                                : 'transparent',
                              borderWidth: program.state !== 'offline' ? 0 : 1.5,
                              borderColor: getStateColor(program.state),
                            },
                          ]}
                        />
                      </View>

                      {program.status && (
                        <Text style={styles.programStatus} numberOfLines={2} ellipsizeMode="tail">
                          {program.status}
                        </Text>
                      )}

                      {program.progress !== undefined && program.progress > 0 && (
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
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Sessions Card */}
          <TouchableOpacity
            style={[
              styles.statCard,
              expandedCard === 'sessions' && styles.statCardExpanded,
            ]}
            onPress={() => toggleCard('sessions')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${activeSessions.length} Sessions, tap to ${expandedCard === 'sessions' ? 'collapse' : 'expand'}`}
          >
            <View style={styles.statCardHeader}>
              <View style={styles.statCardLeft}>
                <Text style={styles.statValue}>{activeSessions.length}</Text>
                <Text style={styles.statLabel}>Sessions</Text>
              </View>
              <Text style={styles.expandArrow}>
                {expandedCard === 'sessions' ? '\u25B2' : '\u25BC'}
              </Text>
            </View>
            <View style={[styles.statIndicator, { backgroundColor: '#6366f1' }]} />
          </TouchableOpacity>

          {expandedCard === 'sessions' && (
            <View style={styles.expandedContent}>
              {sessions.length === 0 ? (
                <Text style={styles.expandedEmptyText}>No sessions</Text>
              ) : (
                sessions.slice(0, 10).map((session) => (
                  <TouchableOpacity
                    key={session.id}
                    style={styles.expandedItem}
                    onPress={() => {
                      haptic.light();
                      if (session.programId) {
                        navigation.navigate('ProgramDetail', { programId: session.programId });
                      }
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Session: ${session.name}`}
                  >
                    <View style={styles.expandedItemRow}>
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: getStateColor(session.state) },
                        ]}
                      />
                      <Text style={styles.expandedItemTitle} numberOfLines={1}>
                        {session.name}
                      </Text>
                      <View style={[styles.sessionStateBadge, { backgroundColor: getStateColor(session.state) + '25' }]}>
                        <Text style={[styles.sessionStateText, { color: getStateColor(session.state) }]}>
                          {session.state}
                        </Text>
                      </View>
                    </View>
                    {session.status && (
                      <Text style={styles.expandedItemMeta} numberOfLines={1}>
                        {session.status}
                      </Text>
                    )}
                    <View style={styles.sessionMetaRow}>
                      {session.programId && (
                        <Text style={styles.expandedItemMeta}>
                          {session.programId.toUpperCase()}
                        </Text>
                      )}
                      <Text style={styles.expandedItemMeta}>
                        {timeAgo(session.lastUpdate || session.createdAt)}
                      </Text>
                    </View>
                    {session.progress !== undefined && session.progress > 0 && (
                      <View style={styles.progressBar}>
                        <View
                          style={[
                            styles.progressFill,
                            {
                              width: `${session.progress}%`,
                              backgroundColor: getStateColor(session.state),
                            },
                          ]}
                        />
                      </View>
                    )}
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}

          {/* Pending Tasks Card */}
          <TouchableOpacity
            style={[
              styles.statCard,
              expandedCard === 'tasks' && styles.statCardExpanded,
            ]}
            onPress={() => toggleCard('tasks')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${pendingCount} Pending Tasks, tap to ${expandedCard === 'tasks' ? 'collapse' : 'expand'}`}
          >
            <View style={styles.statCardHeader}>
              <View style={styles.statCardLeft}>
                <Text style={styles.statValue}>{pendingCount}</Text>
                <Text style={styles.statLabel}>Pending Tasks</Text>
              </View>
              <Text style={styles.expandArrow}>
                {expandedCard === 'tasks' ? '\u25B2' : '\u25BC'}
              </Text>
            </View>
            <View style={[styles.statIndicator, { backgroundColor: theme.colors.warning }]} />
          </TouchableOpacity>

          {expandedCard === 'tasks' && (
            <View style={styles.expandedContent}>
              {pendingTasks.length === 0 ? (
                <Text style={styles.expandedEmptyText}>No pending tasks</Text>
              ) : (
                pendingTasks.slice(0, 8).map((task) => (
                  <TouchableOpacity
                    key={task.id}
                    style={styles.expandedItem}
                    onPress={() => {
                      haptic.light();
                      navigation.navigate('TaskDetail', { task });
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                  >
                    <View style={styles.expandedItemRow}>
                      <View style={[styles.statusDot, { backgroundColor: getStatusColor(task.status) }]} />
                      <Text style={styles.expandedItemTitle} numberOfLines={1}>
                        {task.title}
                      </Text>
                    </View>
                    <Text style={styles.expandedItemMeta}>
                      {task.source || 'unknown'} {'\u2192'} {task.target || 'unknown'} {'\u00B7'} {timeAgo(task.createdAt)}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}

          {/* Messages Card */}
          <TouchableOpacity
            style={[
              styles.statCard,
              expandedCard === 'messages' && styles.statCardExpanded,
            ]}
            onPress={() => toggleCard('messages')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${unreadCount} Messages, tap to ${expandedCard === 'messages' ? 'collapse' : 'expand'}`}
          >
            <View style={styles.statCardHeader}>
              <View style={styles.statCardLeft}>
                <Text style={styles.statValue}>{unreadCount}</Text>
                <Text style={styles.statLabel}>Messages</Text>
              </View>
              <Text style={styles.expandArrow}>
                {expandedCard === 'messages' ? '\u25B2' : '\u25BC'}
              </Text>
            </View>
            <View style={[styles.statIndicator, { backgroundColor: theme.colors.primary }]} />
          </TouchableOpacity>

          {expandedCard === 'messages' && (
            <View style={styles.expandedContent}>
              {receivedMessages.length === 0 ? (
                <Text style={styles.expandedEmptyText}>No messages received</Text>
              ) : (
                receivedMessages.map((msg) => (
                  <TouchableOpacity
                    key={msg.id}
                    style={styles.expandedItem}
                    onPress={() => {
                      haptic.light();
                      navigation.navigate('ChannelDetail', {
                        channelId: msg.source,
                        channelName: msg.source,
                      });
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                  >
                    <View style={styles.expandedItemRow}>
                      <View style={[styles.msgTypeBadge, { backgroundColor: getMessageTypeColor(msg.message_type) + '25' }]}>
                        <Text style={[styles.msgTypeText, { color: getMessageTypeColor(msg.message_type) }]}>
                          {msg.source?.toUpperCase()}
                        </Text>
                      </View>
                      <Text style={styles.expandedItemMeta}>{timeAgo(msg.createdAt)}</Text>
                    </View>
                    <Text style={styles.expandedItemMessage} numberOfLines={2}>
                      {msg.message}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}
        </View>

        {/* Active Sprint Card */}
        {sprints.filter(s => s.status === 'active').length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Active Sprint</Text>
            {sprints
              .filter(s => s.status === 'active')
              .slice(0, 1)
              .map((sprint) => {
                const completed = sprint.stories.filter(s => s.status === 'complete').length;
                const total = sprint.stories.length;
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                return (
                  <TouchableOpacity
                    key={sprint.id}
                    style={styles.sprintCard}
                    onPress={() => {
                      haptic.light();
                      navigation.navigate('SprintDetail', { sprint });
                    }}
                    activeOpacity={0.7}
                    accessibilityLabel={`Sprint: ${sprint.projectName}, ${completed} of ${total} stories complete`}
                    accessibilityRole="button"
                  >
                    <View style={styles.sprintHeader}>
                      <Text style={styles.sprintName} numberOfLines={1}>{sprint.projectName}</Text>
                      <Text style={styles.sprintProgress}>{completed}/{total}</Text>
                    </View>
                    {sprint.branch ? (
                      <Text style={styles.sprintBranch} numberOfLines={1}>{sprint.branch}</Text>
                    ) : null}
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: theme.colors.primary }]} />
                    </View>
                    <View style={styles.sprintStories}>
                      {sprint.stories.slice(0, 5).map((story) => (
                        <View key={story.id} style={styles.storyRow}>
                          <View style={[styles.storyDot, {
                            backgroundColor:
                              story.status === 'complete' ? theme.colors.success :
                              story.status === 'active' ? theme.colors.primary :
                              story.status === 'failed' ? theme.colors.error :
                              theme.colors.textMuted,
                          }]} />
                          <Text style={styles.storyTitle} numberOfLines={1}>{story.title}</Text>
                        </View>
                      ))}
                      {sprint.stories.length > 5 && (
                        <Text style={styles.expandedItemMeta}>+{sprint.stories.length - 5} more</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickActionButton}
            onPress={() => {
              haptic.light();
              navigation.navigate('ChannelDetail', { programId: 'iso' });
            }}
            activeOpacity={0.7}
            accessibilityLabel="Send a message"
            accessibilityRole="button"
          >
            <Text style={styles.quickActionText}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionButton}
            onPress={() => {
              haptic.light();
              navigation.navigate('Sprints');
            }}
            activeOpacity={0.7}
            accessibilityLabel="View sprints"
            accessibilityRole="button"
          >
            <Text style={styles.quickActionText}>Sprints</Text>
          </TouchableOpacity>
        </View>
        </>
        )}

        {/* Questions Section (shown regardless of empty state) */}
        {pendingQuestions.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeader}>Needs Your Attention</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{pendingQuestions.length}</Text>
              </View>
            </View>
            <View style={styles.questionList}>
              {pendingQuestions.map((question) => (
                <TouchableOpacity
                  key={question.id}
                  style={styles.questionCard}
                  activeOpacity={0.7}
                  onPress={() => {
                    haptic.light();
                    navigation.navigate('TaskDetail', { task: question });
                  }}
                  accessibilityLabel={`Question from ${question.source}: ${question.title}`}
                  accessibilityRole="button"
                >
                  <View style={styles.questionHeader}>
                    <View style={styles.questionIcon}>
                      <Text style={styles.questionIconText}>
                        {question.source?.charAt(0)?.toUpperCase() || '?'}
                      </Text>
                    </View>
                    <View style={styles.questionContent}>
                      <Text style={styles.questionTitle} numberOfLines={2}>
                        {question.title}
                      </Text>
                      <Text style={styles.questionTime}>
                        {timeAgo(question.createdAt)}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
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

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  appTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    letterSpacing: 0.5,
  },
  connectionIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  healthLink: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surfaceElevated,
  },
  healthLinkText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  lastUpdate: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },

  // Stats Column (expandable cards stacked vertically)
  statsColumn: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  statCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    position: 'relative',
    overflow: 'hidden',
  },
  statCardExpanded: {
    borderColor: theme.colors.primary,
  },
  statCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statCardLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: theme.spacing.sm,
  },
  statValue: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
  },
  statLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  expandArrow: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  statIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
  },

  // Expanded Content
  expandedContent: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  expandedItem: {
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  expandedItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xxs,
  },
  expandedItemTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text,
    flex: 1,
  },
  expandedItemMeta: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  expandedItemMessage: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xxs,
  },
  expandedEmptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    textAlign: 'center',
    paddingVertical: theme.spacing.md,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  msgTypeBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xxs,
    borderRadius: theme.borderRadius.sm,
  },
  msgTypeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  sessionStateBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xxs,
    borderRadius: theme.borderRadius.sm,
  },
  sessionStateText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sessionMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.xxs,
  },

  // Program Grid
  programGrid: {
    flexDirection: 'column',
    gap: theme.spacing.sm,
  },
  programCard: {
    width: '100%',
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    minHeight: 64,
  },
  programHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  programName: {
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
    color: theme.colors.text,
    letterSpacing: 1,
    flex: 1,
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: theme.spacing.xs,
    marginTop: 2,
  },
  programStatus: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
  },
  progressBar: {
    height: 3,
    backgroundColor: theme.colors.border,
    borderRadius: 1.5,
    overflow: 'hidden',
    marginTop: theme.spacing.sm,
  },
  progressFill: {
    height: '100%',
    borderRadius: 1.5,
  },

  // Section
  section: {
    marginBottom: theme.spacing.xl,
  },
  sectionHeader: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
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

  // Question List
  questionList: {
    gap: theme.spacing.sm,
  },
  questionCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  questionHeader: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  questionIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionIconText: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.primary,
  },
  questionContent: {
    flex: 1,
  },
  questionTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  questionTime: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },

  // Sprint Card
  sprintCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  sprintHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  sprintName: {
    fontSize: theme.fontSize.md,
    fontWeight: '700',
    color: theme.colors.text,
    flex: 1,
  },
  sprintProgress: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary,
    marginLeft: theme.spacing.sm,
  },
  sprintBranch: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.sm,
  },
  sprintStories: {
    marginTop: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  storyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  storyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  storyTitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    flex: 1,
  },

  // Quick Actions
  quickActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  quickActionButton: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.primary + '40',
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  quickActionText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary,
  },

  // Error Banner
  errorBanner: {
    backgroundColor: theme.colors.error + '15',
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.error + '30',
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    fontWeight: '500',
  },
  retryText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    fontWeight: '600',
  },
});
