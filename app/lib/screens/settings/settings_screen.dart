import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../providers/auth_provider.dart';
import '../../services/haptic_service.dart';

void _log(String message) {
  debugPrint('[SettingsScreen] $message');
}

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  String _appVersion = '';

  @override
  void initState() {
    super.initState();
    _loadAppVersion();
  }

  Future<void> _loadAppVersion() async {
    try {
      final packageInfo = await PackageInfo.fromPlatform();
      if (mounted) {
        setState(() {
          _appVersion = '${packageInfo.version} (${packageInfo.buildNumber})';
        });
      }
    } catch (e) {
      _log('Failed to load app version: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/home'),
        ),
      ),
      body: ListView(
        children: [
          // Profile Section
          _buildSectionHeader(context, 'Profile'),
          _buildProfileTile(context, user),

          const Divider(height: 32),

          // Account Section
          _buildSectionHeader(context, 'Account'),
          ListTile(
            leading: const Icon(Icons.lock_outline),
            title: const Text('Change Password'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              HapticService.light();
              context.go('/settings/change-password');
            },
          ),
          ListTile(
            leading: const Icon(Icons.key),
            title: const Text('API Key'),
            subtitle: const Text('Manage your MCP API key'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              HapticService.light();
              context.go('/api-key');
            },
          ),

          const Divider(height: 32),

          // Preferences Section
          _buildSectionHeader(context, 'Preferences'),
          ListTile(
            leading: const Icon(Icons.notifications_outlined),
            title: const Text('Notifications'),
            subtitle: const Text('Push notification settings'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              HapticService.light();
              context.go('/settings/notifications');
            },
          ),

          const Divider(height: 32),

          // Data & Privacy Section
          _buildSectionHeader(context, 'Data & Privacy'),
          ListTile(
            leading: Icon(Icons.delete_outline, color: theme.colorScheme.error),
            title: Text(
              'Delete Account',
              style: TextStyle(color: theme.colorScheme.error),
            ),
            subtitle: const Text('Permanently delete your account'),
            onTap: () {
              HapticService.light();
              context.go('/settings/delete-account');
            },
          ),

          const Divider(height: 32),

          // Support Section
          _buildSectionHeader(context, 'Support'),
          ListTile(
            leading: const Icon(Icons.help_outline),
            title: const Text('Help & FAQ'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              HapticService.light();
              _showHelpDialog(context);
            },
          ),
          ListTile(
            leading: const Icon(Icons.feedback_outlined),
            title: const Text('Send Feedback'),
            subtitle: const Text('Report issues on GitHub'),
            trailing: const Icon(Icons.open_in_new),
            onTap: () {
              HapticService.light();
              _openFeedback(context);
            },
          ),
          ListTile(
            leading: const Icon(Icons.info_outline),
            title: const Text('About'),
            subtitle: Text('Version $_appVersion'),
            onTap: () {
              HapticService.light();
              _showAboutDialog(context);
            },
          ),

          const Divider(height: 32),

          // Sign Out
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: OutlinedButton.icon(
              onPressed: () {
                HapticService.medium();
                _signOut(context);
              },
              icon: const Icon(Icons.logout),
              label: const Text('Sign Out'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),

          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(BuildContext context, String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.bold,
            ),
      ),
    );
  }

  Widget _buildProfileTile(BuildContext context, user) {
    final displayName = user?.displayName ?? 'No name set';
    final email = user?.email ?? 'No email';
    final initials = _getInitials(displayName, email);

    return ListTile(
      leading: CircleAvatar(
        radius: 28,
        backgroundColor: Theme.of(context).colorScheme.primaryContainer,
        child: Text(
          initials,
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: Theme.of(context).colorScheme.onPrimaryContainer,
          ),
        ),
      ),
      title: Text(
        displayName == 'No name set' ? email.split('@').first : displayName,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      subtitle: Text(email),
      trailing: const Icon(Icons.chevron_right),
      onTap: () {
        HapticService.light();
        context.go('/settings/profile');
      },
    );
  }

  String _getInitials(String displayName, String email) {
    if (displayName != 'No name set' && displayName.isNotEmpty) {
      final parts = displayName.split(' ');
      if (parts.length >= 2) {
        return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
      }
      return displayName[0].toUpperCase();
    }
    return email.isNotEmpty ? email[0].toUpperCase() : '?';
  }

  Future<void> _signOut(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign Out?'),
        content: const Text('Are you sure you want to sign out?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Sign Out'),
          ),
        ],
      ),
    );

    if (confirmed == true && context.mounted) {
      await ref.read(authNotifierProvider.notifier).signOut();
      if (context.mounted) {
        context.go('/login');
      }
    }
  }

  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Help & FAQ'),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'What is CacheBash?',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 4),
              Text(
                'CacheBash is a mobile companion for Claude Code. '
                'It lets you answer questions and monitor progress from anywhere.',
              ),
              SizedBox(height: 16),
              Text(
                'How do I connect Claude Code?',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 4),
              Text(
                '1. Go to API Key in Settings\n'
                '2. Copy the MCP configuration\n'
                '3. Add it to ~/.config/claude/mcp.json\n'
                '4. Restart Claude Code',
              ),
              SizedBox(height: 16),
              Text(
                'Need more help?',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 4),
              Text('Contact support at cachebashapp@gmail.com'),
            ],
          ),
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Got it'),
          ),
        ],
      ),
    );
  }

  void _openFeedback(BuildContext context) {
    context.push('/feedback');
  }

  void _showAboutDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AboutDialog(
        applicationName: 'CacheBash',
        applicationVersion: _appVersion,
        applicationIcon: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.primaryContainer,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(
            Icons.rocket_launch,
            color: Theme.of(context).colorScheme.onPrimaryContainer,
          ),
        ),
        children: const [
          Text(
            'Mobile companion for Claude Code.\n\n'
            'Answer questions and monitor progress from anywhere.',
          ),
        ],
      ),
    );
  }
}
