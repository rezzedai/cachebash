import 'package:cloud_firestore/cloud_firestore.dart';

import '../services/encryption_service.dart';

/// Type of message - question (needs response), alert (one-way notification), or info
enum MessageType {
  /// A question that requires user response
  question,

  /// An alert notification (error, warning, success, info) - no response needed
  alert,

  /// Informational message - no response needed
  info,
}

extension MessageTypeExtension on MessageType {
  String get value {
    switch (this) {
      case MessageType.question:
        return 'question';
      case MessageType.alert:
        return 'alert';
      case MessageType.info:
        return 'info';
    }
  }

  static MessageType fromString(String? value) {
    switch (value) {
      case 'alert':
        return MessageType.alert;
      case 'info':
        return MessageType.info;
      case 'question':
      default:
        return MessageType.question;
    }
  }

  String get displayName {
    switch (this) {
      case MessageType.question:
        return 'Question';
      case MessageType.alert:
        return 'Alert';
      case MessageType.info:
        return 'Info';
    }
  }
}

/// Alert type for alert messages
enum AlertType {
  error,
  warning,
  success,
  info,
}

extension AlertTypeExtension on AlertType {
  String get value {
    switch (this) {
      case AlertType.error:
        return 'error';
      case AlertType.warning:
        return 'warning';
      case AlertType.success:
        return 'success';
      case AlertType.info:
        return 'info';
    }
  }

  static AlertType fromString(String? value) {
    switch (value) {
      case 'error':
        return AlertType.error;
      case 'warning':
        return AlertType.warning;
      case 'success':
        return AlertType.success;
      case 'info':
      default:
        return AlertType.info;
    }
  }

  String get displayName {
    switch (this) {
      case AlertType.error:
        return 'Error';
      case AlertType.warning:
        return 'Warning';
      case AlertType.success:
        return 'Success';
      case AlertType.info:
        return 'Info';
    }
  }
}

/// Direction of a message - either from Claude to user (question) or from user to Claude (task)
enum MessageDirection {
  /// Claude asking the user a question
  toUser,

  /// User assigning Claude a task
  toClaude,
}

extension MessageDirectionExtension on MessageDirection {
  String get value {
    switch (this) {
      case MessageDirection.toUser:
        return 'to_user';
      case MessageDirection.toClaude:
        return 'to_claude';
    }
  }

  static MessageDirection fromString(String? value) {
    switch (value) {
      case 'to_user':
        return MessageDirection.toUser;
      case 'to_claude':
        return MessageDirection.toClaude;
      default:
        return MessageDirection.toUser;
    }
  }

  String get displayName {
    switch (this) {
      case MessageDirection.toUser:
        return 'From Claude';
      case MessageDirection.toClaude:
        return 'To Claude';
    }
  }
}

/// Action levels for toClaude messages (tasks)
enum MessageAction {
  /// Stop current work immediately and handle this task
  interrupt,

  /// Spin up a subagent at the next convenient moment
  parallel,

  /// Handle when current task completes (default)
  queue,

  /// Low priority, handle when idle
  backlog,
}

extension MessageActionExtension on MessageAction {
  String get value {
    switch (this) {
      case MessageAction.interrupt:
        return 'interrupt';
      case MessageAction.parallel:
        return 'parallel';
      case MessageAction.queue:
        return 'queue';
      case MessageAction.backlog:
        return 'backlog';
    }
  }

  static MessageAction fromString(String? value) {
    switch (value) {
      case 'interrupt':
        return MessageAction.interrupt;
      case 'parallel':
        return MessageAction.parallel;
      case 'queue':
        return MessageAction.queue;
      case 'backlog':
        return MessageAction.backlog;
      default:
        return MessageAction.queue;
    }
  }

  String get displayName {
    switch (this) {
      case MessageAction.interrupt:
        return 'Interrupt';
      case MessageAction.parallel:
        return 'Parallel';
      case MessageAction.queue:
        return 'Queue';
      case MessageAction.backlog:
        return 'Backlog';
    }
  }

  String get description {
    switch (this) {
      case MessageAction.interrupt:
        return 'Stop work immediately';
      case MessageAction.parallel:
        return 'Start new Claude soon';
      case MessageAction.queue:
        return 'Do after current task';
      case MessageAction.backlog:
        return 'When convenient';
    }
  }
}

/// Unified message model that combines questions (toUser) and tasks (toClaude)
class MessageModel {
  final String id;
  final MessageDirection direction;
  final MessageType messageType; // question, alert, info
  final AlertType? alertType; // error, warning, success, info (for alerts only)

