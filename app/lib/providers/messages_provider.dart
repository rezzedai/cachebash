import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/message_model.dart';
import '../services/encryption_service.dart';
import 'auth_provider.dart';

final _firestore = FirebaseFirestore.instance;

void _log(String message) {
  debugPrint('[MessagesProvider] $message');
}

/// Helper to decrypt question tasks into MessageModels
Future<List<MessageModel>> _decryptQuestionTasks(
  List<QueryDocumentSnapshot> docs,
  EncryptionService encryptionService,
) async {
  return await Future.wait(
    docs.map((doc) => MessageModel.fromQuestionTaskDecrypted(doc, encryptionService)),
  );
}

/// Stream provider for inbox (pending questions needing response)
final inboxProvider = StreamProvider<List<MessageModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  _log('inboxProvider: user=${user?.uid}');
  if (user == null) return Stream.value([]);

  return _firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'question')
      .where('status', isEqualTo: 'created')
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .asyncMap((snapshot) async {
        _log('inboxProvider: Got ${snapshot.docs.length} docs');
        return await _decryptQuestionTasks(snapshot.docs, encryptionService);
      })
      .handleError((error, stackTrace) {
        _log('inboxProvider ERROR: $error');
        throw error;
      });
});

/// Stream provider for pending questions (backward compat alias)
final pendingMessagesProvider = StreamProvider<List<MessageModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  if (user == null) return Stream.value([]);

  return _firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'question')
      .where('status', isEqualTo: 'created')
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .asyncMap((snapshot) async {
        _log('pendingMessagesProvider: Got ${snapshot.docs.length} docs');
        return await _decryptQuestionTasks(snapshot.docs, encryptionService);
      })
      .handleError((error, stackTrace) {
        _log('pendingMessagesProvider ERROR: $error');
        throw error;
      });
});

/// Stream provider for active (non-archived) questions
final activeMessagesProvider = StreamProvider<List<MessageModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  _log('activeMessagesProvider: user=${user?.uid}');
  if (user == null) return Stream.value([]);

  return _firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'question')
      .where('archived', isEqualTo: false)
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .asyncMap((snapshot) async {
        _log('activeMessagesProvider: Got ${snapshot.docs.length} docs');
        return await _decryptQuestionTasks(snapshot.docs, encryptionService);
      })
      .handleError((error, stackTrace) {
        _log('activeMessagesProvider ERROR: $error');
        throw error;
      });
});

/// Stream provider for all questions
final allMessagesProvider = StreamProvider<List<MessageModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  if (user == null) return Stream.value([]);

  return _firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'question')
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .asyncMap((snapshot) async {
        _log('allMessagesProvider: Got ${snapshot.docs.length} docs');
        return await _decryptQuestionTasks(snapshot.docs, encryptionService);
      })
      .handleError((error, stackTrace) {
        _log('allMessagesProvider ERROR: $error');
        throw error;
      });
});

/// Stream provider for archived questions
final archivedMessagesProvider = StreamProvider<List<MessageModel>>((ref) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  if (user == null) return Stream.value([]);

  return _firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'question')
      .where('archived', isEqualTo: true)
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .asyncMap((snapshot) async {
        _log('archivedMessagesProvider: Got ${snapshot.docs.length} docs');
        return await _decryptQuestionTasks(snapshot.docs, encryptionService);
      })
      .handleError((error, stackTrace) {
        _log('archivedMessagesProvider ERROR: $error');
        throw error;
      });
});

/// Stream provider for questions by project
final messagesByProjectProvider =
    StreamProvider.family<List<MessageModel>, String?>((ref, projectId) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  if (user == null) return Stream.value([]);

  Query query = _firestore
      .collection('users/${user.uid}/tasks')
      .where('type', isEqualTo: 'question')
      .where('archived', isEqualTo: false);

  if (projectId == null || projectId == '_uncategorized') {
    query = query.where('projectId', isNull: true);
  } else {
    query = query.where('projectId', isEqualTo: projectId);
  }

  return query
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .asyncMap((snapshot) async {
        _log('messagesByProjectProvider: Got ${snapshot.docs.length} docs for project $projectId');
        return await _decryptQuestionTasks(
            snapshot.docs.cast<QueryDocumentSnapshot>(), encryptionService);
      })
      .handleError((error, stackTrace) {
        _log('messagesByProjectProvider ERROR: $error');
        throw error;
      });
});

/// Provider for a single question by ID
final messageProvider =
    StreamProvider.family<MessageModel?, String>((ref, messageId) {
  final user = ref.watch(currentUserProvider);
  final encryptionService = ref.watch(encryptionServiceProvider);
  if (user == null) return Stream.value(null);

  return _firestore
      .doc('users/${user.uid}/tasks/$messageId')
      .snapshots()
      .asyncMap((doc) async {
        if (!doc.exists) return null;
        return await MessageModel.fromQuestionTaskDecrypted(doc, encryptionService);
      });
});

/// Service for question/message operations (writes to tasks collection)
class MessagesService {
  final FirebaseFirestore _firestore;
  final EncryptionService _encryptionService;

  MessagesService({FirebaseFirestore? firestore, EncryptionService? encryptionService})
      : _firestore = firestore ?? FirebaseFirestore.instance,
        _encryptionService = encryptionService ?? EncryptionService();

