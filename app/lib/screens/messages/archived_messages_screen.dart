import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/message_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/messages_provider.dart';
import '../../services/haptic_service.dart';
import '../../widgets/message_card.dart';
import '../../widgets/task_detail_sheet.dart';

class ArchivedMessagesScreen extends ConsumerWidget {
  const ArchivedMessagesScreen({super.key});

  Future<void> _unarchiveMessage(
    BuildContext context,
    WidgetRef ref,
    String messageId,
  ) async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    try {
      await ref.read(messagesServiceProvider).unarchiveMessage(
            userId: user.uid,
            messageId: messageId,
          );
      HapticService.success();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Message restored')),
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

  Future<void> _deleteMessage(
    BuildContext context,
    WidgetRef ref,
    String messageId,
  ) async {
    final confirmed = await _showDeleteConfirmDialog(context);
    if (confirmed != true) return;
    await _deleteMessageDirect(context, ref, messageId);
  }

  Future<bool> _showDeleteConfirmDialog(BuildContext context) async {
    HapticService.heavy();
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Message?'),
        content: const Text(
          'This will permanently delete this message. This action cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              HapticService.medium();
              Navigator.pop(context, true);
            },
            style: TextButton.styleFrom(
              foregroundColor: Theme.of(context).colorScheme.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  Future<void> _deleteMessageDirect(
    BuildContext context,
    WidgetRef ref,
    String messageId,
  ) async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    try {
      await ref.read(messagesServiceProvider).deleteMessage(
            userId: user.uid,
            messageId: messageId,
          );
      HapticService.success();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Message deleted')),
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
      context.push('/questions/${message.id}');
    } else {
      // Show task detail in bottom sheet
      TaskDetailSheet.show(context, message);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final archivedMessages = ref.watch(archivedMessagesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Archived Messages'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            HapticService.light();
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/messages');
            }
          },
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(archivedMessagesProvider);
        },
        child: archivedMessages.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, stack) => ListView(
            children: [
              const SizedBox(height: 120),
              Center(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Icon(
                        Icons.error_outline,
                        size: 48,
                        color: Theme.of(context).colorScheme.error,
                      ),
                      const SizedBox(height: 16),
                      Text(
                        'Pull down to retry',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          data: (messages) {
            if (messages.isEmpty) {
              return ListView(
                children: [
                  const SizedBox(height: 120),
                  Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.archive,
                          size: 64,
                          color: Theme.of(context).colorScheme.outline,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'No archived messages',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Archived messages will appear here',
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                color:
                                    Theme.of(context).colorScheme.onSurfaceVariant,
                              ),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            }

            return ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: messages.length,
              itemBuilder: (context, index) {
                final message = messages[index];
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Dismissible(
                    key: Key('archived_${message.id}'),
                    direction: DismissDirection.horizontal,
                    dismissThresholds: const {
                      DismissDirection.endToStart: 0.4, // Delete
                      DismissDirection.startToEnd: 0.4, // Restore
                    },
                    confirmDismiss: (direction) async {
                      if (direction == DismissDirection.endToStart) {
                        // Delete requires confirmation
                        return await _showDeleteConfirmDialog(context);
                      }
                      // Restore proceeds without confirmation
                      return true;
                    },
                    onDismissed: (direction) {
                      if (direction == DismissDirection.endToStart) {
                        // Swipe left = Delete (already confirmed)
                        _deleteMessageDirect(context, ref, message.id);
                      } else if (direction == DismissDirection.startToEnd) {
                        // Swipe right = Restore
                        _unarchiveMessage(context, ref, message.id);
                      }
                    },
                    background: Container(
                      alignment: Alignment.centerLeft,
                      padding: const EdgeInsets.only(left: 24),
                      decoration: BoxDecoration(
                        color: Colors.green,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(Icons.unarchive, color: Colors.white),
                    ),
                    secondaryBackground: Container(
                      alignment: Alignment.centerRight,
                      padding: const EdgeInsets.only(right: 24),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.error,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(Icons.delete, color: Colors.white),
                    ),
                    child: MessageCard(
                      message: message,
                      onTap: () => _navigateToMessage(context, message),
                      onLongPress: () => MessageCard.showContextMenu(
                        context,
                        isArchived: true,
                        onArchive: () => _unarchiveMessage(context, ref, message.id),
                        onDelete: () => _deleteMessage(context, ref, message.id),
                      ),
                    ),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
