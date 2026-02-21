import 'package:flutter/material.dart';

/// Metadata for a Grid program — used in channel list, avatars, and status indicators
class ProgramMeta {
  final String id;
  final String displayName;
  final Color color;
  final String initial;

  const ProgramMeta({
    required this.id,
    required this.displayName,
    required this.color,
    required this.initial,
  });
}

/// Registry of all known Grid programs with their visual identity
class ProgramRegistry {
  ProgramRegistry._();

  static const Map<String, ProgramMeta> _programs = {
    'iso': ProgramMeta(id: 'iso', displayName: 'ISO', color: Color(0xFF4ECDC4), initial: 'I'),
    'basher': ProgramMeta(id: 'basher', displayName: 'BASHER', color: Color(0xFFFBBF24), initial: 'B'),
    'alan': ProgramMeta(id: 'alan', displayName: 'ALAN', color: Color(0xFF60A5FA), initial: 'A'),
    'quorra': ProgramMeta(id: 'quorra', displayName: 'QUORRA', color: Color(0xFF8B5CF6), initial: 'Q'),
    'sark': ProgramMeta(id: 'sark', displayName: 'SARK', color: Color(0xFFEF4444), initial: 'S'),
    'radia': ProgramMeta(id: 'radia', displayName: 'RADIA', color: Color(0xFFF472B6), initial: 'R'),
    'able': ProgramMeta(id: 'able', displayName: 'ABLE', color: Color(0xFF34D399), initial: 'A'),
    'beck': ProgramMeta(id: 'beck', displayName: 'BECK', color: Color(0xFFFB923C), initial: 'B'),
    'ram': ProgramMeta(id: 'ram', displayName: 'RAM', color: Color(0xFF818CF8), initial: 'R'),
    'casp': ProgramMeta(id: 'casp', displayName: 'CASP', color: Color(0xFF2DD4BF), initial: 'C'),
    'bit': ProgramMeta(id: 'bit', displayName: 'BIT', color: Color(0xFF9CA3AF), initial: 'B'),
    'flynn': ProgramMeta(id: 'flynn', displayName: 'Flynn', color: Color(0xFFF59E0B), initial: 'F'),
  };

  static const _unknown = ProgramMeta(
    id: 'unknown',
    displayName: 'Unknown',
    color: Color(0xFF64748B),
    initial: '?',
  );

  /// Get program metadata by ID (case-insensitive)
  static ProgramMeta get(String? programId) {
    if (programId == null) return _unknown;
    return _programs[programId.toLowerCase()] ?? _unknown;
  }

  /// Get all known programs
  static List<ProgramMeta> get all => _programs.values.toList();

  /// Get all known program IDs
  static Set<String> get knownIds => _programs.keys.toSet();
}
