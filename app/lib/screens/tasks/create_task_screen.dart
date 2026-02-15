import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/task_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/tasks_provider.dart';
import '../../services/haptic_service.dart';

class CreateTaskScreen extends ConsumerStatefulWidget {
  const CreateTaskScreen({super.key});

  @override
  ConsumerState<CreateTaskScreen> createState() => _CreateTaskScreenState();
}

class _CreateTaskScreenState extends ConsumerState<CreateTaskScreen> {
  final _instructionsController = TextEditingController();
  TaskAction _action = TaskAction.queue;
  String? _selectedTarget;
  bool _isSubmitting = false;

  static const _programs = [
    'Any', 'basher', 'iso', 'alan', 'sark', 'able', 'beck', 'quorra', 'radia', 'casp', 'clu',
  ];

  @override
  void dispose() {
    _instructionsController.dispose();
    super.dispose();
  }

  IconData _getIconForAction(TaskAction action) {
    switch (action) {
      case TaskAction.interrupt:
        return Icons.bolt;
      case TaskAction.parallel:
        return Icons.call_split;
      case TaskAction.queue:
        return Icons.playlist_play;
      case TaskAction.backlog:
        return Icons.inventory_2_outlined;
    }
  }

  Future<void> _submitTask() async {
    final instructions = _instructionsController.text.trim();

    if (instructions.isEmpty) {
      HapticService.error();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a message')),
      );
      return;
    }

    // Auto-generate title from first line (max 50 chars)
    final firstLine = instructions.split('\n').first;
    final title = firstLine.length > 50
        ? '${firstLine.substring(0, 47)}...'
        : firstLine;

    final user = ref.read(currentUserProvider);
    if (user == null) return;

    setState(() => _isSubmitting = true);
    HapticService.medium();

    try {
      await ref.read(tasksServiceProvider).createTask(
            userId: user.uid,
            title: title,
            instructions: instructions,
            action: _action,
            target: _selectedTarget,
            source: 'flynn',
          );

      HapticService.success();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Message sent!')),
        );
        context.go('/tasks');
      }
    } catch (e) {
      HapticService.error();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Message Claude'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () {
            HapticService.light();
            context.pop();
          },
        ),
        actions: [
          TextButton(
            onPressed: _isSubmitting ? null : _submitTask,
            child: _isSubmitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Send'),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Action flags at top
            SizedBox(
              width: double.infinity,
              child: SegmentedButton<TaskAction>(
                segments: TaskAction.values.map((action) {
                  return ButtonSegment(
                    value: action,
                    icon: Icon(_getIconForAction(action)),
                  );
                }).toList(),
                selected: {_action},
                onSelectionChanged: (value) {
                  HapticService.selection();
                  setState(() => _action = value.first);
                },
                showSelectedIcon: false,
                expandedInsets: EdgeInsets.zero,
              ),
            ),
            const SizedBox(height: 8),
            // Description of selected action
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerLow,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(
                    _getIconForAction(_action),
                    size: 16,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    _action.displayName,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: Theme.of(context).colorScheme.primary,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '— ${_action.description}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Target program picker
            Text(
              'Target',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                  ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _programs.map((program) {
                final isAny = program == 'Any';
                final isSelected = isAny ? _selectedTarget == null : _selectedTarget == program;
                return ChoiceChip(
                  label: Text(program),
                  selected: isSelected,
                  onSelected: (_) {
                    HapticService.selection();
                    setState(() => _selectedTarget = isAny ? null : program);
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 24),

            // Instructions (title removed - first line serves as summary)
            Text(
              'Instructions',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                  ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _instructionsController,
              decoration: const InputDecoration(
                hintText:
                    'Detailed instructions for Claude...\n\nYou can use markdown formatting.',
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
              maxLines: 12,
              minLines: 6,
              textCapitalization: TextCapitalization.sentences,
            ),
            const SizedBox(height: 16),

            // Markdown tip
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerLow,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.code,
                    size: 16,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Tip: Use markdown for code blocks, lists, and formatting',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color:
                                Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
