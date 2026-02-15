import 'package:flutter/services.dart';

/// Centralized haptic feedback service for consistent tactile responses
class HapticService {
  /// Light tap feedback - for subtle interactions like list item taps
  static void light() => HapticFeedback.lightImpact();

  /// Medium impact - for confirmations and moderate actions
  static void medium() => HapticFeedback.mediumImpact();

  /// Heavy impact - for significant actions or alerts
  static void heavy() => HapticFeedback.heavyImpact();

  /// Success feedback - for completed actions
  static void success() => HapticFeedback.mediumImpact();

  /// Error feedback - for failed actions or validation errors
  static void error() => HapticFeedback.vibrate();

  /// Selection feedback - for picker changes, toggle switches
  static void selection() => HapticFeedback.selectionClick();

  /// Notification feedback - for incoming high-priority items
  static void notification() => HapticFeedback.heavyImpact();
}
