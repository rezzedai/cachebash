import 'package:flutter/material.dart';

import '../models/question_model.dart';
import '../services/haptic_service.dart';

class QuestionCard extends StatefulWidget {
  final QuestionModel question;
  final VoidCallback? onTap;
  final bool handleTap; // If false, parent handles tap (e.g., SelectableCard)
  final Future<void> Function(String response)? onAnswer; // Quick answer callback
  final bool showQuickReply; // Show quick reply button on homescreen

  const QuestionCard({
    super.key,
    required this.question,
    this.onTap,
    this.handleTap = true,
    this.onAnswer,
    this.showQuickReply = false,
  });

  @override
  State<QuestionCard> createState() => _QuestionCardState();
}

class _QuestionCardState extends State<QuestionCard> {
  bool _isExpanded = false;
  bool _isSubmitting = false;

  Future<void> _handleQuickAnswer(String response) async {
    if (_isSubmitting || widget.onAnswer == null) return;

    setState(() => _isSubmitting = true);
    HapticService.medium();

    try {
      await widget.onAnswer!(response);
      if (mounted) {
        HapticService.success();
        setState(() => _isExpanded = false);
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
    final content = Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row with priority and status
              Row(
                children: [
                  if (widget.question.isHighPriority) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.errorContainer,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.priority_high,
                            size: 14,
                            color: Theme.of(context)
                                .colorScheme
                                .onErrorContainer,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            'High',
                            style: TextStyle(
                              fontSize: 12,
                              color: Theme.of(context)
                                  .colorScheme
                                  .onErrorContainer,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],
                  _buildStatusChip(context),
                  const Spacer(),
                  Text(
                    _formatTime(widget.question.createdAt),
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color:
                              Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Question text
              Text(
                widget.question.question,
                style: Theme.of(context).textTheme.bodyLarge,
                maxLines: _isExpanded ? null : 3,
                overflow: _isExpanded ? null : TextOverflow.ellipsis,
              ),

              // Options preview (only if not expanded)
              if (widget.question.hasOptions && !_isExpanded) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  children: widget.question.options!
                      .take(3)
                      .map((option) => Chip(
                            label: Text(
                              option,
                              style: const TextStyle(fontSize: 12),
                            ),
                            visualDensity: VisualDensity.compact,
                          ))
                      .toList(),
                ),
              ],

              // Quick reply section (expanded)
              if (_isExpanded && widget.question.hasOptions) ...[
                const SizedBox(height: 16),
                const Divider(),
                const SizedBox(height: 12),
                if (_isSubmitting)
                  const Center(
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: CircularProgressIndicator(),
                    ),
                  )
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: widget.question.options!
                        .map((option) => ActionChip(
                              label: Text(option),
                              onPressed: () => _handleQuickAnswer(option),
                              backgroundColor: Theme.of(context).colorScheme.primaryContainer,
                              labelStyle: TextStyle(
                                color: Theme.of(context).colorScheme.onPrimaryContainer,
                              ),
                            ))
                        .toList(),
                  ),
              ],

              // Quick reply button
              if (widget.showQuickReply &&
                  widget.question.isPending &&
                  widget.question.hasOptions &&
                  widget.onAnswer != null &&
                  !widget.question.isAnswered) ...[
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    TextButton.icon(
                      onPressed: _isSubmitting
                          ? null
                          : () {
                              setState(() => _isExpanded = !_isExpanded);
                              HapticService.light();
                            },
                      icon: Icon(
                        _isExpanded ? Icons.expand_less : Icons.reply,
                        size: 18,
                      ),
                      label: Text(_isExpanded ? 'Cancel' : 'Quick Reply'),
                    ),
                    if (!_isExpanded)
                      TextButton(
                        onPressed: () {
                          HapticService.light();
                          widget.onTap?.call();
                        },
                        child: const Text('View Details'),
                      ),
                  ],
                ),
              ],

              // Response preview if answered
              if (widget.question.isAnswered && widget.question.response != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.reply,
                        size: 16,
                        color:
                            Theme.of(context).colorScheme.onPrimaryContainer,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          widget.question.response!,
                          style: TextStyle(
                            color: Theme.of(context)
                                .colorScheme
                                .onPrimaryContainer,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        );

    return Card(
      clipBehavior: Clip.antiAlias,
      child: widget.handleTap && !_isExpanded
          ? InkWell(
              onTap: () {
                HapticService.light();
                widget.onTap?.call();
              },
              child: content,
            )
          : content,
    );
  }

  Widget _buildStatusChip(BuildContext context) {
    Color backgroundColor;
    Color textColor;
    String label;
    IconData icon;

    if (widget.question.isPending) {
      backgroundColor = Theme.of(context).colorScheme.tertiaryContainer;
      textColor = Theme.of(context).colorScheme.onTertiaryContainer;
      label = 'Pending';
      icon = Icons.schedule;
    } else if (widget.question.isAnswered) {
      backgroundColor = Theme.of(context).colorScheme.primaryContainer;
      textColor = Theme.of(context).colorScheme.onPrimaryContainer;
      label = 'Answered';
      icon = Icons.check;
    } else {
      backgroundColor = Theme.of(context).colorScheme.surfaceContainerHighest;
      textColor = Theme.of(context).colorScheme.onSurfaceVariant;
      label = 'Expired';
      icon = Icons.timer_off;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: textColor),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(fontSize: 12, color: textColor),
          ),
        ],
      ),
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
