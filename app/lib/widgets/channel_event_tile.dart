import 'package:flutter/material.dart';

import '../models/message_model.dart';
import '../services/haptic_service.dart';

/// Renders a single event in a channel's chronological feed
class ChannelEventTile extends StatelessWidget {
  final MessageModel message;
  final VoidCallback? onTap;
  final ValueChanged<String>? onQuickReply;

  const ChannelEventTile({
    super.key,
    required this.message,
    this.onTap,
    this.onQuickReply,
  });

  Color _typeColor() {
    // Alert colors
    if (message.isAlert) {
      switch (message.alertType) {
        case AlertType.error:
          return const Color(0xFFEF4444);
        case AlertType.warning:
          return const Color(0xFFFBBF24);
        case AlertType.success:
          return const Color(0xFF4ADE80);
        default:
          return const Color(0xFF38BDF8);
      }
    }

    // Task/message direction
    if (message.isToClaude) {
      if (message.isInterrupt) return const Color(0xFFEF4444);
      return const Color(0xFF7B68EE); // purple for outgoing tasks
    }

    // Question needing response
    if (message.needsResponse) return const Color(0xFFFBBF24);

    // Default incoming
    return const Color(0xFF4ECDC4);
  }

  String _typeLabel() {
    if (message.isAlert) return message.alertType?.displayName ?? 'Alert';
    if (message.isToClaude) return message.action?.displayName ?? 'Task';
    if (message.isQuestion) return 'Question';
    return 'Message';
  }

  IconData _typeIcon() {
    if (message.isAlert) {
      switch (message.alertType) {
        case AlertType.error:
          return Icons.error_outline;
        case AlertType.warning:
          return Icons.warning_amber_outlined;
        case AlertType.success:
          return Icons.check_circle_outline;
        default:
          return Icons.info_outline;
      }
    }
    if (message.isToClaude) return Icons.send;
    if (message.needsResponse) return Icons.help_outline;
    if (message.isAnswered) return Icons.question_answer_outlined;
    return Icons.chat_bubble_outline;
  }

  String _statusLabel() {
    if (message.isPending && message.isToUser) return 'Waiting';
    if (message.isAnswered) return 'Answered';
    if (message.isComplete) return 'Done';
    if (message.isInProgress) return 'In Progress';
    if (message.isCancelled) return 'Cancelled';
    if (message.isExpired) return 'Expired';
    return '';
  }

  String _timeStr(DateTime time) {
    final hour = time.hour.toString().padLeft(2, '0');
    final min = time.minute.toString().padLeft(2, '0');
    return '$hour:$min';
  }

  String _dateStr(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inDays == 0) return 'Today';
    if (diff.inDays == 1) return 'Yesterday';
    return '${time.month}/${time.day}';
  }

  @override
  Widget build(BuildContext context) {
    final typeColor = _typeColor();
    final isIncoming = message.isToUser;

    return GestureDetector(
      onTap: () {
        if (onTap != null) {
          HapticService.light();
          onTap!();
        }
      },
      child: Container(
        margin: EdgeInsets.fromLTRB(
          isIncoming ? 12 : 48,
          4,
          isIncoming ? 48 : 12,
          4,
        ),
        child: Column(
          crossAxisAlignment: isIncoming ? CrossAxisAlignment.start : CrossAxisAlignment.end,
          children: [
            // Type badge + time
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(_typeIcon(), size: 12, color: typeColor),
                  const SizedBox(width: 4),
                  Text(
                    _typeLabel(),
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      color: typeColor,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${_dateStr(message.createdAt)} ${_timeStr(message.createdAt)}',
                    style: TextStyle(
                      fontSize: 10,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),

            // Message bubble
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: isIncoming
                    ? Theme.of(context).colorScheme.surfaceContainerHighest
                    : typeColor.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: typeColor.withOpacity(0.2),
                  width: 0.5,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Title (for tasks)
                  if (message.title != null && message.title!.isNotEmpty) ...[
                    Text(
                      message.title!,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 4),
                  ],

                  // Content
                  Text(
                    message.content,
                    style: TextStyle(
                      fontSize: 14,
                      color: Theme.of(context).colorScheme.onSurface.withOpacity(0.9),
                      height: 1.4,
                    ),
                  ),

                  // Status
                  if (_statusLabel().isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(
                      _statusLabel(),
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10,
                        color: typeColor.withOpacity(0.8),
                      ),
                    ),
                  ],

                  // Response (for answered questions)
                  if (message.hasResponse) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: const Color(0xFF4ADE80).withOpacity(0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.check, size: 14, color: Color(0xFF4ADE80)),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              message.response!,
                              style: const TextStyle(fontSize: 13),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],

                  // Quick reply options for pending questions
                  if (message.needsResponse && message.hasOptions) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: message.options!.map((option) => InkWell(
                        onTap: () {
                          HapticService.medium();
                          onQuickReply?.call(option);
                        },
                        borderRadius: BorderRadius.circular(16),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.primary.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                              color: Theme.of(context).colorScheme.primary.withOpacity(0.3),
                            ),
                          ),
                          child: Text(
                            option,
                            style: TextStyle(
                              fontSize: 13,
                              color: Theme.of(context).colorScheme.primary,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      )).toList(),
                    ),
                  ],

                  // Priority badge for high-priority items
                  if (message.isHighPriority) ...[
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEF4444).withOpacity(0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text(
                        'HIGH PRIORITY',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 9,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFFEF4444),
                          letterSpacing: 0.5,
                        ),
                      ),
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
}
