import 'package:flutter/material.dart';

import '../models/message_model.dart';
import '../services/haptic_service.dart';

/// Card widget for displaying a unified message (question or task)
class MessageCard extends StatelessWidget {
  final MessageModel message;
  final VoidCallback? onTap;
  final VoidCallback? onArchive;
  final VoidCallback? onDelete;
  final VoidCallback? onLongPress;
  final String? projectName;
  final bool handleTap; // If false, parent handles tap (e.g., SelectableCard)
  final bool enableSwipe; // Whether to enable swipe actions

  const MessageCard({
    super.key,
    required this.message,
    this.onTap,
    this.onArchive,
    this.onDelete,
    this.onLongPress,
    this.projectName,
    this.handleTap = true,
    this.enableSwipe = false,
  });

  @override
  Widget build(BuildContext context) {
    final content = Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row with direction badge, priority, and status
          Row(
            children: [
              _buildDirectionBadge(context),
              const SizedBox(width: 8),
              if (message.isHighPriority) ...[
                _buildPriorityBadge(context),
                const SizedBox(width: 8),
              ],
              _buildStatusChip(context),
              const Spacer(),
              Text(
                _formatTime(message.createdAt),
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Title (for tasks) or Question text
          if (message.isToClaude && message.title != null) ...[
            Text(
              message.title!,
              style: Theme.of(context).textTheme.titleMedium,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 4),
          ],

          // Content/Instructions
          Text(
            message.content,
            style: Theme.of(context).textTheme.bodyLarge,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),

          // Action badge for tasks
          if (message.isToClaude && message.action != null) ...[
            const SizedBox(height: 8),
            _buildActionBadge(context),
          ],

          // Options preview for questions
          if (message.isToUser && message.hasOptions) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: message.options!
                  .take(3)
                  .map((option) => Chip(
                        label: Text(
                          option,
                          style: const TextStyle(fontSize: 12),
                        ),
                        visualDensity: VisualDensity.compact,
                      ))
                  .toList(),
            ),
          ],

          // Response preview if answered
          if (message.isToUser && message.isAnswered && message.response != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.reply,
                    size: 16,
                    color: Theme.of(context).colorScheme.onPrimaryContainer,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      message.response!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onPrimaryContainer,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
          ],

          // Context preview if available
          if (message.context != null && message.context!.isNotEmpty && !message.isAnswered) ...[
            const SizedBox(height: 8),
            Text(
              message.context!,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                    fontStyle: FontStyle.italic,
                  ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],

          // Project name at bottom-right
          if (projectName != null) ...[
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Icon(
                  Icons.folder_outlined,
                  size: 12,
                  color: Theme.of(context).colorScheme.outline,
                ),
                const SizedBox(width: 4),
                Text(
                  projectName!,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: Theme.of(context).colorScheme.outline,
                      ),
                ),
              ],
            ),
          ],
        ],
      ),
    );

    final card = Card(
      clipBehavior: Clip.antiAlias,
      child: handleTap
          ? InkWell(
              onTap: () {
                HapticService.light();
                onTap?.call();
              },
              onLongPress: onLongPress != null
                  ? () {
                      HapticService.medium();
                      onLongPress?.call();
                    }
                  : null,
              child: content,
            )
          : content,
    );

    // If swipe is not enabled, return the card as-is
    if (!enableSwipe) {
      return card;
    }

    // Wrap in Dismissible for swipe actions
    return Dismissible(
      key: Key('message_${message.id}'),
      direction: DismissDirection.horizontal,
      dismissThresholds: const {
        DismissDirection.endToStart: 0.4, // Archive
        DismissDirection.startToEnd: 0.4, // Delete
      },
      confirmDismiss: (direction) async {
        if (direction == DismissDirection.startToEnd) {
          // Delete requires confirmation
          return await _showDeleteConfirmation(context);
        }
        // Archive proceeds without confirmation
        return true;
      },
      onDismissed: (direction) {
        if (direction == DismissDirection.endToStart) {
          // Swipe left = Archive
          onArchive?.call();
        } else if (direction == DismissDirection.startToEnd) {
          // Swipe right = Delete
          onDelete?.call();
        }
      },
      background: Container(
        alignment: Alignment.centerLeft,
        padding: const EdgeInsets.only(left: 24),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.error,
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Icon(Icons.delete, color: Colors.white),
      ),
      secondaryBackground: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 24),
        decoration: BoxDecoration(
          color: Colors.orange,
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Icon(Icons.archive, color: Colors.white),
      ),
      child: card,
    );
  }

  Future<bool> _showDeleteConfirmation(BuildContext context) async {
    HapticService.heavy();
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Message?'),
        content: const Text(
          'This will permanently delete this message. This action cannot be undone.',
        ),
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
    return result ?? false;
  }

  /// Show a context menu with archive/delete options (accessibility alternative to swipe)
  static void showContextMenu(
    BuildContext context, {
    required VoidCallback onArchive,
    required VoidCallback onDelete,
    bool isArchived = false,
  }) {
    HapticService.medium();
    showModalBottomSheet(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (!isArchived)
              ListTile(
                leading: const Icon(Icons.archive, color: Colors.orange),
                title: const Text('Archive'),
                onTap: () {
                  Navigator.pop(context);
                  onArchive();
                },
              ),
            if (isArchived)
              ListTile(
                leading: const Icon(Icons.unarchive, color: Colors.green),
                title: const Text('Restore'),
                onTap: () {
                  Navigator.pop(context);
                  onArchive(); // In archived context, this restores
                },
              ),
            ListTile(
              leading: Icon(Icons.delete, color: Theme.of(context).colorScheme.error),
              title: Text(
                'Delete',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
              onTap: () {
                Navigator.pop(context);
                onDelete();
              },
            ),
            ListTile(
              leading: const Icon(Icons.close),
              title: const Text('Cancel'),
              onTap: () => Navigator.pop(context),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDirectionBadge(BuildContext context) {
    final isToUser = message.isToUser;
    Color color;
    IconData icon;
    String label;

    if (message.isAlert) {
      // Alert-specific styling based on alert type
      switch (message.alertType) {
        case AlertType.error:
          color = Theme.of(context).colorScheme.error;
          icon = Icons.error;
          label = 'Error';
          break;
        case AlertType.warning:
          color = Colors.orange;
          icon = Icons.warning;
          label = 'Warning';
          break;
        case AlertType.success:
          color = Colors.green;
          icon = Icons.check_circle;
          label = 'Success';
          break;
        case AlertType.info:
        default:
          color = Colors.blue;
          icon = Icons.info;
          label = 'Info';
          break;
      }
    } else if (isToUser) {
      color = Theme.of(context).colorScheme.primary;
      icon = Icons.help_outline;
      label = 'Question';
    } else {
      color = Theme.of(context).colorScheme.secondary;
      icon = Icons.task_alt;
      label = 'Task';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withAlpha(30),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withAlpha(80), width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }

  Widget _buildPriorityBadge(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.errorContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.priority_high,
            size: 14,
            color: Theme.of(context).colorScheme.onErrorContainer,
          ),
          const SizedBox(width: 4),
          Text(
            'High',
            style: TextStyle(
              fontSize: 12,
              color: Theme.of(context).colorScheme.onErrorContainer,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusChip(BuildContext context) {
    Color backgroundColor;
    Color textColor;
    String label;
    IconData icon;

    // Handle direction-specific statuses
    if (message.isToUser) {
      // Alert-specific statuses
      if (message.isAlert) {
        if (message.isAcknowledged) {
          backgroundColor = Theme.of(context).colorScheme.surfaceContainerHighest;
          textColor = Theme.of(context).colorScheme.onSurfaceVariant;
          label = 'Acknowledged';
          icon = Icons.check;
        } else {
          backgroundColor = Theme.of(context).colorScheme.tertiaryContainer;
          textColor = Theme.of(context).colorScheme.onTertiaryContainer;
          label = 'New';
          icon = Icons.notifications_active;
        }
      }
      // Question statuses
      else if (message.isPending) {
        backgroundColor = Theme.of(context).colorScheme.tertiaryContainer;
        textColor = Theme.of(context).colorScheme.onTertiaryContainer;
        label = 'Pending';
        icon = Icons.schedule;
      } else if (message.isAnswered) {
        backgroundColor = Theme.of(context).colorScheme.primaryContainer;
        textColor = Theme.of(context).colorScheme.onPrimaryContainer;
        label = 'Answered';
        icon = Icons.check;
      } else {
        backgroundColor = Theme.of(context).colorScheme.surfaceContainerHighest;
        textColor = Theme.of(context).colorScheme.onSurfaceVariant;
        label = 'Expired';
        icon = Icons.timer_off;
      }
    } else {
      // Task statuses
      switch (message.status) {
        case 'pending':
          backgroundColor = Colors.orange.withAlpha(40);
          textColor = Colors.orange;
          label = 'Pending';
          icon = Icons.hourglass_empty;
          break;
        case 'in_progress':
          backgroundColor = Colors.blue.withAlpha(40);
          textColor = Colors.blue;
          label = 'In Progress';
          icon = Icons.play_circle;
          break;
        case 'complete':
          backgroundColor = Colors.green.withAlpha(40);
          textColor = Colors.green;
          label = 'Complete';
          icon = Icons.check_circle;
          break;
        case 'cancelled':
          backgroundColor = Colors.grey.withAlpha(40);
          textColor = Colors.grey;
          label = 'Cancelled';
          icon = Icons.cancel;
          break;
        default:
          backgroundColor = Colors.grey.withAlpha(40);
          textColor = Colors.grey;
          label = message.status;
          icon = Icons.circle;
      }
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: textColor),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(fontSize: 12, color: textColor),
          ),
        ],
      ),
    );
  }

  Widget _buildActionBadge(BuildContext context) {
    Color color;
    IconData icon;
    String label;

    switch (message.action) {
      case MessageAction.interrupt:
        color = Colors.red;
        icon = Icons.warning;
        label = 'Interrupt';
        break;
      case MessageAction.parallel:
        color = Colors.purple;
        icon = Icons.call_split;
        label = 'Parallel';
        break;
      case MessageAction.queue:
        color = Colors.blue;
        icon = Icons.queue;
        label = 'Queue';
        break;
      case MessageAction.backlog:
        color = Colors.grey;
        icon = Icons.schedule;
        label = 'Backlog';
        break;
      default:
        color = Colors.blue;
        icon = Icons.queue;
        label = 'Queue';
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
            style: TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }

  String _formatTime(DateTime time) {
    final now = DateTime.now();
    final diff = now.difference(time);

    if (diff.inMinutes < 1) {
      return 'now';
    } else if (diff.inMinutes < 60) {
      return '${diff.inMinutes}m';
    } else if (diff.inHours < 24) {
      return '${diff.inHours}h';
    } else {
      return '${diff.inDays}d';
    }
  }
}
