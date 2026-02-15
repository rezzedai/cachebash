import 'package:cloud_firestore/cloud_firestore.dart';

import '../services/encryption_service.dart';

/// Task type discriminator — all entities live in tasks collection
enum TaskType {
  task,
  question,
  dream,
  sprint,
  sprintStory,
}

extension TaskTypeExtension on TaskType {
  String get value {
    switch (this) {
      case TaskType.task:
        return 'task';
      case TaskType.question:
        return 'question';
      case TaskType.dream:
        return 'dream';
      case TaskType.sprint:
        return 'sprint';
      case TaskType.sprintStory:
        return 'sprint-story';
    }
  }

  static TaskType fromString(String? value) {
    switch (value) {
      case 'question':
        return TaskType.question;
      case 'dream':
        return TaskType.dream;
      case 'sprint':
        return TaskType.sprint;
      case 'sprint-story':
        return TaskType.sprintStory;
      case 'task':
      default:
        return TaskType.task;
    }
  }

  String get displayName {
    switch (this) {
      case TaskType.task:
        return 'Task';
      case TaskType.question:
        return 'Question';
      case TaskType.dream:
        return 'Dream';
      case TaskType.sprint:
        return 'Sprint';
      case TaskType.sprintStory:
        return 'Story';
    }
  }
}

/// Lifecycle statuses — replaces v1 pending/in_progress/complete/cancelled
enum LifecycleStatus {
  created,
  active,
  blocked,
  completing,
  done,
  failed,
  derezzed,
}

extension LifecycleStatusExtension on LifecycleStatus {
  String get value {
    switch (this) {
      case LifecycleStatus.created:
        return 'created';
      case LifecycleStatus.active:
        return 'active';
      case LifecycleStatus.blocked:
        return 'blocked';
      case LifecycleStatus.completing:
        return 'completing';
      case LifecycleStatus.done:
        return 'done';
      case LifecycleStatus.failed:
        return 'failed';
      case LifecycleStatus.derezzed:
        return 'derezzed';
    }
  }

  static LifecycleStatus fromString(String? value) {
    switch (value) {
      case 'active':
        return LifecycleStatus.active;
      case 'blocked':
        return LifecycleStatus.blocked;
      case 'completing':
        return LifecycleStatus.completing;
      case 'done':
        return LifecycleStatus.done;
      case 'failed':
        return LifecycleStatus.failed;
      case 'derezzed':
        return LifecycleStatus.derezzed;
      // Map v1 statuses for backward compat
      case 'pending':
        return LifecycleStatus.created;
      case 'in_progress':
        return LifecycleStatus.active;
      case 'complete':
        return LifecycleStatus.done;
      case 'cancelled':
        return LifecycleStatus.derezzed;
      case 'created':
      default:
        return LifecycleStatus.created;
    }
  }

  String get displayName {
    switch (this) {
      case LifecycleStatus.created:
        return 'Pending';
      case LifecycleStatus.active:
        return 'Active';
      case LifecycleStatus.blocked:
        return 'Blocked';
      case LifecycleStatus.completing:
        return 'Completing';
      case LifecycleStatus.done:
        return 'Done';
      case LifecycleStatus.failed:
        return 'Failed';
      case LifecycleStatus.derezzed:
        return 'Derezzed';
    }
  }
}

/// Task action levels
enum TaskAction {
  interrupt,
  sprint,
  parallel,
  queue,
  backlog,
}

extension TaskActionExtension on TaskAction {
  String get value {
    switch (this) {
      case TaskAction.interrupt:
        return 'interrupt';
      case TaskAction.sprint:
        return 'sprint';
      case TaskAction.parallel:
        return 'parallel';
      case TaskAction.queue:
        return 'queue';
      case TaskAction.backlog:
        return 'backlog';
    }
  }

  static TaskAction fromString(String? value) {
    switch (value) {
      case 'interrupt':
        return TaskAction.interrupt;
      case 'sprint':
        return TaskAction.sprint;
      case 'parallel':
        return TaskAction.parallel;
      case 'queue':
        return TaskAction.queue;
      case 'backlog':
        return TaskAction.backlog;
      default:
        return TaskAction.queue;
    }
  }

