import 'dart:math' as math;
import 'package:flutter/material.dart';

import '../models/streak_model.dart';
import '../services/haptic_service.dart';

/// Celebration animation for streak milestones
class StreakCelebration extends StatefulWidget {
  final int streak;
  final StreakMilestone? milestone;
  final bool isNewRecord;
  final VoidCallback? onComplete;

  const StreakCelebration({
    super.key,
    required this.streak,
    this.milestone,
    this.isNewRecord = false,
    this.onComplete,
  });

  @override
  State<StreakCelebration> createState() => _StreakCelebrationState();
}

class _StreakCelebrationState extends State<StreakCelebration>
    with TickerProviderStateMixin {
  late AnimationController _mainController;
  late AnimationController _particleController;
  late Animation<double> _scaleAnimation;
  late Animation<double> _fadeAnimation;
  late List<_Particle> _particles;

  @override
  void initState() {
    super.initState();

    // Main animation for the streak display
    _mainController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );

    _scaleAnimation = TweenSequence<double>([
      TweenSequenceItem(
        tween: Tween(begin: 0.0, end: 1.2).chain(CurveTween(curve: Curves.easeOut)),
        weight: 50,
      ),
      TweenSequenceItem(
        tween: Tween(begin: 1.2, end: 1.0).chain(CurveTween(curve: Curves.elasticOut)),
        weight: 50,
      ),
    ]).animate(_mainController);

    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _mainController,
        curve: const Interval(0.0, 0.3, curve: Curves.easeOut),
      ),
    );

    // Particle animation for confetti effect
    _particleController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    );

    _generateParticles();

    // Start animations
    HapticService.heavy();
    _mainController.forward();
    _particleController.forward();

    // Auto-dismiss after animation
    Future.delayed(const Duration(seconds: 3), () {
      if (mounted) {
        widget.onComplete?.call();
      }
    });
  }

  void _generateParticles() {
    final random = math.Random();
    _particles = List.generate(30, (index) {
      return _Particle(
        x: random.nextDouble() * 2 - 1, // -1 to 1
        y: random.nextDouble() * -1, // 0 to -1 (start above)
        vx: random.nextDouble() * 2 - 1, // velocity x
        vy: random.nextDouble() * 2 + 1, // velocity y (downward)
        color: _particleColors[random.nextInt(_particleColors.length)],
        size: random.nextDouble() * 8 + 4,
        rotation: random.nextDouble() * math.pi * 2,
        rotationSpeed: random.nextDouble() * 4 - 2,
      );
    });
  }

  static const _particleColors = [
    Colors.amber,
    Colors.orange,
    Colors.yellow,
    Colors.red,
    Colors.pink,
  ];

  @override
  void dispose() {
    _mainController.dispose();
    _particleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.black54,
      child: Stack(
        children: [
          // Confetti particles
          AnimatedBuilder(
            animation: _particleController,
            builder: (context, _) {
              return CustomPaint(
                size: MediaQuery.of(context).size,
                painter: _ParticlePainter(
                  particles: _particles,
                  progress: _particleController.value,
                ),
              );
            },
          ),

          // Main celebration content
          Center(
            child: AnimatedBuilder(
              animation: _mainController,
              builder: (context, child) {
                return Opacity(
                  opacity: _fadeAnimation.value,
                  child: Transform.scale(
                    scale: _scaleAnimation.value,
                    child: child,
                  ),
                );
              },
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Fire icon
                  Container(
                    width: 100,
                    height: 100,
                    decoration: BoxDecoration(
                      color: Colors.amber.withAlpha(51),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.local_fire_department,
                      color: Colors.amber,
                      size: 60,
                    ),
                  ),
                  const SizedBox(height: 24),

                  // Streak count
                  Text(
                    '${widget.streak}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 72,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Text(
                    'DAY STREAK!',
                    style: TextStyle(
                      color: Colors.white.withAlpha(230),
                      fontSize: 24,
                      fontWeight: FontWeight.w500,
                      letterSpacing: 4,
                    ),
                  ),

                  // Milestone message
                  if (widget.milestone != null) ...[
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: Colors.amber,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        widget.milestone!.title,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],

                  // New record message
                  if (widget.isNewRecord && widget.milestone == null) ...[
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: Colors.purple,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.emoji_events, color: Colors.white, size: 20),
                          SizedBox(width: 8),
                          Text(
                            'NEW RECORD!',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],

                  const SizedBox(height: 32),

                  // Tap to continue
                  Text(
                    'Tap to continue',
                    style: TextStyle(
                      color: Colors.white.withAlpha(153),
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Dismiss on tap
          Positioned.fill(
            child: GestureDetector(
              onTap: widget.onComplete,
              behavior: HitTestBehavior.opaque,
            ),
          ),
        ],
      ),
    );
  }
}

class _Particle {
  final double x;
  final double y;
  final double vx;
  final double vy;
  final Color color;
  final double size;
  final double rotation;
  final double rotationSpeed;

  _Particle({
    required this.x,
    required this.y,
    required this.vx,
    required this.vy,
    required this.color,
    required this.size,
    required this.rotation,
    required this.rotationSpeed,
  });
}

class _ParticlePainter extends CustomPainter {
  final List<_Particle> particles;
  final double progress;

  _ParticlePainter({required this.particles, required this.progress});

  @override
  void paint(Canvas canvas, Size size) {
    for (final particle in particles) {
      final x = size.width / 2 + (particle.x + particle.vx * progress * 2) * size.width / 2;
      final y = size.height / 2 + (particle.y + particle.vy * progress * 2) * size.height / 2;

      // Fade out towards the end
      final opacity = (1 - progress).clamp(0.0, 1.0);

      final paint = Paint()
        ..color = particle.color.withAlpha((opacity * 255).round())
        ..style = PaintingStyle.fill;

      canvas.save();
      canvas.translate(x, y);
      canvas.rotate(particle.rotation + particle.rotationSpeed * progress * math.pi * 2);

      // Draw a small rectangle for confetti effect
      canvas.drawRect(
        Rect.fromCenter(
          center: Offset.zero,
          width: particle.size,
          height: particle.size * 0.6,
        ),
        paint,
      );

      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant _ParticlePainter oldDelegate) {
    return progress != oldDelegate.progress;
  }
}

/// Helper to show streak celebration as a dialog
void showStreakCelebration(
  BuildContext context, {
  required int streak,
  StreakMilestone? milestone,
  bool isNewRecord = false,
}) {
  showDialog(
    context: context,
    barrierDismissible: true,
    barrierColor: Colors.transparent,
    builder: (context) => StreakCelebration(
      streak: streak,
      milestone: milestone,
      isNewRecord: isNewRecord,
      onComplete: () => Navigator.of(context).pop(),
    ),
  );
}
