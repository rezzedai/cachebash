import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/task_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/selection_provider.dart';
import '../../providers/tasks_provider.dart';
import '../../services/haptic_service.dart';
import '../../widgets/animated_list_item.dart';
import '../../widgets/selectable_card.dart';
import '../../widgets/selection_action_bar.dart';
import '../../widgets/shimmer_card.dart';

class TasksScreen extends ConsumerWidget {
  const TasksScreen({super.key});

  Future<void> _cancelTask(
    BuildContext context,
    WidgetRef ref,
    String taskId,
  ) async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    HapticService.medium();

    try {
      await ref.read(tasksServiceProvider).cancelTask(
            userId: user.uid,
            taskId: taskId,
          );
      HapticService.success();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Task cancelled')),
        );
      }
    } catch (e) {
      HapticService.error();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  Future<void> _deleteTask(
    BuildContext context,
    WidgetRef ref,
    String taskId,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Task?'),
        content: const Text('This action cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              HapticService.medium();
              Navigator.pop(context, true);
            },
            style: TextButton.styleFrom(
              foregroundColor: Theme.of(context).colorScheme.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    final user = ref.read(currentUserProvider);
    if (user == null) return;

    try {
      await ref.read(tasksServiceProvider).deleteTask(
            userId: user.uid,
            taskId: taskId,
          );
      HapticService.success();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Task deleted')),
        );
      }
    } catch (e) {
      HapticService.error();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  Future<void> _cancelSelected(
    BuildContext context,
    WidgetRef ref,
    Set<String> selectedIds,
  ) async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel Tasks?'),
        content: Text('Cancel ${selectedIds.length} selected task(s)?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('No'),
          ),
          FilledButton(
            onPressed: () {
              HapticService.medium();
              Navigator.pop(context, true);
            },
            child: const Text('Cancel Tasks'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      final service = ref.read(tasksServiceProvider);
      for (final id in selectedIds) {
        await service.cancelTask(userId: user.uid, taskId: id);
      }
      HapticService.success();
      ref.read(tasksSelectionProvider.notifier).exitSelectionMode();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Cancelled ${selectedIds.length} task(s)')),
        );
      }
    } catch (e) {
      HapticService.error();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  Future<void> _deleteSelected(
    BuildContext context,
    WidgetRef ref,
    Set<String> selectedIds,
  ) async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Tasks?'),
        content: Text(
          'Delete ${selectedIds.length} selected task(s)? This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              HapticService.medium();
              Navigator.pop(context, true);
            },
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      final service = ref.read(tasksServiceProvider);
      for (final id in selectedIds) {
        await service.deleteTask(userId: user.uid, taskId: id);
      }
      HapticService.success();
      ref.read(tasksSelectionProvider.notifier).exitSelectionMode();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Deleted ${selectedIds.length} task(s)')),
        );
      }
    } catch (e) {
      HapticService.error();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recentTasks = ref.watch(recentTasksProvider);
    final selectionState = ref.watch(tasksSelectionProvider);

    return PopScope(
      canPop: !selectionState.isSelecting,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && selectionState.isSelecting) {
          ref.read(tasksSelectionProvider.notifier).exitSelectionMode();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: selectionState.isSelecting
              ? Text('${selectionState.selectedCount} selected')
              : const Text('Tasks'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () {
              if (selectionState.isSelecting) {
                HapticService.light();
                ref.read(tasksSelectionProvider.notifier).exitSelectionMode();
              } else {
                HapticService.light();
                context.go('/home');
              }
            },
          ),
          actions: [
            if (!selectionState.isSelecting)
              IconButton(
                icon: const Icon(Icons.checklist),
                onPressed: () {
                  HapticService.light();
                  ref.read(tasksSelectionProvider.notifier).enterSelectionMode();
                },
                tooltip: 'Select',
              )
            else
              // Select all button
              recentTasks.whenOrNull(
                data: (tasks) => IconButton(
                  icon: Icon(
                    selectionState.selectedCount == tasks.length
                        ? Icons.deselect
                        : Icons.select_all,
                  ),
                  onPressed: () {
                    HapticService.light();
                    if (selectionState.selectedCount == tasks.length) {
                      ref.read(tasksSelectionProvider.notifier).clearSelection();
                    } else {
                      ref.read(tasksSelectionProvider.notifier).selectAll(
                            tasks.map((t) => t.id).toList(),
                          );
                    }
                  },
                  tooltip: selectionState.selectedCount == tasks.length
                      ? 'Deselect All'
                      : 'Select All',
                ),
              ) ?? const SizedBox.shrink(),
          ],
        ),
        body: Column(
          children: [
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async {
                  ref.invalidate(recentTasksProvider);
                },
                child: recentTasks.when(
                  loading: () => Padding(
                    padding: const EdgeInsets.all(16),
                    child: ShimmerList.tasks(itemCount: 4),
                  ),
                  error: (error, stack) => Center(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text('Error: $error'),
                    ),
                  ),
                  data: (tasks) {
                    if (tasks.isEmpty) {
                      return Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.task_alt,
                              size: 64,
                              color: Theme.of(context).colorScheme.outline,
                            ),
                            const SizedBox(height: 16),
                            Text(
                              'No tasks yet',
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Tasks created from Messages will appear here',
                              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                    color:
                                        Theme.of(context).colorScheme.onSurfaceVariant,
                                  ),
                            ),
                          ],
                        ),
                      );
                    }

                    // Group tasks by status
                    final pendingTasks = tasks.where((t) => t.isPending).toList();
                    final inProgressTasks =
                        tasks.where((t) => t.isInProgress).toList();
                    final completedTasks = tasks.where((t) => t.isComplete).toList();
                    final cancelledTasks = tasks.where((t) => t.isCancelled).toList();

                    int animationIndex = 0;
                    return ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        if (pendingTasks.isNotEmpty) ...[
                          AnimatedListItem(
                            index: animationIndex++,
                            child: _buildSectionHeader(context, 'Pending', Icons.hourglass_empty),
                          ),
                          const SizedBox(height: 12),
                          ...pendingTasks.map((t) => AnimatedListItem(
                                index: animationIndex++,
                                child: SelectableCard(
                                  isSelecting: selectionState.isSelecting,
                                  isSelected: selectionState.isSelected(t.id),
                                  onTap: () => _showTaskDetails(context, t),
                                  onLongPress: () {
                                    if (!selectionState.isSelecting) {
                                      ref.read(tasksSelectionProvider.notifier).enterSelectionMode();
                                    }
                                    ref.read(tasksSelectionProvider.notifier).toggleSelection(t.id);
                                  },
                                  onToggleSelection: () {
                                    ref.read(tasksSelectionProvider.notifier).toggleSelection(t.id);
                                  },
                                  child: _buildTaskCard(
                                    context,
                                    ref,
                                    t,
                                    isSelecting: selectionState.isSelecting,
                                    onCancel: selectionState.isSelecting
                                        ? null
                                        : () => _cancelTask(context, ref, t.id),
                                  ),
                                ),
                              )),
                          const SizedBox(height: 16),
                        ],
                        if (inProgressTasks.isNotEmpty) ...[
                          AnimatedListItem(
                            index: animationIndex++,
                            child: _buildSectionHeader(context, 'In Progress', Icons.play_circle),
                          ),
                          const SizedBox(height: 12),
                          ...inProgressTasks.map((t) => AnimatedListItem(
                                index: animationIndex++,
                                child: SelectableCard(
                                  isSelecting: selectionState.isSelecting,
                                  isSelected: selectionState.isSelected(t.id),
                                  onTap: () => _showTaskDetails(context, t),
                                  onLongPress: () {
                                    if (!selectionState.isSelecting) {
                                      ref.read(tasksSelectionProvider.notifier).enterSelectionMode();
                                    }
                                    ref.read(tasksSelectionProvider.notifier).toggleSelection(t.id);
                                  },
                                  onToggleSelection: () {
                                    ref.read(tasksSelectionProvider.notifier).toggleSelection(t.id);
                                  },
                                  child: _buildTaskCard(
                                    context,
                                    ref,
                                    t,
                                    isSelecting: selectionState.isSelecting,
                                  ),
                                ),
                              )),
                          const SizedBox(height: 16),
                        ],
                        if (completedTasks.isNotEmpty) ...[
                          AnimatedListItem(
                            index: animationIndex++,
                            child: _buildSectionHeader(context, 'Completed', Icons.check_circle),
                          ),
                          const SizedBox(height: 12),
                          ...completedTasks.take(5).map((t) => AnimatedListItem(
                                index: animationIndex++,
                                child: SelectableCard(
                                  isSelecting: selectionState.isSelecting,
                                  isSelected: selectionState.isSelected(t.id),
                                  onTap: () => _showTaskDetails(context, t),
                                  onLongPress: () {
                                    if (!selectionState.isSelecting) {
                                      ref.read(tasksSelectionProvider.notifier).enterSelectionMode();
                                    }
                                    ref.read(tasksSelectionProvider.notifier).toggleSelection(t.id);
                                  },
                                  onToggleSelection: () {
                                    ref.read(tasksSelectionProvider.notifier).toggleSelection(t.id);
                                  },
                                  child: _buildTaskCard(
                                    context,
                                    ref,
                                    t,
                                    isSelecting: selectionState.isSelecting,
                                    onDelete: selectionState.isSelecting
                                        ? null
                                        : () => _deleteTask(context, ref, t.id),
                                  ),
                                ),
                              )),
                          const SizedBox(height: 16),
                        ],
                        if (cancelledTasks.isNotEmpty) ...[
                          AnimatedListItem(
                            index: animationIndex++,
                            child: _buildSectionHeader(context, 'Cancelled', Icons.cancel),
                          ),
                          const SizedBox(height: 12),
                          ...cancelledTasks.take(3).map((t) => AnimatedListItem(
                                index: animationIndex++,
                                child: SelectableCard(
                                  isSelecting: selectionState.isSelecting,
                                  isSelected: selectionState.isSelected(t.id),
                                  onTap: () => _showTaskDetails(context, t),
                                  onLongPress: () {
                                    if (!selectionState.isSelecting) {
                                      ref.read(tasksSelectionProvider.notifier).enterSelectionMode();
                                    }
                                    ref.read(tasksSelectionProvider.notifier).toggleSelection(t.id);
                                  },
                                  onToggleSelection: () {
                                    ref.read(tasksSelectionProvider.notifier).toggleSelection(t.id);
                                  },
                                  child: _buildTaskCard(
                                    context,
                                    ref,
                                    t,
                                    isSelecting: selectionState.isSelecting,
                                    onDelete: selectionState.isSelecting
                                        ? null
                                        : () => _deleteTask(context, ref, t.id),
                                  ),
                                ),
                              )),
                        ],
                        const SizedBox(height: 16),
                      ],
                    );
                  },
                ),
              ),
            ),
            // Selection action bar
            if (selectionState.isSelecting && selectionState.hasSelection)
              SelectionActionBar(
                selectedCount: selectionState.selectedCount,
                onCancel: () {
                  ref.read(tasksSelectionProvider.notifier).exitSelectionMode();
                },
                actions: [
                  SelectionAction(
                    label: 'Cancel',
                    icon: Icons.cancel_outlined,
                    onPressed: () => _cancelSelected(
                      context,
                      ref,
                      selectionState.selectedIds,
                    ),
                  ),
                  SelectionAction(
                    label: 'Delete',
                    icon: Icons.delete,
                    isDestructive: true,
                    onPressed: () => _deleteSelected(
                      context,
                      ref,
                      selectionState.selectedIds,
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  void _showTaskDetails(BuildContext context, TaskModel task) {
    HapticService.light();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        expand: false,
        builder: (context, scrollController) => SingleChildScrollView(
          controller: scrollController,
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.outline,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              Text(
                task.title,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  _buildStatusChip(context, task),
                  const SizedBox(width: 8),
                  _buildPriorityChip(context, task),
                ],
              ),
              const SizedBox(height: 24),
              Text(
                'Instructions',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: Theme.of(context).colorScheme.primary,
                    ),
              ),
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerLow,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: SelectableText(
                  task.instructions,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontFamily: 'monospace',
                      ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Created ${_formatDateTime(task.createdAt)}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
              if (task.startedAt != null) ...[
                const SizedBox(height: 4),
                Text(
                  'Started ${_formatDateTime(task.startedAt!)}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ],
              if (task.completedAt != null) ...[
                const SizedBox(height: 4),
                Text(
                  'Completed ${_formatDateTime(task.completedAt!)}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSectionHeader(
    BuildContext context,
    String title,
    IconData icon,
  ) {
    return Row(
      children: [
        Icon(icon, size: 20, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: 8),
        Text(
          title,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
        ),
      ],
    );
  }

  Widget _buildTaskCard(
    BuildContext context,
    WidgetRef ref,
    TaskModel task, {
    bool isSelecting = false,
    VoidCallback? onCancel,
    VoidCallback? onDelete,
  }) {
    Color priorityColor;
    switch (task.priority) {
      case 'high':
        priorityColor = Colors.red;
        break;
      case 'low':
        priorityColor = Colors.grey;
        break;
      default:
        priorityColor = Colors.blue;
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 4,
                  height: 40,
                  decoration: BoxDecoration(
                    color: priorityColor,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        task.title,
                        style: Theme.of(context).textTheme.titleMedium,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        task.instructions,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                if (!isSelecting && (onCancel != null || onDelete != null))
                  PopupMenuButton<String>(
                    icon: Icon(
                      Icons.more_vert,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                    onSelected: (value) {
                      if (value == 'cancel' && onCancel != null) {
                        onCancel();
                      } else if (value == 'delete' && onDelete != null) {
                        onDelete();
                      }
                    },
                    itemBuilder: (context) => [
                      if (onCancel != null)
                        const PopupMenuItem(
                          value: 'cancel',
                          child: Row(
                            children: [
                              Icon(Icons.cancel),
                              SizedBox(width: 12),
                              Text('Cancel'),
                            ],
                          ),
                        ),
                      if (onDelete != null)
                        PopupMenuItem(
                          value: 'delete',
                          child: Row(
                            children: [
                              Icon(
                                Icons.delete,
                                color: Theme.of(context).colorScheme.error,
                              ),
                              const SizedBox(width: 12),
                              Text(
                                'Delete',
                                style: TextStyle(
                                  color: Theme.of(context).colorScheme.error,
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                _buildStatusChip(context, task),
                const Spacer(),
                Text(
                  _formatDateTime(task.createdAt),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusChip(BuildContext context, TaskModel task) {
    Color color;
    String label;
    IconData icon;

    switch (task.status) {
      case 'pending':
        color = Colors.orange;
        label = 'Pending';
        icon = Icons.hourglass_empty;
        break;
      case 'in_progress':
        color = Colors.blue;
        label = 'In Progress';
        icon = Icons.play_circle;
        break;
      case 'complete':
        color = Colors.green;
        label = 'Complete';
        icon = Icons.check_circle;
        break;
      case 'cancelled':
        color = Colors.grey;
        label = 'Cancelled';
        icon = Icons.cancel;
        break;
      default:
        color = Colors.grey;
        label = task.status;
        icon = Icons.circle;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withAlpha(30),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPriorityChip(BuildContext context, TaskModel task) {
    Color color;
    String label;

    switch (task.priority) {
      case 'high':
        color = Colors.red;
        label = 'High';
        break;
      case 'low':
        color = Colors.grey;
        label = 'Low';
        break;
      default:
        color = Colors.blue;
        label = 'Normal';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withAlpha(30),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }

  String _formatDateTime(DateTime time) {
    final now = DateTime.now();
    final diff = now.difference(time);

    if (diff.inMinutes < 1) {
      return 'just now';
    } else if (diff.inMinutes < 60) {
      return '${diff.inMinutes}m ago';
    } else if (diff.inHours < 24) {
      return '${diff.inHours}h ago';
    } else {
      return '${diff.inDays}d ago';
    }
  }
}
