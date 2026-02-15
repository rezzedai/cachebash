import 'package:flutter/material.dart';
import 'dart:math' as math;

/// Animated checkmark that draws itself with a satisfying animation
class SuccessCheckmark extends StatefulWidget {
  final double size;
  final Color? color;
  final Duration duration;
  final VoidCallback? onComplete;

  const SuccessCheckmark({
    super.key,
    this.size = 80,
    this.color,
    this.duration = const Duration(milliseconds: 600),
    this.onComplete,
  });

  @override
  State<SuccessCheckmark> createState() => _SuccessCheckmarkState();
}

class _SuccessCheckmarkState extends State<SuccessCheckmark>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _circleAnimation;
  late Animation<double> _checkAnimation;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: widget.duration,
    );

    // Circle draws from 0 to 100%
    _circleAnimation = Tween<double>(begin: 0, end: 1).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.0, 0.5, curve: Curves.easeOut),
      ),
    );

    // Check draws after circle
    _checkAnimation = Tween<double>(begin: 0, end: 1).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.4, 0.9, curve: Curves.easeOut),
      ),
    );

    // Scale bounce at the end
    _scaleAnimation = TweenSequence<double>([
      TweenSequenceItem(
        tween: Tween<double>(begin: 1.0, end: 1.15),
        weight: 40,
      ),
      TweenSequenceItem(
        tween: Tween<double>(begin: 1.15, end: 1.0)
            .chain(CurveTween(curve: Curves.elasticOut)),
        weight: 60,
      ),
    ]).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.5, 1.0),
      ),
    );

    _controller.forward().then((_) {
      widget.onComplete?.call();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? Theme.of(context).colorScheme.primary;

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Transform.scale(
          scale: _scaleAnimation.value,
          child: CustomPaint(
            size: Size(widget.size, widget.size),
            painter: _CheckmarkPainter(
              circleProgress: _circleAnimation.value,
              checkProgress: _checkAnimation.value,
              color: color,
            ),
          ),
        );
      },
    );
  }
}

class _CheckmarkPainter extends CustomPainter {
  final double circleProgress;
  final double checkProgress;
  final Color color;

  _CheckmarkPainter({
    required this.circleProgress,
    required this.checkProgress,
    required this.color,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 4;

    // Draw circle
    final circlePaint = Paint()
      ..color = color.withAlpha((255 * 0.15).round())
      ..style = PaintingStyle.fill;

    final circleBorderPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;

    // Fill circle
    canvas.drawCircle(center, radius * circleProgress, circlePaint);

    // Draw circle border (arc)
    final sweepAngle = 2 * math.pi * circleProgress;
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2, // Start from top
      sweepAngle,
      false,
      circleBorderPaint,
    );

    // Draw checkmark
    if (checkProgress > 0) {
      final checkPaint = Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round;

      final checkPath = Path();

      // Checkmark points relative to center
      final startPoint = Offset(
        center.dx - radius * 0.3,
        center.dy + radius * 0.05,
      );
      final midPoint = Offset(
        center.dx - radius * 0.05,
        center.dy + radius * 0.35,
      );
      final endPoint = Offset(
        center.dx + radius * 0.4,
        center.dy - radius * 0.25,
      );

      checkPath.moveTo(startPoint.dx, startPoint.dy);

      // First segment (down stroke)
      final firstSegmentEnd = checkProgress < 0.5
          ? Offset.lerp(startPoint, midPoint, checkProgress * 2)!
          : midPoint;
      checkPath.lineTo(firstSegmentEnd.dx, firstSegmentEnd.dy);

      // Second segment (up stroke)
      if (checkProgress > 0.5) {
        final secondSegmentEnd =
            Offset.lerp(midPoint, endPoint, (checkProgress - 0.5) * 2)!;
        checkPath.lineTo(secondSegmentEnd.dx, secondSegmentEnd.dy);
      }

      canvas.drawPath(checkPath, checkPaint);
    }
  }

  @override
  bool shouldRepaint(covariant _CheckmarkPainter oldDelegate) {
    return circleProgress != oldDelegate.circleProgress ||
        checkProgress != oldDelegate.checkProgress ||
        color != oldDelegate.color;
  }
}

/// A success overlay that shows the checkmark centered on screen
class SuccessOverlay extends StatelessWidget {
  final String? message;
  final VoidCallback? onComplete;

  const SuccessOverlay({
    super.key,
    this.message,
    this.onComplete,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black54,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SuccessCheckmark(
              size: 100,
              color: Colors.white,
              onComplete: onComplete,
            ),
            if (message != null) ...[
              const SizedBox(height: 24),
              Text(
                message!,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Helper to show success overlay as a dialog
Future<void> showSuccessOverlay(
  BuildContext context, {
  String? message,
  Duration displayDuration = const Duration(milliseconds: 1500),
}) async {
  showDialog(
    context: context,
    barrierDismissible: false,
    barrierColor: Colors.transparent,
    builder: (context) => SuccessOverlay(message: message),
  );

  await Future.delayed(displayDuration);

  if (context.mounted) {
    Navigator.of(context).pop();
  }
}
