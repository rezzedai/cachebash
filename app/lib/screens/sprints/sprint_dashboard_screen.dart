import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/sprint_model.dart';
import '../../providers/sprints_provider.dart';
import '../../services/haptic_service.dart';
import '../../widgets/story_progress_row.dart';
import '../../widgets/sprint_progress_card.dart';

class SprintDashboardScreen extends ConsumerWidget {
  final String sprintId;

  const SprintDashboardScreen({super.key, required this.sprintId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sprintAsync = ref.watch(sprintProvider(sprintId));
    final storiesAsync = ref.watch(sprintStoriesProvider(sprintId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Sprint Dashboard'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            HapticService.light();
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/sessions');
            }
          },
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'Add Story',
            onPressed: () {
              HapticService.light();
              context.push('/sprints/$sprintId/add-story');
            },
          ),
        ],
      ),
      body: sprintAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(child: Text('Error: $error')),
        data: (sprint) {
          if (sprint == null) {
            return const Center(child: Text('Sprint not found'));
          }

          return storiesAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, stack) => Center(child: Text('Error: $error')),
            data: (stories) => _buildDashboard(context, ref, sprint, stories),
          );
        },
      ),
    );
  }

  Widget _buildDashboard(
    BuildContext context,
    WidgetRef ref,
    SprintModel sprint,
    List<SprintStory> stories,
  ) {
    // Group stories by status
    final activeStories = stories.where((s) => s.isActive).toList();
    final queuedStories = stories.where((s) => s.isQueued).toList();
    final completedStories = stories.where((s) => s.isDone).toList();

    // Group by wave for display
    final storiesByWave = <int, List<SprintStory>>{};
    for (final story in stories) {
      storiesByWave.putIfAbsent(story.wave, () => []).add(story);
    }

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(sprintProvider(sprintId));
        ref.invalidate(sprintStoriesProvider(sprintId));
      },
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Overall progress card
            SprintProgressCard(sprint: sprint, stories: stories),
            const SizedBox(height: 24),

            // Active stories section
            if (activeStories.isNotEmpty) ...[
              _buildSectionHeader(
                context,
                'Active',
                Icons.play_circle,
                Colors.green,
                activeStories.length,
              ),
              const SizedBox(height: 8),
              ...activeStories.map((story) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: StoryProgressRow(story: story, showProgress: true),
                  )),
              const SizedBox(height: 16),
            ],

            // Queued stories section
            if (queuedStories.isNotEmpty) ...[
              _buildSectionHeader(
                context,
                'Queued',
                Icons.queue,
                Colors.blue,
                queuedStories.length,
              ),
              const SizedBox(height: 8),
              ...queuedStories.map((story) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: StoryProgressRow(story: story),
                  )),
              const SizedBox(height: 16),
            ],

            // Completed stories section
            if (completedStories.isNotEmpty) ...[
              _buildSectionHeader(
                context,
                'Completed',
                Icons.check_circle,
                Colors.grey,
                completedStories.length,
              ),
              const SizedBox(height: 8),
              ...completedStories.map((story) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: StoryProgressRow(story: story, showDuration: true),
                  )),
            ],

            // Sprint config info
            const SizedBox(height: 24),
            _buildConfigSection(context, sprint),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(
    BuildContext context,
    String title,
    IconData icon,
    Color color,
    int count,
  ) {
    return Row(
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(width: 8),
        Text(
          title,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
        ),
        const SizedBox(width: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: color.withAlpha(51),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            '$count',
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.w500,
              fontSize: 12,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildConfigSection(BuildContext context, SprintModel sprint) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Sprint Configuration',
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  color: Theme.of(context).colorScheme.primary,
                ),
          ),
          const SizedBox(height: 12),
          _buildConfigRow(
              context, 'Orchestrator', sprint.config.orchestratorModel),
          _buildConfigRow(context, 'Subagent', sprint.config.subagentModel),
          _buildConfigRow(
              context, 'Max Concurrent', '${sprint.config.maxConcurrent}'),
          _buildConfigRow(context, 'Branch', sprint.branch),
          _buildConfigRow(context, 'Elapsed', sprint.elapsedFormatted),
        ],
      ),
    );
  }

  Widget _buildConfigRow(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
          Text(
            value,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  fontWeight: FontWeight.w500,
                ),
          ),
        ],
      ),
    );
  }
}
