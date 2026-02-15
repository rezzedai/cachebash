import 'package:cloud_firestore/cloud_firestore.dart';

import '../services/encryption_service.dart';

/// Model representing a question from Claude Code
class QuestionModel {
  final String id;
  final String question;
  final List<String>? options;
  final String priority;
  final String status;
  final String? context;
  final String? response;
  final DateTime createdAt;
  final DateTime? answeredAt;
  final String? projectId;
  final bool archived;
  final DateTime? deletedAt;
  final bool isEncrypted;

  QuestionModel({
    required this.id,
    required this.question,
    this.options,
    required this.priority,
    required this.status,
    this.context,
    this.response,
    required this.createdAt,
    this.answeredAt,
    this.projectId,
    this.archived = false,
    this.deletedAt,
    this.isEncrypted = false,
  });

  /// Create from Firestore without decryption (raw data)
  factory QuestionModel.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>?;
    return QuestionModel(
      id: doc.id,
      question: data?['question'] ?? '',
      options: (data?['options'] as List<dynamic>?)?.cast<String>(),
      priority: data?['priority'] ?? 'normal',
      status: data?['status'] ?? 'pending',
      context: data?['context'] as String?,
      response: data?['response'] as String?,
      createdAt: (data?['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      answeredAt: (data?['answeredAt'] as Timestamp?)?.toDate(),
      projectId: data?['projectId'] as String?,
      archived: data?['archived'] as bool? ?? false,
      deletedAt: (data?['deletedAt'] as Timestamp?)?.toDate(),
      isEncrypted: data?['encrypted'] as bool? ?? false,
    );
  }

  /// Create from Firestore with decryption
  static Future<QuestionModel> fromFirestoreDecrypted(
    DocumentSnapshot doc,
    EncryptionService encryptionService,
  ) async {
    final data = doc.data() as Map<String, dynamic>?;
    final isEncrypted = data?['encrypted'] as bool? ?? false;

    String question = data?['question'] ?? '';
    String? context = data?['context'] as String?;
    String? response = data?['response'] as String?;
    List<String>? options = (data?['options'] as List<dynamic>?)?.cast<String>();

    // Decrypt fields if marked as encrypted
    if (isEncrypted) {
      question = await encryptionService.decryptIfNeeded(question);
      context = context != null ? await encryptionService.decryptIfNeeded(context) : null;
      response = response != null ? await encryptionService.decryptIfNeeded(response) : null;
      if (options != null) {
        final decryptedOptions = <String>[];
        for (final option in options) {
          decryptedOptions.add(await encryptionService.decryptIfNeeded(option));
        }
        options = decryptedOptions;
      }
    }

    return QuestionModel(
      id: doc.id,
      question: question,
      options: options,
      priority: data?['priority'] ?? 'normal',
      status: data?['status'] ?? 'pending',
      context: context,
      response: response,
      createdAt: (data?['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      answeredAt: (data?['answeredAt'] as Timestamp?)?.toDate(),
      projectId: data?['projectId'] as String?,
      archived: data?['archived'] as bool? ?? false,
      deletedAt: (data?['deletedAt'] as Timestamp?)?.toDate(),
      isEncrypted: isEncrypted,
    );
  }

  /// Create from v2 tasks collection (type: "question")
  factory QuestionModel.fromTaskDocument(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>?;
    final questionData = data?['question'] as Map<String, dynamic>? ?? {};
    final lifecycleStatus = data?['status'] as String? ?? 'created';

    return QuestionModel(
      id: doc.id,
      question: questionData['content'] ?? data?['instructions'] ?? '',
      options: (questionData['options'] as List<dynamic>?)?.cast<String>(),
      priority: data?['priority'] ?? 'normal',
      status: _mapLifecycleStatus(lifecycleStatus),
      context: questionData['context'] as String?,
      response: questionData['response'] as String?,
      createdAt: (data?['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      answeredAt: (questionData['answeredAt'] as Timestamp?)?.toDate(),
      projectId: data?['projectId'] as String?,
      archived: data?['archived'] as bool? ?? false,
      isEncrypted: data?['encrypted'] as bool? ?? false,
    );
  }

  /// Create from v2 tasks collection with decryption
  static Future<QuestionModel> fromTaskDocumentDecrypted(
    DocumentSnapshot doc,
    EncryptionService encryptionService,
  ) async {
    final data = doc.data() as Map<String, dynamic>?;
    final isEncrypted = data?['encrypted'] as bool? ?? false;
    final questionData = data?['question'] as Map<String, dynamic>? ?? {};
    final lifecycleStatus = data?['status'] as String? ?? 'created';

    String question = questionData['content'] ?? data?['instructions'] ?? '';
    String? context = questionData['context'] as String?;
    String? response = questionData['response'] as String?;
    List<String>? options = (questionData['options'] as List<dynamic>?)?.cast<String>();

    if (isEncrypted) {
      question = await encryptionService.decryptIfNeeded(question);
      context = context != null ? await encryptionService.decryptIfNeeded(context) : null;
      response = response != null ? await encryptionService.decryptIfNeeded(response) : null;
      if (options != null) {
        final decryptedOptions = <String>[];
        for (final option in options) {
          decryptedOptions.add(await encryptionService.decryptIfNeeded(option));
        }
        options = decryptedOptions;
      }
    }

    return QuestionModel(
      id: doc.id,
      question: question,
      options: options,
      priority: data?['priority'] ?? 'normal',
      status: _mapLifecycleStatus(lifecycleStatus),
      context: context,
      response: response,
      createdAt: (data?['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      answeredAt: (questionData['answeredAt'] as Timestamp?)?.toDate(),
      projectId: data?['projectId'] as String?,
      archived: data?['archived'] as bool? ?? false,
      isEncrypted: isEncrypted,
    );
  }

  /// Map v2 lifecycle status to legacy question status
  static String _mapLifecycleStatus(String status) {
    switch (status) {
      case 'created':
        return 'pending';
      case 'active':
        return 'pending';
      case 'done':
        return 'answered';
      case 'failed':
      case 'derezzed':
        return 'expired';
      default:
        return status;
    }
  }

  bool get isPending => status == 'pending';
  bool get isAnswered => status == 'answered';
  bool get isExpired => status == 'expired';
  bool get isHighPriority => priority == 'high';
  bool get hasOptions => options != null && options!.isNotEmpty;
  bool get isArchived => archived;
  bool get isDeleted => deletedAt != null;
  bool get hasProject => projectId != null;

  QuestionModel copyWith({
    String? id,
    String? question,
    List<String>? options,
    String? priority,
    String? status,
    String? context,
    String? response,
    DateTime? createdAt,
    DateTime? answeredAt,
    String? projectId,
    bool? archived,
    DateTime? deletedAt,
    bool? isEncrypted,
  }) {
    return QuestionModel(
      id: id ?? this.id,
      question: question ?? this.question,
      options: options ?? this.options,
      priority: priority ?? this.priority,
      status: status ?? this.status,
      context: context ?? this.context,
      response: response ?? this.response,
      createdAt: createdAt ?? this.createdAt,
      answeredAt: answeredAt ?? this.answeredAt,
      projectId: projectId ?? this.projectId,
      archived: archived ?? this.archived,
      deletedAt: deletedAt ?? this.deletedAt,
      isEncrypted: isEncrypted ?? this.isEncrypted,
    );
  }
}
