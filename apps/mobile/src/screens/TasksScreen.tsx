import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
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

interface PendingDismissal {
  task: Task;
  timeoutId: ReturnType<typeof setTimeout>;
}

const UNDO_TIMEOUT_MS = 4000;

export default function TasksScreen({ navigation }: Props) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingDismissals, setPendingDismissals] = useState<Map<string, PendingDismissal>>(new Map());
  const [snackbar, setSnackbar] = useState<{ taskIds: string[]; message: string } | null>(null);
  const snackbarTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { tasks, isLoading, refetch, error, isCached, pendingCount, dismissTask, dismissAllPending } = useTasks();

  // Cleanup snackbar timeout on unmount
  useEffect(() => {
    return () => {
      if (snackbarTimeoutRef.current) clearTimeout(snackbarTimeoutRef.current);
    };
  }, []);

  // Filter out pending dismissals from visible tasks
  const visibleTasks = useMemo(() => {
    return tasks.filter(t => !pendingDismissals.has(t.id));
  }, [tasks, pendingDismissals]);

  const filteredTasks = useMemo(() => {
    if (filter === 'all') return visibleTasks;
    return visibleTasks.filter(task => task.status === filter);
  }, [visibleTasks, filter]);

  const selectableTasks = useMemo(() => {
    return filteredTasks.filter(t => t.status === 'created');
  }, [filteredTasks]);

  const visiblePendingCount = visibleTasks.filter(t => t.status === 'created').length;
  const allSelected = selectableTasks.length > 0 && selectedIds.size === selectableTasks.length;

  // --- Dismiss with undo ---

  const dismissWithUndo = useCallback((tasksToDismiss: Task[]) => {
    if (snackbarTimeoutRef.current) clearTimeout(snackbarTimeoutRef.current);

    setPendingDismissals(prev => {
      const next = new Map(prev);
      tasksToDismiss.forEach(task => {
        const existing = next.get(task.id);
        if (existing) clearTimeout(existing.timeoutId);

        const timeoutId = setTimeout(async () => {
          try {
            await dismissTask(task.id);
          } catch {
            // Task may already be dismissed
          }
          setPendingDismissals(p => {
            const n = new Map(p);
            n.delete(task.id);
            return n;
          });
        }, UNDO_TIMEOUT_MS);

        next.set(task.id, { task, timeoutId });
      });
      return next;
    });

    const message = tasksToDismiss.length === 1
      ? 'Task dismissed'
      : `${tasksToDismiss.length} tasks dismissed`;
    setSnackbar({ taskIds: tasksToDismiss.map(t => t.id), message });

    snackbarTimeoutRef.current = setTimeout(() => setSnackbar(null), UNDO_TIMEOUT_MS);
  }, [dismissTask]);

  const undoDismissal = useCallback(() => {
    if (!snackbar) return;

    setPendingDismissals(prev => {
      const next = new Map(prev);
      snackbar.taskIds.forEach(id => {
        const pending = next.get(id);
        if (pending) clearTimeout(pending.timeoutId);
        next.delete(id);
      });
      return next;
    });

    setSnackbar(null);
    if (snackbarTimeoutRef.current) clearTimeout(snackbarTimeoutRef.current);
    haptic.success();
  }, [snackbar]);

  // --- Selection mode ---

  const toggleSelection = useCallback((taskId: string) => {
    haptic.selection();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    haptic.selection();
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableTasks.map(t => t.id)));
    }
  }, [allSelected, selectableTasks]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const enterSelectionMode = useCallback(() => {
    haptic.medium();
    setSelectionMode(true);
  }, []);

  const dismissSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const tasksToDismiss = Array.from(selectedIds)
      .map(id => tasks.find(t => t.id === id))
      .filter((t): t is Task => t != null);
    haptic.medium();
    dismissWithUndo(tasksToDismiss);
    exitSelectionMode();
  }, [selectedIds, tasks, dismissWithUndo, exitSelectionMode]);

  // --- Render helpers ---

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
        style={[styles.filterChip, isActive && styles.filterChipActive]}
        onPress={() => {
          haptic.selection();
          setFilter(key);
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: isActive }}
      >
        <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderTaskCard = ({ item: task }: { item: Task }) => {
    const isSelected = selectedIds.has(task.id);
    const isSelectable = task.status === 'created';

    const card = (
      <TouchableOpacity
        style={[
          styles.taskCard,
          task.priority === 'high' && styles.taskCardHighPriority,
          task.type === 'question' && task.status === 'created' && styles.taskCardQuestion,
          selectionMode && isSelected && styles.taskCardSelected,
        ]}
        onPress={() => {
          if (selectionMode && isSelectable) {
            toggleSelection(task.id);
          } else {
            navigation.navigate('TaskDetail', { task });
          }
        }}
        onLongPress={() => {
          if (!selectionMode && isSelectable) {
            enterSelectionMode();
            toggleSelection(task.id);
          }
        }}
        activeOpacity={0.7}
        accessibilityLabel={`${task.title}, ${task.status}, ${task.priority} priority`}
        accessibilityRole="button"
      >
        <View style={styles.taskCardHeader}>
          {selectionMode && isSelectable ? (
            <TouchableOpacity
              style={[styles.checkbox, isSelected && styles.checkboxSelected]}
              onPress={() => toggleSelection(task.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
            >
              {isSelected && <Text style={styles.checkmark}>{'✓'}</Text>}
            </TouchableOpacity>
          ) : (
            <View style={[styles.statusDot, { backgroundColor: getStatusColor(task.status) }]} />
          )}
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

    // Swipe-to-dismiss for pending tasks (disabled in selection mode)
    if (task.status === 'created' && !selectionMode) {
      return (
        <Swipeable
          renderRightActions={() => (
            <TouchableOpacity
              style={styles.dismissAction}
              onPress={() => {
                haptic.medium();
                dismissWithUndo([task]);
              }}
              accessibilityLabel="Dismiss task"
            >
              <Text style={styles.dismissActionText}>Dismiss</Text>
            </TouchableOpacity>
          )}
          onSwipeableOpen={() => {
            haptic.medium();
            dismissWithUndo([task]);
          }}
          rightThreshold={40}
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
        {selectionMode ? (
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={exitSelectionMode}
              style={styles.cancelButton}
              accessibilityLabel="Exit selection mode"
              accessibilityRole="button"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.selectionCount}>
              {selectedIds.size} selected
            </Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              onPress={toggleSelectAll}
              style={styles.selectAllButton}
              accessibilityLabel={allSelected ? 'Deselect all' : 'Select all'}
              accessibilityRole="button"
            >
              <Text style={styles.selectAllText}>
                {allSelected ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Tasks</Text>
            {isCached && (
              <View style={styles.cachedBadge}>
                <Text style={styles.cachedBadgeText}>CACHED</Text>
              </View>
            )}
            <View style={{ flex: 1 }} />
            {filter === 'created' && visiblePendingCount > 0 && (
              <TouchableOpacity
                style={styles.clearAllButton}
                onPress={() => {
                  Alert.alert(
                    'Clear All Pending',
                    `Dismiss ${visiblePendingCount} pending task${visiblePendingCount !== 1 ? 's' : ''}? They will be marked as skipped.`,
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
                accessibilityLabel={`Clear all ${visiblePendingCount} pending tasks`}
                accessibilityRole="button"
              >
                <Text style={styles.clearAllText}>Clear All</Text>
              </TouchableOpacity>
            )}
            {visiblePendingCount > 0 && (
              <TouchableOpacity
                style={styles.selectModeButton}
                onPress={enterSelectionMode}
                accessibilityLabel="Select multiple tasks"
                accessibilityRole="button"
              >
                <Text style={styles.selectModeButtonText}>Select</Text>
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
        )}
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
        contentContainerStyle={[
          styles.listContent,
          (selectionMode && selectedIds.size > 0) && styles.listContentWithBar,
        ]}
        ListEmptyComponent={renderEmpty}
        extraData={selectionMode ? selectedIds : pendingDismissals}
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

      {/* Selection mode bottom bar */}
      {selectionMode && selectedIds.size > 0 && (
        <View style={styles.selectionBar}>
          <TouchableOpacity
            style={styles.dismissSelectedButton}
            onPress={dismissSelected}
            accessibilityLabel={`Dismiss ${selectedIds.size} selected tasks`}
            accessibilityRole="button"
          >
            <Text style={styles.dismissSelectedText}>
              Dismiss {selectedIds.size} Task{selectedIds.size !== 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Undo snackbar */}
      {snackbar && (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText}>{snackbar.message}</Text>
          <TouchableOpacity
            onPress={undoDismissal}
            style={styles.undoButton}
            accessibilityLabel="Undo dismissal"
            accessibilityRole="button"
          >
            <Text style={styles.undoText}>UNDO</Text>
          </TouchableOpacity>
        </View>
      )}
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
  selectModeButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  selectModeButtonText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: theme.spacing.sm,
  },
  cancelButtonText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.primary,
    fontWeight: '600',
  },
  selectionCount: {
    fontSize: theme.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text,
    marginLeft: theme.spacing.sm,
  },
  selectAllButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  selectAllText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    fontWeight: '600',
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
  listContentWithBar: {
    paddingBottom: 80,
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
  taskCardSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary + '10',
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
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: theme.colors.textMuted,
    marginRight: theme.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  checkmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
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
  selectionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  dismissSelectedButton: {
    backgroundColor: theme.colors.error,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  dismissSelectedText: {
    color: '#fff',
    fontSize: theme.fontSize.md,
    fontWeight: '700',
  },
  snackbar: {
    position: 'absolute',
    bottom: theme.spacing.lg,
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  snackbarText: {
    color: theme.colors.text,
    fontSize: theme.fontSize.sm,
    fontWeight: '500',
    flex: 1,
  },
  undoButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    marginLeft: theme.spacing.md,
  },
  undoText: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
