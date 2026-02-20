import React, { useState, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTasks } from '../hooks/useTasks';
import { Task } from '../types';
import { theme } from '../theme';
import { timeAgo, getStatusColor } from '../utils';

type Props = NativeStackScreenProps<any, 'Tasks'>;

type FilterType = 'all' | 'created' | 'active' | 'done';

export default function TasksScreen({ navigation }: Props) {
  const [filter, setFilter] = useState<FilterType>('all');
  const { tasks, isLoading, refetch, error } = useTasks();

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
        onPress={() => setFilter(key)}
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

  const renderTaskCard = ({ item: task }: { item: Task }) => (
    <TouchableOpacity
      style={styles.taskCard}
      onPress={() => navigation.navigate('TaskDetail', { task })}
      activeOpacity={0.7}
    >
      <View style={styles.taskCardHeader}>
        <View style={[styles.statusDot, { backgroundColor: getStatusColor(task.status) }]} />
        <Text style={styles.taskTitle} numberOfLines={1}>
          {task.title}
        </Text>
      </View>

      <View style={styles.taskMeta}>
        <Text style={styles.taskMetaText}>
          {task.source} → {task.target}
        </Text>
        <Text style={styles.taskMetaText}>•</Text>
        <Text style={styles.taskMetaText}>{timeAgo(task.createdAt)}</Text>
      </View>

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
          <TouchableOpacity onPress={refetch} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyStateText}>No tasks found</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Tasks</Text>
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
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.text,
  },
  filterContainer: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  filterContent: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  filterChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginRight: theme.spacing.sm,
  },
  filterChipActive: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.primary,
  },
  filterChipText: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.textSecondary,
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
