import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/task_model.dart';
import '../services/encryption_service.dart';
import 'auth_provider.dart';

void _log(String message) {
  debugPrint('[TasksProvider] $message');
}

final _firestore = FirebaseFirestore.instance;

/// Helper to decrypt a list of task documents
Future<List<TaskModel>> _decryptTasks(
  List<QueryDocumentSnapshot> docs,
  EncryptionService encryptionService,
) async {
  return await Future.wait(
    docs.map((doc) => TaskModel.fromFirestoreDecrypted(doc, encryptionService)),
  );
}

/// Stream provider for pending tasks (type: "task", status: "created")
final pendingTasksProvider = StreamProvider<List<TaskModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  if (user == null) return Stream.value([]);

  return _firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'task')
      .where('status', isEqualTo: 'created')
      .orderBy('createdAt', descending: true)
      .limit(20)
      .snapshots()
      .asyncMap((snapshot) => _decryptTasks(snapshot.docs, encryptionService));
});

/// Stream provider for active tasks (type: "task", status: "active")
final activeTasksProvider = StreamProvider<List<TaskModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  if (user == null) return Stream.value([]);

  return _firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'task')
      .where('status', isEqualTo: 'active')
      .orderBy('startedAt', descending: true)
      .limit(10)
      .snapshots()
      .asyncMap((snapshot) => _decryptTasks(snapshot.docs, encryptionService));
});

/// V1 compat alias for activeTasksProvider
final inProgressTasksProvider = activeTasksProvider;

/// Stream provider for all recent tasks (all types)
final recentTasksProvider = StreamProvider<List<TaskModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  if (user == null) return Stream.value([]);

  return _firestore
      .collection('users/${user.uid}/tasks')
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .asyncMap((snapshot) => _decryptTasks(snapshot.docs, encryptionService));
});

/// Stream provider for tasks by type
final tasksByTypeProvider =
    StreamProvider.family<List<TaskModel>, String>((ref, type) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  if (user == null) return Stream.value([]);

  return _firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: type)
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .asyncMap((snapshot) => _decryptTasks(snapshot.docs, encryptionService));
});

/// Service for task-related operations
class TasksService {
  final FirebaseFirestore _firestore;
  final EncryptionService _encryptionService;

  TasksService({FirebaseFirestore? firestore, EncryptionService? encryptionService})
      : _firestore = firestore ?? FirebaseFirestore.instance,
        _encryptionService = encryptionService ?? EncryptionService();

  /// Create a new task for Claude Code to pick up
  Future<String> createTask({
    required String userId,
    required String title,
    required String instructions,
    String? projectId,
    String priority = 'normal',
    TaskAction action = TaskAction.queue,
    bool encrypt = false,
    String? target,
    String? source,
  }) async {
    _log('Creating task: $title (action: ${action.value})');

    final taskRef = _firestore.collection('users/$userId/tasks').doc();

    String finalTitle = title;
    String finalInstructions = instructions;
    String finalAction = action.value;
    bool isEncrypted = false;

    if (encrypt) {
      try {
        finalTitle = await _encryptionService.encrypt(title);
        finalInstructions = await _encryptionService.encrypt(instructions);
        finalAction = await _encryptionService.encrypt(action.value);
        isEncrypted = true;
        _log('Task encrypted successfully');
      } catch (e) {
        _log('Encryption failed, storing unencrypted: $e');
      }
    }

    await taskRef.set({
      'type': 'task',
      'title': finalTitle,
      'instructions': finalInstructions,
      'projectId': projectId,
      'priority': priority,
      'action': finalAction,
      'status': 'created',
      'createdAt': FieldValue.serverTimestamp(),
      'startedAt': null,
      'completedAt': null,
      'sessionId': null,
      'encrypted': isEncrypted,
      'target': target,
      'source': source ?? 'flynn',
      'archived': false,
    });

    _log('Task created with ID ${taskRef.id}');
    return taskRef.id;
  }

  /// Cancel a task (derez it)
  Future<void> cancelTask({
    required String userId,
    required String taskId,
  }) async {
    _log('Cancelling task $taskId');

    await _firestore.doc('users/$userId/tasks/$taskId').update({
      'status': 'derezzed',
    });

    _log('Task $taskId derezzed');
  }

  /// Delete a task permanently
  Future<void> deleteTask({
    required String userId,
    required String taskId,
  }) async {
    _log('Deleting task $taskId');

    await _firestore.doc('users/$userId/tasks/$taskId').delete();

    _log('Task $taskId deleted');
  }

  /// Update task priority
  Future<void> updatePriority({
    required String userId,
    required String taskId,
    required String priority,
  }) async {
    _log('Updating task $taskId priority to $priority');

    await _firestore.doc('users/$userId/tasks/$taskId').update({
      'priority': priority,
    });
  }
}

/// Provider for tasks service
final tasksServiceProvider = Provider<TasksService>((ref) {
  return TasksService();
});
