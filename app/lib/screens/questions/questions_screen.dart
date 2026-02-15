import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/auth_provider.dart';
import '../../providers/questions_provider.dart';
import '../../providers/selection_provider.dart';
import '../../services/haptic_service.dart';
import '../../widgets/animated_list_item.dart';
import '../../widgets/question_card.dart';
import '../../widgets/selectable_card.dart';
import '../../widgets/selection_action_bar.dart';
import '../../widgets/shimmer_card.dart';

void _log(String message) {
  debugPrint('[QuestionsScreen] $message');
}

class QuestionsScreen extends ConsumerWidget {
  const QuestionsScreen({super.key});

  Future<void> _archiveSelected(
    BuildContext context,
    WidgetRef ref,
    Set<String> selectedIds,
  ) async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Archive Questions?'),
        content: Text('Archive ${selectedIds.length} selected question(s)?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              HapticService.medium();
              Navigator.pop(context, true);
            },
            child: const Text('Archive'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      final service = ref.read(questionsServiceProvider);
      for (final id in selectedIds) {
        await service.archiveQuestion(userId: user.uid, questionId: id);
      }
      HapticService.success();
      ref.read(questionsSelectionProvider.notifier).exitSelectionMode();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Archived ${selectedIds.length} question(s)')),
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

  Future<void> _deleteSelected(
    BuildContext context,
    WidgetRef ref,
    Set<String> selectedIds,
  ) async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Questions?'),
        content: Text(
          'Delete ${selectedIds.length} selected question(s)? This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              HapticService.medium();
              Navigator.pop(context, true);
            },
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      final service = ref.read(questionsServiceProvider);
      for (final id in selectedIds) {
        await service.deleteQuestion(userId: user.uid, questionId: id);
      }
      HapticService.success();
      ref.read(questionsSelectionProvider.notifier).exitSelectionMode();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Deleted ${selectedIds.length} question(s)')),
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
    final questionsAsync = ref.watch(allQuestionsProvider);
    final selectionState = ref.watch(questionsSelectionProvider);
    _log('build: questionsAsync state = ${questionsAsync.isLoading ? "loading" : questionsAsync.hasError ? "error" : "data"}');

    return PopScope(
      canPop: !selectionState.isSelecting,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && selectionState.isSelecting) {
          ref.read(questionsSelectionProvider.notifier).exitSelectionMode();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: selectionState.isSelecting
              ? Text('${selectionState.selectedCount} selected')
              : const Text('Questions'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () {
              if (selectionState.isSelecting) {
                HapticService.light();
                ref.read(questionsSelectionProvider.notifier).exitSelectionMode();
              } else {
                context.go('/home');
              }
            },
          ),
          actions: [
            if (!selectionState.isSelecting)
              IconButton(
                icon: const Icon(Icons.checklist),
                onPressed: () {
                  HapticService.light();
                  ref.read(questionsSelectionProvider.notifier).enterSelectionMode();
                },
                tooltip: 'Select',
              )
            else
              // Select all button
              questionsAsync.whenOrNull(
                data: (questions) => IconButton(
                  icon: Icon(
                    selectionState.selectedCount == questions.length
                        ? Icons.deselect
                        : Icons.select_all,
                  ),
                  onPressed: () {
                    HapticService.light();
                    if (selectionState.selectedCount == questions.length) {
                      ref.read(questionsSelectionProvider.notifier).clearSelection();
                    } else {
                      ref.read(questionsSelectionProvider.notifier).selectAll(
                            questions.map((q) => q.id).toList(),
                          );
                    }
                  },
                  tooltip: selectionState.selectedCount == questions.length
                      ? 'Deselect All'
                      : 'Select All',
                ),
              ) ?? const SizedBox.shrink(),
          ],
        ),
        body: Column(
          children: [
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async {
                  ref.invalidate(allQuestionsProvider);
                },
                child: questionsAsync.when(
                  loading: () {
                    _log('Showing loading state');
                    return Padding(
                      padding: const EdgeInsets.all(16),
                      child: ShimmerList.questions(itemCount: 5),
                    );
                  },
                  error: (error, stack) {
                    _log('ERROR: $error');
                    _log('STACK: $stack');
                    return SingleChildScrollView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      child: SizedBox(
                        height: MediaQuery.of(context).size.height - 150,
                        child: Center(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Icon(Icons.error_outline, size: 48, color: Colors.red),
                                const SizedBox(height: 16),
                                const Text('Error loading questions', style: TextStyle(fontWeight: FontWeight.bold)),
                                const SizedBox(height: 8),
                                Text(
                                  error.toString().length > 300 ? '${error.toString().substring(0, 300)}...' : error.toString(),
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(fontSize: 12),
                                ),
                                const SizedBox(height: 16),
                                const Text('Pull down to retry', style: TextStyle(color: Colors.grey)),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                  data: (questions) {
                    if (questions.isEmpty) {
                      return SingleChildScrollView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        child: SizedBox(
                          height: MediaQuery.of(context).size.height - 150,
                          child: Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  Icons.inbox_outlined,
                                  size: 64,
                                  color: Theme.of(context).colorScheme.outline,
                                ),
                                const SizedBox(height: 16),
                                Text(
                                  'No questions yet',
                                  style: Theme.of(context).textTheme.titleMedium,
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'Questions from Claude Code will appear here',
                                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                                      ),
                                ),
                                const SizedBox(height: 16),
                                Text(
                                  'Pull down to refresh',
                                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                        color: Theme.of(context).colorScheme.outline,
                                      ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    }

                    return ListView.builder(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.all(16),
                      itemCount: questions.length,
                      itemBuilder: (context, index) {
                        final question = questions[index];
                        return AnimatedListItem(
                          index: index,
                          child: Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: SelectableCard(
                              isSelecting: selectionState.isSelecting,
                              isSelected: selectionState.isSelected(question.id),
                              onTap: () => context.push('/questions/${question.id}'),
                              onLongPress: () {
                                if (!selectionState.isSelecting) {
                                  ref.read(questionsSelectionProvider.notifier).enterSelectionMode();
                                }
                                ref.read(questionsSelectionProvider.notifier).toggleSelection(question.id);
                              },
                              onToggleSelection: () {
                                ref.read(questionsSelectionProvider.notifier).toggleSelection(question.id);
                              },
                              child: QuestionCard(
                                question: question,
                                handleTap: false, // SelectableCard handles tap
                              ),
                            ),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
            ),
            // Selection action bar
            if (selectionState.isSelecting && selectionState.hasSelection)
              SelectionActionBar(
                selectedCount: selectionState.selectedCount,
                onCancel: () {
                  ref.read(questionsSelectionProvider.notifier).exitSelectionMode();
                },
                actions: [
                  SelectionAction(
                    label: 'Archive',
                    icon: Icons.archive,
                    onPressed: () => _archiveSelected(
                      context,
                      ref,
                      selectionState.selectedIds,
                    ),
                  ),
                  SelectionAction(
                    label: 'Delete',
                    icon: Icons.delete,
                    isDestructive: true,
                    onPressed: () => _deleteSelected(
                      context,
                      ref,
                      selectionState.selectedIds,
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
