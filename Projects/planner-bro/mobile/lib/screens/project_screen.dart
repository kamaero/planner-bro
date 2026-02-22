import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/projects_provider.dart';
import '../widgets/task_card_widget.dart';
import '../widgets/gantt_widget.dart';
import '../core/api_client.dart';

class ProjectScreen extends ConsumerStatefulWidget {
  final String projectId;
  const ProjectScreen({super.key, required this.projectId});

  @override
  ConsumerState<ProjectScreen> createState() => _ProjectScreenState();
}

class _ProjectScreenState extends ConsumerState<ProjectScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final projectAsync = ref.watch(projectProvider(widget.projectId));
    final tasksAsync = ref.watch(tasksProvider(widget.projectId));

    return projectAsync.when(
      loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (e, _) => Scaffold(body: Center(child: Text('Error: $e'))),
      data: (project) => Scaffold(
        appBar: AppBar(
          title: Row(
            children: [
              Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                  color: _hexToColor(project.color),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(child: Text(project.name, overflow: TextOverflow.ellipsis)),
            ],
          ),
          bottom: TabBar(
            controller: _tabController,
            tabs: const [
              Tab(icon: Icon(Icons.list), text: 'Tasks'),
              Tab(icon: Icon(Icons.bar_chart), text: 'Gantt'),
            ],
          ),
        ),
        body: tasksAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(child: Text('Error: $e')),
          data: (tasks) => TabBarView(
            controller: _tabController,
            children: [
              // Task list
              RefreshIndicator(
                onRefresh: () => ref.refresh(tasksProvider(widget.projectId).future),
                child: tasks.isEmpty
                    ? const Center(child: Text('No tasks yet'))
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: tasks.length,
                        itemBuilder: (ctx, i) => TaskCardWidget(task: tasks[i]),
                      ),
              ),
              // Gantt
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.all(16),
                child: GanttWidget(tasks: tasks),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Color _hexToColor(String hex) {
    final h = hex.replaceFirst('#', '');
    return Color(int.parse('FF$h', radix: 16));
  }
}
