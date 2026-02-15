import 'package:flutter/material.dart';

import '../services/haptic_service.dart';

/// An animated button that scales down on press and springs back on release
class AnimatedPressButton extends StatefulWidget {
  final Widget child;
  final VoidCallback? onPressed;
  final double pressedScale;
  final Duration duration;
  final bool enableHaptic;

  const AnimatedPressButton({
    super.key,
    required this.child,
    this.onPressed,
    this.pressedScale = 0.95,
    this.duration = const Duration(milliseconds: 100),
    this.enableHaptic = true,
  });

  @override
  State<AnimatedPressButton> createState() => _AnimatedPressButtonState();
}

class _AnimatedPressButtonState extends State<AnimatedPressButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: widget.duration,
    );
    _scaleAnimation = Tween<double>(
      begin: 1.0,
      end: widget.pressedScale,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeInOut,
    ));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onTapDown(TapDownDetails details) {
    _controller.forward();
  }

  void _onTapUp(TapUpDetails details) {
    _controller.reverse();
    if (widget.enableHaptic) {
      HapticService.light();
    }
    widget.onPressed?.call();
  }

  void _onTapCancel() {
    _controller.reverse();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: widget.onPressed != null ? _onTapDown : null,
      onTapUp: widget.onPressed != null ? _onTapUp : null,
      onTapCancel: widget.onPressed != null ? _onTapCancel : null,
      child: AnimatedBuilder(
        animation: _scaleAnimation,
        builder: (context, child) {
          return Transform.scale(
            scale: _scaleAnimation.value,
            child: child,
          );
        },
        child: widget.child,
      ),
    );
  }
}

/// A filled button with press animation
class AnimatedFilledButton extends StatelessWidget {
  final Widget child;
  final VoidCallback? onPressed;
  final ButtonStyle? style;

  const AnimatedFilledButton({
    super.key,
    required this.child,
    this.onPressed,
    this.style,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedPressButton(
      onPressed: onPressed,
      enableHaptic: false, // FilledButton will trigger its own
      child: FilledButton(
        onPressed: onPressed != null ? () {} : null,
        style: style,
        child: child,
      ),
    );
  }
}

/// A card with press animation
class AnimatedCard extends StatelessWidget {
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry? padding;
  final double? elevation;
  final Color? color;
  final ShapeBorder? shape;

  const AnimatedCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding,
    this.elevation,
    this.color,
    this.shape,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedPressButton(
      onPressed: onTap,
      child: Card(
        elevation: elevation,
        color: color,
        shape: shape,
        child: padding != null
            ? Padding(padding: padding!, child: child)
            : child,
      ),
    );
  }
}

/// An icon button with press animation
class AnimatedIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onPressed;
  final double? size;
  final Color? color;
  final String? tooltip;

  const AnimatedIconButton({
    super.key,
    required this.icon,
    this.onPressed,
    this.size,
    this.color,
    this.tooltip,
  });

  @override
  Widget build(BuildContext context) {
    final button = AnimatedPressButton(
      onPressed: onPressed,
      pressedScale: 0.85,
      child: Icon(icon, size: size, color: color),
    );

    if (tooltip != null) {
      return Tooltip(
        message: tooltip!,
        child: button,
      );
    }
    return button;
  }
}
