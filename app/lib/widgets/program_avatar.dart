import 'package:flutter/material.dart';

import '../theme/program_colors.dart';

/// Circular avatar showing a program's identity color and initial
class ProgramAvatar extends StatelessWidget {
  final String programId;
  final double size;
  final bool showStatusDot;
  final String? statusState; // 'working', 'blocked', 'complete', 'pinned', 'offline'

  const ProgramAvatar({
    super.key,
    required this.programId,
    this.size = 40,
    this.showStatusDot = false,
    this.statusState,
  });

  Color _statusColor() {
    switch (statusState) {
      case 'working':
        return const Color(0xFF4ADE80); // green
      case 'blocked':
        return const Color(0xFFFBBF24); // orange
      case 'complete':
      case 'done':
        return const Color(0xFF64748B); // slate
      case 'pinned':
        return const Color(0xFF38BDF8); // blue
      default:
        return const Color(0xFF64748B); // slate / offline
    }
  }

  @override
  Widget build(BuildContext context) {
    final meta = ProgramRegistry.get(programId);
    final dotSize = size * 0.3;

    return SizedBox(
      width: size + (showStatusDot ? dotSize * 0.4 : 0),
      height: size + (showStatusDot ? dotSize * 0.4 : 0),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              color: meta.color.withValues(alpha: 0.15),
              shape: BoxShape.circle,
              border: Border.all(
                color: meta.color.withValues(alpha: 0.3),
                width: 1.5,
              ),
            ),
            child: Center(
              child: Text(
                meta.initial,
                style: TextStyle(
                  color: meta.color,
                  fontSize: size * 0.4,
                  fontWeight: FontWeight.bold,
                  fontFamily: 'monospace',
                ),
              ),
            ),
          ),
          if (showStatusDot)
            Positioned(
              right: 0,
              bottom: 0,
              child: Container(
                width: dotSize,
                height: dotSize,
                decoration: BoxDecoration(
                  color: _statusColor(),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: Theme.of(context).colorScheme.surface,
                    width: 2,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
