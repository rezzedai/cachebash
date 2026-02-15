import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/auth_provider.dart';
import '../../providers/messages_provider.dart';
import '../../providers/questions_provider.dart';
import '../../providers/dream_sessions_provider.dart';
import '../../providers/sessions_provider.dart';
import '../../providers/pulse_provider.dart';
import '../../models/dream_session_model.dart';
import '../../services/haptic_service.dart';
import '../../widgets/animated_list_item.dart';
import '../../widgets/question_card.dart';
import '../../widgets/session_card.dart';
import '../../widgets/shimmer_card.dart';
import '../../widgets/program_pulse_row.dart';
import '../../widgets/task_queue_chips.dart';

void _log(String message) {
  debugPrint('[HomeScreen] $message');
}

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  void _openFeedback(BuildContext context) {
    context.push('/feedback');
  }

  Future<void> _archiveSession(
    BuildContext context,
    WidgetRef ref,
    String sessionId,
  ) async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    try {
      await ref.read(sessionsServiceProvider).archiveSession(
            userId: user.uid,
            sessionId: sessionId,
          );
      HapticService.success();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Session archived')),
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

  Future<void> _archiveAllInactive(
    BuildContext context,
    WidgetRef ref,
  ) async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    HapticService.medium();

    try {
      final count = await ref.read(sessionsServiceProvider).archiveAllStale(
            userId: user.uid,
          );
      HapticService.success();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Archived $count session(s)')),
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

  Future<void> _answerQuestion(
    WidgetRef ref,
    String questionId,
    String response,
  ) async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    await ref.read(messagesServiceProvider).answerMessage(
          userId: user.uid,
          messageId: questionId,
          response: response,
        );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pendingQuestions = ref.watch(pendingQuestionsProvider);
    final activeDreams = ref.watch(activeDreamSessionsProvider);
    final activeSessions = ref.watch(activeSessionsProvider);
    final inactiveSessions = ref.watch(inactiveSessionsProvider);
    final allSessions = ref.watch(allActiveSessionsProvider);
    final pendingTaskQueue = ref.watch(pendingTaskQueueProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Grid Pulse'),
        actions: [
          IconButton(
            icon: const Icon(Icons.help_outline),
            onPressed: () {
              HapticService.light();
              _openFeedback(context);
            },
            tooltip: 'Help & Feedback',
          ),
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () {
              HapticService.light();
              context.go('/settings');
            },
            tooltip: 'Settings',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(pendingQuestionsProvider);
          ref.invalidate(activeDreamSessionsProvider);
          ref.invalidate(activeSessionsProvider);
          ref.invalidate(inactiveSessionsProvider);
          ref.invalidate(allActiveSessionsProvider);
          ref.invalidate(pendingTaskQueueProvider);
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Grid Pulse Section
            _buildSectionHeader(context, 'Grid Pulse', Icons.grid_view_rounded),
            const SizedBox(height: 12),
            allSessions.when(
              loading: () => const SizedBox(height: 48, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
              error: (error, stack) => const SizedBox.shrink(),
              data: (sessions) => ProgramPulseRow(sessions: sessions),
            ),

            const SizedBox(height: 20),

            // Task Queue Section
            _buildSectionHeader(
              context,
              'Task Queue',
              Icons.queue,
              onViewAll: () => context.go('/tasks'),
            ),
            const SizedBox(height: 8),
            pendingTaskQueue.when(
              loading: () => const SizedBox(height: 32, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
              error: (error, stack) => const SizedBox.shrink(),
              data: (tasks) => TaskQueueChips(
                pendingTasks: tasks,
                onTapTarget: (target) {
                  HapticService.light();
                  context.go('/tasks');
                },
              ),
            ),

            const SizedBox(height: 20),

            // Quick Actions
            _buildQuickActions(context, ref),

            const SizedBox(height: 24),

            // Pending Questions Section
            _buildSectionHeader(
              context,
              'Pending Questions',
              Icons.help_outline,
              onViewAll: () => context.go('/messages'),
            ),
            const SizedBox(height: 12),
            pendingQuestions.when(
              loading: () => ShimmerList.questions(itemCount: 2),
              error: (error, stack) => _buildErrorCard(context, error),
              data: (questions) {
                if (questions.isEmpty) {
                  return _buildEmptyCard(
                    context,
                    Icons.inbox,
                    'No pending questions',
                    'Questions from Claude will appear here',
                  );
                }
                return Column(
                  children: questions
                      .take(3)
                      .toList()
                      .asMap()
                      .entries
                      .map((entry) => AnimatedListItem(
                            index: entry.key,
                            child: Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: QuestionCard(
                                question: entry.value,
                                onTap: () => context.push('/questions/${entry.value.id}'),
                                showQuickReply: true,
                                onAnswer: (response) => _answerQuestion(
                                  ref,
                                  entry.value.id,
                                  response,
                                ),
                              ),
                            ),
                          ))
                      .toList(),
                );
              },
            ),

            const SizedBox(height: 24),

            // Dream Mode Section
            _buildDreamSection(context, ref, activeDreams),

            const SizedBox(height: 24),

            // Active Sessions Section
            _buildSectionHeader(
              context,
              'Active Sessions',
              Icons.terminal,
              onViewAll: () => context.go('/sessions'),
            ),
            const SizedBox(height: 12),
            activeSessions.when(
              loading: () => ShimmerList.sessions(itemCount: 2),
              error: (error, stack) => _buildErrorCard(context, error),
              data: (sessions) {
                if (sessions.isEmpty) {
                  return _buildEmptyCard(
                    context,
                    Icons.terminal,
                    'No active sessions',
                    'Claude Code sessions will appear here',
                  );
                }
                return Column(
                  children: sessions
                      .take(3)
                      .toList()
                      .asMap()
                      .entries
                      .map((entry) => AnimatedListItem(
                            index: entry.key,
                            child: Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: SessionCard(
                                session: entry.value,
                                onTap: () {
                                  HapticService.light();
                                  context.push('/sessions/${entry.value.id}');
                                },
                                onArchive: () =>
                                    _archiveSession(context, ref, entry.value.id),
                              ),
                            ),
                          ))
                      .toList(),
                );
              },
            ),

            // Inactive Sessions Section (stale sessions)
            inactiveSessions.when(
              loading: () => const SizedBox.shrink(),
              error: (error, stack) => const SizedBox.shrink(),
              data: (sessions) {
                if (sessions.isEmpty) {
                  return const SizedBox.shrink();
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 24),
                    _buildSectionHeader(
                      context,
                      'Inactive (${sessions.length})',
                      Icons.access_time,
                      actionWidget: TextButton.icon(
                        onPressed: () => _archiveAllInactive(context, ref),
                        icon: const Icon(Icons.archive, size: 16),
                        label: const Text('Archive All'),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Sessions not updated in 30+ minutes',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color:
                                Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                    ),
                    const SizedBox(height: 12),
                    ...sessions.take(5).map((s) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: SessionCard(
                            session: s,
                            showSwipeHint: sessions.indexOf(s) == 0,
                            onTap: () {
                              HapticService.light();
                              context.push('/sessions/${s.id}');
                            },
                            onArchive: () =>
                                _archiveSession(context, ref, s.id),
                          ),
                        )),
                  ],
                );
              },
            ),

            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickActions(BuildContext context, WidgetRef ref) {
    final activeDreams = ref.watch(activeDreamSessionsProvider);
    final hasActiveDream = activeDreams.whenOrNull(data: (d) => d.isNotEmpty) ?? false;

    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () {
              HapticService.light();
              context.push('/tasks/new');
            },
            icon: const Icon(Icons.add_task, size: 18),
            label: const Text('New Task'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () {
              HapticService.light();
              context.push('/dreams/new');
            },
            icon: const Icon(Icons.nightlight_round, size: 18),
            label: const Text('New Dream'),
          ),
        ),
        if (hasActiveDream) ...[
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () {
                HapticService.medium();
                // Navigate to first active dream for kill action
                final dreams = activeDreams.value ?? [];
                if (dreams.isNotEmpty) {
                  context.push('/dreams/${dreams.first.id}');
                }
              },
              icon: Icon(Icons.dangerous, size: 18, color: Theme.of(context).colorScheme.error),
              label: Text('Kill', style: TextStyle(color: Theme.of(context).colorScheme.error)),
              style: OutlinedButton.styleFrom(
                side: BorderSide(color: Theme.of(context).colorScheme.error.withValues(alpha: 0.5)),
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildDreamSection(
    BuildContext context,
    WidgetRef ref,
    AsyncValue<List<DreamSessionModel>> activeDreams,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionHeader(
          context,
          'Dream Mode',
          Icons.nightlight_round,
        ),
        const SizedBox(height: 12),
        activeDreams.when(
          loading: () => const SizedBox.shrink(),
          error: (error, stack) => const SizedBox.shrink(),
          data: (dreams) {
            if (dreams.isEmpty) {
              return SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () {
                    HapticService.light();
                    context.push('/dreams/new');
                  },
                  icon: const Icon(Icons.nightlight_round),
                  label: const Text('Start Dream'),
                ),
              );
            }
            return Column(
              children: dreams.map((dream) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Card(
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: () {
                        HapticService.light();
                        context.push('/dreams/${dream.id}');
                      },
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Icon(
                                  dream.isActive
                                      ? Icons.nightlight_round
                                      : Icons.hourglass_top,
                                  size: 20,
                                  color: dream.isActive
                                      ? Colors.green
                                      : Colors.orange,
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  dream.agent,
                                  style: Theme.of(context)
                                      .textTheme
                                      .titleSmall
                                      ?.copyWith(
                                          fontWeight: FontWeight.bold),
                                ),
                                const Spacer(),
                                Text(
                                  dream.statusDisplay,
                                  style: Theme.of(context)
                                      .textTheme
                                      .bodySmall
                                      ?.copyWith(
                                        color: Theme.of(context)
                                            .colorScheme
                                            .onSurfaceVariant,
                                      ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            LinearProgressIndicator(
                              value: dream.budgetCapUsd > 0
                                  ? (dream.budgetConsumedUsd /
                                          dream.budgetCapUsd)
                                      .clamp(0.0, 1.0)
                                  : 0,
                              backgroundColor: Theme.of(context)
                                  .colorScheme
                                  .surfaceContainerHighest,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '\$${dream.budgetConsumedUsd.toStringAsFixed(2)} / \$${dream.budgetCapUsd.toStringAsFixed(2)} · ${dream.elapsedFormatted}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              }).toList(),
            );
          },
        ),
      ],
    );
  }

  Widget _buildSectionHeader(
    BuildContext context,
    String title,
    IconData icon, {
    VoidCallback? onViewAll,
    Widget? actionWidget,
  }) {
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
        const Spacer(),
        if (actionWidget != null) actionWidget,
        if (onViewAll != null)
          TextButton(
            onPressed: onViewAll,
            child: const Text('View All'),
          ),
      ],
    );
  }

  Widget _buildEmptyCard(
    BuildContext context,
    IconData icon,
    String title,
    String subtitle,
  ) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Icon(
              icon,
              size: 48,
              color: Theme.of(context).colorScheme.outline,
            ),
            const SizedBox(height: 12),
            Text(
              title,
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 4),
            Text(
              subtitle,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorCard(BuildContext context, Object error) {
    _log('ERROR: $error');
    final errorMessage = error.toString();
    return Card(
      color: Theme.of(context).colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.error_outline,
                  color: Theme.of(context).colorScheme.onErrorContainer,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Error loading data',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onErrorContainer,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              errorMessage.length > 200
                  ? '${errorMessage.substring(0, 200)}...'
                  : errorMessage,
              style: TextStyle(
                color: Theme.of(context).colorScheme.onErrorContainer,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }

}
