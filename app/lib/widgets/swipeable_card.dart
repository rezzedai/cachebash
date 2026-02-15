import 'package:flutter/material.dart';

import '../services/haptic_service.dart';

/// A swipeable card that reveals action buttons when swiped
class SwipeableCard extends StatefulWidget {
  final Widget child;
  final VoidCallback? onSwipeLeft;
  final VoidCallback? onSwipeRight;
  final Widget? leftBackground;
  final Widget? rightBackground;
  final double threshold;
  final bool enableLeftSwipe;
  final bool enableRightSwipe;

  const SwipeableCard({
    super.key,
    required this.child,
    this.onSwipeLeft,
    this.onSwipeRight,
    this.leftBackground,
    this.rightBackground,
    this.threshold = 0.3,
    this.enableLeftSwipe = true,
    this.enableRightSwipe = true,
  });

  @override
  State<SwipeableCard> createState() => _SwipeableCardState();
}

class _SwipeableCardState extends State<SwipeableCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  double _dragExtent = 0;
  bool _hasTriggeredHaptic = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 200),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDragUpdate(DragUpdateDetails details) {
    final delta = details.primaryDelta ?? 0;

    // Check swipe direction permissions
    if (delta > 0 && !widget.enableRightSwipe) return;
    if (delta < 0 && !widget.enableLeftSwipe) return;

    setState(() {
      _dragExtent += delta;
      _dragExtent = _dragExtent.clamp(
        widget.enableLeftSwipe ? -150.0 : 0.0,
        widget.enableRightSwipe ? 150.0 : 0.0,
      );
    });

    // Trigger haptic when passing threshold
    final progress = _dragExtent.abs() / 150;
    if (progress >= widget.threshold && !_hasTriggeredHaptic) {
      HapticService.selection();
      _hasTriggeredHaptic = true;
    } else if (progress < widget.threshold) {
      _hasTriggeredHaptic = false;
    }
  }

  void _onDragEnd(DragEndDetails details) {
    final progress = _dragExtent.abs() / 150;

    if (progress >= widget.threshold) {
      // Trigger action
      HapticService.medium();
      if (_dragExtent > 0) {
        widget.onSwipeRight?.call();
      } else {
        widget.onSwipeLeft?.call();
      }
    }

    // Animate back to center
    setState(() {
      _dragExtent = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    final progress = _dragExtent / 150;

    return GestureDetector(
      onHorizontalDragUpdate: _onDragUpdate,
      onHorizontalDragEnd: _onDragEnd,
      child: Stack(
        children: [
          // Left background (shown when swiping right)
          if (widget.rightBackground != null && _dragExtent > 0)
            Positioned.fill(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Opacity(
                  opacity: progress.abs().clamp(0.0, 1.0),
                  child: widget.rightBackground!,
                ),
              ),
            ),

          // Right background (shown when swiping left)
          if (widget.leftBackground != null && _dragExtent < 0)
            Positioned.fill(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Opacity(
                  opacity: progress.abs().clamp(0.0, 1.0),
                  child: widget.leftBackground!,
                ),
              ),
            ),

          // Main card
          Transform.translate(
            offset: Offset(_dragExtent, 0),
            child: widget.child,
          ),
        ],
      ),
    );
  }
}

/// Pre-built background for archive action
class ArchiveSwipeBackground extends StatelessWidget {
  const ArchiveSwipeBackground({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.orange.shade600,
        borderRadius: BorderRadius.circular(12),
      ),
      alignment: Alignment.centerLeft,
      padding: const EdgeInsets.only(left: 24),
      child: const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.archive, color: Colors.white, size: 28),
          SizedBox(height: 4),
          Text(
            'Archive',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}

/// Pre-built background for answer/reply action
class AnswerSwipeBackground extends StatelessWidget {
  const AnswerSwipeBackground({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primary,
        borderRadius: BorderRadius.circular(12),
      ),
      alignment: Alignment.centerRight,
      padding: const EdgeInsets.only(right: 24),
      child: const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.reply, color: Colors.white, size: 28),
          SizedBox(height: 4),
          Text(
            'Answer',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}

/// Pre-built background for delete action
class DeleteSwipeBackground extends StatelessWidget {
  const DeleteSwipeBackground({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.red.shade600,
        borderRadius: BorderRadius.circular(12),
      ),
      alignment: Alignment.centerRight,
      padding: const EdgeInsets.only(right: 24),
      child: const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.delete, color: Colors.white, size: 28),
          SizedBox(height: 4),
          Text(
            'Delete',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}
