import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/streak_provider.dart';

/// A badge showing the current streak count
class StreakBadge extends ConsumerWidget {
  final bool showLabel;
  final double? size;

  const StreakBadge({
    super.key,
    this.showLabel = true,
    this.size,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statsAsync = ref.watch(userStatsProvider);

    return statsAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (stats) {
        if (stats.currentStreak == 0) {
          return const SizedBox.shrink();
        }

        final isAtRisk = stats.isStreakAtRisk;
        final iconSize = size ?? 24.0;

        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: isAtRisk
                  ? [Colors.orange.shade600, Colors.orange.shade400]
                  : [Colors.amber.shade600, Colors.amber.shade400],
            ),
            borderRadius: BorderRadius.circular(20),
            boxShadow: [
              BoxShadow(
                color: (isAtRisk ? Colors.orange : Colors.amber).withAlpha(77),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.local_fire_department,
                color: Colors.white,
                size: iconSize,
              ),
              const SizedBox(width: 4),
              Text(
                '${stats.currentStreak}',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: iconSize * 0.7,
                ),
              ),
              if (showLabel) ...[
                const SizedBox(width: 4),
                Text(
                  isAtRisk ? 'at risk!' : 'day${stats.currentStreak == 1 ? '' : 's'}',
                  style: TextStyle(
                    color: Colors.white.withAlpha(204),
                    fontSize: iconSize * 0.5,
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

/// A larger streak card for displaying on the home screen
class StreakCard extends ConsumerWidget {
  const StreakCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statsAsync = ref.watch(userStatsProvider);

    return statsAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (stats) {
        return Card(
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              gradient: LinearGradient(
                colors: [
                  Theme.of(context).colorScheme.primaryContainer,
                  Theme.of(context).colorScheme.primaryContainer.withAlpha(179),
                ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            child: Row(
              children: [
                // Streak icon
                Container(
                  width: 60,
                  height: 60,
                  decoration: BoxDecoration(
                    color: Colors.amber.withAlpha(51),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.local_fire_department,
                    color: stats.currentStreak > 0 ? Colors.amber : Colors.grey,
                    size: 32,
                  ),
                ),
                const SizedBox(width: 16),

                // Stats
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            '${stats.currentStreak}',
                            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                                  fontWeight: FontWeight.bold,
                                  color: Theme.of(context).colorScheme.onPrimaryContainer,
                                ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            'day streak',
                            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                                  color: Theme.of(context).colorScheme.onPrimaryContainer,
                                ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        stats.isStreakAtRisk
                            ? 'Answer a question to keep your streak!'
                            : stats.currentStreak == 0
                                ? 'Answer a question to start your streak'
                                : 'Best: ${stats.longestStreak} days',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: stats.isStreakAtRisk
                                  ? Colors.orange
                                  : Theme.of(context).colorScheme.onPrimaryContainer.withAlpha(179),
                            ),
                      ),
                    ],
                  ),
                ),

                // Total answered
                Column(
                  children: [
                    Text(
                      '${stats.totalAnswered}',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.bold,
                            color: Theme.of(context).colorScheme.onPrimaryContainer,
                          ),
                    ),
                    Text(
                      'total',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Theme.of(context).colorScheme.onPrimaryContainer.withAlpha(179),
                          ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Mini streak indicator for app bar
class StreakIndicator extends ConsumerWidget {
  const StreakIndicator({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final streak = ref.watch(currentStreakProvider);
    final isAtRisk = ref.watch(streakAtRiskProvider);

    if (streak == 0) {
      return const SizedBox.shrink();
    }

    return Tooltip(
      message: isAtRisk ? 'Streak at risk!' : '$streak day streak',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: isAtRisk ? Colors.orange : Colors.amber,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.local_fire_department, color: Colors.white, size: 16),
            const SizedBox(width: 2),
            Text(
              '$streak',
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
