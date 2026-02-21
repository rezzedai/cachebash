import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/message_model.dart';
import '../models/task_model.dart';
import '../providers/auth_provider.dart';
import '../providers/tasks_provider.dart';
import '../services/haptic_service.dart';

/// Bottom sheet for creating a reply to an existing message
/// Creates a new message linked via threadId and inReplyTo
class ReplySheet extends ConsumerStatefulWidget {
  final MessageModel parentMessage;

  const ReplySheet({super.key, required this.parentMessage});

  /// Show the reply sheet as a modal bottom sheet
  static Future<void> show(BuildContext context, MessageModel parentMessage) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: ReplySheet(parentMessage: parentMessage),
      ),
    );
  }

  @override
  ConsumerState<ReplySheet> createState() => _ReplySheetState();
}

class _ReplySheetState extends ConsumerState<ReplySheet> {
  final _titleController = TextEditingController();
  final _instructionsController = TextEditingController();
  bool _isSubmitting = false;
  TaskAction _selectedAction = TaskAction.queue;
  String _selectedPriority = 'normal';

  @override
  void dispose() {
    _titleController.dispose();
    _instructionsController.dispose();
    super.dispose();
  }

  Future<void> _submitReply() async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    final instructions = _instructionsController.text.trim();
    if (instructions.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter your message')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      // Determine threadId - use parent's threadId if it exists, otherwise parent's id
      final threadId = widget.parentMessage.threadId ?? widget.parentMessage.id;

      await ref.read(tasksServiceProvider).createTask(
            userId: user.uid,
            title: _titleController.text.trim().isEmpty
                ? 'Reply'
                : _titleController.text.trim(),
            instructions: instructions,
            action: _selectedAction,
            priority: _selectedPriority,
            threadId: threadId,
            inReplyTo: widget.parentMessage.id,
          );

      if (mounted) {
        HapticService.success();
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Reply sent!')),
        );
      }
    } catch (e) {
      if (mounted) {
        HapticService.error();
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
    return SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Handle
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.outline,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Title
            Text(
              'Reply to message',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),

            // Parent message preview
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerLow,
                borderRadius: BorderRadius.circular(8),
                border: Border(
                  left: BorderSide(
                    color: Theme.of(context).colorScheme.primary,
                    width: 3,
                  ),
                ),
              ),
              child: Text(
                widget.parentMessage.content,
                style: Theme.of(context).textTheme.bodySmall,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(height: 24),

            // Title field (optional)
            TextField(
              controller: _titleController,
              decoration: const InputDecoration(
                labelText: 'Title (optional)',
                hintText: 'Brief title for your reply',
                border: OutlineInputBorder(),
              ),
              maxLength: 100,
            ),
            const SizedBox(height: 16),

            // Instructions field
            TextField(
              controller: _instructionsController,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Your message',
                hintText: 'What would you like the agent to do?',
                border: OutlineInputBorder(),
              ),
              maxLength: 2000,
            ),
            const SizedBox(height: 16),

            // Action level selector
            Text(
              'When should the agent handle this?',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: TaskAction.values.map((action) {
                final isSelected = _selectedAction == action;
                return ChoiceChip(
                  label: Text(action.displayName),
                  selected: isSelected,
                  onSelected: (selected) {
                    if (selected) {
                      HapticService.selection();
                      setState(() => _selectedAction = action);
                    }
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 16),

            // Priority selector
            Text(
              'Priority',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: ['low', 'normal', 'high'].map((priority) {
                final isSelected = _selectedPriority == priority;
                return ChoiceChip(
                  label: Text(priority[0].toUpperCase() + priority.substring(1)),
                  selected: isSelected,
                  onSelected: (selected) {
                    if (selected) {
                      HapticService.selection();
                      setState(() => _selectedPriority = priority);
                    }
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 24),

            // Submit button
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _isSubmitting
                    ? null
                    : () {
                        HapticService.medium();
                        _submitReply();
                      },
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: _isSubmitting
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Send Reply'),
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}
