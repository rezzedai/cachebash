import 'package:flutter/material.dart';

import '../services/haptic_service.dart';

/// Action bar that appears at the bottom when items are selected
class SelectionActionBar extends StatelessWidget {
  final int selectedCount;
  final List<SelectionAction> actions;
  final VoidCallback onCancel;

  const SelectionActionBar({
    super.key,
    required this.selectedCount,
    required this.actions,
    required this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHigh,
        border: Border(
          top: BorderSide(
            color: Theme.of(context).colorScheme.outlineVariant,
            width: 0.5,
          ),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              // Cancel button
              IconButton(
                onPressed: () {
                  HapticService.light();
                  onCancel();
                },
                icon: const Icon(Icons.close),
                tooltip: 'Cancel',
              ),
              const SizedBox(width: 8),
              // Selected count
              Text(
                '$selectedCount selected',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
              ),
              const Spacer(),
              // Action buttons
              ...actions.map((action) => Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: _ActionButton(action: action),
                  )),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final SelectionAction action;

  const _ActionButton({required this.action});

  @override
  Widget build(BuildContext context) {
    final isDestructive = action.isDestructive;

    return FilledButton.icon(
      onPressed: () {
        HapticService.medium();
        action.onPressed();
      },
      icon: Icon(action.icon, size: 18),
      label: Text(action.label),
      style: FilledButton.styleFrom(
        backgroundColor: isDestructive
            ? Theme.of(context).colorScheme.error
            : Theme.of(context).colorScheme.primary,
        foregroundColor: isDestructive
            ? Theme.of(context).colorScheme.onError
            : Theme.of(context).colorScheme.onPrimary,
      ),
    );
  }
}

/// Represents an action that can be performed on selected items
class SelectionAction {
  final String label;
  final IconData icon;
  final VoidCallback onPressed;
  final bool isDestructive;

  const SelectionAction({
    required this.label,
    required this.icon,
    required this.onPressed,
    this.isDestructive = false,
  });
}
