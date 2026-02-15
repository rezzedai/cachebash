import 'package:cloud_firestore/cloud_firestore.dart';

/// Model representing a project to organize questions
class ProjectModel {
  final String id;
  final String name;
  final DateTime createdAt;
  final int questionCount;
  final bool isDefault;
  final DateTime? deletedAt;

  ProjectModel({
    required this.id,
    required this.name,
    required this.createdAt,
    this.questionCount = 0,
    this.isDefault = false,
    this.deletedAt,
  });

  /// Special "Uncategorized" project for questions without a projectId
  static ProjectModel get uncategorized => ProjectModel(
        id: '_uncategorized',
        name: 'Uncategorized',
        createdAt: DateTime.fromMillisecondsSinceEpoch(0),
        isDefault: true,
      );

  factory ProjectModel.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>?;
    return ProjectModel(
      id: doc.id,
      name: data?['name'] ?? 'Unnamed Project',
      createdAt: (data?['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      questionCount: data?['questionCount'] as int? ?? 0,
      isDefault: data?['isDefault'] as bool? ?? false,
      deletedAt: (data?['deletedAt'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'name': name,
      'createdAt': FieldValue.serverTimestamp(),
      'questionCount': questionCount,
      'isDefault': isDefault,
      'deletedAt': deletedAt,
    };
  }

  bool get isDeleted => deletedAt != null;
  bool get isUncategorized => id == '_uncategorized';

  ProjectModel copyWith({
    String? id,
    String? name,
    DateTime? createdAt,
    int? questionCount,
    bool? isDefault,
    DateTime? deletedAt,
  }) {
    return ProjectModel(
      id: id ?? this.id,
      name: name ?? this.name,
      createdAt: createdAt ?? this.createdAt,
      questionCount: questionCount ?? this.questionCount,
      isDefault: isDefault ?? this.isDefault,
      deletedAt: deletedAt ?? this.deletedAt,
    );
  }
}
