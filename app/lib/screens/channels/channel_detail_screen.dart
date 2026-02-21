import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/message_model.dart';
import '../../models/task_model.dart';
import '../../providers/channel_provider.dart';
import '../../providers/auth_provider.dart';
import '../../providers/questions_provider.dart';
import '../../providers/tasks_provider.dart';
import '../../theme/program_colors.dart';
import '../../widgets/channel_event_tile.dart';
import '../../widgets/session_pinned_card.dart';
import '../../widgets/inline_compose.dart';
import '../../widgets/program_avatar.dart';
import '../../services/haptic_service.dart';

class _DisplayItem {
  final MessageModel message; // The primary/first message
  final List<MessageModel> threadReplies; // Additional messages in same thread
  bool isExpanded;

  _DisplayItem({
    required this.message, 
    this.threadReplies = const [], 
    this.isExpanded = false,
  });

  bool get isThread => threadReplies.isNotEmpty;
  int get replyCount => threadReplies.length;
}

class ChannelDetailScreen extends ConsumerStatefulWidget {
  final String programId;

  const ChannelDetailScreen({
    super.key,
    required this.programId,
  });

  @override
  ConsumerState<ChannelDetailScreen> createState() => _ChannelDetailScreenState();
}

class _ChannelDetailScreenState extends ConsumerState<ChannelDetailScreen> {
  final Map<String, bool> _expandedThreads = {};

  List<_DisplayItem> _buildDisplayItems(List<MessageModel> messages) {
    final threadMap = <String, List<MessageModel>>{};
    final standalone = <MessageModel>[];

    for (final msg in messages) {
      if (msg.threadId != null) {
        threadMap.putIfAbsent(msg.threadId!, () => []).add(msg);
      } else {
        standalone.add(msg);
      }
    }

    final items = <_DisplayItem>[];

    // Add threads (sorted by earliest message)
    for (final entry in threadMap.entries) {
      final sorted = entry.value..sort((a, b) => a.createdAt.compareTo(b.createdAt));
      items.add(_DisplayItem(
        message: sorted.first,
        threadReplies: sorted.skip(1).toList(),
        isExpanded: _expandedThreads[entry.key] ?? false,
      ));
    }

    // Add standalone messages
    for (final msg in standalone) {
      items.add(_DisplayItem(message: msg));
    }

    // Sort all by primary message time
    items.sort((a, b) => a.message.createdAt.compareTo(b.message.createdAt));
    return items;
  }

  void _toggleThread(String threadId) {
    setState(() {
      _expandedThreads[threadId] = !(_expandedThreads[threadId] ?? false);
    });
    HapticService.light();
  }

  TaskAction _convertToTaskAction(MessageAction action) {
    switch (action) {
      case MessageAction.interrupt:
        return TaskAction.interrupt;
      case MessageAction.parallel:
        return TaskAction.parallel;
      case MessageAction.queue:
        return TaskAction.queue;
      case MessageAction.backlog:
        return TaskAction.backlog;
    }
  }

  Future<void> _handleQuickReply(MessageModel message, String reply) async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    HapticService.medium();