  /// Answer a question (updates question.response in tasks collection)
  Future<void> answerMessage({
    required String userId,
    required String messageId,
    required String response,
    bool encrypt = true,
  }) async {
    final doc = await _firestore.doc('users/$userId/tasks/$messageId').get();
    final isMessageEncrypted = doc.data()?['encrypted'] as bool? ?? false;

    String finalResponse = response;
    bool shouldEncrypt = encrypt && isMessageEncrypted;

    if (shouldEncrypt) {
      try {
        finalResponse = await _encryptionService.encrypt(response);
        _log('Response encrypted successfully');
      } on EncryptionException catch (e) {
        _log('Encryption failed, aborting response: $e');
        throw Exception('Cannot send encrypted response: encryption unavailable');
      }
    }

    await _firestore.doc('users/$userId/tasks/$messageId').update({
      'question.response': finalResponse,
      'question.answeredAt': FieldValue.serverTimestamp(),
      'status': 'done',
    });
  }

  /// Cancel a question
  Future<void> cancelMessage({
    required String userId,
    required String messageId,
  }) async {
    _log('Cancelling question $messageId');
    await _firestore.doc('users/$userId/tasks/$messageId').update({
      'status': 'derezzed',
    });
  }

  /// Mark a question as expired
  Future<void> expireMessage({
    required String userId,
    required String messageId,
  }) async {
    await _firestore.doc('users/$userId/tasks/$messageId').update({
      'status': 'derezzed',
    });
  }

  /// Archive a question
  Future<void> archiveMessage({
    required String userId,
    required String messageId,
  }) async {
    _log('Archiving question $messageId');
    await _firestore.doc('users/$userId/tasks/$messageId').update({
      'archived': true,
    });
  }

  /// Unarchive a question
  Future<void> unarchiveMessage({
    required String userId,
    required String messageId,
  }) async {
    _log('Unarchiving question $messageId');
    await _firestore.doc('users/$userId/tasks/$messageId').update({
      'archived': false,
    });
  }

  /// Soft delete a question (derez it)
  Future<void> deleteMessage({
    required String userId,
    required String messageId,
  }) async {
    _log('Deleting question $messageId');
    await _firestore.doc('users/$userId/tasks/$messageId').update({
      'status': 'derezzed',
    });
  }

  /// Hard delete a question permanently
  Future<void> permanentlyDeleteMessage({
    required String userId,
    required String messageId,
  }) async {
    _log('Permanently deleting question $messageId');
    await _firestore.doc('users/$userId/tasks/$messageId').delete();
  }

  /// Move question to a project
  Future<void> moveToProject({
    required String userId,
    required String messageId,
    String? projectId,
  }) async {
    await _firestore.doc('users/$userId/tasks/$messageId').update({
      'projectId': projectId,
    });
  }

  /// Update question priority
  Future<void> updatePriority({
    required String userId,
    required String messageId,
    required String priority,
  }) async {
    await _firestore.doc('users/$userId/tasks/$messageId').update({
      'priority': priority,
    });
  }

  /// Acknowledge an alert (mark as done)
  Future<void> acknowledgeAlert({
    required String userId,
    required String messageId,
  }) async {
    _log('Acknowledging alert $messageId');
    await _firestore.doc('users/$userId/tasks/$messageId').update({
      'status': 'done',
    });
  }

  /// Create a reply to an alert (creates a task linked to the alert)
  Future<String> createReplyToAlert({
    required String userId,
    required String alertId,
    required String replyText,
    String? sessionId,
  }) async {
    _log('Creating reply to alert $alertId');

    final taskRef = _firestore.collection('users/$userId/tasks').doc();

    await taskRef.set({
      'type': 'task',
      'title': 'Reply to alert',
      'instructions': replyText,
      'priority': 'high',
      'action': 'interrupt',
      'status': 'created',
      'createdAt': FieldValue.serverTimestamp(),
      'sessionId': sessionId,
      'replyTo': alertId,
      'archived': false,
      'encrypted': false,
      'source': 'flynn',
    });

    _log('Reply to alert created with ID ${taskRef.id}');
    return taskRef.id;
  }
}

/// Provider for messages service
final messagesServiceProvider = Provider<MessagesService>((ref) {
  return MessagesService();
});

/// Thread group model for grouping related messages
class ThreadGroup {
  final String threadId;
  final List<MessageModel> messages;

  ThreadGroup({required this.threadId, required this.messages});

  MessageModel get latestMessage =>
      messages.reduce((a, b) => a.createdAt.isAfter(b.createdAt) ? a : b);

  MessageModel get threadStarter =>
      messages.firstWhere((m) => m.inReplyTo == null, orElse: () => messages.first);

  bool get hasMultipleMessages => messages.length > 1;
  int get messageCount => messages.length;
  int get replyCount => messages.length - 1;
}

/// Groups a flat list of messages by their threadId
List<ThreadGroup> groupMessagesByThread(List<MessageModel> messages) {
  final Map<String, List<MessageModel>> groups = {};
  final List<MessageModel> standalone = [];

  for (final message in messages) {
    if (message.threadId != null) {
      groups.putIfAbsent(message.threadId!, () => []).add(message);
    } else {
      standalone.add(message);
    }
  }

  final result = <ThreadGroup>[];

  for (final entry in groups.entries) {
    entry.value.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    result.add(ThreadGroup(threadId: entry.key, messages: entry.value));
  }

  for (final message in standalone) {
    result.add(ThreadGroup(threadId: message.id, messages: [message]));
  }

  result.sort((a, b) => b.latestMessage.createdAt.compareTo(a.latestMessage.createdAt));

  return result;
}

/// Provider for messages grouped by thread
final threadedMessagesProvider = StreamProvider<List<ThreadGroup>>((ref) {
  final messagesAsync = ref.watch(activeMessagesProvider);

  return messagesAsync.when(
    data: (messages) => Stream.value(groupMessagesByThread(messages)),
    loading: () => const Stream.empty(),
    error: (e, s) => Stream.error(e, s),
  );
});
