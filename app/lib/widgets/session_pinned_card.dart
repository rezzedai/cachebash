import 'package:flutter/material.dart';

import '../models/session_model.dart';
import '../theme/program_colors.dart';

/// Persistent session status card pinned at top of channel detail
class SessionPinnedCard extends StatelessWidget {
  final SessionModel session;
  final String programId;
  final VoidCallback? onTap;

  const SessionPinnedCard({
    super.key,
    required this.session,
    required this.programId,
    this.onTap,
  });

  Color _stateColor() {
    if (session.isBlocked) return const Color(0xFFFBBF24);
    if (session.isWorking) return const Color(0xFF4ADE80);
    if (session.isPinned) return const Color(0xFF38BDF8);
    if (session.isComplete) return const Color(0xFF64748B);
    return const Color(0xFF64748B);
  }

  String _stateLabel() {
    if (session.isStale) return 'INACTIVE';
    return session.state.toUpperCase();
  }

  String _timeAgo(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inSeconds < 60) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }

  @override
  Widget build(BuildContext context) {
    final meta = ProgramRegistry.get(programId);
    final stateColor = _stateColor();

    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.fromLTRB(12, 8, 12, 4),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: stateColor.withOpacity(0.3),
            width: 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // State badge + last update
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: stateColor.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    _stateLabel(),
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      color: stateColor,
                      letterSpacing: 1,
                    ),
                  ),
                ),
                if (session.projectName != null) ...[
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      session.projectName!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        color: meta.color.withOpacity(0.7),
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                ] else
                  const Spacer(),
                Text(
                  _timeAgo(session.lastUpdate),
                  style: TextStyle(
                    fontSize: 11,
                    color: session.isStale
                        ? const Color(0xFFFBBF24)
                        : Theme.of(context).colorScheme.onSurfaceVariant,
                    fontWeight: session.isStale ? FontWeight.bold : FontWeight.normal,
                  ),
                ),
              ],
            ),

            // Progress bar (if applicable)
            if (session.progress != null && session.progress! > 0) ...[
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(2),
                child: LinearProgressIndicator(
                  value: session.progress! / 100,
                  minHeight: 3,
                  backgroundColor: stateColor.withOpacity(0.1),
                  valueColor: AlwaysStoppedAnimation(stateColor),
                ),
              ),
            ],

            // Status message
            if (session.status.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                session.status,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13,
                  color: Theme.of(context).colorScheme.onSurface.withOpacity(0.8),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
