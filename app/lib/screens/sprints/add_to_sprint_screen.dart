import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/auth_provider.dart';
import '../../providers/sprints_provider.dart';
import '../../services/haptic_service.dart';

class AddToSprintScreen extends ConsumerStatefulWidget {
  final String sprintId;

  const AddToSprintScreen({super.key, required this.sprintId});

  @override
  ConsumerState<AddToSprintScreen> createState() => _AddToSprintScreenState();
}

class _AddToSprintScreenState extends ConsumerState<AddToSprintScreen> {
  final _formKey = GlobalKey<FormState>();
  final _idController = TextEditingController();
  final _titleController = TextEditingController();
  String _insertionMode = 'next_wave';
  String _complexity = 'normal';
  bool _isSubmitting = false;

  @override
  void dispose() {
    _idController.dispose();
    _titleController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    final user = ref.read(currentUserProvider);
    if (user == null) return;

    setState(() => _isSubmitting = true);
    HapticService.medium();

    try {
      await ref.read(sprintsServiceProvider).addStory(
            userId: user.uid,
            sprintId: widget.sprintId,
            storyId: _idController.text.trim(),
            title: _titleController.text.trim(),
            insertionMode: _insertionMode,
            complexity: _complexity,
          );

      if (mounted) {
        HapticService.success();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Story added to sprint')),
        );
        context.pop();
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
    return Scaffold(
      appBar: AppBar(
        title: const Text('Add Story'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () {
            HapticService.light();
            context.pop();
          },
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Story ID
              TextFormField(
                controller: _idController,
                decoration: const InputDecoration(
                  labelText: 'Story ID',
                  hintText: 'e.g., US-007',
                  prefixIcon: Icon(Icons.tag),
                ),
                textCapitalization: TextCapitalization.characters,
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Story ID is required';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),

              // Title
              TextFormField(
                controller: _titleController,
                decoration: const InputDecoration(
                  labelText: 'Title',
                  hintText: 'Brief description of the story',
                  prefixIcon: Icon(Icons.title),
                ),
                maxLength: 200,
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Title is required';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 24),

              // Insertion Mode
              Text(
                'When to Execute',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: Theme.of(context).colorScheme.primary,
                    ),
              ),
              const SizedBox(height: 8),
              _buildInsertionOption(
                'current_wave',
                'Current Wave',
                'Add to the current wave (may start immediately)',
                Icons.flash_on,
              ),
              _buildInsertionOption(
                'next_wave',
                'Next Wave',
                'Add to the next wave (after current wave completes)',
                Icons.arrow_forward,
              ),
              _buildInsertionOption(
                'backlog',
                'Backlog',
                'Add to backlog (lowest priority)',
                Icons.low_priority,
              ),
              const SizedBox(height: 24),

              // Complexity
              Text(
                'Complexity',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: Theme.of(context).colorScheme.primary,
                    ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: _buildComplexityOption(
                      'normal',
                      'Normal',
                      'Use Sonnet',
                      Icons.speed,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _buildComplexityOption(
                      'high',
                      'High',
                      'Use Opus',
                      Icons.psychology,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 32),

              // Submit button
              FilledButton(
                onPressed: _isSubmitting ? null : _submit,
                style: FilledButton.styleFrom(
                  minimumSize: const Size(double.infinity, 56),
                ),
                child: _isSubmitting
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Add Story'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInsertionOption(
    String value,
    String title,
    String description,
    IconData icon,
  ) {
    final isSelected = _insertionMode == value;
    return GestureDetector(
      onTap: () {
        HapticService.light();
        setState(() => _insertionMode = value);
      },
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isSelected
              ? Theme.of(context).colorScheme.primaryContainer
              : Theme.of(context).colorScheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected
                ? Theme.of(context).colorScheme.primary
                : Colors.transparent,
            width: 2,
          ),
        ),
        child: Row(
          children: [
            Icon(
              icon,
              color: isSelected
                  ? Theme.of(context).colorScheme.onPrimaryContainer
                  : Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                          fontWeight: FontWeight.w500,
                          color: isSelected
                              ? Theme.of(context).colorScheme.onPrimaryContainer
                              : null,
                        ),
                  ),
                  Text(
                    description,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: isSelected
                              ? Theme.of(context)
                                  .colorScheme
                                  .onPrimaryContainer
                                  .withAlpha(179)
                              : Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                  ),
                ],
              ),
            ),
            if (isSelected)
              Icon(
                Icons.check_circle,
                color: Theme.of(context).colorScheme.primary,
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildComplexityOption(
    String value,
    String title,
    String subtitle,
    IconData icon,
  ) {
    final isSelected = _complexity == value;
    return GestureDetector(
      onTap: () {
        HapticService.light();
        setState(() => _complexity = value);
      },
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isSelected
              ? Theme.of(context).colorScheme.primaryContainer
              : Theme.of(context).colorScheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected
                ? Theme.of(context).colorScheme.primary
                : Colors.transparent,
            width: 2,
          ),
        ),
        child: Column(
          children: [
            Icon(
              icon,
              size: 32,
              color: isSelected
                  ? Theme.of(context).colorScheme.onPrimaryContainer
                  : Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 8),
            Text(
              title,
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    fontWeight: FontWeight.w500,
                    color: isSelected
                        ? Theme.of(context).colorScheme.onPrimaryContainer
                        : null,
                  ),
            ),
            Text(
              subtitle,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: isSelected
                        ? Theme.of(context)
                            .colorScheme
                            .onPrimaryContainer
                            .withAlpha(179)
                        : Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}
