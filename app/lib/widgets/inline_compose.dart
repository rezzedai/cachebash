import 'package:flutter/material.dart';

import '../models/message_model.dart';
import '../services/haptic_service.dart';

/// Inline compose bar at the bottom of channel detail
class InlineCompose extends StatefulWidget {
  final String targetProgramId;
  final ValueChanged<ComposePayload> onSend;

  const InlineCompose({
    super.key,
    required this.targetProgramId,
    required this.onSend,
  });

  @override
  State<InlineCompose> createState() => _InlineComposeState();
}

class ComposePayload {
  final String content;
  final String? title;
  final MessageAction action;
  final String priority;

  const ComposePayload({
    required this.content,
    this.title,
    this.action = MessageAction.queue,
    this.priority = 'normal',
  });
}

class _InlineComposeState extends State<InlineCompose> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  MessageAction _action = MessageAction.queue;
  bool _showOptions = false;

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;

    HapticService.medium();
    widget.onSend(ComposePayload(
      content: text,
      action: _action,
    ));

    _controller.clear();
    _focusNode.unfocus();
    setState(() {
      _showOptions = false;
      _action = MessageAction.queue;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border(
          top: BorderSide(
            color: Theme.of(context).colorScheme.outlineVariant,
            width: 0.5,
          ),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Action picker (expandable)
            if (_showOptions)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(
                  children: [
                    const Text(
                      'Action:',
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(width: 8),
                    ...MessageAction.values.map((action) => Padding(
                      padding: const EdgeInsets.only(right: 4),
                      child: ChoiceChip(
                        label: Text(
                          action.displayName,
                          style: const TextStyle(fontSize: 11),
                        ),
                        selected: _action == action,
                        onSelected: (selected) {
                          if (selected) {
                            HapticService.light();
                            setState(() => _action = action);
                          }
                        },
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        visualDensity: VisualDensity.compact,
                      ),
                    )),
                  ],
                ),
              ),

            // Text input + send
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
              child: Row(
                children: [
                  // Options toggle
                  IconButton(
                    onPressed: () {
                      HapticService.light();
                      setState(() => _showOptions = !_showOptions);
                    },
                    icon: Icon(
                      _showOptions ? Icons.expand_more : Icons.add_circle_outline,
                      color: _showOptions
                          ? Theme.of(context).colorScheme.primary
                          : Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                    iconSize: 22,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
                  ),

                  // Text field
                  Expanded(
                    child: Container(
                      constraints: const BoxConstraints(maxHeight: 100),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: TextField(
                        controller: _controller,
                        focusNode: _focusNode,
                        maxLines: null,
                        textInputAction: TextInputAction.newline,
                        style: const TextStyle(fontSize: 14),
                        decoration: InputDecoration(
                          hintText: 'Message ${widget.targetProgramId.toUpperCase()}...',
                          hintStyle: TextStyle(
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
                            fontSize: 14,
                          ),
                          border: InputBorder.none,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                          isDense: true,
                        ),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                  ),

                  const SizedBox(width: 4),

                  // Send button
                  IconButton(
                    onPressed: _controller.text.trim().isNotEmpty ? _send : null,
                    icon: Icon(
                      Icons.send,
                      color: _controller.text.trim().isNotEmpty
                          ? Theme.of(context).colorScheme.primary
                          : Theme.of(context).colorScheme.onSurfaceVariant.withOpacity(0.5),
                    ),
                    iconSize: 22,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
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