  String get displayName {
    switch (this) {
      case TaskAction.interrupt:
        return 'Interrupt';
      case TaskAction.sprint:
        return 'Sprint';
      case TaskAction.parallel:
        return 'Parallel';
      case TaskAction.queue:
        return 'Queue';
      case TaskAction.backlog:
        return 'Backlog';
    }
  }

  String get description {
    switch (this) {
      case TaskAction.interrupt:
        return 'Stop work immediately';
      case TaskAction.sprint:
        return 'Add to current sprint';
      case TaskAction.parallel:
        return 'Start new Claude soon';
      case TaskAction.queue:
        return 'Do after current task';
      case TaskAction.backlog:
        return 'When convenient';
    }
  }
}

/// Provenance metadata
class Provenance {
  final String? model;
  final int? costTokens;
  final double? confidence;

  Provenance({this.model, this.costTokens, this.confidence});

  factory Provenance.fromMap(Map<String, dynamic>? data) {
    if (data == null) return Provenance();
    return Provenance(
      model: data['model'] as String?,
      costTokens: data['cost_tokens'] as int?,
      confidence: (data['confidence'] as num?)?.toDouble(),
    );
  }
}

/// Question sub-object (for type: "question")
class QuestionData {
  final String content;
  final List<String>? options;
  final String? context;
  final String? response;
  final DateTime? answeredAt;

  QuestionData({
    required this.content,
    this.options,
    this.context,
    this.response,
    this.answeredAt,
  });

  factory QuestionData.fromMap(Map<String, dynamic>? data) {
    if (data == null) return QuestionData(content: '');
    return QuestionData(
      content: data['content'] ?? '',
      options: (data['options'] as List<dynamic>?)?.cast<String>(),
      context: data['context'] as String?,
      response: data['response'] as String?,
      answeredAt: (data['answeredAt'] as Timestamp?)?.toDate(),
    );
  }
}

/// Dream sub-object (for type: "dream")
class DreamData {
  final String agent;
  final double budgetCapUsd;
  final double budgetConsumedUsd;
  final int timeoutHours;
  final String? branch;
  final String? prUrl;
  final String? outcome;
  final String? morningReport;

  DreamData({
    this.agent = 'basher',
    this.budgetCapUsd = 5.0,
    this.budgetConsumedUsd = 0.0,
    this.timeoutHours = 4,
    this.branch,
    this.prUrl,
    this.outcome,
    this.morningReport,
  });

  factory DreamData.fromMap(Map<String, dynamic>? data) {
    if (data == null) return DreamData();
    return DreamData(
      agent: data['agent'] ?? 'basher',
      budgetCapUsd: (data['budgetCapUsd'] as num?)?.toDouble() ?? 5.0,
      budgetConsumedUsd: (data['budgetConsumedUsd'] as num?)?.toDouble() ?? 0.0,
      timeoutHours: data['timeoutHours'] ?? 4,
      branch: data['branch'] as String?,
      prUrl: data['prUrl'] as String?,
      outcome: data['outcome'] as String?,
      morningReport: data['morningReport'] as String?,
    );
  }

  double get budgetRemaining => budgetCapUsd - budgetConsumedUsd;
  double get budgetPercentUsed =>
      budgetCapUsd > 0 ? (budgetConsumedUsd / budgetCapUsd * 100) : 0;
}

/// Sprint sub-object (for type: "sprint" and "sprint-story")
class SprintData {
  final String? parentId;
  final String? storyId;
  final int? wave;
  final int progress;
  final String? currentAction;
  final String? status;
  final List<String> dependencies;
  final String complexity;
  final String? model;
  final String? projectName;
  final String? branch;
  final Map<String, dynamic>? config;
  final Map<String, dynamic>? summary;

  SprintData({
    this.parentId,
    this.storyId,
    this.wave,
    this.progress = 0,
    this.currentAction,
    this.status,
    this.dependencies = const [],
    this.complexity = 'normal',
    this.model,
    this.projectName,
    this.branch,
    this.config,
    this.summary,
  });

