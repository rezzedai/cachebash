import 'package:flutter/material.dart';

import '../models/message_model.dart';
import '../services/haptic_service.dart';
import 'message_card.dart';

/// A group of related messages in a thread
class ThreadGroup {
  final String threadId;
  final List<MessageModel> messages;

  ThreadGroup({required this.threadId, required this.messages});

  MessageModel get latestMessage =>
      messages.reduce((a, b) => a.createdAt.isAfter(b.createdAt) ? a : b);

  MessageModel get threadStarter =>
      messages.firstWhere((m) => m.inReplyTo == null, orElse: () => messages.first);

  bool get hasMultipleMessages => messages.length > 1;
  int get messageCount => messages.length;
  int get replyCount => messages.length - 1;
}

/// Groups a flat list of messages by their threadId
/// Messages without a threadId become standalone "threads" of size 1
List<ThreadGroup> groupMessagesByThread(List<MessageModel> messages) {
  final Map<String, List<MessageModel>> groups = {};
  final List<MessageModel> standalone = [];

  for (final message in messages) {
    if (message.threadId != null) {
      groups.putIfAbsent(message.threadId!, () => []).add(message);
    } else {
      standalone.add(message);
    }
  }

  // Convert to ThreadGroups
  final result = <ThreadGroup>[];

  for (final entry in groups.entries) {
    // Sort messages within thread by createdAt ascending (oldest first)
    entry.value.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    result.add(ThreadGroup(threadId: entry.key, messages: entry.value));
  }

  // Add standalone messages as single-message threads
  for (final message in standalone) {
    result.add(ThreadGroup(threadId: message.id, messages: [message]));
  }

  // Sort threads by latest message timestamp (newest first)
  result.sort((a, b) => b.latestMessage.createdAt.compareTo(a.latestMessage.createdAt));

  return result;
}

/// Card widget for displaying a thread of related messages
/// Can be collapsed to show only the thread starter with reply count,
/// or expanded to show all messages
class ThreadCard extends StatefulWidget {
  final ThreadGroup thread;
  final void Function(MessageModel message)? onMessageTap;
  final void Function(MessageModel message)? onReply;
  final bool initiallyExpanded;
  final Map<String, String>? projectNameMap;

  const ThreadCard({
    super.key,
    required this.thread,
    this.onMessageTap,
    this.onReply,
    this.initiallyExpanded = false,
    this.projectNameMap,
  });

  @override
  State<ThreadCard> createState() => _ThreadCardState();
}

class _ThreadCardState extends State<ThreadCard> {
  late bool _isExpanded;

  @override
  void initState() {
    super.initState();
    _isExpanded = widget.initiallyExpanded;
  }

  void _toggleExpanded() {
    HapticService.light();
    setState(() => _isExpanded = !_isExpanded);
  }

  String? _getProjectName(MessageModel message) {
    if (message.projectId == null || widget.projectNameMap == null) return null;
    return widget.projectNameMap![message.projectId!];
  }

  @override
  Widget build(BuildContext context) {
    // Single message - just show the card
    if (!widget.thread.hasMultipleMessages) {
      final message = widget.thread.messages.first;
      return MessageCard(
        message: message,
        onTap: () => widget.onMessageTap?.call(message),
        projectName: _getProjectName(message),
      );
    }

    // Multiple messages - show collapsible thread
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Thread header (always visible)
          InkWell(
            onTap: _toggleExpanded,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Icon(
                    _isExpanded ? Icons.expand_less : Icons.expand_more,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.thread.threadStarter.displayTitle,
                          style: Theme.of(context).textTheme.titleSmall,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${widget.thread.replyCount} ${widget.thread.replyCount == 1 ? 'reply' : 'replies'}',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: Theme.of(context).colorScheme.primary,
                              ),
                        ),
                      ],
                    ),
                  ),
                  _buildThreadBadge(context),
                ],
              ),
            ),
          ),

          // Expanded content - all messages in thread
          if (_isExpanded) ...[
            const Divider(height: 1),
            ...widget.thread.messages.map((message) => _buildThreadMessage(context, message)),
          ],
        ],
      ),
    );
  }

  Widget _buildThreadBadge(BuildContext context) {
    // Show badge for pending replies
    final pendingCount = widget.thread.messages.where((m) => m.isPending && m.isToUser).length;
    if (pendingCount > 0) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.primaryContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          '$pendingCount pending',
          style: TextStyle(
            fontSize: 12,
            color: Theme.of(context).colorScheme.onPrimaryContainer,
          ),
        ),
      );
    }
    return const SizedBox.shrink();
  }

  Widget _buildThreadMessage(BuildContext context, MessageModel message) {
    final isReply = message.inReplyTo != null;

    return InkWell(
      onTap: () => widget.onMessageTap?.call(message),
      child: Padding(
        padding: EdgeInsets.only(
          left: isReply ? 32 : 16,
          right: 16,
          top: 8,
          bottom: 8,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Reply indicator
            if (isReply)
              Padding(
                padding: const EdgeInsets.only(right: 8, top: 4),
                child: Icon(
                  Icons.subdirectory_arrow_right,
                  size: 16,
                  color: Theme.of(context).colorScheme.outline,
                ),
              ),

            // Message content
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _buildDirectionBadge(context, message),
                      const SizedBox(width: 8),
                      _buildStatusBadge(context, message),
                      const Spacer(),
                      Text(
                        _formatTime(message.createdAt),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    message.content,
                    style: Theme.of(context).textTheme.bodyMedium,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (message.isAnswered && message.response != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      'Response: ${message.response}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Theme.of(context).colorScheme.primary,
                          ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDirectionBadge(BuildContext context, MessageModel message) {
    final isToUser = message.isToUser;
    final color = isToUser
        ? Theme.of(context).colorScheme.primary
        : Theme.of(context).colorScheme.secondary;
    final icon = isToUser ? Icons.help_outline : Icons.task_alt;

    return Icon(icon, size: 14, color: color);
  }

  Widget _buildStatusBadge(BuildContext context, MessageModel message) {
    final (color, label) = message.isToUser
        ? message.isPending
            ? (Colors.orange, 'Pending')
            : message.isAnswered
                ? (Colors.green, 'Answered')
                : (Colors.grey, 'Expired')
        : switch (message.status) {
            'pending' => (Colors.orange, 'Pending'),
            'in_progress' => (Colors.blue, 'In Progress'),
            'complete' => (Colors.green, 'Complete'),
            _ => (Colors.grey, message.status),
          };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withAlpha(30),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(label, style: TextStyle(fontSize: 10, color: color)),
    );
  }

  String _formatTime(DateTime time) {
    final now = DateTime.now();
    final diff = now.difference(time);

    if (diff.inMinutes < 1) {
      return 'now';
    } else if (diff.inMinutes < 60) {
      return '${diff.inMinutes}m';
    } else if (diff.inHours < 24) {
      return '${diff.inHours}h';
    } else {
      return '${diff.inDays}d';
    }
  }
}
