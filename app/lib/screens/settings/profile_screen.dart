import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/auth_provider.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _displayNameController = TextEditingController();
  bool _isLoading = false;
  bool _hasChanges = false;

  @override
  void initState() {
    super.initState();
    _loadUserData();
  }

  void _loadUserData() {
    final user = ref.read(currentUserProvider);
    _displayNameController.text = user?.displayName ?? '';
    _displayNameController.addListener(_onFieldChanged);
  }

  void _onFieldChanged() {
    final user = ref.read(currentUserProvider);
    final currentName = user?.displayName ?? '';
    setState(() {
      _hasChanges = _displayNameController.text != currentName;
    });
  }

  @override
  void dispose() {
    _displayNameController.dispose();
    super.dispose();
  }

  Future<void> _saveProfile() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    final success = await ref
        .read(authNotifierProvider.notifier)
        .updateDisplayName(_displayNameController.text.trim());

    if (!mounted) return;
    setState(() => _isLoading = false);

    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Profile updated successfully'),
          backgroundColor: Colors.green,
        ),
      );
      setState(() => _hasChanges = false);
    } else {
      final error = ref.read(authNotifierProvider).error;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(getAuthErrorMessage(error ?? 'Update failed')),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  void _dismissKeyboard() {
    FocusScope.of(context).unfocus();
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final email = user?.email ?? 'No email';
    final initials = _getInitials(user?.displayName ?? '', email);

    return GestureDetector(
      onTap: _dismissKeyboard,
      child: Scaffold(
        appBar: AppBar(
        title: const Text('Edit Profile'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/settings'),
        ),
        actions: [
          if (_hasChanges)
            TextButton(
              onPressed: _isLoading ? null : _saveProfile,
              child: _isLoading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Save'),
            ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Avatar
            Center(
              child: Stack(
                children: [
                  CircleAvatar(
                    radius: 50,
                    backgroundColor:
                        Theme.of(context).colorScheme.primaryContainer,
                    child: Text(
                      initials,
                      style: TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                        color:
                            Theme.of(context).colorScheme.onPrimaryContainer,
                      ),
                    ),
                  ),
                  Positioned(
                    right: 0,
                    bottom: 0,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.primary,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.camera_alt,
                        size: 20,
                        color: Theme.of(context).colorScheme.onPrimary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Center(
              child: TextButton(
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Photo upload coming soon'),
                    ),
                  );
                },
                child: const Text('Change Photo'),
              ),
            ),

            const SizedBox(height: 24),

            // Display Name
            TextFormField(
              controller: _displayNameController,
              decoration: const InputDecoration(
                labelText: 'Display Name',
                hintText: 'Enter your name',
                prefixIcon: Icon(Icons.person_outline),
                border: OutlineInputBorder(),
              ),
              textCapitalization: TextCapitalization.words,
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Please enter your name';
                }
                if (value.trim().length < 2) {
                  return 'Name must be at least 2 characters';
                }
                return null;
              },
            ),

            const SizedBox(height: 16),

            // Email (read-only)
            TextFormField(
              initialValue: email,
              decoration: const InputDecoration(
                labelText: 'Email',
                prefixIcon: Icon(Icons.email_outlined),
                border: OutlineInputBorder(),
                filled: true,
              ),
              readOnly: true,
              enabled: false,
            ),
            const SizedBox(height: 8),
            Text(
              'Email cannot be changed',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),

            const SizedBox(height: 32),

            // Account Info
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Account Info',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                    ),
                    const SizedBox(height: 12),
                    _buildInfoRow(
                        context, 'User ID', user?.uid ?? 'Unknown'),
                    const SizedBox(height: 8),
                    _buildInfoRow(
                      context,
                      'Created',
                      user?.metadata.creationTime != null
                          ? _formatDate(user!.metadata.creationTime!)
                          : 'Unknown',
                    ),
                    const SizedBox(height: 8),
                    _buildInfoRow(
                      context,
                      'Last Sign In',
                      user?.metadata.lastSignInTime != null
                          ? _formatDate(user!.metadata.lastSignInTime!)
                          : 'Unknown',
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
      ),
    );
  }

  Widget _buildInfoRow(BuildContext context, String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 100,
          child: Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      ],
    );
  }

  String _getInitials(String displayName, String email) {
    if (displayName.isNotEmpty) {
      final parts = displayName.split(' ');
      if (parts.length >= 2) {
        return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
      }
      return displayName[0].toUpperCase();
    }
    return email.isNotEmpty ? email[0].toUpperCase() : '?';
  }

  String _formatDate(DateTime date) {
    return '${date.month}/${date.day}/${date.year}';
  }
}
