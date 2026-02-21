import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/channel_provider.dart';
import '../../widgets/program_avatar.dart';
import '../../services/haptic_service.dart';

class ActivityScreen extends ConsumerWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channelsAsync = ref.watch(channelListProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Activity',
          style: TextStyle(
            fontFamily: 'monospace',
            fontWeight: FontWeight.bold,
            letterSpacing: 1.2,
          ),
        ),
        centerTitle: false,
      ),
      body: channelsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(
          child: Text('Error: $error'),
        ),
        data: (channels) {
          final needsResponse = channels.where((c) => c.hasPendingQuestions).toList();
          final blocked = channels.where((c) => c.isBlocked).toList();
          final active = channels.where((c) => c.hasActiveSession && !c.isBlocked).toList();

          final hasContent = needsResponse.isNotEmpty || blocked.isNotEmpty || active.isNotEmpty;

          if (!hasContent) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.check_circle_outline,
                    size: 64,
                    color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.5),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'All clear',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontFamily: 'monospace',
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'No items need your attention',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            );
          }

          return ListView(
            padding: const EdgeInsets.symmetric(vertical: 8),
            children: [
              if (needsResponse.isNotEmpty) ...[
                _SectionHeader(
                  title: 'Needs Response',
                  icon: Icons.help_outline,
                  color: Theme.of(context).colorScheme.error,
                ),
                ...needsResponse.map((channel) => _ActivityTile(
                  channel: channel,
                  subtitle: '${channel.pendingQuestionCount} question${channel.pendingQuestionCount > 1 ? 's' : ''} waiting',
                  accentColor: Theme.of(context).colorScheme.error,
                )),
              ],
              if (blocked.isNotEmpty) ...[
                _SectionHeader(
                  title: 'Blocked',
                  icon: Icons.pause_circle_outline,
                  color: const Color(0xFFFBBF24),
                ),
                ...blocked.map((channel) => _ActivityTile(
                  channel: channel,
                  subtitle: channel.activeSession?.status ?? 'Blocked',
                  accentColor: const Color(0xFFFBBF24),
                )),
              ],
              if (active.isNotEmpty) ...[
                _SectionHeader(
                  title: 'Working',
                  icon: Icons.play_circle_outline,
                  color: const Color(0xFF4ADE80),
                ),
                ...active.map((channel) => _ActivityTile(
                  channel: channel,
                  subtitle: channel.activeSession?.status ?? 'Active',
                  accentColor: const Color(0xFF4ADE80),
                )),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final IconData icon;
  final Color color;

  const _SectionHeader({
    required this.title,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
      child: Row(
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 8),
          Text(
            title.toUpperCase(),
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: 11,
              fontWeight: FontWeight.bold,
              color: color,
              letterSpacing: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}

class _ActivityTile extends StatelessWidget {
  final ChannelData channel;
  final String subtitle;
  final Color accentColor;

  const _ActivityTile({
    required this.channel,
    required this.subtitle,
    required this.accentColor,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {
        HapticService.light();
        context.push('/channels/${channel.programId}');
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            ProgramAvatar(
              programId: channel.programId,
              size: 40,
              showStatusDot: true,
              statusState: channel.displayState,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    channel.meta.displayName,
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.chevron_right,
              size: 20,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }
}
