import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import { Sprint, SprintStory, SprintStoryStatus } from '../types';
import { theme } from '../theme';

type Props = NativeStackScreenProps<any, 'SprintDetail'>;

export default function SprintDetailScreen({ route, navigation }: Props) {
  const { sprintId, sprint: initialSprint } = route.params as { sprintId: string; sprint?: Sprint };
  const { api } = useAuth();
  const [sprint, setSprint] = useState<Sprint | null>(initialSprint || null);
  const [isLoading, setIsLoading] = useState(!initialSprint);
  const [error, setError] = useState<Error | null>(null);

  const fetchSprint = async () => {
    if (!api) return;

    try {
      setIsLoading(true);
      setError(null);
      const data = await api.getSprint(sprintId);
      if (data) {
        const formattedSprint: Sprint = {
          id: data.id || sprintId,
          projectName: data.projectName || 'Unknown',
          branch: data.branch || '',
          stories: (data.stories || []).map((s: any) => ({
            id: s.id,
            title: s.title,
            status: s.status || 'queued',
            progress: s.progress || 0,
            currentAction: s.currentAction,
            wave: s.wave,
          })),
          status: data.status || 'active',
          createdAt: data.createdAt,
        };
        setSprint(formattedSprint);
        navigation.setOptions({ title: formattedSprint.projectName });
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load sprint'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSprint();
    // Poll every 10 seconds
    const interval = setInterval(fetchSprint, 10000);
    return () => clearInterval(interval);
  }, [sprintId, api]);

  const getStatusColor = (status: SprintStoryStatus): string => {
    switch (status) {
      case 'active':
        return theme.colors.primary;
      case 'complete':
        return theme.colors.success;
      case 'failed':
        return theme.colors.error;
      case 'queued':
        return theme.colors.textMuted;
      case 'skipped':
        return theme.colors.textSecondary;
      default:
        return theme.colors.textMuted;
    }
  };

  const getSprintStatusColor = (status: string) => {
    if (status === 'active') return theme.colors.primary;
    if (status === 'complete') return theme.colors.success;
    if (status === 'failed') return theme.colors.error;
    return theme.colors.textMuted;
  };

  const overallProgress = useMemo(() => {
    if (!sprint || sprint.stories.length === 0) return 0;
    const completed = sprint.stories.filter((s) => s.status === 'complete').length;
    return Math.round((completed / sprint.stories.length) * 100);
  }, [sprint]);

  const storiesByWave = useMemo(() => {
    if (!sprint) return new Map<number | 'unassigned', SprintStory[]>();

    const grouped = new Map<number | 'unassigned', SprintStory[]>();
    for (const story of sprint.stories) {
      const key = story.wave !== undefined ? story.wave : 'unassigned';
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(story);
    }

    return grouped;
  }, [sprint]);

  const [expandedStory, setExpandedStory] = useState<string | null>(null);

  const renderStoryCard = (story: SprintStory) => {
    const statusColor = getStatusColor(story.status);
    const isExpanded = expandedStory === story.id;

    return (
      <TouchableOpacity
        key={story.id}
        style={styles.storyCard}
        activeOpacity={0.7}
        onPress={() => setExpandedStory(isExpanded ? null : story.id)}
        accessibilityRole="button"
        accessibilityLabel={`${story.title}, ${story.status}`}
      >
        <View style={styles.storyHeader}>
          <Text style={styles.storyTitle} numberOfLines={isExpanded ? undefined : 2}>
            {story.title}
          </Text>
          <View style={[styles.storyStatusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.storyStatusText, { color: statusColor }]}>
              {story.status}
            </Text>
          </View>
        </View>

        {story.status === 'active' && story.progress !== undefined && (
          <View style={styles.storyProgressBar}>
            <View
              style={[
                styles.storyProgressFill,
                {
                  width: `${story.progress}%`,
                  backgroundColor: statusColor,
                },
              ]}
            />
          </View>
        )}

        {story.currentAction && (
          <Text style={styles.currentAction} numberOfLines={isExpanded ? undefined : 2}>
            {story.currentAction}
          </Text>
        )}

        {isExpanded && (
          <View style={styles.storyDetail}>
            <View style={styles.storyDetailRow}>
              <Text style={styles.storyDetailLabel}>ID</Text>
              <Text style={styles.storyDetailValue}>{story.id}</Text>
            </View>
            {story.wave !== undefined && (
              <View style={styles.storyDetailRow}>
                <Text style={styles.storyDetailLabel}>Wave</Text>
                <Text style={styles.storyDetailValue}>{story.wave}</Text>
              </View>
            )}
            {story.progress !== undefined && (
              <View style={styles.storyDetailRow}>
                <Text style={styles.storyDetailLabel}>Progress</Text>
                <Text style={styles.storyDetailValue}>{story.progress}%</Text>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderWaveSection = (wave: number | 'unassigned', stories: SprintStory[]) => {
    const waveLabel = wave === 'unassigned' ? 'Unassigned' : `Wave ${wave}`;

    return (
      <View key={String(wave)} style={styles.waveSection}>
        <Text style={styles.waveHeader}>{waveLabel}</Text>
        <View style={styles.waveStories}>
          {stories.map(renderStoryCard)}
        </View>
      </View>
    );
  };

  if (isLoading && !sprint) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  if (error || !sprint) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load sprint</Text>
        </View>
      </View>
    );
  }

  const sprintStatusColor = getSprintStatusColor(sprint.status);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={fetchSprint}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* Sprint Info */}
        <View style={styles.sprintInfo}>
          <View style={styles.branchBadge}>
            <Text style={styles.branchText}>{sprint.branch}</Text>
          </View>

          <View style={styles.overallProgress}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>Overall Progress</Text>
              <Text style={styles.progressPercentage}>{overallProgress}%</Text>
            </View>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${overallProgress}%`,
                    backgroundColor: sprintStatusColor,
                  },
                ]}
              />
            </View>
          </View>

          <View style={[styles.sprintStatusBadge, { backgroundColor: sprintStatusColor + '20' }]}>
            <Text style={[styles.sprintStatusText, { color: sprintStatusColor }]}>
              {sprint.status.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Stories by Wave */}
        <View style={styles.storiesSection}>
          <Text style={styles.storiesSectionHeader}>Stories</Text>
          {Array.from(storiesByWave.entries())
            .sort(([a], [b]) => {
              if (a === 'unassigned') return 1;
              if (b === 'unassigned') return -1;
              return a - b;
            })
            .map(([wave, stories]) => renderWaveSection(wave, stories))}
        </View>
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
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  errorText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.error,
    textAlign: 'center',
  },
  sprintInfo: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.md,
  },
  branchBadge: {
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    alignSelf: 'flex-start',
  },
  branchText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  overallProgress: {
    gap: theme.spacing.sm,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
  },
  progressPercentage: {
    fontSize: theme.fontSize.md,
    fontWeight: '700',
    color: theme.colors.primary,
  },
  progressBar: {
    height: 8,
    backgroundColor: theme.colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  sprintStatusBadge: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    alignSelf: 'flex-start',
  },
  sprintStatusText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  storiesSection: {
    gap: theme.spacing.lg,
  },
  storiesSectionHeader: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  waveSection: {
    marginBottom: theme.spacing.lg,
  },
  waveHeader: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  waveStories: {
    gap: theme.spacing.md,
  },
  storyCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  storyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  storyTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    flex: 1,
  },
  storyStatusBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
  },
  storyStatusText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
  },
  storyProgressBar: {
    height: 4,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: theme.spacing.sm,
  },
  storyProgressFill: {
    height: '100%',
    borderRadius: 2,
  },
  currentAction: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
  },
  storyDetail: {
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing.xs,
  },
  storyDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  storyDetailLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: '500',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  storyDetailValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
});
