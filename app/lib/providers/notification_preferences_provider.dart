import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/notification_preferences_model.dart';
import 'auth_provider.dart';

final _firestore = FirebaseFirestore.instance;

void _log(String message) {
  debugPrint('[NotificationPreferencesProvider] $message');
}

/// Stream provider for notification preferences (real-time sync)
final notificationPreferencesProvider =
    StreamProvider<NotificationPreferences>((ref) {
  final user = ref.watch(currentUserProvider);
  _log('user=${user?.uid}');

  if (user == null) {
    _log('No user, returning defaults');
    return Stream.value(NotificationPreferences.defaults());
  }

  _log('Setting up stream for user ${user.uid}');
  return _firestore.doc('users/${user.uid}').snapshots().map((doc) {
    final data = doc.data();
    if (data == null) {
      _log('No user doc, returning defaults');
      return NotificationPreferences.defaults();
    }

    final prefsMap = data['notificationPreferences'] as Map<String, dynamic>?;
    if (prefsMap == null) {
      _log('No preferences field, returning defaults');
      return NotificationPreferences.defaults();
    }

    _log('Got preferences: $prefsMap');
    return NotificationPreferences.fromMap(prefsMap);
  }).handleError((error, stackTrace) {
    _log('ERROR: $error');
    _log('STACK: $stackTrace');
    throw error;
  });
});

/// Service for updating notification preferences
class NotificationPreferencesService {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  /// Update one or more notification preferences
  Future<void> updatePreferences(
    String userId, {
    bool? newQuestions,
    bool? sessionUpdates,
    bool? dreamCompletions,
    bool? dreamBudgetWarnings,
    bool? sprintUpdates,
    bool? highPriorityOnly,
    bool? quietHoursEnabled,
    int? quietHoursStart,
    int? quietHoursEnd,
  }) async {
    final updates = <String, dynamic>{};

    if (newQuestions != null) updates['notificationPreferences.newQuestions'] = newQuestions;
    if (sessionUpdates != null) updates['notificationPreferences.sessionUpdates'] = sessionUpdates;
    if (dreamCompletions != null) updates['notificationPreferences.dreamCompletions'] = dreamCompletions;
    if (dreamBudgetWarnings != null) updates['notificationPreferences.dreamBudgetWarnings'] = dreamBudgetWarnings;
    if (sprintUpdates != null) updates['notificationPreferences.sprintUpdates'] = sprintUpdates;
    if (highPriorityOnly != null) updates['notificationPreferences.highPriorityOnly'] = highPriorityOnly;
    if (quietHoursEnabled != null) updates['notificationPreferences.quietHoursEnabled'] = quietHoursEnabled;
    if (quietHoursStart != null) updates['notificationPreferences.quietHoursStart'] = quietHoursStart;
    if (quietHoursEnd != null) updates['notificationPreferences.quietHoursEnd'] = quietHoursEnd;

    if (updates.isEmpty) return;

    _log('Updating preferences for $userId: $updates');
    await _firestore.doc('users/$userId').update(updates);
  }
}

final notificationPreferencesServiceProvider =
    Provider<NotificationPreferencesService>((ref) {
  return NotificationPreferencesService();
});
