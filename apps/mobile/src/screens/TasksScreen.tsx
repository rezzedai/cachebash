import React, { useState, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Swipeable } from 'react-native-gesture-handler';
import { useTasks } from '../hooks/useTasks';
import { Task } from '../types';
import { theme } from '../theme';
import { timeAgo, getStatusColor } from '../utils';
import { haptic } from '../utils/haptics';
import EmptyState from '../components/EmptyState';

type Props = NativeStackScreenProps<any, 'Tasks'>;

type FilterType = 'all' | 'created' | 'active' | 'done';

export default function TasksScreen({ navigation }: Props) {
  const [filter, setFilter] = useState<FilterType>('all');
  const { tasks, isLoading, refetch, error, isCached, pendingCount, dismissTask, dismissAllPending } = useTasks();

  const filteredTasks = useMemo(() => {
    if (filter === 'all') return tasks;
    return tasks.filter(task => task.status === filter);
  }, [tasks, filter]);

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'created', label: 'Pending' },
    { key: 'active', label: 'Active' },
    { key: 'done', label: 'Done' },
  ];

  const renderFilterChip = ({ key, label }: { key: FilterType; label: string }) => {
    const isActive = filter === key;
    return (
      <TouchableOpacity
        key={key}
        style={[
          styles.filterChip,
          isActive && styles.filterChipActive,
        ]}
        onPress={() => {
          haptic.selection();
          setFilter(key);
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: isActive }}
      >
        <Text style={[
          styles.filterChipText,
          isActive && styles.filterChipTextActive,
        ]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderDismissAction = () => (
    <TouchableOpacity
      style={styles.dismissAction}
      onPress={() => {}}
      accessibilityLabel="Dismiss task"
    >
      <Text style={styles.dismissActionText}>Dismiss</Text>
    </TouchableOpacity>
  );

  const renderTaskCard = ({ item: task }: { item: Task }) => {
    const card = (
      <TouchableOpacity
        style={[
          styles.taskCard,
          task.priority === 'high' && styles.taskCardHighPriority,
          task.type === 'question' && task.status === 'created' && styles.taskCardQuestion,
        ]}
        onPress={() => navigation.navigate('TaskDetail', { task })}
        activeOpacity={0.7}
        accessibilityLabel={`${task.title}, ${task.status}, ${task.priority} priority`}
        accessibilityRole="button"
      >
        <View style={styles.taskCardHeader}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(task.status) }]} />
          <Text style={styles.taskTitle} numberOfLines={1} ellipsizeMode="tail">
            {task.title}
          </Text>
        </View>

        {(task.source || task.target) && (
          <View style={styles.taskMeta}>
            <Text style={styles.taskMetaText}>
              {task.source || 'unknown'} → {task.target || 'unknown'}
            </Text>
            <Text style={styles.taskMetaText}>•</Text>
            <Text style={styles.taskMetaText}>{timeAgo(task.createdAt)}</Text>
          </View>
        )}

        <View style={styles.taskBadges}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>{task.type}</Text>
          </View>
          {task.priority === 'high' && (
            <View style={[styles.typeBadge, styles.priorityBadge]}>
              <Text style={styles.typeBadgeText}>high priority</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );

    if (task.status === 'created') {
      return (
        <Swipeable
          renderRightActions={renderDismissAction}
          onSwipeableOpen={async () => {
            haptic.medium();
            try {
              await dismissTask(task.id);
              haptic.success();
            } catch {
              haptic.error();
            }
          }}
          overshootRight={false}
        >
          {card}
        </Swipeable>
      );
    }

    return card;
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
          <Text style={styles.errorText}>Failed to load tasks</Text>
          <TouchableOpacity
            onPress={refetch}
            style={styles.retryButton}
            accessibilityRole="button"
            accessibilityLabel="Retry loading tasks"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <EmptyState
        icon="📋"
        title="No Tasks Yet"
        description="Create your first task to coordinate your AI agents."
        ctaLabel="Create Task"
        onCta={() => navigation.navigate('CreateTask')}
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Tasks</Text>
          {isCached && (
            <View style={styles.cachedBadge}>
              <Text style={styles.cachedBadgeText}>CACHED</Text>
            </View>
          )}
          {filter === 'created' && pendingCount > 0 && (
            <TouchableOpacity
              style={styles.clearAllButton}
              onPress={() => {
                Alert.alert(
                  'Clear All Pending',
                  `Dismiss ${pendingCount} pending task${pendingCount !== 1 ? 's' : ''}? They will be marked as skipped.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Clear All',
                      style: 'destructive',
                      onPress: async () => {
                        haptic.medium();
                        await dismissAllPending();
                      },
                    },
                  ]
                );
              }}
              accessibilityLabel={`Clear all ${pendingCount} pending tasks`}
              accessibilityRole="button"
            >
              <Text style={styles.clearAllText}>Clear All</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => {
              haptic.selection();
              navigation.navigate('CreateTask');
            }}
            accessibilityLabel="Create new task"
            accessibilityRole="button"
          >
            <Text style={styles.createButtonText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        {filters.map(renderFilterChip)}
      </ScrollView>

      <FlatList
        data={filteredTasks}
        renderItem={renderTaskCard}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
        maxToRenderPerBatch={10}
        initialNumToRender={15}
        windowSize={5}
        removeClippedSubviews={true}
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
  createButton: {
    marginLeft: 'auto',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonText: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.background,
    lineHeight: 22,
  },
  filterContainer: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  filterContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  filterChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginRight: theme.spacing.sm,
    minHeight: 34,
    justifyContent: 'center',
  },
  filterChipActive: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.primary,
  },
  filterChipText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text,
    lineHeight: 18,
  },
  filterChipTextActive: {
    color: theme.colors.primary,
  },
  listContent: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  taskCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.border,
  },
  taskCardHighPriority: {
    borderLeftColor: theme.colors.error,
    backgroundColor: theme.colors.surface,
  },
  taskCardQuestion: {
    borderLeftColor: theme.colors.primary,
  },
  taskCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: theme.spacing.sm,
  },
  taskTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: '600',
    color: theme.colors.text,
    flex: 1,
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  taskMetaText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  taskBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  typeBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surfaceElevated,
  },
  priorityBadge: {
    backgroundColor: theme.colors.error + '20',
  },
  typeBadgeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
    fontWeight: '500',
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
  clearAllButton: {
    marginLeft: 'auto',
    marginRight: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.error + '15',
    borderWidth: 1,
    borderColor: theme.colors.error + '40',
  },
  clearAllText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    fontWeight: '600',
  },
  dismissAction: {
    backgroundColor: theme.colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
  },
  dismissActionText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: theme.fontSize.sm,
  },
});
