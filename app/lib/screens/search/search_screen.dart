import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/search_provider.dart';
import '../../services/haptic_service.dart';
import '../../widgets/animated_list_item.dart';

class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final _searchController = TextEditingController();
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    // Auto-focus on entry
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _focusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _dismissKeyboard() {
    FocusScope.of(context).unfocus();
  }

  @override
  Widget build(BuildContext context) {
    final searchState = ref.watch(searchProvider);
    final groupedResults = ref.watch(groupedSearchResultsProvider);

    return GestureDetector(
      onTap: _dismissKeyboard,
      child: Scaffold(
        appBar: AppBar(
        title: const Text('Search'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            HapticService.light();
            context.go('/home');
          },
        ),
      ),
      body: Column(
        children: [
          // Search bar
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _searchController,
              focusNode: _focusNode,
              onChanged: (value) {
                ref.read(searchProvider.notifier).setQuery(value);
              },
              decoration: InputDecoration(
                hintText: 'Search questions, tasks, sessions...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: searchState.query.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          HapticService.light();
                          _searchController.clear();
                          ref.read(searchProvider.notifier).clearSearch();
                        },
                      )
                    : null,
                filled: true,
                fillColor: Theme.of(context).colorScheme.surfaceContainerHigh,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),

          // Filter chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                _FilterChip(
                  label: 'All',
                  isSelected: searchState.filter == SearchFilter.all,
                  onTap: () {
                    HapticService.light();
                    ref.read(searchProvider.notifier).setFilter(SearchFilter.all);
                  },
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: 'Questions',
                  isSelected: searchState.filter == SearchFilter.questions,
                  onTap: () {
                    HapticService.light();
                    ref.read(searchProvider.notifier).setFilter(SearchFilter.questions);
                  },
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: 'Tasks',
                  isSelected: searchState.filter == SearchFilter.tasks,
                  onTap: () {
                    HapticService.light();
                    ref.read(searchProvider.notifier).setFilter(SearchFilter.tasks);
                  },
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: 'Sessions',
                  isSelected: searchState.filter == SearchFilter.sessions,
                  onTap: () {
                    HapticService.light();
                    ref.read(searchProvider.notifier).setFilter(SearchFilter.sessions);
                  },
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: 'Projects',
                  isSelected: searchState.filter == SearchFilter.projects,
                  onTap: () {
                    HapticService.light();
                    ref.read(searchProvider.notifier).setFilter(SearchFilter.projects);
                  },
                ),
              ],
            ),
          ),

          const SizedBox(height: 8),

          // Status filter chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                _StatusFilterChip(
                  label: 'All Status',
                  isSelected: searchState.statusFilter == SearchStatusFilter.all,
                  onTap: () {
                    HapticService.light();
                    ref.read(searchProvider.notifier).setStatusFilter(SearchStatusFilter.all);
                  },
                ),
                const SizedBox(width: 8),
                _StatusFilterChip(
                  label: 'Pending',
                  isSelected: searchState.statusFilter == SearchStatusFilter.pending,
                  onTap: () {
                    HapticService.light();
                    ref.read(searchProvider.notifier).setStatusFilter(SearchStatusFilter.pending);
                  },
                ),
                const SizedBox(width: 8),
                _StatusFilterChip(
                  label: 'Completed',
                  isSelected: searchState.statusFilter == SearchStatusFilter.completed,
                  onTap: () {
                    HapticService.light();
                    ref.read(searchProvider.notifier).setStatusFilter(SearchStatusFilter.completed);
                  },
                ),
                const SizedBox(width: 8),
                _StatusFilterChip(
                  label: 'Archived',
                  isSelected: searchState.statusFilter == SearchStatusFilter.archived,
                  onTap: () {
                    HapticService.light();
                    ref.read(searchProvider.notifier).setStatusFilter(SearchStatusFilter.archived);
                  },
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // Results
          Expanded(
            child: searchState.isLoading
                ? const Center(child: CircularProgressIndicator())
                : searchState.error != null
                    ? _buildErrorState(context, searchState.error!)
                    : searchState.query.isEmpty
                        ? _buildEmptyState(context)
                        : searchState.results.isEmpty
                            ? _buildNoResultsState(context, searchState.query)
                            : _buildResultsList(context, groupedResults),
          ),
        ],
      ),
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.search,
            size: 64,
            color: Theme.of(context).colorScheme.outline,
          ),
          const SizedBox(height: 16),
          Text(
            'Search Everything',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            'Find questions, tasks, sessions, and projects',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildNoResultsState(BuildContext context, String query) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.search_off,
            size: 64,
            color: Theme.of(context).colorScheme.outline,
          ),
          const SizedBox(height: 16),
          Text(
            'No results found',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            'No matches for "$query"',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildErrorState(BuildContext context, String error) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.error_outline,
            size: 64,
            color: Theme.of(context).colorScheme.error,
          ),
          const SizedBox(height: 16),
          Text(
            'Search failed',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            error,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildResultsList(
    BuildContext context,
    Map<String, List<SearchResult>> groupedResults,
  ) {
    final sections = <Widget>[];
    int animationIndex = 0;

    // Order: questions, tasks, sessions, projects
    final order = ['question', 'task', 'session', 'project'];

    for (final type in order) {
      final results = groupedResults[type];
      if (results == null || results.isEmpty) continue;

      sections.add(
        AnimatedListItem(
          index: animationIndex++,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: _buildSectionHeader(context, type, results.length),
          ),
        ),
      );

      for (final result in results) {
        sections.add(
          AnimatedListItem(
            index: animationIndex++,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: _SearchResultCard(
                result: result,
                onTap: () => _navigateToResult(result),
              ),
            ),
          ),
        );
      }
    }

    return ListView(
      padding: const EdgeInsets.only(bottom: 16),
      children: sections,
    );
  }

  Widget _buildSectionHeader(BuildContext context, String type, int count) {
    IconData icon;
    String label;

    switch (type) {
      case 'question':
        icon = Icons.help_outline;
        label = 'Questions';
        break;
      case 'task':
        icon = Icons.task_alt;
        label = 'Tasks';
        break;
      case 'session':
        icon = Icons.terminal;
        label = 'Sessions';
        break;
      case 'project':
        icon = Icons.folder;
        label = 'Projects';
        break;
      default:
        icon = Icons.circle;
        label = type;
    }

    return Row(
      children: [
        Icon(icon, size: 20, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: 8),
        Text(
          label,
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.bold,
              ),
        ),
        const SizedBox(width: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.primaryContainer,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            '$count',
            style: TextStyle(
              fontSize: 12,
              color: Theme.of(context).colorScheme.onPrimaryContainer,
            ),
          ),
        ),
      ],
    );
  }

  void _navigateToResult(SearchResult result) {
    HapticService.light();
    switch (result.type) {
      case 'question':
        context.push('/questions/${result.id}');
        break;
      case 'task':
        context.go('/tasks');
        break;
      case 'session':
        context.push('/sessions/${result.id}');
        break;
      case 'project':
        context.push('/projects/${result.id}');
        break;
    }
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  const _FilterChip({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected
              ? Theme.of(context).colorScheme.primary
              : Theme.of(context).colorScheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected
                ? Theme.of(context).colorScheme.onPrimary
                : Theme.of(context).colorScheme.onSurfaceVariant,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
          ),
        ),
      ),
    );
  }
}

