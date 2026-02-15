import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/question_model.dart';
import '../services/encryption_service.dart';
import 'auth_provider.dart';

final firestore = FirebaseFirestore.instance;

void _log(String message) {
  debugPrint('[QuestionsProvider] $message');
}

/// Helper to decrypt question task documents into QuestionModels
Future<List<QuestionModel>> _decryptQuestionTasks(
  List<QueryDocumentSnapshot> docs,
  EncryptionService encryptionService,
) async {
  final questions = await Future.wait(
    docs.map((doc) => QuestionModel.fromTaskDocumentDecrypted(doc, encryptionService)),
  );
  return questions;
}

/// Stream provider for pending questions (lifecycle status: created)
final pendingQuestionsProvider = StreamProvider<List<QuestionModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  _log('pendingQuestionsProvider: user=${user?.uid}');
  if (user == null) {
    _log('pendingQuestionsProvider: No user, returning empty');
    return Stream.value([]);
  }

  _log('pendingQuestionsProvider: Setting up stream for user ${user.uid}');
  return firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'question')
      .where('status', isEqualTo: 'created')
      .orderBy('createdAt', descending: true)
      .snapshots()
      .asyncMap((snapshot) async {
        _log('pendingQuestionsProvider: Got ${snapshot.docs.length} docs');
        return await _decryptQuestionTasks(snapshot.docs, encryptionService);
      })
      .handleError((error, stackTrace) {
        _log('pendingQuestionsProvider ERROR: $error');
        _log('pendingQuestionsProvider STACK: $stackTrace');
        throw error;
      });
});

/// Stream provider for all questions (excluding derezzed)
final allQuestionsProvider = StreamProvider<List<QuestionModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  _log('allQuestionsProvider: user=${user?.uid}');
  if (user == null) {
    _log('allQuestionsProvider: No user, returning empty');
    return Stream.value([]);
  }

  _log('allQuestionsProvider: Setting up stream for user ${user.uid}');
  return firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'question')
      .where('status', whereIn: ['created', 'active', 'done', 'failed'])
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .asyncMap((snapshot) async {
        _log('allQuestionsProvider: Got ${snapshot.docs.length} docs');
        return await _decryptQuestionTasks(snapshot.docs, encryptionService);
      })
      .handleError((error, stackTrace) {
        _log('allQuestionsProvider ERROR: $error');
        _log('allQuestionsProvider STACK: $stackTrace');
        throw error;
      });
});

/// Stream provider for active (non-archived) questions
final activeQuestionsProvider = StreamProvider<List<QuestionModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  _log('activeQuestionsProvider: user=${user?.uid}');
  if (user == null) {
    _log('activeQuestionsProvider: No user, returning empty');
    return Stream.value([]);
  }

  _log('activeQuestionsProvider: Setting up stream for user ${user.uid}');
  return firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'question')
      .where('archived', isEqualTo: false)
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .asyncMap((snapshot) async {
        _log('activeQuestionsProvider: Got ${snapshot.docs.length} docs');
        return await _decryptQuestionTasks(snapshot.docs, encryptionService);
      })
      .handleError((error, stackTrace) {
        _log('activeQuestionsProvider ERROR: $error');
        _log('activeQuestionsProvider STACK: $stackTrace');
        throw error;
      });
});

/// Stream provider for questions by project
final questionsByProjectProvider =
    StreamProvider.family<List<QuestionModel>, String?>((ref, projectId) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  _log('questionsByProjectProvider: user=${user?.uid}, projectId=$projectId');
  if (user == null) {
    _log('questionsByProjectProvider: No user, returning empty');
    return Stream.value([]);
  }

  _log('questionsByProjectProvider: Setting up stream for user ${user.uid}, project $projectId');
  Query query = firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'question')
      .where('archived', isEqualTo: false);

  if (projectId == null || projectId == '_uncategorized') {
    _log('questionsByProjectProvider: Filtering for uncategorized (projectId isNull)');
    query = query.where('projectId', isNull: true);
  } else {
    _log('questionsByProjectProvider: Filtering for projectId=$projectId');
    query = query.where('projectId', isEqualTo: projectId);
  }

  return query
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .asyncMap((snapshot) async {
        _log('questionsByProjectProvider: Got ${snapshot.docs.length} docs for project $projectId');
        return await _decryptQuestionTasks(snapshot.docs.cast<QueryDocumentSnapshot>(), encryptionService);
      })
      .handleError((error, stackTrace) {
        _log('questionsByProjectProvider ERROR: $error');
        _log('questionsByProjectProvider STACK: $stackTrace');
        throw error;
      });
});

/// Provider for a single question by ID
final questionProvider =
    StreamProvider.family<QuestionModel?, String>((ref, questionId) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  if (user == null) {
    return Stream.value(null);
  }

  return firestore
      .doc('users/${user.uid}/tasks/$questionId')
      .snapshots()
      .asyncMap((doc) async {
        if (!doc.exists) return null;
        return await QuestionModel.fromTaskDocumentDecrypted(doc, encryptionService);
      });
});

/// Service for question operations (writes to tasks collection)
class QuestionsService {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final EncryptionService _encryptionService;

  QuestionsService({EncryptionService? encryptionService})
      : _encryptionService = encryptionService ?? EncryptionService();

  /// Submit a response to a question
  Future<void> answerQuestion({
    required String userId,
    required String questionId,
    required String response,
    bool encrypt = true,
  }) async {
    final doc = await _firestore.doc('users/$userId/tasks/$questionId').get();
    final isQuestionEncrypted = doc.data()?['encrypted'] as bool? ?? false;

    String finalResponse = response;
    bool shouldEncrypt = encrypt && isQuestionEncrypted;

    if (shouldEncrypt) {
      try {
        finalResponse = await _encryptionService.encrypt(response);
        _log('Response encrypted successfully');
      } catch (e) {
        _log('Encryption failed, storing unencrypted: $e');
        shouldEncrypt = false;
      }
    }

    await _firestore.doc('users/$userId/tasks/$questionId').update({
      'question.response': finalResponse,
      'question.answeredAt': FieldValue.serverTimestamp(),
      'status': 'done',
      if (shouldEncrypt) 'question.responseEncrypted': true,
    });
  }

  /// Mark a question as expired
  Future<void> expireQuestion({
    required String userId,
    required String questionId,
  }) async {
    await _firestore.doc('users/$userId/tasks/$questionId').update({
      'status': 'derezzed',
    });
  }

  /// Archive a question
  Future<void> archiveQuestion({
    required String userId,
    required String questionId,
  }) async {
    await _firestore.doc('users/$userId/tasks/$questionId').update({
      'archived': true,
    });
  }

  /// Unarchive a question
  Future<void> unarchiveQuestion({
    required String userId,
    required String questionId,
  }) async {
    await _firestore.doc('users/$userId/tasks/$questionId').update({
      'archived': false,
    });
  }

  /// Soft delete a question (derez it)
  Future<void> deleteQuestion({
    required String userId,
    required String questionId,
  }) async {
    await _firestore.doc('users/$userId/tasks/$questionId').update({
      'status': 'derezzed',
    });
  }

  /// Move question to a project
  Future<void> moveToProject({
    required String userId,
    required String questionId,
    String? projectId,
  }) async {
    await _firestore.doc('users/$userId/tasks/$questionId').update({
      'projectId': projectId,
    });
  }
}

final questionsServiceProvider = Provider<QuestionsService>((ref) {
  return QuestionsService();
});
