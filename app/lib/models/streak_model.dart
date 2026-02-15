import 'package:cloud_firestore/cloud_firestore.dart';

/// User statistics including answer streaks
class UserStats {
  final int currentStreak;
  final int longestStreak;
  final int totalAnswered;
  final DateTime? lastAnsweredAt;
  final DateTime? streakStartDate;

  const UserStats({
    required this.currentStreak,
    required this.longestStreak,
    required this.totalAnswered,
    this.lastAnsweredAt,
    this.streakStartDate,
  });

  factory UserStats.empty() => const UserStats(
        currentStreak: 0,
        longestStreak: 0,
        totalAnswered: 0,
      );

  factory UserStats.fromFirestore(Map<String, dynamic> data) {
    return UserStats(
      currentStreak: data['currentStreak'] as int? ?? 0,
      longestStreak: data['longestStreak'] as int? ?? 0,
      totalAnswered: data['totalAnswered'] as int? ?? 0,
      lastAnsweredAt: data['lastAnsweredAt'] != null
          ? (data['lastAnsweredAt'] as Timestamp).toDate()
          : null,
      streakStartDate: data['streakStartDate'] != null
          ? (data['streakStartDate'] as Timestamp).toDate()
          : null,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'currentStreak': currentStreak,
      'longestStreak': longestStreak,
      'totalAnswered': totalAnswered,
      'lastAnsweredAt':
          lastAnsweredAt != null ? Timestamp.fromDate(lastAnsweredAt!) : null,
      'streakStartDate': streakStartDate != null
          ? Timestamp.fromDate(streakStartDate!)
          : null,
    };
  }

  /// Check if the streak is at risk (haven't answered today)
  bool get isStreakAtRisk {
    if (currentStreak == 0 || lastAnsweredAt == null) return false;
    final now = DateTime.now();
    final lastAnswer = lastAnsweredAt!;
    // Streak is at risk if last answer was yesterday and it's after noon
    return _daysBetween(lastAnswer, now) >= 1 && now.hour >= 12;
  }

  /// Check if we can extend the streak today
  bool get canExtendStreak {
    if (lastAnsweredAt == null) return true;
    return !_isSameDay(lastAnsweredAt!, DateTime.now());
  }

  /// Check if the streak has been broken
  bool get isStreakBroken {
    if (lastAnsweredAt == null) return false;
    return _daysBetween(lastAnsweredAt!, DateTime.now()) > 1;
  }

  /// Calculate new streak value after answering
  int calculateNewStreak() {
    if (lastAnsweredAt == null) return 1;

    final now = DateTime.now();
    final days = _daysBetween(lastAnsweredAt!, now);

    if (days == 0) {
      // Same day, streak stays the same
      return currentStreak;
    } else if (days == 1) {
      // Next day, streak extends
      return currentStreak + 1;
    } else {
      // Streak broken, start over
      return 1;
    }
  }

  UserStats copyWith({
    int? currentStreak,
    int? longestStreak,
    int? totalAnswered,
    DateTime? lastAnsweredAt,
    DateTime? streakStartDate,
  }) {
    return UserStats(
      currentStreak: currentStreak ?? this.currentStreak,
      longestStreak: longestStreak ?? this.longestStreak,
      totalAnswered: totalAnswered ?? this.totalAnswered,
      lastAnsweredAt: lastAnsweredAt ?? this.lastAnsweredAt,
      streakStartDate: streakStartDate ?? this.streakStartDate,
    );
  }

  static bool _isSameDay(DateTime a, DateTime b) {
    return a.year == b.year && a.month == b.month && a.day == b.day;
  }

  static int _daysBetween(DateTime from, DateTime to) {
    from = DateTime(from.year, from.month, from.day);
    to = DateTime(to.year, to.month, to.day);
    return (to.difference(from).inHours / 24).round();
  }
}

/// Streak milestone for celebrating achievements
enum StreakMilestone {
  streak3(3, 'Getting Started'),
  streak7(7, 'Week Warrior'),
  streak14(14, 'Fortnight Focus'),
  streak30(30, 'Monthly Master'),
  streak50(50, 'Half Century'),
  streak100(100, 'Century Club'),
  streak365(365, 'Year of Excellence');

  final int days;
  final String title;

  const StreakMilestone(this.days, this.title);

  static StreakMilestone? checkMilestone(int streak) {
    for (final milestone in StreakMilestone.values.reversed) {
      if (streak == milestone.days) {
        return milestone;
      }
    }
    return null;
  }

  static StreakMilestone? getNextMilestone(int streak) {
    for (final milestone in StreakMilestone.values) {
      if (milestone.days > streak) {
        return milestone;
      }
    }
    return null;
  }
}
