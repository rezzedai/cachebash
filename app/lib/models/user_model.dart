import 'package:cloud_firestore/cloud_firestore.dart';

/// User model representing a CacheBash user
class UserModel {
  final String uid;
  final String? email;
  final String? apiKeyHash;
  final DateTime? createdAt;
  final DateTime? apiKeyUpdatedAt;

  UserModel({
    required this.uid,
    this.email,
    this.apiKeyHash,
    this.createdAt,
    this.apiKeyUpdatedAt,
  });

  factory UserModel.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>?;
    return UserModel(
      uid: doc.id,
      email: data?['email'] as String?,
      apiKeyHash: data?['apiKeyHash'] as String?,
      createdAt: (data?['createdAt'] as Timestamp?)?.toDate(),
      apiKeyUpdatedAt: (data?['apiKeyUpdatedAt'] as Timestamp?)?.toDate(),
    );
  }

  bool get hasApiKey => apiKeyHash != null && apiKeyHash!.isNotEmpty;

  Map<String, dynamic> toMap() {
    return {
      'email': email,
      'apiKeyHash': apiKeyHash,
      'createdAt': createdAt != null ? Timestamp.fromDate(createdAt!) : null,
      'apiKeyUpdatedAt':
          apiKeyUpdatedAt != null ? Timestamp.fromDate(apiKeyUpdatedAt!) : null,
    };
  }
}
