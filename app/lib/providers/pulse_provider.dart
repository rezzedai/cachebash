import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/session_model.dart';
import '../models/task_model.dart';
import '../services/encryption_service.dart';
import 'auth_provider.dart';

final _firestore = FirebaseFirestore.instance;

/// Stream all non-archived sessions (for program pulse dots)
final allActiveSessionsProvider = StreamProvider<List<SessionModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  if (user == null) return Stream.value([]);

  return _firestore
      .collection('users/${user.uid}/sessions')
      .where('archived', isEqualTo: false)
      .where('state', whereIn: ['working', 'blocked', 'pinned'])
      .orderBy('lastUpdate', descending: true)
      .limit(20)
      .snapshots()
      .map((snapshot) =>
          snapshot.docs.map((doc) => SessionModel.fromFirestore(doc)).toList());
});

/// Stream pending tasks for queue summary (type: "task", status: "created")
final pendingTaskQueueProvider = StreamProvider<List<TaskModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  if (user == null) return Stream.value([]);

  return _firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'task')
      .where('status', isEqualTo: 'created')
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .asyncMap((snapshot) async {
    return await Future.wait(
      snapshot.docs.map((doc) =>
          TaskModel.fromFirestoreDecrypted(doc, encryptionService)),
    );
  });
});
