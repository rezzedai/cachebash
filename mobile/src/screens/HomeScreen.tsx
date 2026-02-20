import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSessions } from '../hooks/useSessions';
import { useTasks } from '../hooks/useTasks';
import { useMessages } from '../hooks/useMessages';
import { theme } from '../theme';
import type { Program } from '../types';
import { timeAgo, getStateColor } from '../utils';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export default function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { sessions, programs, isLoading, refetch, error } = useSessions();
  const { tasks, pendingCount } = useTasks();
  const { messages, unreadCount } = useMessages();

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // Total fleet programs count
  const programCount = programs.length;

  // Find most recent update time across all sessions
  const lastUpdateTime = sessions.reduce((latest, session) => {
    const time = new Date(session.lastUpdate || session.createdAt).getTime();
    return time > latest ? time : latest;
  }, 0);

  const lastUpdateStr = lastUpdateTime
    ? timeAgo(new Date(lastUpdateTime).toISOString())
    : 'never';

  // Filter pending questions (tasks of type 'question' with status 'created')
  const pendingQuestions = tasks.filter(
    (t) => t.type === 'question' && t.status === 'created'
  );

  const handleProgramPress = (program: Program) => {
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
                  { backgroundColor: programs.length > 0 ? theme.colors.success : theme.colors.warning },
                ]}
              />
            </View>
          </View>
          <Text style={styles.lastUpdate}>Updated {lastUpdateStr}</Text>
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>Unable to connect to Grid</Text>
            <TouchableOpacity onPress={onRefresh}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Quick Stats Row */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, styles.statCardFirst]}>
            <Text style={styles.statValue}>{programCount}</Text>
            <Text style={styles.statLabel}>Programs</Text>
            <View
              style={[
                styles.statIndicator,
                { backgroundColor: theme.colors.success },
              ]}
            />
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statValue}>{pendingCount}</Text>
            <Text style={styles.statLabel}>Pending Tasks</Text>
            <View
              style={[
                styles.statIndicator,
                { backgroundColor: theme.colors.warning },
              ]}
            />
          </View>

          <View style={[styles.statCard, styles.statCardLast]}>
            <Text style={styles.statValue}>{unreadCount}</Text>
            <Text style={styles.statLabel}>Messages</Text>
            <View
              style={[
                styles.statIndicator,
                { backgroundColor: theme.colors.primary },
              ]}
            />
          </View>
        </View>

        {/* Program Grid */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Fleet Status</Text>
          <View style={styles.programGrid}>
            {programs.map((program) => (
              <TouchableOpacity
                key={program.id}
                style={styles.programCard}
                onPress={() => handleProgramPress(program)}
                activeOpacity={0.7}
              >
                <View style={styles.programHeader}>
                  <Text style={styles.programName}>{program.name.toUpperCase()}</Text>
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
                  <Text style={styles.programStatus} numberOfLines={1}>
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
        </View>

        {/* Pending Questions */}
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
                  onPress={() => navigation.navigate('TaskDetail', { task: question })}
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

const { width } = Dimensions.get('window');
const cardPadding = theme.spacing.md;
const cardGap = theme.spacing.sm;
const programCardWidth = (width - cardPadding * 2 - cardGap) / 2;

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
  lastUpdate: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },

  // Stats Row
  statsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    position: 'relative',
    overflow: 'hidden',
  },
  statCardFirst: {
    // Could add specific styles for first card if needed
  },
  statCardLast: {
    // Could add specific styles for last card if needed
  },
  statValue: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  statLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: '500',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
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

  // Program Grid
  programGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  programCard: {
    width: programCardWidth,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    minHeight: 100,
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
