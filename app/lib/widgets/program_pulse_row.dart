import 'package:flutter/material.dart';
import '../models/session_model.dart';
import '../theme/colors.dart';

/// Displays active Grid programs as colored heat dots.
/// Brightness indicates recency of activity.
class ProgramPulseRow extends StatelessWidget {
  final List<SessionModel> sessions;

  const ProgramPulseRow({super.key, required this.sessions});

  @override
  Widget build(BuildContext context) {
    // Group sessions by programId, take most recent per program
    final Map<String, SessionModel> programSessions = {};
    for (final session in sessions) {
      final pid = session.programId ?? 'unknown';
      if (!programSessions.containsKey(pid) ||
          session.lastUpdate.isAfter(programSessions[pid]!.lastUpdate)) {
        programSessions[pid] = session;
      }
    }

    if (programSessions.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(
          'No active programs',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
        ),
      );
    }

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: programSessions.entries.map((entry) {
        final pid = entry.key;
        final session = entry.value;
        final color = AppColors.getProgramColor(pid);
        final minutesAgo = DateTime.now().difference(session.lastUpdate).inMinutes;
        // Brightness: 1.0 = active now, fades to 0.3 over 60 minutes
        final brightness = (1.0 - (minutesAgo / 60.0)).clamp(0.3, 1.0);

        return Tooltip(
          message: '$pid: ${session.status}',
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: color.withValues(alpha: brightness),
                  boxShadow: brightness > 0.7
                      ? [BoxShadow(color: color.withValues(alpha: 0.4), blurRadius: 8, spreadRadius: 1)]
                      : null,
                ),
                child: Center(
                  child: Text(
                    pid.substring(0, 1).toUpperCase(),
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: brightness),
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                pid,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                      fontSize: 9,
                    ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}
