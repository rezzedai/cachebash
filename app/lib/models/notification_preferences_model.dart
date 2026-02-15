/// Model for user notification preferences stored in Firestore
class NotificationPreferences {
  final bool newQuestions;
  final bool sessionUpdates;
  final bool highPriorityOnly;

  NotificationPreferences({
    this.newQuestions = true,
    this.sessionUpdates = true,
    this.highPriorityOnly = false,
  });

  factory NotificationPreferences.fromMap(Map<String, dynamic> map) {
    return NotificationPreferences(
      newQuestions: map['newQuestions'] as bool? ?? true,
      sessionUpdates: map['sessionUpdates'] as bool? ?? true,
      highPriorityOnly: map['highPriorityOnly'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'newQuestions': newQuestions,
      'sessionUpdates': sessionUpdates,
      'highPriorityOnly': highPriorityOnly,
    };
  }

  static NotificationPreferences defaults() => NotificationPreferences();

  NotificationPreferences copyWith({
    bool? newQuestions,
    bool? sessionUpdates,
    bool? highPriorityOnly,
  }) {
    return NotificationPreferences(
      newQuestions: newQuestions ?? this.newQuestions,
      sessionUpdates: sessionUpdates ?? this.sessionUpdates,
      highPriorityOnly: highPriorityOnly ?? this.highPriorityOnly,
    );
  }
}
