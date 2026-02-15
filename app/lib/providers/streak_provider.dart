import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/streak_model.dart';
import 'auth_provider.dart';

void _log(String message) {
  debugPrint('[StreakProvider] $message');
}

/// Service for managing user stats and streaks
class StatsService {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  /// Get user stats document reference
  DocumentReference<Map<String, dynamic>> _statsRef(String userId) {
    return _firestore.collection('users').doc(userId).collection('stats').doc('summary');
  }

  /// Stream user stats
  Stream<UserStats> watchStats(String userId) {
    return _statsRef(userId).snapshots().map((snapshot) {
      if (!snapshot.exists || snapshot.data() == null) {
        return UserStats.empty();
      }
      return UserStats.fromFirestore(snapshot.data()!);
    });
  }

  /// Get current stats
  Future<UserStats> getStats(String userId) async {
    final snapshot = await _statsRef(userId).get();
    if (!snapshot.exists || snapshot.data() == null) {
      return UserStats.empty();
    }
    return UserStats.fromFirestore(snapshot.data()!);
  }

  /// Record a question answer and update streak
  Future<StreakUpdateResult> recordAnswer(String userId) async {
    _log('recordAnswer for user: $userId');

    return _firestore.runTransaction((transaction) async {
      final statsRef = _statsRef(userId);
      final snapshot = await transaction.get(statsRef);

      UserStats currentStats;
      if (!snapshot.exists || snapshot.data() == null) {
        currentStats = UserStats.empty();
      } else {
        currentStats = UserStats.fromFirestore(snapshot.data()!);
      }

      final now = DateTime.now();
      final previousStreak = currentStats.currentStreak;
      final newStreak = currentStats.calculateNewStreak();
      final isNewDay = currentStats.canExtendStreak;

      // Determine if streak started fresh
      final streakStartDate = previousStreak == 0 || newStreak == 1
          ? now
          : currentStats.streakStartDate ?? now;

      final newStats = UserStats(
        currentStreak: newStreak,
        longestStreak: newStreak > currentStats.longestStreak
            ? newStreak
            : currentStats.longestStreak,
        totalAnswered: currentStats.totalAnswered + 1,
        lastAnsweredAt: now,
        streakStartDate: streakStartDate,
      );

      transaction.set(statsRef, newStats.toFirestore(), SetOptions(merge: true));

      // Check for milestone
      final milestone = StreakMilestone.checkMilestone(newStreak);

      return StreakUpdateResult(
        previousStreak: previousStreak,
        newStreak: newStreak,
        isExtended: isNewDay && newStreak > previousStreak,
        milestone: milestone,
        isNewRecord: newStreak > currentStats.longestStreak,
      );
    });
  }
}

/// Result of updating a streak
class StreakUpdateResult {
  final int previousStreak;
  final int newStreak;
  final bool isExtended;
  final StreakMilestone? milestone;
  final bool isNewRecord;

  const StreakUpdateResult({
    required this.previousStreak,
    required this.newStreak,
    required this.isExtended,
    this.milestone,
    required this.isNewRecord,
  });

  bool get shouldCelebrate => isExtended || milestone != null || isNewRecord;
}

/// Provider for stats service
final statsServiceProvider = Provider<StatsService>((ref) {
  return StatsService();
});

/// Provider for current user's stats
final userStatsProvider = StreamProvider<UserStats>((ref) {
  final user = ref.watch(currentUserProvider);
  if (user == null) {
    return Stream.value(UserStats.empty());
  }
  return ref.watch(statsServiceProvider).watchStats(user.uid);
});

/// Provider for streak at risk status
final streakAtRiskProvider = Provider<bool>((ref) {
  final statsAsync = ref.watch(userStatsProvider);
  return statsAsync.maybeWhen(
    data: (stats) => stats.isStreakAtRisk,
    orElse: () => false,
  );
});

/// Provider for current streak count
final currentStreakProvider = Provider<int>((ref) {
  final statsAsync = ref.watch(userStatsProvider);
  return statsAsync.maybeWhen(
    data: (stats) => stats.currentStreak,
    orElse: () => 0,
  );
});
