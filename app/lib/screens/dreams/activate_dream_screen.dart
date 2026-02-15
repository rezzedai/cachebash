import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/auth_provider.dart';
import '../../providers/dream_sessions_provider.dart';
import '../../services/haptic_service.dart';

class ActivateDreamScreen extends ConsumerStatefulWidget {
  const ActivateDreamScreen({super.key});

  @override
  ConsumerState<ActivateDreamScreen> createState() =>
      _ActivateDreamScreenState();
}

class _ActivateDreamScreenState extends ConsumerState<ActivateDreamScreen> {
  String _selectedAgent = 'basher';
  double _budgetCap = 5.0;
  final _taskController = TextEditingController();
  bool _isSubmitting = false;

  static const _agents = [
    'basher',
    'sark',
    'able',
    'beck',
    'alan',
    'quorra',
    'radia',
  ];

  static const _budgetOptions = [1.0, 2.0, 5.0, 10.0];

  @override
  void dispose() {
    _taskController.dispose();
    super.dispose();
  }

  Future<void> _startDream() async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    setState(() => _isSubmitting = true);

    try {
      final dreamId =
          await ref.read(dreamSessionsServiceProvider).createDreamSession(
                userId: user.uid,
                agent: _selectedAgent,
                taskId: _taskController.text.trim().isNotEmpty
                    ? _taskController.text.trim()
                    : null,
                budgetCapUsd: _budgetCap,
              );

      if (mounted) {
        HapticService.success();
        context.push('/dreams/$dreamId');
      }
    } catch (e) {
      HapticService.error();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Start Dream'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => context.pop(),
        ),
        actions: [
          TextButton(
            onPressed: _isSubmitting ? null : _startDream,
            child: _isSubmitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Start'),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Agent picker
            Text('Agent', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _agents.map((agent) {
                final isSelected = agent == _selectedAgent;
                return ChoiceChip(
                  label: Text(agent),
                  selected: isSelected,
                  onSelected: (_) {
                    HapticService.light();
                    setState(() => _selectedAgent = agent);
                  },
                );
              }).toList(),
            ),

            const SizedBox(height: 24),

            // Task description
            Text('Task', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            TextField(
              controller: _taskController,
              decoration: const InputDecoration(
                hintText: 'Describe the task (optional)',
                border: OutlineInputBorder(),
              ),
              maxLines: 3,
            ),

            const SizedBox(height: 24),

            // Budget cap
            Text('Budget Cap', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            SegmentedButton<double>(
              segments: _budgetOptions
                  .map((b) => ButtonSegment(
                        value: b,
                        label: Text('\$${b.toStringAsFixed(0)}'),
                      ))
                  .toList(),
              selected: {_budgetCap},
              onSelectionChanged: (values) {
                HapticService.light();
                setState(() => _budgetCap = values.first);
              },
            ),

            const SizedBox(height: 32),

            // Summary card
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Summary', style: theme.textTheme.titleSmall),
                    const SizedBox(height: 8),
                    _summaryRow('Agent', _selectedAgent),
                    _summaryRow(
                      'Budget',
                      '\$${_budgetCap.toStringAsFixed(2)}',
                    ),
                    _summaryRow('Timeout', '4 hours'),
                    _summaryRow(
                      'Branch',
                      'dream/${DateTime.now().toString().substring(0, 10)}/${_taskController.text.trim().isNotEmpty ? _taskController.text.trim().split(' ').first.toLowerCase() : 'task'}',
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _summaryRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}
