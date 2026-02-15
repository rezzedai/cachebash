import 'package:flutter/material.dart';

/// Available gradient presets for user avatars
/// Users can select their preferred gradient in settings
class AvatarGradients {
  static const List<AvatarGradient> presets = [
    // Brand colors first
    AvatarGradient(
      id: 'brand_cyan_purple',
      name: 'CacheBash',
      colors: [Color(0xFF4ECDC4), Color(0xFF7B68EE)],
    ),
    AvatarGradient(
      id: 'ocean',
      name: 'Ocean',
      colors: [Color(0xFF4FACFE), Color(0xFF00F2FE)],
    ),
    AvatarGradient(
      id: 'sunset',
      name: 'Sunset',
      colors: [Color(0xFFFA709A), Color(0xFFFEE140)],
    ),
    AvatarGradient(
      id: 'aurora',
      name: 'Aurora',
      colors: [Color(0xFF43E97B), Color(0xFF38F9D7)],
    ),
    AvatarGradient(
      id: 'lavender',
      name: 'Lavender',
      colors: [Color(0xFFCD9CF2), Color(0xFFF6F3FF)],
    ),
    AvatarGradient(
      id: 'coral',
      name: 'Coral',
      colors: [Color(0xFFFF6B6B), Color(0xFFFFE66D)],
    ),
    AvatarGradient(
      id: 'indigo',
      name: 'Indigo',
      colors: [Color(0xFF667EEA), Color(0xFF764BA2)],
    ),
    AvatarGradient(
      id: 'mint',
      name: 'Mint',
      colors: [Color(0xFFA8EDEA), Color(0xFFFED6E3)],
    ),
    AvatarGradient(
      id: 'fire',
      name: 'Fire',
      colors: [Color(0xFFFF512F), Color(0xFFDD2476)],
    ),
    AvatarGradient(
      id: 'sky',
      name: 'Sky',
      colors: [Color(0xFF89F7FE), Color(0xFF66A6FF)],
    ),
    AvatarGradient(
      id: 'forest',
      name: 'Forest',
      colors: [Color(0xFF134E5E), Color(0xFF71B280)],
    ),
    AvatarGradient(
      id: 'midnight',
      name: 'Midnight',
      colors: [Color(0xFF2C3E50), Color(0xFF4CA1AF)],
    ),
  ];

  /// Get gradient by ID, falls back to brand gradient
  static AvatarGradient getById(String? id) {
    if (id == null) return presets.first;
    return presets.firstWhere(
      (g) => g.id == id,
      orElse: () => presets.first,
    );
  }

  /// Get deterministic gradient from UID (for auto-assignment)
  static AvatarGradient fromUid(String uid) {
    int hash = 0;
    for (int i = 0; i < uid.length; i++) {
      hash = uid.codeUnitAt(i) + ((hash << 5) - hash);
    }
    return presets[hash.abs() % presets.length];
  }
}

/// Model for a gradient preset
class AvatarGradient {
  final String id;
  final String name;
  final List<Color> colors;

  const AvatarGradient({
    required this.id,
    required this.name,
    required this.colors,
  });

  LinearGradient toLinearGradient() => LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: colors,
      );
}

/// Main avatar widget - auto-generates gradient + initials from user data
class UserAvatar extends StatelessWidget {
  final String? email;
  final String? displayName;
  final String? uid;
  final String? selectedGradientId; // User's chosen gradient (from Firestore)
  final double size;
  final VoidCallback? onTap;

  const UserAvatar({
    super.key,
    this.email,
    this.displayName,
    this.uid,
    this.selectedGradientId,
    this.size = 48,
    this.onTap,
  });

  String get initials {
    if (displayName != null && displayName!.isNotEmpty) {
      final parts = displayName!.trim().split(' ');
      if (parts.length >= 2) {
        return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
      }
      return displayName!
          .substring(0, displayName!.length.clamp(1, 2))
          .toUpperCase();
    }
    if (email != null && email!.isNotEmpty) {
      final localPart = email!.split('@').first;
      return localPart.substring(0, localPart.length.clamp(1, 2)).toUpperCase();
    }
    return '?';
  }

  AvatarGradient get gradient {
    if (selectedGradientId != null) {
      return AvatarGradients.getById(selectedGradientId);
    }
    if (uid != null) {
      return AvatarGradients.fromUid(uid!);
    }
    return AvatarGradients.presets.first;
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: gradient.toLinearGradient(),
          boxShadow: [
            BoxShadow(
              color: gradient.colors.first.withValues(alpha: 0.3),
              blurRadius: size * 0.2,
              offset: Offset(0, size * 0.08),
            ),
          ],
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.1),
            width: size > 40 ? 2 : 1,
          ),
        ),
        child: Center(
          child: Text(
            initials,
            style: TextStyle(
              fontSize: size * 0.38,
              fontWeight: FontWeight.w700,
              color: const Color(0xFF1A1A2E),
              fontFamily: 'monospace',
              letterSpacing: 0.5,
              shadows: [
                Shadow(
                  color: Colors.white.withValues(alpha: 0.3),
                  offset: const Offset(0, 1),
                  blurRadius: 2,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Gradient picker grid for settings screen
class GradientPicker extends StatelessWidget {
  final String? selectedId;
  final ValueChanged<String> onSelected;

  const GradientPicker({
    super.key,
    this.selectedId,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
      ),
      itemCount: AvatarGradients.presets.length,
      itemBuilder: (context, index) {
        final gradient = AvatarGradients.presets[index];
        final isSelected = gradient.id == selectedId;

        return GestureDetector(
          onTap: () => onSelected(gradient.id),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: gradient.toLinearGradient(),
              border: Border.all(
                color: isSelected
                    ? const Color(0xFF4ECDC4)
                    : Colors.white.withValues(alpha: 0.1),
                width: isSelected ? 3 : 1,
              ),
              boxShadow: isSelected
                  ? [
                      BoxShadow(
                        color: const Color(0xFF4ECDC4).withValues(alpha: 0.4),
                        blurRadius: 12,
                        spreadRadius: 2,
                      ),
                    ]
                  : null,
            ),
            child: isSelected
                ? const Icon(Icons.check, color: Color(0xFF1A1A2E), size: 24)
                : null,
          ),
        );
      },
    );
  }
}

/// Ready-to-use settings section for avatar customization
class AvatarSettingsSection extends StatelessWidget {
  final String? email;
  final String? displayName;
  final String? uid;
  final String? selectedGradientId;
  final ValueChanged<String> onGradientChanged;

  const AvatarSettingsSection({
    super.key,
    this.email,
    this.displayName,
    this.uid,
    this.selectedGradientId,
    required this.onGradientChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Preview
        Center(
          child: Column(
            children: [
              UserAvatar(
                email: email,
                displayName: displayName,
                uid: uid,
                selectedGradientId: selectedGradientId,
                size: 80,
              ),
              const SizedBox(height: 12),
              Text(
                displayName ?? email ?? 'User',
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFFF0F0F5),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                email ?? '',
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.white.withValues(alpha: 0.5),
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 32),

        // Gradient picker
        const Text(
          'Choose Avatar Style',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: Color(0xFFF0F0F5),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Select a gradient that represents you',
          style: TextStyle(
            fontSize: 13,
            color: Colors.white.withValues(alpha: 0.5),
          ),
        ),
        const SizedBox(height: 16),

        GradientPicker(
          selectedId: selectedGradientId ??
              (uid != null ? AvatarGradients.fromUid(uid!).id : null),
          onSelected: onGradientChanged,
        ),
      ],
    );
  }
}