  factory SprintData.fromMap(Map<String, dynamic>? data) {
    if (data == null) return SprintData();
    return SprintData(
      parentId: data['parentId'] as String?,
      storyId: data['storyId'] as String?,
      wave: data['wave'] as int?,
      progress: data['progress'] ?? 0,
      currentAction: data['currentAction'] as String?,
      status: data['status'] as String?,
      dependencies: List<String>.from(data['dependencies'] ?? []),
      complexity: data['complexity'] ?? 'normal',
      model: data['model'] as String?,
      projectName: data['projectName'] as String?,
      branch: data['branch'] as String?,
      config: data['config'] as Map<String, dynamic>?,
      summary: data['summary'] as Map<String, dynamic>?,
    );
  }

  bool get isHighComplexity => complexity == 'high';
}

/// Unified task model — tasks, questions, dreams, sprints, sprint-stories
/// All live in users/{uid}/tasks
class TaskModel {
  final String id;
  final TaskType type;
  final String title;
  final String instructions;
  final String? preview;
  final String? projectId;
  final String priority;
  final TaskAction action;
  final LifecycleStatus status;
  final String? source;
  final String? target;
  final DateTime createdAt;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final String? sessionId;
  final bool isEncrypted;
  final bool archived;

  // Envelope v2.1
  final int? ttl;
  final String? replyTo;
  final String? threadId;
  final Provenance? provenance;
  final List<String>? fallback;
  final DateTime? expiresAt;

  // Type-specific sub-objects
  final QuestionData? question;
  final DreamData? dream;
  final SprintData? sprint;

  TaskModel({
    required this.id,
    this.type = TaskType.task,
    required this.title,
    required this.instructions,
    this.preview,
    this.projectId,
    required this.priority,
    this.action = TaskAction.queue,
    required this.status,
    this.source,
    this.target,
    required this.createdAt,
    this.startedAt,
    this.completedAt,
    this.sessionId,
    this.isEncrypted = false,
    this.archived = false,
    this.ttl,
    this.replyTo,
    this.threadId,
    this.provenance,
    this.fallback,
    this.expiresAt,
    this.question,
    this.dream,
    this.sprint,
  });

  factory TaskModel.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>?;
    final typeStr = data?['type'] as String?;
    final type = TaskTypeExtension.fromString(typeStr);