  // Core content
  final String content; // Question text OR task instructions
  final String? title; // For toClaude messages (task title)
  final String? context; // What Claude is working on

  // toUser-specific (questions)
  final List<String>? options; // Multiple choice options
  final String? response; // User's answer
  final DateTime? answeredAt;

  // toClaude-specific (tasks)
  final MessageAction? action; // interrupt/parallel/queue/backlog
  final DateTime? startedAt;
  final DateTime? completedAt;
  final String? sessionId;

  // Threading fields
  final String? threadId; // Groups related messages into a conversation thread
  final String? inReplyTo; // ID of the message this is replying to

  // Common metadata
  final String priority; // low, normal, high
  final String status; // pending, in_progress, answered, complete, expired, cancelled, acknowledged
  final DateTime createdAt;
  final String? projectId;
  final bool archived;
  final DateTime? deletedAt;
  final bool isEncrypted;

  MessageModel({
    required this.id,
    required this.direction,
    this.messageType = MessageType.question,
    this.alertType,
    required this.content,
    this.title,
    this.context,
    this.options,
    this.response,
    this.answeredAt,
    this.action,
    this.startedAt,
    this.completedAt,
    this.sessionId,
    this.threadId,
    this.inReplyTo,
    required this.priority,
    required this.status,
    required this.createdAt,
    this.projectId,
    this.archived = false,
    this.deletedAt,
    this.isEncrypted = false,
  });

  /// Create from Firestore without decryption (raw data)
  factory MessageModel.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>?;
    final direction = MessageDirectionExtension.fromString(data?['direction']);
    final messageType = MessageTypeExtension.fromString(data?['messageType']);
    final alertType = data?['alertType'] != null
        ? AlertTypeExtension.fromString(data?['alertType'])
        : null;

