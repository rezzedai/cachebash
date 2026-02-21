import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/channel_provider.dart';
import '../../providers/sprints_provider.dart';
import '../../widgets/program_avatar.dart';
import '../../services/haptic_service.dart';

class ActivityScreen extends ConsumerWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channelsAsync = ref.watch(channelListProvider);
    final sprintsAsync = ref.watch(activeSprintsProvider);

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

          return RefreshIndicator(
            onRefresh: () async {
              HapticService.light();
              ref.invalidate(channelListProvider);
              ref.invalidate(activeSprintsProvider);
              await Future.delayed(const Duration(milliseconds: 500));
            },
            child: _buildContent(
              context, 
              needsResponse, 
              blocked, 
              active,
              sprintsAsync,
            ),
          );
        },
      ),
    );
  }

  Widget _buildContent(
    BuildContext context,
    List<ChannelData> needsResponse,
    List<ChannelData> blocked,
    List<ChannelData> active,
    AsyncValue sprints,
  ) {
    final hasChannelContent = needsResponse.isNotEmpty || blocked.isNotEmpty || active.isNotEmpty;
    final hasSprintContent = sprints.maybeWhen(
      data: (list) => list.isNotEmpty,
      orElse: () => false,
    );

    if (!hasChannelContent && !hasSprintContent) {
      return ListView(
        children: [
          SizedBox(height: MediaQuery.of(context).size.height * 0.3),
          Center(
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
          ),
        ],
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
            showProgress: false,
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
            showProgress: false,
          )),
        ],
        if (hasSprintContent) ...[
          _SectionHeader(
            title: 'Active Sprints',
            icon: Icons.rocket_launch_outlined,
            color: const Color(0xFF7B68EE),
          ),
          sprints.when(
            data: (sprintList) => Column(
              children: sprintList.map((sprint) => _SprintTile(sprint: sprint)).toList(),
            ),
            loading: () => const Padding(
              padding: EdgeInsets.all(16),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (_, __) => const SizedBox.shrink(),
          ),
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
            showProgress: true,
            progress: _estimateProgress(channel),
          )),
        ],
      ],
    );
  }

  double _estimateProgress(ChannelData channel) {
    // Simple heuristic: if session has recent activity, show partial progress
    final session = channel.activeSession;
    if (session == null) return 0.0;
    
    // If status contains indicators like "step", "phase", etc., could parse here
    // For now, show 0.3 for active, 0.7 for in-progress mentions
    if (session.status.toLowerCase().contains('finish') || 
        session.status.toLowerCase().contains('complete')) {
      return 0.9;
    } else if (session.status.toLowerCase().contains('progress') ||
               session.status.toLowerCase().contains('working')) {
      return 0.6;
    }
    return 0.3; // Just started
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
  final bool showProgress;
  final double progress;

  const _ActivityTile({
    required this.channel,
    required this.subtitle,
    required this.accentColor,
    this.showProgress = false,
    this.progress = 0.0,
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
        child: Column(
          children: [
            Row(
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
                        maxLines: 2,
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
            if (showProgress) ...[
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: progress,
                  backgroundColor: accentColor.withValues(alpha: 0.2),
                  valueColor: AlwaysStoppedAnimation<Color>(accentColor),
                  minHeight: 4,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SprintTile extends StatelessWidget {
  final dynamic sprint; // SprintModel - using dynamic to avoid import issues

  const _SprintTile({required this.sprint});

  @override
  Widget build(BuildContext context) {
    final sprintData = sprint;
    final title = sprintData.title ?? 'Sprint';
    final currentWave = sprintData.currentWave ?? 1;
    final totalWaves = sprintData.totalWaves ?? 1;
    final progress = totalWaves > 0 ? currentWave / totalWaves : 0.0;

    return InkWell(
      onTap: () {
        HapticService.light();
        context.push('/sprints/${sprintData.id}');
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: const Color(0xFF7B68EE).withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.rocket_launch,
                    size: 20,
                    color: Color(0xFF7B68EE),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Wave $currentWave of $totalWaves',
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
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: progress,
                backgroundColor: const Color(0xFF7B68EE).withValues(alpha: 0.2),
                valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF7B68EE)),
                minHeight: 4,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