class _StatusFilterChip extends StatelessWidget {
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  const _StatusFilterChip({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected
              ? Theme.of(context).colorScheme.secondaryContainer
              : Colors.transparent,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isSelected
                ? Theme.of(context).colorScheme.secondary
                : Theme.of(context).colorScheme.outline,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: isSelected
                ? Theme.of(context).colorScheme.onSecondaryContainer
                : Theme.of(context).colorScheme.onSurfaceVariant,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
          ),
        ),
      ),
    );
  }
}

class _SearchResultCard extends StatelessWidget {
  final SearchResult result;
  final VoidCallback onTap;

  const _SearchResultCard({
    required this.result,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              _buildTypeIcon(context),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      result.title,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w500,
                          ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (result.subtitle != null && result.subtitle!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        result.subtitle!,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _buildStatusBadge(context),
              const SizedBox(width: 4),
              Icon(
                Icons.chevron_right,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTypeIcon(BuildContext context) {
    IconData icon;
    Color color;

    switch (result.type) {
      case 'question':
        icon = Icons.help_outline;
        color = Colors.blue;
        break;
      case 'task':
        icon = Icons.task_alt;
        color = Colors.green;
        break;
      case 'session':
        icon = Icons.terminal;
        color = Colors.purple;
        break;
      case 'project':
        icon = Icons.folder;
        color = Colors.orange;
        break;
      default:
        icon = Icons.circle;
        color = Colors.grey;
    }

    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        color: color.withAlpha(30),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Icon(icon, size: 20, color: color),
    );
  }

  Widget _buildStatusBadge(BuildContext context) {
    Color color;
    String label;

    switch (result.status) {
      case 'pending':
        color = Colors.orange;
        label = 'Pending';
        break;
      case 'answered':
        color = Colors.green;
        label = 'Answered';
        break;
      case 'working':
        color = Colors.blue;
        label = 'Working';
        break;
      case 'blocked':
        color = Colors.red;
        label = 'Blocked';
        break;
      case 'complete':
      case 'completed':
        color = Colors.green;
        label = 'Complete';
        break;
      case 'archived':
        color = Colors.grey;
        label = 'Archived';
        break;
      case 'expired':
        color = Colors.grey;
        label = 'Expired';
        break;
      case 'cancelled':
        color = Colors.grey;
        label = 'Cancelled';
        break;
      case 'in_progress':
        color = Colors.blue;
        label = 'In Progress';
        break;
      default:
        color = Colors.grey;
        label = result.status;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withAlpha(30),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10,
          color: color,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}
