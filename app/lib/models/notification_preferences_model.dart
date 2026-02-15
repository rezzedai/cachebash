/// Model for user notification preferences stored in Firestore
class NotificationPreferences {
  final bool newQuestions;
  final bool sessionUpdates;
  final bool dreamCompletions;
  final bool dreamBudgetWarnings;
  final bool sprintUpdates;
  final bool highPriorityOnly;
  final bool quietHoursEnabled;
  final int quietHoursStart; // Hour 0-23
  final int quietHoursEnd;   // Hour 0-23

  NotificationPreferences({
    this.newQuestions = true,
    this.sessionUpdates = true,
    this.dreamCompletions = true,
    this.dreamBudgetWarnings = true,
    this.sprintUpdates = true,
    this.highPriorityOnly = false,
    this.quietHoursEnabled = false,
    this.quietHoursStart = 22,
    this.quietHoursEnd = 7,
  });

  factory NotificationPreferences.fromMap(Map<String, dynamic> map) {
    return NotificationPreferences(
      newQuestions: map['newQuestions'] as bool? ?? true,
      sessionUpdates: map['sessionUpdates'] as bool? ?? true,
      dreamCompletions: map['dreamCompletions'] as bool? ?? true,
      dreamBudgetWarnings: map['dreamBudgetWarnings'] as bool? ?? true,
      sprintUpdates: map['sprintUpdates'] as bool? ?? true,
      highPriorityOnly: map['highPriorityOnly'] as bool? ?? false,
      quietHoursEnabled: map['quietHoursEnabled'] as bool? ?? false,
      quietHoursStart: map['quietHoursStart'] as int? ?? 22,
      quietHoursEnd: map['quietHoursEnd'] as int? ?? 7,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'newQuestions': newQuestions,
      'sessionUpdates': sessionUpdates,
      'dreamCompletions': dreamCompletions,
      'dreamBudgetWarnings': dreamBudgetWarnings,
      'sprintUpdates': sprintUpdates,
      'highPriorityOnly': highPriorityOnly,
      'quietHoursEnabled': quietHoursEnabled,
      'quietHoursStart': quietHoursStart,
      'quietHoursEnd': quietHoursEnd,
    };
  }

  static NotificationPreferences defaults() => NotificationPreferences();

  NotificationPreferences copyWith({
    bool? newQuestions,
    bool? sessionUpdates,
    bool? dreamCompletions,
    bool? dreamBudgetWarnings,
    bool? sprintUpdates,
    bool? highPriorityOnly,
    bool? quietHoursEnabled,
    int? quietHoursStart,
    int? quietHoursEnd,
  }) {
    return NotificationPreferences(
      newQuestions: newQuestions ?? this.newQuestions,
      sessionUpdates: sessionUpdates ?? this.sessionUpdates,
      dreamCompletions: dreamCompletions ?? this.dreamCompletions,
      dreamBudgetWarnings: dreamBudgetWarnings ?? this.dreamBudgetWarnings,
      sprintUpdates: sprintUpdates ?? this.sprintUpdates,
      highPriorityOnly: highPriorityOnly ?? this.highPriorityOnly,
      quietHoursEnabled: quietHoursEnabled ?? this.quietHoursEnabled,
      quietHoursStart: quietHoursStart ?? this.quietHoursStart,
      quietHoursEnd: quietHoursEnd ?? this.quietHoursEnd,
    );
  }
}
