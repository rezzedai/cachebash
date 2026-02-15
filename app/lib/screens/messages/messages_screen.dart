import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/message_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/messages_provider.dart' hide ThreadGroup, groupMessagesByThread;
import '../../providers/projects_provider.dart';
import '../../providers/selection_provider.dart';
import '../../services/haptic_service.dart';
import '../../widgets/animated_list_item.dart';
import '../../widgets/selectable_card.dart';
import '../../widgets/thread_card.dart';
import '../../widgets/selection_action_bar.dart';
import '../../widgets/shimmer_card.dart';
import '../../widgets/task_detail_sheet.dart';

void _log(String message) {
  debugPrint('[MessagesScreen] $message');
}

class MessagesScreen extends ConsumerWidget {
  const MessagesScreen({super.key});

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
        title: const Text('Archive Messages?'),
        content: Text('Archive ${selectedIds.length} selected message(s)?'),
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
      final service = ref.read(messagesServiceProvider);
      for (final id in selectedIds) {
        await service.archiveMessage(userId: user.uid, messageId: id);
      }
      HapticService.success();
      ref.read(messagesSelectionProvider.notifier).exitSelectionMode();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Archived ${selectedIds.length} message(s)')),
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
        title: const Text('Delete Messages?'),
        content: Text(
          'Delete ${selectedIds.length} selected message(s)? This cannot be undone.',
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
      final service = ref.read(messagesServiceProvider);
      for (final id in selectedIds) {
        await service.deleteMessage(userId: user.uid, messageId: id);
      }
      HapticService.success();
      ref.read(messagesSelectionProvider.notifier).exitSelectionMode();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Deleted ${selectedIds.length} message(s)')),
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

  void _navigateToMessage(BuildContext context, MessageModel message) {
    HapticService.light();
    if (message.isToUser) {
      // Push to question detail to maintain navigation stack
      context.push('/questions/${message.id}');
    } else {
      // Show task detail in bottom sheet
      TaskDetailSheet.show(context, message);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final messagesAsync = ref.watch(activeMessagesProvider);
    final selectionState = ref.watch(messagesSelectionProvider);
    final projectNameMap = ref.watch(projectNameMapProvider);
    _log('build: messagesAsync state = ${messagesAsync.isLoading ? "loading" : messagesAsync.hasError ? "error" : "data"}');

    return PopScope(
      canPop: !selectionState.isSelecting,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && selectionState.isSelecting) {
          ref.read(messagesSelectionProvider.notifier).exitSelectionMode();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: selectionState.isSelecting
              ? Text('${selectionState.selectedCount} selected')
              : const Text('Messages'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () {
              if (selectionState.isSelecting) {
                HapticService.light();
                ref.read(messagesSelectionProvider.notifier).exitSelectionMode();
              } else {
                context.go('/home');
              }
            },
          ),
          actions: [
            if (!selectionState.isSelecting) ...[
              IconButton(
                icon: const Icon(Icons.checklist),
                onPressed: () {
                  HapticService.light();
                  ref.read(messagesSelectionProvider.notifier).enterSelectionMode();
                },
                tooltip: 'Select',
              ),
              IconButton(
                icon: const Icon(Icons.archive),
                onPressed: () {
                  HapticService.light();
                  context.go('/messages/archived');
                },
                tooltip: 'Archived',
              ),
            ] else
              // Select all button
              messagesAsync.whenOrNull(
                data: (messages) => IconButton(
                  icon: Icon(
                    selectionState.selectedCount == messages.length
                        ? Icons.deselect
                        : Icons.select_all,
                  ),
                  onPressed: () {
                    HapticService.light();
                    if (selectionState.selectedCount == messages.length) {
                      ref.read(messagesSelectionProvider.notifier).clearSelection();
                    } else {
                      ref.read(messagesSelectionProvider.notifier).selectAll(
                            messages.map((m) => m.id).toList(),
                          );
                    }
                  },
                  tooltip: selectionState.selectedCount == messages.length
                      ? 'Deselect All'
                      : 'Select All',
                ),
              ) ?? const SizedBox.shrink(),
          ],
        ),
        floatingActionButton: null,
        body: Column(
          children: [
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async {
                  ref.invalidate(activeMessagesProvider);
                },
                child: messagesAsync.when(
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
                                const Text('Error loading messages', style: TextStyle(fontWeight: FontWeight.bold)),
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
                  data: (messages) {
                    if (messages.isEmpty) {
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
                                  'No messages yet',
                                  style: Theme.of(context).textTheme.titleMedium,
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'Questions and tasks will appear here',
                                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                                      ),
                                ),
                                const SizedBox(height: 24),
                                FilledButton.icon(
                                  onPressed: () {
                                    HapticService.light();
                                    context.push('/messages/new');
                                  },
                                  icon: const Icon(Icons.add),
                                  label: const Text('Create Task'),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    }

                    // Group messages into threads
                    final threads = groupMessagesByThread(messages);

                    // Categorize threads by their most urgent status
                    bool threadHasPendingQuestion(ThreadGroup t) =>
                        t.messages.any((m) => m.isToUser && m.isPending);
                    bool threadHasPendingTask(ThreadGroup t) =>
                        t.messages.any((m) => m.isToClaude && m.isPending);
                    bool threadIsAnswered(ThreadGroup t) =>
                        t.messages.every((m) => !m.isPending) &&
                        t.messages.any((m) => m.isToUser && m.isAnswered);
                    bool threadIsCompleted(ThreadGroup t) =>
                        t.messages.every((m) => !m.isPending) &&
                        t.messages.any((m) => m.isToClaude && m.isComplete);

                    final pendingQuestionThreads = threads.where(threadHasPendingQuestion).toList();
                    final pendingTaskThreads = threads.where((t) =>
                        !threadHasPendingQuestion(t) && threadHasPendingTask(t)).toList();
                    final answeredThreads = threads.where((t) =>
                        !threadHasPendingQuestion(t) && !threadHasPendingTask(t) && threadIsAnswered(t)).toList();
                    final completedThreads = threads.where((t) =>
                        !threadHasPendingQuestion(t) && !threadHasPendingTask(t) && !threadIsAnswered(t) && threadIsCompleted(t)).toList();

                    final categorizedIds = {
                      ...pendingQuestionThreads.map((t) => t.threadId),
                      ...pendingTaskThreads.map((t) => t.threadId),
                      ...answeredThreads.map((t) => t.threadId),
                      ...completedThreads.map((t) => t.threadId),
                    };
                    final otherThreads = threads.where((t) => !categorizedIds.contains(t.threadId)).toList();

                    int animationIndex = 0;

                    Widget buildThreadItem(ThreadGroup thread) {
                      final threadMessageIds = thread.messages.map((m) => m.id).toList();
                      final isThreadSelected = threadMessageIds.every(
                        (id) => selectionState.isSelected(id),
                      );

                      return AnimatedListItem(
                        index: animationIndex++,
                        child: Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: SelectableCard(
                            isSelecting: selectionState.isSelecting,
                            isSelected: isThreadSelected,
                            onTap: () {
                              // When not selecting, tap the first message
                              if (thread.messages.isNotEmpty) {
                                _navigateToMessage(context, thread.messages.first);
                              }
                            },
                            onLongPress: () {
                              if (!selectionState.isSelecting) {
                                ref.read(messagesSelectionProvider.notifier).enterSelectionMode();
                              }
                              // Toggle all messages in this thread
                              final notifier = ref.read(messagesSelectionProvider.notifier);
                              if (isThreadSelected) {
                                for (final id in threadMessageIds) {
                                  notifier.toggleSelection(id);
                                }
                              } else {
                                for (final id in threadMessageIds) {
                                  if (!selectionState.isSelected(id)) {
                                    notifier.toggleSelection(id);
                                  }
                                }
                              }
                            },
                            onToggleSelection: () {
                              // Toggle all messages in this thread
                              final notifier = ref.read(messagesSelectionProvider.notifier);
                              if (isThreadSelected) {
                                for (final id in threadMessageIds) {
                                  notifier.toggleSelection(id);
                                }
                              } else {
                                for (final id in threadMessageIds) {
                                  if (!selectionState.isSelected(id)) {
                                    notifier.toggleSelection(id);
                                  }
                                }
                              }
                            },
                            child: ThreadCard(
                              thread: thread,
                              onMessageTap: (message) => _navigateToMessage(context, message),
                              projectNameMap: projectNameMap,
                            ),
                          ),
                        ),
                      );
                    }

                    return ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.all(16),
                      children: [
                        // Pending Questions (needs response)
                        if (pendingQuestionThreads.isNotEmpty) ...[
                          AnimatedListItem(
                            index: animationIndex++,
                            child: _buildSectionHeader(context, 'Needs Response', Icons.help_outline),
                          ),
                          const SizedBox(height: 12),
                          ...pendingQuestionThreads.map(buildThreadItem),
                          const SizedBox(height: 16),
                        ],

                        // Pending Tasks (awaiting Claude)
                        if (pendingTaskThreads.isNotEmpty) ...[
                          AnimatedListItem(
                            index: animationIndex++,
                            child: _buildSectionHeader(context, 'Awaiting Claude', Icons.hourglass_empty),
                          ),
                          const SizedBox(height: 12),
                          ...pendingTaskThreads.map(buildThreadItem),
                          const SizedBox(height: 16),
                        ],

                        // Answered Questions
                        if (answeredThreads.isNotEmpty) ...[
                          AnimatedListItem(
                            index: animationIndex++,
                            child: _buildSectionHeader(context, 'Answered', Icons.check_circle_outline),
                          ),
                          const SizedBox(height: 12),
                          ...answeredThreads.take(5).map(buildThreadItem),
                          const SizedBox(height: 16),
                        ],

                        // Completed Tasks
                        if (completedThreads.isNotEmpty) ...[
                          AnimatedListItem(
                            index: animationIndex++,
                            child: _buildSectionHeader(context, 'Completed', Icons.task_alt),
                          ),
                          const SizedBox(height: 12),
                          ...completedThreads.take(5).map(buildThreadItem),
                          const SizedBox(height: 16),
                        ],

                        // Other threads (expired, cancelled, etc.)
                        if (otherThreads.isNotEmpty) ...[
                          AnimatedListItem(
                            index: animationIndex++,
                            child: _buildSectionHeader(context, 'Other', Icons.more_horiz),
                          ),
                          const SizedBox(height: 12),
                          ...otherThreads.take(5).map(buildThreadItem),
                        ],

                        const SizedBox(height: 80), // Space for FAB
                      ],
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
                  ref.read(messagesSelectionProvider.notifier).exitSelectionMode();
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

  Widget _buildSectionHeader(BuildContext context, String title, IconData icon) {
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
      ],
    );
  }
}
