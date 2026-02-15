import 'package:flutter/material.dart';

import '../models/message_model.dart';

/// Reusable bottom sheet for displaying task details
class TaskDetailSheet extends StatelessWidget {
  final MessageModel task;

  const TaskDetailSheet({super.key, required this.task});

  /// Show the task detail sheet as a modal bottom sheet
  static void show(BuildContext context, MessageModel task) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        expand: false,
        builder: (context, scrollController) => TaskDetailSheet(task: task),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
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
          if (task.title != null) ...[
            Text(
              task.title!,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
          ],
          Row(
            children: [
              _buildStatusChip(context),
              const SizedBox(width: 8),
              _buildPriorityChip(context),
              if (task.action != null) ...[
                const SizedBox(width: 8),
                _buildActionChip(context),
              ],
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
              task.content,
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
    );
  }

  Widget _buildStatusChip(BuildContext context) {
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
      case 'answered':
        color = Colors.green;
        label = task.isToUser ? 'Answered' : 'Complete';
        icon = Icons.check_circle;
        break;
      case 'cancelled':
        color = Colors.grey;
        label = 'Cancelled';
        icon = Icons.cancel;
        break;
      case 'expired':
        color = Colors.grey;
        label = 'Expired';
        icon = Icons.timer_off;
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

  Widget _buildPriorityChip(BuildContext context) {
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

  Widget _buildActionChip(BuildContext context) {
    Color color;
    String label;

    switch (task.action) {
      case MessageAction.interrupt:
        color = Colors.red;
        label = 'Interrupt';
        break;
      case MessageAction.parallel:
        color = Colors.purple;
        label = 'Parallel';
        break;
      case MessageAction.queue:
        color = Colors.blue;
        label = 'Queue';
        break;
      case MessageAction.backlog:
        color = Colors.grey;
        label = 'Backlog';
        break;
      default:
        color = Colors.blue;
        label = 'Queue';
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
