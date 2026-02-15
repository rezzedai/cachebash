import 'package:flutter/material.dart';
import '../models/task_model.dart';
import '../theme/colors.dart';

/// Shows pending task counts grouped by target program as colored chips.
class TaskQueueChips extends StatelessWidget {
  final List<TaskModel> pendingTasks;
  final void Function(String? target)? onTapTarget;

  const TaskQueueChips({super.key, required this.pendingTasks, this.onTapTarget});

  @override
  Widget build(BuildContext context) {
    if (pendingTasks.isEmpty) {
      return Text(
        'Queue empty',
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
      );
    }

    // Group by target
    final Map<String, int> targetCounts = {};
    for (final task in pendingTasks) {
      final target = task.target ?? 'unassigned';
      targetCounts[target] = (targetCounts[target] ?? 0) + 1;
    }

    // Sort by count descending
    final sorted = targetCounts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: sorted.map((entry) {
        final color = AppColors.getProgramColor(entry.key);
        return ActionChip(
          avatar: CircleAvatar(
            backgroundColor: color,
            radius: 10,
            child: Text(
              '${entry.value}',
              style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
            ),
          ),
          label: Text(entry.key, style: const TextStyle(fontSize: 12)),
          onPressed: onTapTarget != null ? () => onTapTarget!(entry.key) : null,
          visualDensity: VisualDensity.compact,
          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        );
      }).toList(),
    );
  }
}
