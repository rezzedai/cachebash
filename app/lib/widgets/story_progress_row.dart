import 'package:flutter/material.dart';

import '../models/sprint_model.dart';

class StoryProgressRow extends StatelessWidget {
  final SprintStory story;
  final bool showProgress;
  final bool showDuration;

  const StoryProgressRow({
    super.key,
    required this.story,
    this.showProgress = false,
    this.showDuration = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
        border: Border(
          left: BorderSide(
            color: _getStatusColor(),
            width: 4,
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _buildStatusIcon(context),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color:
                                Theme.of(context).colorScheme.primaryContainer,
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            story.id,
                            style:
                                Theme.of(context).textTheme.labelSmall?.copyWith(
                                      fontWeight: FontWeight.w600,
                                      color: Theme.of(context)
                                          .colorScheme
                                          .onPrimaryContainer,
                                    ),
                          ),
                        ),
                        if (story.isHighComplexity) ...[
                          const SizedBox(width: 6),
                          Icon(
                            Icons.psychology,
                            size: 14,
                            color: Colors.purple.shade300,
                          ),
                        ],
                        if (story.addedDynamically) ...[
                          const SizedBox(width: 6),
                          Icon(
                            Icons.add_circle,
                            size: 14,
                            color: Colors.blue.shade300,
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      story.title,
                      style: Theme.of(context).textTheme.bodyMedium,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              if (showDuration && story.duration != null)
                _buildDurationBadge(context),
              if (!showDuration && showProgress && story.isActive)
                _buildProgressBadge(context),
            ],
          ),

          // Progress bar for active stories
          if (showProgress && story.isActive && story.progress > 0) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: story.progress / 100,
                      minHeight: 6,
                      backgroundColor:
                          Theme.of(context).colorScheme.surfaceContainerHighest,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  '${story.progress}%',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        fontWeight: FontWeight.w500,
                      ),
                ),
              ],
            ),
          ],

          // Current action
          if (story.currentAction != null && story.currentAction!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(
                  Icons.arrow_forward,
                  size: 14,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    story.currentAction!,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context).colorScheme.primary,
                          fontStyle: FontStyle.italic,
                        ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ],

          // Model info
          if (story.model != null) ...[
            const SizedBox(height: 4),
            Text(
              'Model: ${story.model}',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildStatusIcon(BuildContext context) {
    IconData icon;
    Color color = _getStatusColor();

    switch (story.status) {
      case 'queued':
        icon = Icons.hourglass_empty;
        break;
      case 'active':
        icon = Icons.play_circle;
        break;
      case 'complete':
        icon = Icons.check_circle;
        break;
      case 'failed':
        icon = Icons.error;
        break;
      case 'skipped':
        icon = Icons.skip_next;
        break;
      default:
        icon = Icons.circle;
    }

    return Icon(icon, color: color, size: 24);
  }

  Color _getStatusColor() {
    switch (story.status) {
      case 'queued':
        return Colors.blue;
      case 'active':
        return Colors.green;
      case 'complete':
        return Colors.green.shade700;
      case 'failed':
        return Colors.red;
      case 'skipped':
        return Colors.grey;
      default:
        return Colors.grey;
    }
  }

  Widget _buildProgressBadge(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primaryContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        '${story.progress}%',
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w600,
              color: Theme.of(context).colorScheme.onPrimaryContainer,
            ),
      ),
    );
  }

  Widget _buildDurationBadge(BuildContext context) {
    final duration = story.duration!;
    String formatted;
    if (duration >= 3600) {
      formatted = '${duration ~/ 3600}h ${(duration % 3600) ~/ 60}m';
    } else if (duration >= 60) {
      formatted = '${duration ~/ 60}m ${duration % 60}s';
    } else {
      formatted = '${duration}s';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.timer,
            size: 12,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
          const SizedBox(width: 4),
          Text(
            formatted,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
        ],
      ),
    );
  }
}
