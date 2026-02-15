import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/dream_session_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/dream_sessions_provider.dart';
import '../../services/haptic_service.dart';

class DreamDetailScreen extends ConsumerWidget {
  final String dreamId;

  const DreamDetailScreen({super.key, required this.dreamId});

  Future<void> _killDream(
      BuildContext context, WidgetRef ref, DreamSessionModel dream) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Stop Dream?'),
        content: Text(
            'This will kill the ${dream.agent} dream session. This cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Stop Dream'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    final user = ref.read(currentUserProvider);
    if (user == null) return;

    try {
      await ref.read(dreamSessionsServiceProvider).killDreamSession(
            userId: user.uid,
            dreamId: dream.id,
          );
      HapticService.success();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Dream session stopped')),
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
    final dreamAsync = ref.watch(dreamSessionProvider(dreamId));
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/home');
            }
          },
        ),
        title: const Text('Dream Session'),
      ),
      body: dreamAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(
          child: Text('Error: $error'),
        ),
        data: (dream) {
          if (dream == null) {
            return const Center(child: Text('Dream session not found'));
          }

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Status badge + agent
                Row(
                  children: [
                    _buildStatusBadge(context, dream),
                    const SizedBox(width: 12),
                    Text(
                      dream.agent,
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 16),

                // Info card
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        _infoRow(context, 'Status', dream.statusDisplay),
                        _infoRow(context, 'Branch', dream.branch),
                        _infoRow(context, 'Elapsed', dream.elapsedFormatted),
                        if (dream.prUrl != null)
                          _infoRow(context, 'PR', dream.prUrl!),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 16),

                // Budget bar
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text('Budget', style: theme.textTheme.titleSmall),
                            Text(
                              '\$${dream.budgetConsumedUsd.toStringAsFixed(2)} / \$${dream.budgetCapUsd.toStringAsFixed(2)}',
                              style: theme.textTheme.bodyMedium,
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        LinearProgressIndicator(
                          value: dream.budgetCapUsd > 0
                              ? (dream.budgetConsumedUsd / dream.budgetCapUsd)
                                  .clamp(0.0, 1.0)
                              : 0,
                          backgroundColor:
                              theme.colorScheme.surfaceContainerHighest,
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 16),

                // Kill button (only when running)
                if (dream.isRunning)
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: theme.colorScheme.error,
                        foregroundColor: theme.colorScheme.onError,
                      ),
                      onPressed: () => _killDream(context, ref, dream),
                      icon: const Icon(Icons.stop),
                      label: const Text('Stop Dream'),
                    ),
                  ),

                // Morning report (when completed)
                if (dream.isCompleted && dream.morningReport != null) ...[
                  const SizedBox(height: 24),
                  Text('Morning Report', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: SelectableText(
                        dream.morningReport!,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontFamily: 'monospace',
                        ),
                      ),
                    ),
                  ),
                ],

                // Outcome (when failed)
                if (dream.isFailed && dream.outcome != null) ...[
                  const SizedBox(height: 24),
                  Text('Outcome', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Card(
                    color: theme.colorScheme.errorContainer,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                        dream.outcome!,
                        style: TextStyle(
                          color: theme.colorScheme.onErrorContainer,
                        ),
                      ),
                    ),
                  ),
                ],

                const SizedBox(height: 32),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildStatusBadge(BuildContext context, DreamSessionModel dream) {
    Color color;
    IconData icon;

    switch (dream.status) {
      case 'pending':
        color = Colors.orange;
        icon = Icons.hourglass_top;
        break;
      case 'active':
        color = Colors.green;
        icon = Icons.nightlight_round;
        break;
      case 'completed':
        color = Colors.blue;
        icon = Icons.check_circle;
        break;
      case 'failed':
        color = Colors.red;
        icon = Icons.error;
        break;
      case 'killed':
        color = Colors.grey;
        icon = Icons.stop_circle;
        break;
      default:
        color = Colors.grey;
        icon = Icons.circle;
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
            dream.statusDisplay,
            style: TextStyle(color: color, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }

  Widget _infoRow(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(
              label,
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }
}
