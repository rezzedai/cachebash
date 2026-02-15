import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/dream_session_model.dart';
import 'auth_provider.dart';

void _log(String message) {
  debugPrint('[DreamSessionsProvider] $message');
}

final firestore = FirebaseFirestore.instance;

/// Stream provider for active dream sessions (created or active)
/// In v2, dreams are tasks with type: "dream" in users/{uid}/tasks
final activeDreamSessionsProvider =
    StreamProvider<List<DreamSessionModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  if (user == null) return Stream.value([]);

  return firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'dream')
      .where('status', whereIn: ['created', 'active'])
      .orderBy('createdAt', descending: true)
      .limit(10)
      .snapshots()
      .map((snapshot) => snapshot.docs
          .map((doc) => DreamSessionModel.fromFirestore(doc))
          .toList());
});

/// Stream provider for a single dream session by ID
final dreamSessionProvider =
    StreamProvider.family<DreamSessionModel?, String>((ref, dreamId) {
  final user = ref.watch(currentUserProvider);
  if (user == null) return Stream.value(null);

  _log('Watching dream session $dreamId');

  return firestore
      .doc('users/${user.uid}/tasks/$dreamId')
      .snapshots()
      .map((doc) {
    if (!doc.exists) {
      _log('Dream session $dreamId not found');
      return null;
    }
    return DreamSessionModel.fromFirestore(doc);
  });
});

/// Stream provider for dream session history (done/failed/derezzed)
final dreamSessionHistoryProvider =
    StreamProvider<List<DreamSessionModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  if (user == null) return Stream.value([]);

  return firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'dream')
      .where('status', whereIn: ['done', 'failed', 'derezzed'])
      .orderBy('completedAt', descending: true)
      .limit(20)
      .snapshots()
      .map((snapshot) => snapshot.docs
          .map((doc) => DreamSessionModel.fromFirestore(doc))
          .toList());
});

/// Service for dream session operations
class DreamSessionsService {
  final FirebaseFirestore _firestore;

  DreamSessionsService({FirebaseFirestore? firestore})
      : _firestore = firestore ?? FirebaseFirestore.instance;

  /// Create a new dream session as a task with type: "dream"
  Future<String> createDreamSession({
    required String userId,
    required String agent,
    String? taskId,
    double budgetCapUsd = 5.0,
    int timeoutHours = 4,
  }) async {
    final now = DateTime.now();
    final slug = taskId ?? 'task';
    final datePart =
        '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    final branch = 'dream/$datePart/$slug';

    _log('Creating dream session: agent=$agent, budget=\$$budgetCapUsd');

    final docRef = _firestore.collection('users/$userId/tasks').doc();

    await docRef.set({
      'type': 'dream',
      'title': 'Dream Session',
      'instructions': taskId != null ? 'Dream session for task $taskId' : 'Dream session',
      'status': 'created',
      'priority': 'normal',
      'action': 'queue',
      'source': 'flynn',
      'createdAt': FieldValue.serverTimestamp(),
      'archived': false,
      'encrypted': false,
      'replyTo': taskId,
      'dream': {
        'agent': agent,
        'budgetCapUsd': budgetCapUsd,
        'budgetConsumedUsd': 0.0,
        'timeoutHours': timeoutHours,
        'branch': branch,
        'prUrl': null,
        'outcome': null,
        'morningReport': null,
      },
    });

    _log('Dream session created: ${docRef.id}');
    return docRef.id;
  }

  /// Kill a running dream session
  Future<void> killDreamSession({
    required String userId,
    required String dreamId,
  }) async {
    _log('Killing dream session $dreamId');

    await _firestore.doc('users/$userId/tasks/$dreamId').update({
      'status': 'derezzed',
      'completedAt': FieldValue.serverTimestamp(),
    });

    _log('Dream session $dreamId killed');
  }
}

/// Provider for dream sessions service
final dreamSessionsServiceProvider = Provider<DreamSessionsService>((ref) {
  return DreamSessionsService();
});
