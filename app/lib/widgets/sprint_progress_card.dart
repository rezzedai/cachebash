import 'package:flutter/material.dart';

import '../models/sprint_model.dart';

class SprintProgressCard extends StatelessWidget {
  final SprintModel sprint;
  final List<SprintStory> stories;

  const SprintProgressCard({
    super.key,
    required this.sprint,
    required this.stories,
  });

  @override
  Widget build(BuildContext context) {
    final completedCount = stories.where((s) => s.isComplete).length;
    final failedCount = stories.where((s) => s.isFailed).length;
    final skippedCount = stories.where((s) => s.isSkipped).length;
    final activeCount = stories.where((s) => s.isActive).length;
    final totalCount = stories.length;
    final doneCount = completedCount + failedCount + skippedCount;
    final progress = totalCount > 0 ? doneCount / totalCount : 0.0;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Theme.of(context).colorScheme.primaryContainer,
            Theme.of(context).colorScheme.secondaryContainer,
          ],
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header with project name and status
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      sprint.projectName,
                      style:
                          Theme.of(context).textTheme.headlineSmall?.copyWith(
                                fontWeight: FontWeight.bold,
                                color: Theme.of(context)
                                    .colorScheme
                                    .onPrimaryContainer,
                              ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      sprint.waveProgress,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: Theme.of(context)
                                .colorScheme
                                .onPrimaryContainer
                                .withAlpha(179),
                          ),
                    ),
                  ],
                ),
              ),
              _buildStatusBadge(context),
            ],
          ),
          const SizedBox(height: 20),

          // Progress bar
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 12,
              backgroundColor: Theme.of(context)
                  .colorScheme
                  .onPrimaryContainer
                  .withAlpha(51),
              valueColor: AlwaysStoppedAnimation<Color>(
                Theme.of(context).colorScheme.primary,
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Stats row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildStat(
                context,
                '$doneCount / $totalCount',
                'Stories',
                Icons.article,
              ),
              _buildStat(
                context,
                '$activeCount',
                'Active',
                Icons.play_circle,
              ),
              _buildStat(
                context,
                sprint.elapsedFormatted,
                'Elapsed',
                Icons.timer,
              ),
            ],
          ),

          // Wave indicators
          if (sprint.totalWaves > 1) ...[
            const SizedBox(height: 16),
            _buildWaveIndicators(context),
          ],
        ],
      ),
    );
  }

  Widget _buildStatusBadge(BuildContext context) {
    Color color;
    IconData icon;
    String label;

    switch (sprint.status) {
      case 'running':
        color = Colors.green;
        icon = Icons.play_circle;
        label = 'Running';
        break;
      case 'paused':
        color = Colors.orange;
        icon = Icons.pause_circle;
        label = 'Paused';
        break;
      case 'complete':
        color = Colors.blue;
        icon = Icons.check_circle;
        label = 'Complete';
        break;
      case 'error':
        color = Colors.red;
        icon = Icons.error;
        label = 'Error';
        break;
      default:
        color = Colors.grey;
        icon = Icons.circle;
        label = 'Unknown';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withAlpha(51),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withAlpha(128)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.w500,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStat(
    BuildContext context,
    String value,
    String label,
    IconData icon,
  ) {
    return Column(
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 16,
              color:
                  Theme.of(context).colorScheme.onPrimaryContainer.withAlpha(179),
            ),
            const SizedBox(width: 4),
            Text(
              value,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).colorScheme.onPrimaryContainer,
                  ),
            ),
          ],
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context)
                    .colorScheme
                    .onPrimaryContainer
                    .withAlpha(179),
              ),
        ),
      ],
    );
  }

  Widget _buildWaveIndicators(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(sprint.totalWaves, (index) {
        final waveNum = index + 1;
        final isCurrentWave = waveNum == sprint.currentWave;
        final isPastWave = waveNum < sprint.currentWave;

        Color color;
        if (isPastWave) {
          color = Theme.of(context).colorScheme.primary;
        } else if (isCurrentWave) {
          color = Theme.of(context).colorScheme.primary.withAlpha(179);
        } else {
          color =
              Theme.of(context).colorScheme.onPrimaryContainer.withAlpha(77);
        }

        return Container(
          margin: const EdgeInsets.symmetric(horizontal: 4),
          child: Column(
            children: [
              Container(
                width: isCurrentWave ? 12 : 8,
                height: isCurrentWave ? 12 : 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: color,
                  border: isCurrentWave
                      ? Border.all(
                          color: Theme.of(context).colorScheme.primary,
                          width: 2,
                        )
                      : null,
                ),
              ),
              if (isCurrentWave) ...[
                const SizedBox(height: 4),
                Text(
                  'W$waveNum',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: Theme.of(context).colorScheme.onPrimaryContainer,
                        fontWeight: FontWeight.w500,
                      ),
                ),
              ],
            ],
          ),
        );
      }),
    );
  }
}
