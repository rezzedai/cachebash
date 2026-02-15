import 'package:flutter/material.dart';

/// A shimmer effect widget for loading states
class ShimmerEffect extends StatefulWidget {
  final Widget child;
  final Color? baseColor;
  final Color? highlightColor;
  final Duration duration;

  const ShimmerEffect({
    super.key,
    required this.child,
    this.baseColor,
    this.highlightColor,
    this.duration = const Duration(milliseconds: 1500),
  });

  @override
  State<ShimmerEffect> createState() => _ShimmerEffectState();
}

class _ShimmerEffectState extends State<ShimmerEffect>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: widget.duration,
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final baseColor =
        widget.baseColor ?? Theme.of(context).colorScheme.surfaceContainerHigh;
    final highlightColor = widget.highlightColor ??
        Theme.of(context).colorScheme.surfaceContainerHighest;

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return ShaderMask(
          blendMode: BlendMode.srcATop,
          shaderCallback: (bounds) {
            return LinearGradient(
              colors: [baseColor, highlightColor, baseColor],
              stops: const [0.0, 0.5, 1.0],
              begin: Alignment(-1.0 + 2 * _controller.value, 0),
              end: Alignment(1.0 + 2 * _controller.value, 0),
              tileMode: TileMode.clamp,
            ).createShader(bounds);
          },
          child: child,
        );
      },
      child: widget.child,
    );
  }
}

/// A shimmer placeholder that matches question card layout
class ShimmerQuestionCard extends StatelessWidget {
  const ShimmerQuestionCard({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerEffect(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row
              Row(
                children: [
                  _buildShimmerBox(60, 24),
                  const SizedBox(width: 8),
                  _buildShimmerBox(70, 24),
                  const Spacer(),
                  _buildShimmerBox(30, 16),
                ],
              ),
              const SizedBox(height: 12),
              // Question text lines
              _buildShimmerBox(double.infinity, 16),
              const SizedBox(height: 8),
              _buildShimmerBox(200, 16),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildShimmerBox(double width, double height) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Colors.grey.shade300,
        borderRadius: BorderRadius.circular(4),
      ),
    );
  }
}

/// A shimmer placeholder for session cards
class ShimmerSessionCard extends StatelessWidget {
  const ShimmerSessionCard({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerEffect(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              // Icon placeholder
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 16),
              // Text placeholders
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildShimmerBox(120, 16),
                    const SizedBox(height: 8),
                    _buildShimmerBox(80, 12),
                  ],
                ),
              ),
              // Progress placeholder
              _buildShimmerBox(40, 40),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildShimmerBox(double width, double height) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Colors.grey.shade300,
        borderRadius: BorderRadius.circular(4),
      ),
    );
  }
}

/// A shimmer placeholder for project list tiles
class ShimmerProjectTile extends StatelessWidget {
  const ShimmerProjectTile({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerEffect(
      child: ListTile(
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: Colors.grey.shade300,
            shape: BoxShape.circle,
          ),
        ),
        title: Container(
          width: 100,
          height: 16,
          decoration: BoxDecoration(
            color: Colors.grey.shade300,
            borderRadius: BorderRadius.circular(4),
          ),
        ),
        subtitle: Container(
          width: 60,
          height: 12,
          margin: const EdgeInsets.only(top: 4),
          decoration: BoxDecoration(
            color: Colors.grey.shade300,
            borderRadius: BorderRadius.circular(4),
          ),
        ),
      ),
    );
  }
}

/// A shimmer placeholder for task cards
class ShimmerTaskCard extends StatelessWidget {
  const ShimmerTaskCard({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerEffect(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 4,
                    height: 40,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade300,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _buildShimmerBox(150, 16),
                        const SizedBox(height: 8),
                        _buildShimmerBox(200, 12),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  _buildShimmerBox(80, 24),
                  const Spacer(),
                  _buildShimmerBox(50, 12),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildShimmerBox(double width, double height) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Colors.grey.shade300,
        borderRadius: BorderRadius.circular(4),
      ),
    );
  }
}

/// A list of shimmer cards for loading states
class ShimmerList extends StatelessWidget {
  final int itemCount;
  final Widget Function(BuildContext, int) itemBuilder;

  const ShimmerList({
    super.key,
    this.itemCount = 3,
    required this.itemBuilder,
  });

  /// Creates a shimmer list with question cards
  factory ShimmerList.questions({int itemCount = 3}) {
    return ShimmerList(
      itemCount: itemCount,
      itemBuilder: (context, index) => const Padding(
        padding: EdgeInsets.only(bottom: 12),
        child: ShimmerQuestionCard(),
      ),
    );
  }

  /// Creates a shimmer list with session cards
  factory ShimmerList.sessions({int itemCount = 2}) {
    return ShimmerList(
      itemCount: itemCount,
      itemBuilder: (context, index) => const Padding(
        padding: EdgeInsets.only(bottom: 12),
        child: ShimmerSessionCard(),
      ),
    );
  }

  /// Creates a shimmer list with project tiles
  factory ShimmerList.projects({int itemCount = 4}) {
    return ShimmerList(
      itemCount: itemCount,
      itemBuilder: (context, index) => const ShimmerProjectTile(),
    );
  }

  /// Creates a shimmer list with task cards
  factory ShimmerList.tasks({int itemCount = 3}) {
    return ShimmerList(
      itemCount: itemCount,
      itemBuilder: (context, index) => const Padding(
        padding: EdgeInsets.only(bottom: 12),
        child: ShimmerTaskCard(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(
        itemCount,
        (index) => itemBuilder(context, index),
      ),
    );
  }
}
