import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/project_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/projects_provider.dart';
import '../../services/haptic_service.dart';

void _log(String message) {
  debugPrint('[ProjectsScreen] $message');
}

class ProjectsScreen extends ConsumerWidget {
  const ProjectsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final projectsAsync = ref.watch(projectsWithCountsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Projects'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/home'),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () {
              HapticService.light();
              _showCreateProjectDialog(context, ref);
            },
            tooltip: 'Create Project',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(projectsWithCountsProvider);
        },
        child: projectsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, stack) {
            _log('ERROR loading projects: $error');
            _log('STACK: $stack');
            return SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              child: SizedBox(
                height: MediaQuery.of(context).size.height - 150,
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.error_outline, size: 48, color: Colors.red),
                        const SizedBox(height: 16),
                        const Text('Error loading projects', style: TextStyle(fontWeight: FontWeight.bold)),
                        const SizedBox(height: 8),
                        Text(
                          error.toString().length > 300 ? '${error.toString().substring(0, 300)}...' : error.toString(),
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: 12),
                        ),
                        const SizedBox(height: 16),
                        const Text('Pull down to retry', style: TextStyle(color: Colors.grey)),
                      ],
                    ),
                  ),
                ),
              ),
            );
          },
          data: (projects) {
            if (projects.isEmpty) {
              return SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                child: SizedBox(
                  height: MediaQuery.of(context).size.height - 150,
                  child: Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.folder_outlined,
                          size: 64,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'No projects yet',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Create a project to organize your questions',
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                color: Theme.of(context).colorScheme.onSurfaceVariant,
                              ),
                        ),
                        const SizedBox(height: 24),
                        FilledButton.icon(
                          onPressed: () {
                            HapticService.medium();
                            _showCreateProjectDialog(context, ref);
                          },
                          icon: const Icon(Icons.add),
                          label: const Text('Create Project'),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'Pull down to refresh',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: Theme.of(context).colorScheme.outline,
                              ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }

            return ListView.builder(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: projects.length,
              itemBuilder: (context, index) {
                final project = projects[index];
                return _ProjectListTile(
                  project: project,
                  onTap: () {
                    HapticService.light();
                    context.go('/projects/${project.id}');
                  },
                  onRename: project.isUncategorized
                      ? null
                      : () => _showRenameProjectDialog(context, ref, project),
                  onSetDefault: project.isUncategorized
                      ? null
                      : () => _setDefaultProject(context, ref, project),
                  onDelete: project.isUncategorized
                      ? null
                      : () => _showDeleteProjectDialog(context, ref, project),
                );
              },
            );
          },
        ),
      ),
    );
  }

  Future<void> _showCreateProjectDialog(
      BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Create Project'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Project Name',
            hintText: 'Enter project name',
          ),
          onSubmitted: (value) => Navigator.pop(context, value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Create'),
          ),
        ],
      ),
    );

    if (result != null && result.trim().isNotEmpty) {
      final user = ref.read(currentUserProvider);
      if (user != null) {
        await ref.read(projectsServiceProvider).createProject(
              userId: user.uid,
              name: result.trim(),
            );
      }
    }
  }

  Future<void> _showRenameProjectDialog(
      BuildContext context, WidgetRef ref, ProjectModel project) async {
    final controller = TextEditingController(text: project.name);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Rename Project'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Project Name',
          ),
          onSubmitted: (value) => Navigator.pop(context, value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Rename'),
          ),
        ],
      ),
    );

    if (result != null && result.trim().isNotEmpty && result != project.name) {
      final user = ref.read(currentUserProvider);
      if (user != null) {
        await ref.read(projectsServiceProvider).renameProject(
              userId: user.uid,
              projectId: project.id,
              name: result.trim(),
            );
      }
    }
  }

  Future<void> _setDefaultProject(
      BuildContext context, WidgetRef ref, ProjectModel project) async {
    final user = ref.read(currentUserProvider);
    if (user != null) {
      await ref.read(projectsServiceProvider).setDefaultProject(
            userId: user.uid,
            projectId: project.isDefault ? null : project.id,
          );
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(project.isDefault
                ? 'Default project cleared'
                : '${project.name} set as default'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    }
  }

  Future<void> _showDeleteProjectDialog(
      BuildContext context, WidgetRef ref, ProjectModel project) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Project?'),
        content: Text(
          'This will archive all ${project.questionCount} questions in "${project.name}". '
          'The project can be recovered within 30 days.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      final user = ref.read(currentUserProvider);
      if (user != null) {
        await ref.read(projectsServiceProvider).deleteProject(
              userId: user.uid,
              projectId: project.id,
            );
      }
    }
  }
}

class _ProjectListTile extends StatelessWidget {
  final ProjectModel project;
  final VoidCallback onTap;
  final VoidCallback? onRename;
  final VoidCallback? onDelete;
  final VoidCallback? onSetDefault;

  const _ProjectListTile({
    required this.project,
    required this.onTap,
    this.onRename,
    this.onDelete,
    this.onSetDefault,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Stack(
        children: [
          CircleAvatar(
            backgroundColor: project.isUncategorized
                ? Theme.of(context).colorScheme.surfaceContainerHighest
                : Theme.of(context).colorScheme.primaryContainer,
            child: Icon(
              project.isUncategorized ? Icons.inbox : Icons.folder,
              color: project.isUncategorized
                  ? Theme.of(context).colorScheme.onSurfaceVariant
                  : Theme.of(context).colorScheme.onPrimaryContainer,
            ),
          ),
          if (project.isDefault)
            Positioned(
              right: 0,
              bottom: 0,
              child: Container(
                padding: const EdgeInsets.all(2),
                decoration: BoxDecoration(
                  color: Colors.amber,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: Theme.of(context).colorScheme.surface,
                    width: 1.5,
                  ),
                ),
                child: const Icon(Icons.star, size: 10, color: Colors.white),
              ),
            ),
        ],
      ),
      title: Text(project.name),
      subtitle: Text(
        '${project.questionCount} question${project.questionCount == 1 ? '' : 's'}${project.isDefault ? ' • Default' : ''}',
      ),
      trailing: project.isUncategorized
          ? null
          : PopupMenuButton<String>(
              onSelected: (value) {
                switch (value) {
                  case 'rename':
                    onRename?.call();
                    break;
                  case 'setDefault':
                    onSetDefault?.call();
                    break;
                  case 'delete':
                    onDelete?.call();
                    break;
                }
              },
              itemBuilder: (context) => [
                const PopupMenuItem(
                  value: 'rename',
                  child: Row(
                    children: [
                      Icon(Icons.edit),
                      SizedBox(width: 8),
                      Text('Rename'),
                    ],
                  ),
                ),
                PopupMenuItem(
                  value: 'setDefault',
                  child: Row(
                    children: [
                      Icon(
                        project.isDefault ? Icons.star : Icons.star_outline,
                        color: project.isDefault ? Colors.amber : null,
                      ),
                      const SizedBox(width: 8),
                      Text(project.isDefault
                          ? 'Default Project'
                          : 'Set as Default'),
                    ],
                  ),
                ),
                PopupMenuItem(
                  value: 'delete',
                  child: Row(
                    children: [
                      const Icon(Icons.delete, color: Colors.red),
                      const SizedBox(width: 8),
                      Text('Delete',
                          style: TextStyle(color: Colors.red.shade700)),
                    ],
                  ),
                ),
              ],
            ),
      onTap: onTap,
    );
  }
}
