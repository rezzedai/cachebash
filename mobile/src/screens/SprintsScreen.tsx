import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, StyleSheet, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSprints } from '../hooks/useSprints';
import { Sprint, SprintStory } from '../types';
import { theme } from '../theme';
import { timeAgo, getStatusColor } from '../utils';
import { haptic } from '../utils/haptics';

type Props = NativeStackScreenProps<any, 'Sprints'>;

export default function SprintsScreen({ navigation }: Props) {
  const { sprints, isLoading, refetch, error, isCached } = useSprints();

  const getSprintProgress = (sprint: Sprint) => {
    const total = sprint.stories.length;
    if (total === 0) return { completed: 0, total: 0, percentage: 0 };

    const completed = sprint.stories.filter((s) => s.status === 'complete').length;
    const percentage = Math.round((completed / total) * 100);
    return { completed, total, percentage };
  };

  const getSprintStatusColor = (status: string) => {
    if (status === 'active') return theme.colors.primary;
    if (status === 'complete') return theme.colors.success;
    if (status === 'failed') return theme.colors.error;
    return theme.colors.textMuted;
  };

  const renderSprintCard = (sprint: Sprint) => {
    const progress = getSprintProgress(sprint);
    const statusColor = getSprintStatusColor(sprint.status);

    return (
      <TouchableOpacity
        key={sprint.id}
        style={styles.sprintCard}
        onPress={() => {
          haptic.light();
          navigation.navigate('SprintDetail', { sprintId: sprint.id, sprint });
        }}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Sprint ${sprint.projectName}, ${progress.completed} of ${progress.total} stories complete`}
      >
        <View style={styles.sprintHeader}>
          <Text style={styles.projectName} numberOfLines={1} ellipsizeMode="tail">
            {sprint.projectName.toUpperCase()}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {sprint.status}
            </Text>
          </View>
        </View>

        <Text style={styles.branchName} numberOfLines={1} ellipsizeMode="tail">
          {sprint.branch}
        </Text>

        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progress.percentage}%`,
                  backgroundColor: statusColor,
                },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {progress.completed}/{progress.total} stories • {timeAgo(sprint.createdAt)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.errorText}>Failed to load sprints</Text>
          <TouchableOpacity
            onPress={refetch}
            style={styles.retryButton}
            accessibilityRole="button"
            accessibilityLabel="Retry loading sprints"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyStateText}>⬡ No sprints found</Text>
        <Text style={styles.emptyHintText}>Pull down to refresh</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Sprints</Text>
          {isCached && (
            <View style={styles.cachedBadge}>
              <Text style={styles.cachedBadgeText}>CACHED</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor={theme.colors.primary}
          />
        }
      >
        {sprints.length === 0 ? renderEmpty() : sprints.map(renderSprintCard)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  headerTitle: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
  },
  cachedBadge: {
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
  },
  cachedBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textMuted,
    letterSpacing: 0.5,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  sprintCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sprintHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  projectName: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text,
    letterSpacing: 0.5,
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
  },
  statusBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
  },
  branchName: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.md,
  },
  progressContainer: {
    gap: theme.spacing.xs,
  },
  progressBar: {
    height: 6,
    backgroundColor: theme.colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
  },
  emptyState: {
    paddingVertical: theme.spacing.xl * 2,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textMuted,
  },
  emptyHintText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  errorText: {
    fontSize: theme.fontSize.md,
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
