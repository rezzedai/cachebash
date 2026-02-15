import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/session_model.dart';
import 'auth_provider.dart';

void _log(String message) {
  debugPrint('[SessionsProvider] $message');
}

final firestore = FirebaseFirestore.instance;

/// Stream provider for active sessions (not stale, not archived)
final activeSessionsProvider = StreamProvider<List<SessionModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  if (user == null) {
    return Stream.value([]);
  }

  return firestore
      .collection('users/${user.uid}/sessions')
      .where('archived', isNotEqualTo: true)
      .orderBy('archived')
      .orderBy('lastUpdate', descending: true)
      .limit(20)
      .snapshots()
      .map((snapshot) {
    final sessions =
        snapshot.docs.map((doc) => SessionModel.fromFirestore(doc)).toList();
    // Filter to only active (not stale) sessions
    return sessions.where((s) => s.isActive).toList();
  });
});

/// Stream provider for inactive/stale sessions (stale but not archived)
final inactiveSessionsProvider = StreamProvider<List<SessionModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  if (user == null) {
    return Stream.value([]);
  }

  return firestore
      .collection('users/${user.uid}/sessions')
      .where('archived', isNotEqualTo: true)
      .orderBy('archived')
      .orderBy('lastUpdate', descending: true)
      .limit(50)
      .snapshots()
      .map((snapshot) {
    final sessions =
        snapshot.docs.map((doc) => SessionModel.fromFirestore(doc)).toList();
    // Filter to only stale sessions
    return sessions.where((s) => s.isStale && !s.isComplete).toList();
  });
});

/// Stream provider for archived sessions
final archivedSessionsProvider = StreamProvider<List<SessionModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  if (user == null) {
    return Stream.value([]);
  }

  return firestore
      .collection('users/${user.uid}/sessions')
      .where('archived', isEqualTo: true)
      .orderBy('archivedAt', descending: true)
      .limit(50)
      .snapshots()
      .map((snapshot) =>
          snapshot.docs.map((doc) => SessionModel.fromFirestore(doc)).toList());
});

/// Stream provider for all non-archived sessions (for sessions screen)
final allSessionsProvider = StreamProvider<List<SessionModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  if (user == null) {
    return Stream.value([]);
  }

  return firestore
      .collection('users/${user.uid}/sessions')
      .orderBy('lastUpdate', descending: true)
      .limit(100)
      .snapshots()
      .map((snapshot) =>
          snapshot.docs.map((doc) => SessionModel.fromFirestore(doc)).toList());
});

/// Stream provider for a single session by ID
final sessionProvider =
    StreamProvider.family<SessionModel?, String>((ref, sessionId) {
  final user = ref.watch(currentUserProvider);
  if (user == null) {
    return Stream.value(null);
  }

  _log('Watching session $sessionId');

  return firestore
      .doc('users/${user.uid}/sessions/$sessionId')
      .snapshots()
      .map((doc) {
    if (!doc.exists) {
      _log('Session $sessionId not found');
      return null;
    }
    return SessionModel.fromFirestore(doc);
  });
});

/// Stream provider for session status history
final sessionUpdatesProvider =
    StreamProvider.family<List<StatusUpdate>, String>((ref, sessionId) {
  final user = ref.watch(currentUserProvider);
  if (user == null) {
    return Stream.value([]);
  }

  _log('Watching status updates for session $sessionId');

  return firestore
      .collection('users/${user.uid}/sessions/$sessionId/updates')
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .map((snapshot) =>
          snapshot.docs.map((doc) => StatusUpdate.fromFirestore(doc)).toList());
});

/// Service for session-related operations
class SessionsService {
  final FirebaseFirestore _firestore;

  SessionsService({FirebaseFirestore? firestore})
      : _firestore = firestore ?? FirebaseFirestore.instance;

  /// Send an interrupt message to a session (creates a task)
  Future<void> sendInterrupt({
    required String userId,
    required String sessionId,
    required String message,
  }) async {
    _log('Sending interrupt to session $sessionId');

    final taskRef = _firestore.collection('users/$userId/tasks').doc();

    await taskRef.set({
      'type': 'task',
      'title': 'Session reply',
      'instructions': message,
      'sessionId': sessionId,
      'priority': 'high',
      'status': 'created',
      'action': 'interrupt',
      'createdAt': FieldValue.serverTimestamp(),
      'archived': false,
      'encrypted': false,
      'source': 'flynn',
    });

    _log('Interrupt sent as task with ID ${taskRef.id}');
  }

  /// Archive a session
  Future<void> archiveSession({
    required String userId,
    required String sessionId,
  }) async {
    _log('Archiving session $sessionId');

    await _firestore.doc('users/$userId/sessions/$sessionId').update({
      'archived': true,
      'archivedAt': FieldValue.serverTimestamp(),
    });

    _log('Session $sessionId archived');
  }

  /// Unarchive a session
  Future<void> unarchiveSession({
    required String userId,
    required String sessionId,
  }) async {
    _log('Unarchiving session $sessionId');

    await _firestore.doc('users/$userId/sessions/$sessionId').update({
      'archived': false,
      'archivedAt': null,
    });

    _log('Session $sessionId unarchived');
  }

  /// Mark a session as complete
  Future<void> markComplete({
    required String userId,
    required String sessionId,
  }) async {
    _log('Marking session $sessionId as complete');

    await _firestore.doc('users/$userId/sessions/$sessionId').update({
      'state': 'complete',
      'progress': 100,
    });

    _log('Session $sessionId marked complete');
  }

  /// Archive all stale/inactive sessions
  Future<int> archiveAllStale({required String userId}) async {
    _log('Archiving all stale sessions');

    final snapshot = await _firestore
        .collection('users/$userId/sessions')
        .where('archived', isNotEqualTo: true)
        .get();

    final staleSessions = snapshot.docs
        .map((doc) => SessionModel.fromFirestore(doc))
        .where((s) => s.isStale && !s.isComplete)
        .toList();

    if (staleSessions.isEmpty) {
      _log('No stale sessions to archive');
      return 0;
    }

    final batch = _firestore.batch();
    for (final session in staleSessions) {
      batch.update(_firestore.doc('users/$userId/sessions/${session.id}'), {
        'archived': true,
        'archivedAt': FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    _log('Archived ${staleSessions.length} stale sessions');
    return staleSessions.length;
  }

  /// Delete a session permanently
  Future<void> deleteSession({
    required String userId,
    required String sessionId,
  }) async {
    _log('Deleting session $sessionId');

    await _firestore.doc('users/$userId/sessions/$sessionId').delete();

    _log('Session $sessionId deleted');
  }
}

/// Provider for sessions service
final sessionsServiceProvider = Provider<SessionsService>((ref) {
  return SessionsService();
});
