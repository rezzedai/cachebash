import 'package:flutter/material.dart';

/// CacheBash color palette extracted from design specs
class AppColors {
  AppColors._();

  // Primary colors
  static const Color backgroundDark = Color(0xFF1A1A2E);
  static const Color backgroundDarker = Color(0xFF16162A);
  static const Color surfaceDark = Color(0xFF252545);

  // Accent colors (from palette)
  static const Color cyan = Color(0xFF4ECDC4);
  static const Color cyanLight = Color(0xFF6FE4DC);
  static const Color teal = Color(0xFF3DB5AC);

  // Purple/violet spectrum
  static const Color purple = Color(0xFF7B68EE);
  static const Color purpleLight = Color(0xFF9D8DF0);
  static const Color violet = Color(0xFF8B5CF6);
  static const Color lavender = Color(0xFFB8A9C9);

  // Blue-purple gradient midpoint
  static const Color bluePurple = Color(0xFF5B7FD6);

  // Text colors
  static const Color textPrimary = Color(0xFFF0F0F5);
  static const Color textSecondary = Color(0xFFB0B0C0);
  static const Color textMuted = Color(0xFF6B6B80);

  // Status colors
  static const Color success = Color(0xFF4ADE80);
  static const Color warning = Color(0xFFFBBF24);
  static const Color error = Color(0xFFEF4444);
  static const Color info = Color(0xFF38BDF8);

  // Card/surface colors
  static const Color cardDark = Color(0xFF252545);
  static const Color cardBorder = Color(0xFF3D3D5C);

  // Gradient colors (for app icon style effects)
  static const LinearGradient primaryGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [cyan, purple],
  );

  static const LinearGradient surfaceGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [surfaceDark, backgroundDark],
  );
}