    return MessageModel(
      id: doc.id,
      direction: direction,
      messageType: messageType,
      alertType: alertType,
      content: data?['content'] ?? data?['question'] ?? data?['instructions'] ?? '',
      title: data?['title'] as String?,
      context: data?['context'] as String?,
      options: (data?['options'] as List<dynamic>?)?.cast<String>(),
      response: data?['response'] as String?,
      answeredAt: (data?['answeredAt'] as Timestamp?)?.toDate(),
      action: data?['action'] != null
          ? MessageActionExtension.fromString(data?['action'])
          : null,
      startedAt: (data?['startedAt'] as Timestamp?)?.toDate(),
      completedAt: (data?['completedAt'] as Timestamp?)?.toDate(),
      sessionId: data?['sessionId'] as String?,
      threadId: data?['threadId'] as String?,
      inReplyTo: data?['inReplyTo'] as String?,
      priority: data?['priority'] ?? 'normal',
      status: data?['status'] ?? 'pending',
      createdAt: (data?['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      projectId: data?['projectId'] as String?,
      archived: data?['archived'] as bool? ?? false,
      deletedAt: (data?['deletedAt'] as Timestamp?)?.toDate(),
      isEncrypted: data?['encrypted'] as bool? ?? false,
    );
  }

  /// Create from Firestore with decryption
  static Future<MessageModel> fromFirestoreDecrypted(
    DocumentSnapshot doc,
    EncryptionService encryptionService,
  ) async {
    final data = doc.data() as Map<String, dynamic>?;
    final isEncrypted = data?['encrypted'] as bool? ?? false;
    final direction = MessageDirectionExtension.fromString(data?['direction']);
    final messageType = MessageTypeExtension.fromString(data?['messageType']);
    final alertType = data?['alertType'] != null
        ? AlertTypeExtension.fromString(data?['alertType'])
        : null;

    String content = data?['content'] ?? data?['question'] ?? data?['instructions'] ?? '';
    String? title = data?['title'] as String?;
    String? context = data?['context'] as String?;
    String? response = data?['response'] as String?;
    List<String>? options = (data?['options'] as List<dynamic>?)?.cast<String>();
    String? actionStr = data?['action'] as String?;

    // Decrypt fields if marked as encrypted
    if (isEncrypted) {
      content = await encryptionService.decryptIfNeeded(content);
      title = title != null ? await encryptionService.decryptIfNeeded(title) : null;
      context = context != null ? await encryptionService.decryptIfNeeded(context) : null;
      response = response != null ? await encryptionService.decryptIfNeeded(response) : null;
      options = options != null
          ? await Future.wait(options.map((o) => encryptionService.decryptIfNeeded(o)))
          : null;
      actionStr = actionStr != null ? await encryptionService.decryptIfNeeded(actionStr) : null;
    }

    return MessageModel(
      id: doc.id,
      direction: direction,
      messageType: messageType,
      alertType: alertType,
      content: content,
      title: title,
      context: context,
      options: options,
      response: response,
      answeredAt: (data?['answeredAt'] as Timestamp?)?.toDate(),
      action: actionStr != null ? MessageActionExtension.fromString(actionStr) : null,
      startedAt: (data?['startedAt'] as Timestamp?)?.toDate(),
      completedAt: (data?['completedAt'] as Timestamp?)?.toDate(),
      sessionId: data?['sessionId'] as String?,
      threadId: data?['threadId'] as String?,
      inReplyTo: data?['inReplyTo'] as String?,
      priority: data?['priority'] ?? 'normal',
      status: data?['status'] ?? 'pending',
      createdAt: (data?['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      projectId: data?['projectId'] as String?,
      archived: data?['archived'] as bool? ?? false,
      deletedAt: (data?['deletedAt'] as Timestamp?)?.toDate(),
      isEncrypted: isEncrypted,
    );
  }

  /// Create from v2 tasks collection (type: "question")
  /// Used by providers that read questions from the unified tasks collection
  factory MessageModel.fromQuestionTask(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>?;
    final questionData = data?['question'] as Map<String, dynamic>? ?? {};
    final lifecycleStatus = data?['status'] as String? ?? 'created';
    final alertTypeStr = data?['alertType'] as String?;

    return MessageModel(
      id: doc.id,
      direction: MessageDirection.toUser,
      messageType: alertTypeStr != null ? MessageType.alert : MessageType.question,
      alertType: alertTypeStr != null ? AlertTypeExtension.fromString(alertTypeStr) : null,
      content: questionData['content'] ?? data?['instructions'] ?? '',
      title: data?['title'] as String?,
      context: questionData['context'] as String?,
      options: (questionData['options'] as List<dynamic>?)?.cast<String>(),
      response: questionData['response'] as String?,
      answeredAt: (questionData['answeredAt'] as Timestamp?)?.toDate(),
      threadId: data?['threadId'] as String?,
      inReplyTo: data?['replyTo'] as String?,
      sessionId: data?['sessionId'] as String?,
      priority: data?['priority'] ?? 'normal',
      status: _mapLifecycleToMessageStatus(lifecycleStatus),
      createdAt: (data?['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      projectId: data?['projectId'] as String?,
      archived: data?['archived'] as bool? ?? false,
      isEncrypted: data?['encrypted'] as bool? ?? false,
    );
  }

  /// Create from v2 tasks collection with decryption
  static Future<MessageModel> fromQuestionTaskDecrypted(
    DocumentSnapshot doc,
    EncryptionService encryptionService,
  ) async {
    final data = doc.data() as Map<String, dynamic>?;
    final isEncrypted = data?['encrypted'] as bool? ?? false;
    final questionData = data?['question'] as Map<String, dynamic>? ?? {};
    final lifecycleStatus = data?['status'] as String? ?? 'created';
    final alertTypeStr = data?['alertType'] as String?;

    String content = questionData['content'] ?? data?['instructions'] ?? '';
    String? context = questionData['context'] as String?;
    String? response = questionData['response'] as String?;
    List<String>? options = (questionData['options'] as List<dynamic>?)?.cast<String>();

    if (isEncrypted) {
      content = await encryptionService.decryptIfNeeded(content);
      context = context != null ? await encryptionService.decryptIfNeeded(context) : null;
      response = response != null ? await encryptionService.decryptIfNeeded(response) : null;
      options = options != null
          ? await Future.wait(options.map((o) => encryptionService.decryptIfNeeded(o)))
          : null;
    }

    return MessageModel(
      id: doc.id,
      direction: MessageDirection.toUser,
      messageType: alertTypeStr != null ? MessageType.alert : MessageType.question,
      alertType: alertTypeStr != null ? AlertTypeExtension.fromString(alertTypeStr) : null,
      content: content,
      context: context,
      options: options,
      response: response,
      answeredAt: (questionData['answeredAt'] as Timestamp?)?.toDate(),
      threadId: data?['threadId'] as String?,
      inReplyTo: data?['replyTo'] as String?,
      sessionId: data?['sessionId'] as String?,
      priority: data?['priority'] ?? 'normal',
      status: _mapLifecycleToMessageStatus(lifecycleStatus),
      createdAt: (data?['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      projectId: data?['projectId'] as String?,
      archived: data?['archived'] as bool? ?? false,
      isEncrypted: isEncrypted,
    );
  }

  /// Map lifecycle status to legacy message status for screen compat
  static String _mapLifecycleToMessageStatus(String status) {
    switch (status) {
      case 'created':
        return 'pending';
      case 'active':
        return 'in_progress';
      case 'done':
        return 'answered';
      case 'failed':
      case 'derezzed':
        return 'expired';
      default:
        return status;
    }
  }

  // Direction helpers
  bool get isToUser => direction == MessageDirection.toUser;
  bool get isToClaude => direction == MessageDirection.toClaude;

  // Status helpers (universal)
  bool get isPending => status == 'pending';
  bool get isInProgress => status == 'in_progress';

  // toUser (question) status helpers
  bool get isAnswered => status == 'answered';
  bool get isExpired => status == 'expired';
  bool get isAcknowledged => status == 'acknowledged';
  bool get needsResponse => isToUser && isPending && !isAlert;

  // toClaude (task) status helpers
  bool get isComplete => status == 'complete';
  bool get isCancelled => status == 'cancelled';

  // Priority helpers
  bool get isHighPriority => priority == 'high';
  bool get isNormalPriority => priority == 'normal';
  bool get isLowPriority => priority == 'low';

  // toUser (question) helpers
  bool get hasOptions => options != null && options!.isNotEmpty;
  bool get hasResponse => response != null && response!.isNotEmpty;

  // Message type helpers
  bool get isQuestion => messageType == MessageType.question;
  bool get isAlert => messageType == MessageType.alert;
  bool get isInfo => messageType == MessageType.info;

  // Alert type helpers
  bool get isErrorAlert => alertType == AlertType.error;
  bool get isWarningAlert => alertType == AlertType.warning;
  bool get isSuccessAlert => alertType == AlertType.success;
  bool get isInfoAlert => alertType == AlertType.info;

  // toClaude (task) action helpers
  bool get isInterrupt => action == MessageAction.interrupt;
  bool get isParallel => action == MessageAction.parallel;
  bool get isQueue => action == MessageAction.queue;
  bool get isBacklog => action == MessageAction.backlog;

  // Archive/delete helpers
  bool get isArchived => archived;
  bool get isDeleted => deletedAt != null;
  bool get hasProject => projectId != null;

  // Threading helpers
  bool get isInThread => threadId != null;
  bool get isReply => inReplyTo != null;
  bool get isThreadStarter => threadId != null && inReplyTo == null;

  /// Get a display title for the message
  String get displayTitle {
    if (isToClaude && title != null && title!.isNotEmpty) {
      return title!;
    }
    // For questions, truncate the content as the title
    if (content.length > 50) {
      return '${content.substring(0, 50)}...';
    }
    return content;
  }

  /// Get a display subtitle/preview
  String get displaySubtitle {
    if (isToClaude) {
      return content; // Instructions for tasks
    }
    // For questions with a response, show the response
    if (hasResponse) {
      return 'Response: ${response!}';
    }
    // Otherwise show context if available
    return context ?? '';
  }

  MessageModel copyWith({
    String? id,
    MessageDirection? direction,
    MessageType? messageType,
    AlertType? alertType,
    String? content,
    String? title,
    String? context,
    List<String>? options,
    String? response,
    DateTime? answeredAt,
    MessageAction? action,
    DateTime? startedAt,
    DateTime? completedAt,
    String? sessionId,
    String? threadId,
    String? inReplyTo,
    String? priority,
    String? status,
    DateTime? createdAt,
    String? projectId,
    bool? archived,
    DateTime? deletedAt,
    bool? isEncrypted,
  }) {
    return MessageModel(
      id: id ?? this.id,
      direction: direction ?? this.direction,
      messageType: messageType ?? this.messageType,
      alertType: alertType ?? this.alertType,
      content: content ?? this.content,
      title: title ?? this.title,
      context: context ?? this.context,
      options: options ?? this.options,
      response: response ?? this.response,
      answeredAt: answeredAt ?? this.answeredAt,
      action: action ?? this.action,
      startedAt: startedAt ?? this.startedAt,
      completedAt: completedAt ?? this.completedAt,
      sessionId: sessionId ?? this.sessionId,
      threadId: threadId ?? this.threadId,
      inReplyTo: inReplyTo ?? this.inReplyTo,
      priority: priority ?? this.priority,
      status: status ?? this.status,
      createdAt: createdAt ?? this.createdAt,
      projectId: projectId ?? this.projectId,
      archived: archived ?? this.archived,
      deletedAt: deletedAt ?? this.deletedAt,
      isEncrypted: isEncrypted ?? this.isEncrypted,
    );
  }
}