    return TaskModel(
      id: doc.id,
      type: type,
      title: data?['title'] ?? 'Untitled',
      instructions: data?['instructions'] ?? '',
      preview: data?['preview'] as String?,
      projectId: data?['projectId'] as String?,
      priority: data?['priority'] ?? 'normal',
      action: TaskActionExtension.fromString(data?['action']),
      status: LifecycleStatusExtension.fromString(data?['status']),
      source: data?['source'] as String?,
      target: data?['target'] as String?,
      createdAt: (data?['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      startedAt: (data?['startedAt'] as Timestamp?)?.toDate(),
      completedAt: (data?['completedAt'] as Timestamp?)?.toDate(),
      sessionId: data?['sessionId'] as String?,
      isEncrypted: data?['encrypted'] as bool? ?? false,
      archived: data?['archived'] as bool? ?? false,
      ttl: data?['ttl'] as int?,
      replyTo: data?['replyTo'] as String?,
      threadId: data?['threadId'] as String?,
      provenance: data?['provenance'] != null
          ? Provenance.fromMap(data!['provenance'] as Map<String, dynamic>)
          : null,
      fallback: (data?['fallback'] as List<dynamic>?)?.cast<String>(),
      expiresAt: (data?['expiresAt'] as Timestamp?)?.toDate(),
      question: type == TaskType.question
          ? QuestionData.fromMap(data?['question'] as Map<String, dynamic>?)
          : null,
      dream: type == TaskType.dream
          ? DreamData.fromMap(data?['dream'] as Map<String, dynamic>?)
          : null,
      sprint: (type == TaskType.sprint || type == TaskType.sprintStory)
          ? SprintData.fromMap(data?['sprint'] as Map<String, dynamic>?)
          : null,
    );
  }

  static Future<TaskModel> fromFirestoreDecrypted(
    DocumentSnapshot doc,
    EncryptionService encryptionService,
  ) async {
    final data = doc.data() as Map<String, dynamic>?;
    final isEncrypted = data?['encrypted'] as bool? ?? false;

    String title = data?['title'] ?? 'Untitled';
    String instructions = data?['instructions'] ?? '';

    if (isEncrypted) {
      title = await encryptionService.decryptIfNeeded(title);
      instructions = await encryptionService.decryptIfNeeded(instructions);
    }

    final typeStr = data?['type'] as String?;
    final type = TaskTypeExtension.fromString(typeStr);

    return TaskModel(
      id: doc.id,
      type: type,
      title: title,
      instructions: instructions,
      preview: data?['preview'] as String?,
      projectId: data?['projectId'] as String?,
      priority: data?['priority'] ?? 'normal',
      action: TaskActionExtension.fromString(data?['action']),
      status: LifecycleStatusExtension.fromString(data?['status']),
      source: data?['source'] as String?,
      target: data?['target'] as String?,
      createdAt: (data?['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      startedAt: (data?['startedAt'] as Timestamp?)?.toDate(),
      completedAt: (data?['completedAt'] as Timestamp?)?.toDate(),
      sessionId: data?['sessionId'] as String?,
      isEncrypted: isEncrypted,
      archived: data?['archived'] as bool? ?? false,
      ttl: data?['ttl'] as int?,
      replyTo: data?['replyTo'] as String?,
      threadId: data?['threadId'] as String?,
      provenance: data?['provenance'] != null
          ? Provenance.fromMap(data!['provenance'] as Map<String, dynamic>)
          : null,
      fallback: (data?['fallback'] as List<dynamic>?)?.cast<String>(),
      expiresAt: (data?['expiresAt'] as Timestamp?)?.toDate(),
      question: type == TaskType.question
          ? QuestionData.fromMap(data?['question'] as Map<String, dynamic>?)
          : null,
      dream: type == TaskType.dream
          ? DreamData.fromMap(data?['dream'] as Map<String, dynamic>?)
          : null,
      sprint: (type == TaskType.sprint || type == TaskType.sprintStory)
          ? SprintData.fromMap(data?['sprint'] as Map<String, dynamic>?)
          : null,
    );
  }

  // Type helpers
  bool get isTask => type == TaskType.task;
  bool get isQuestion => type == TaskType.question;
  bool get isDream => type == TaskType.dream;
  bool get isSprint => type == TaskType.sprint;
  bool get isSprintStory => type == TaskType.sprintStory;

  // Lifecycle helpers
  bool get isCreated => status == LifecycleStatus.created;
  bool get isActive => status == LifecycleStatus.active;
  bool get isBlocked => status == LifecycleStatus.blocked;
  bool get isCompleting => status == LifecycleStatus.completing;
  bool get isDone => status == LifecycleStatus.done;
  bool get isFailed => status == LifecycleStatus.failed;
  bool get isDerezzed => status == LifecycleStatus.derezzed;
  bool get isTerminal => isDone || isFailed || isDerezzed;
  bool get isRunning => isCreated || isActive || isBlocked || isCompleting;

  // V1 compat aliases
  bool get isPending => isCreated;
  bool get isInProgress => isActive;
  bool get isComplete => isDone;

  // Priority helpers
  bool get isHighPriority => priority == 'high';
  bool get isNormalPriority => priority == 'normal';
  bool get isLowPriority => priority == 'low';

  // Action helpers
  bool get isInterrupt => action == TaskAction.interrupt;
  bool get isParallel => action == TaskAction.parallel;
  bool get isQueue => action == TaskAction.queue;
  bool get isBacklog => action == TaskAction.backlog;

  // Question helpers
  bool get needsResponse => isQuestion && isCreated;
  bool get hasResponse => question?.response != null && question!.response!.isNotEmpty;
  bool get hasOptions => question?.options != null && question!.options!.isNotEmpty;

  // Dream helpers
  double get budgetRemaining => dream?.budgetRemaining ?? 0;
  double get budgetPercentUsed => dream?.budgetPercentUsed ?? 0;

  // Threading
  bool get isInThread => threadId != null;
  bool get isReply => replyTo != null;

  // Archive
  bool get isArchived => archived;

  String get displayTitle {
    if (isQuestion && question != null) {
      final q = question!.content;
      return q.length > 50 ? '${q.substring(0, 50)}...' : q;
    }
    return title;
  }
}