    try {
      await ref.read(questionsServiceProvider).answerQuestion(
        userId: user.uid,
        questionId: message.id,
        response: reply,
      );

      if (mounted) {
        HapticService.success();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Response sent!'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        HapticService.error();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  Future<void> _handleCompose(ComposePayload payload) async {
    final user = ref.read(currentUserProvider);
    if (user == null) return;

    HapticService.medium();

    try {
      // Auto-generate title from first line (max 50 chars)
      final firstLine = payload.content.split('\n').first;
      final title = firstLine.length > 50
          ? '${firstLine.substring(0, 47)}...'
          : firstLine;

      await ref.read(tasksServiceProvider).createTask(
        userId: user.uid,
        title: title,
        instructions: payload.content,
        action: _convertToTaskAction(payload.action),
        target: widget.programId,
        source: 'flynn',
      );

      if (mounted) {
        HapticService.success();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Message sent!'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        HapticService.error();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final channelAsync = ref.watch(channelDetailProvider(widget.programId));
    final meta = ProgramRegistry.get(widget.programId);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            HapticService.light();
            context.pop();
          },
        ),
        title: Row(
          children: [
            ProgramAvatar(
              programId: widget.programId,
              size: 28,
              showStatusDot: false,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    meta.displayName,
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  channelAsync.when(
                    data: (channel) => Text(
                      channel.hasActiveSession
                          ? channel.activeSession!.state.toUpperCase()
                          : 'Offline',
                      style: TextStyle(
                        fontSize: 11,
                        fontFamily: 'monospace',
                        color: channel.hasActiveSession
                            ? (channel.isBlocked ? const Color(0xFFFBBF24) : const Color(0xFF4ADE80))
                            : Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                    loading: () => const SizedBox.shrink(),
                    error: (_, __) => const SizedBox.shrink(),
                  ),
                ],
              ),
            ),
          ],
        ),
        centerTitle: false,
      ),
      body: channelAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(
          child: Text('Error: $error'),
        ),
        data: (channel) {
          final displayItems = _buildDisplayItems(channel.messages);

          return Column(
            children: [
              // Pinned session card (if active)
              if (channel.activeSession != null)
                SessionPinnedCard(
                  session: channel.activeSession!,
                  programId: widget.programId,
                  onTap: () {
                    HapticService.light();
                    context.push('/sessions/${channel.activeSession!.id}');
                  },
                ),

              // Event feed
              Expanded(
                child: displayItems.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            ProgramAvatar(programId: widget.programId, size: 64),
                            const SizedBox(height: 16),
                            Text(
                              'No messages with ${meta.displayName}',
                              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                                color: Theme.of(context).colorScheme.onSurfaceVariant,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Send a message to start a conversation',
                              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: Theme.of(context).colorScheme.onSurfaceVariant.withValues(alpha: 0.7),
                              ),
                            ),
                          ],
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.only(top: 8, bottom: 8),
                        reverse: true, // newest at bottom like a chat
                        itemCount: displayItems.length,
                        itemBuilder: (context, index) {
                          // Reverse index since ListView is reversed
                          final item = displayItems[displayItems.length - 1 - index];
                          
                          if (!item.isThread) {
                            // Standalone message
                            return ChannelEventTile(
                              message: item.message,
                              onQuickReply: (reply) => _handleQuickReply(item.message, reply),
                            );
                          }

                          // Thread group
                          return _ThreadGroup(
                            item: item,
                            onToggle: () => _toggleThread(item.message.threadId!),
                            onQuickReply: (message, reply) => _handleQuickReply(message, reply),
                          );
                        },
                      ),
              ),

              // Inline compose bar
              InlineCompose(
                targetProgramId: widget.programId,
                onSend: _handleCompose,
              ),
            ],
          );
        },
      ),
    );
  }
}

class _ThreadGroup extends StatelessWidget {
  final _DisplayItem item;
  final VoidCallback onToggle;
  final void Function(MessageModel, String) onQuickReply;

  const _ThreadGroup({
    required this.item,
    required this.onToggle,
    required this.onQuickReply,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // First message (always visible)
        ChannelEventTile(
          message: item.message,
          onQuickReply: (reply) => onQuickReply(item.message, reply),
        ),

        // Reply toggle
        if (item.replyCount > 0)
          InkWell(
            onTap: onToggle,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(56, 0, 16, 8),
              child: Row(
                children: [
                  Icon(
                    item.isExpanded 
                        ? Icons.keyboard_arrow_up 
                        : Icons.keyboard_arrow_down,
                    size: 16,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    item.isExpanded 
                        ? 'Hide ${item.replyCount} ${item.replyCount == 1 ? 'reply' : 'replies'}'
                        : '${item.replyCount} ${item.replyCount == 1 ? 'reply' : 'replies'}',
                    style: TextStyle(
                      fontSize: 12,
                      fontFamily: 'monospace',
                      color: Theme.of(context).colorScheme.primary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),

        // Thread replies (when expanded)
        if (item.isExpanded)
          Padding(
            padding: const EdgeInsets.only(left: 24),
            child: Container(
              decoration: BoxDecoration(
                border: Border(
                  left: BorderSide(
                    color: Theme.of(context).colorScheme.outlineVariant,
                    width: 2,
                  ),
                ),
              ),
              child: Column(
                children: item.threadReplies.map((reply) {
                  return ChannelEventTile(
                    message: reply,
                    onQuickReply: (replyText) => onQuickReply(reply, replyText),
                  );
                }).toList(),
              ),
            ),
          ),
      ],
    );
  }
}
