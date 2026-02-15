import 'package:flutter/material.dart';

import '../models/session_model.dart';
import '../services/haptic_service.dart';

class SessionCard extends StatelessWidget {
  final SessionModel session;
  final VoidCallback? onTap;
  final VoidCallback? onArchive;
  final VoidCallback? onUnarchive;
  final bool showSwipeHint;

  const SessionCard({
    super.key,
    required this.session,
    this.onTap,
    this.onArchive,
    this.onUnarchive,
    this.showSwipeHint = false,
  });

  @override
  Widget build(BuildContext context) {
    final card = Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Project name row (if available)
              if (session.projectName != null) ...[
                Row(
                  children: [
                    Icon(
                      Icons.folder_outlined,
                      size: 14,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      session.projectName!,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
              ],

              // Header row with state indicator and wave badge
              Row(
                children: [
                  _buildStateIndicator(context),
                  const SizedBox(width: 8),
                  // Program badge
                  if (session.programId != null) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.primaryContainer,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        session.programId!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onPrimaryContainer,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Expanded(
                    child: Text(
                      session.name,
                      style: Theme.of(context).textTheme.titleMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (session.isStale && !session.isArchived)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.orange.withAlpha(51),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        'Inactive',
                        style: TextStyle(
                          color: Colors.orange.shade700,
                          fontSize: 11,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                ],
              ),

              // Status text
              if (session.status.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  session.status,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],

              // Progress bar
              if (session.progress != null) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          value: session.progress! / 100,
                          minHeight: 6,
                          backgroundColor:
                              Theme.of(context).colorScheme.surfaceContainerHighest,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '${session.progress}%',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            fontWeight: FontWeight.w500,
                          ),
                    ),
                  ],
                ),
              ],

              // Last update
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Updated ${_formatTime(session.lastUpdate)}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color:
                                Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                    ),
                  ),
                  if (showSwipeHint)
                    Text(
                      '← swipe to archive',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color:
                                Theme.of(context).colorScheme.onSurfaceVariant,
                            fontStyle: FontStyle.italic,
                          ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );

    // Wrap in Dismissible if archive handler provided
    if (onArchive != null && !session.isArchived) {
      return Dismissible(
        key: Key('session_${session.id}'),
        direction: DismissDirection.endToStart,
        confirmDismiss: (direction) async {
          HapticService.medium();
          return true;
        },
        onDismissed: (direction) {
          onArchive?.call();
        },
        background: Container(
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.only(right: 20),
          decoration: BoxDecoration(
            color: Colors.orange.shade600,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              Icon(Icons.archive, color: Colors.white),
              SizedBox(width: 8),
              Text(
                'Archive',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
        child: card,
      );
    }

    // For archived sessions, swipe to unarchive
    if (onUnarchive != null && session.isArchived) {
      return Dismissible(
        key: Key('session_${session.id}'),
        direction: DismissDirection.startToEnd,
        confirmDismiss: (direction) async {
          HapticService.medium();
          return true;
        },
        onDismissed: (direction) {
          onUnarchive?.call();
        },
        background: Container(
          alignment: Alignment.centerLeft,
          padding: const EdgeInsets.only(left: 20),
          decoration: BoxDecoration(
            color: Colors.green.shade600,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Row(
            mainAxisAlignment: MainAxisAlignment.start,
            children: [
              Icon(Icons.unarchive, color: Colors.white),
              SizedBox(width: 8),
              Text(
                'Restore',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
        child: card,
      );
    }

    return card;
  }

  Widget _buildStateIndicator(BuildContext context) {
    Color color;
    IconData icon;

    final displayState = session.displayState;

    switch (displayState) {
      case 'working':
        color = Colors.green;
        icon = Icons.play_circle;
        break;
      case 'blocked':
        color = Colors.orange;
        icon = Icons.pause_circle;
        break;
      case 'pinned':
        color = Colors.blue;
        icon = Icons.push_pin;
        break;
      case 'complete':
        color = Colors.grey;
        icon = Icons.check_circle;
        break;
      case 'inactive':
        color = Colors.orange.shade300;
        icon = Icons.access_time;
        break;
      case 'archived':
        color = Colors.grey.shade400;
        icon = Icons.archive;
        break;
      default:
        color = Colors.grey;
        icon = Icons.circle;
    }

    return Icon(icon, color: color, size: 20);
  }

  String _formatTime(DateTime time) {
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
