import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_provider.dart';
import '../providers/projects_provider.dart';
import '../widgets/project_card_widget.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final projectsAsync = ref.watch(projectsProvider);
    final userAsync = ref.watch(authProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('planner-bro'),
        actions: [
          IconButton(
            icon: const Icon(Icons.analytics_outlined),
            onPressed: () => context.push('/analytics'),
          ),
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () => context.push('/notifications'),
          ),
          IconButton(
            icon: const Icon(Icons.person_outline),
            onPressed: () => context.push('/settings'),
          ),
        ],
      ),
      body: projectsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (projects) {
          if (projects.isEmpty) {
            return const Center(
              child: Text(
                  'No projects yet.\nAsk your manager to add you to a project.',
                  textAlign: TextAlign.center),
            );
          }
          return RefreshIndicator(
            onRefresh: () => ref.refresh(projectsProvider.future),
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: projects.length,
              itemBuilder: (ctx, i) => ProjectCardWidget(project: projects[i]),
            ),
          );
        },
      ),
    );
  }
}
