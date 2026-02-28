import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/task.dart';
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

class _ProjectScreenState extends ConsumerState<ProjectScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  static const Map<String, String> _statusLabels = {
    'planning': 'Планирование',
    'tz': 'ТЗ',
    'todo': 'К выполнению',
    'in_progress': 'В работе',
    'testing': 'Тестирование',
    'review': 'На проверке',
    'done': 'Выполнено',
  };

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
      loading: () =>
          const Scaffold(body: Center(child: CircularProgressIndicator())),
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
              Expanded(
                  child: Text(project.name, overflow: TextOverflow.ellipsis)),
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
                onRefresh: () =>
                    ref.refresh(tasksProvider(widget.projectId).future),
                child: tasks.isEmpty
                    ? const Center(child: Text('No tasks yet'))
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: tasks.length,
                        itemBuilder: (ctx, i) => TaskCardWidget(
                          task: tasks[i],
                          onTap: () => _openTaskEditor(tasks[i]),
                        ),
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

  Future<void> _openTaskEditor(Task task) async {
    var selectedStatus = task.status;
    var progress = task.progressPercent.toDouble();
    final nextStepController = TextEditingController(text: task.nextStep ?? '');
    final commentController = TextEditingController();
    final reasonController = TextEditingController();
    DateTime? selectedDeadline = task.endDate;
    final initialDeadline = task.endDate;
    var isSaving = false;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            Future<void> saveTask() async {
              if (isSaving) return;
              final hasDeadlineChanged =
                  _dateChanged(initialDeadline, selectedDeadline);
              if (hasDeadlineChanged && reasonController.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                      content: Text('Укажите причину изменения дедлайна')),
                );
                return;
              }
              setSheetState(() => isSaving = true);
              try {
                final payload = <String, dynamic>{
                  'status': selectedStatus,
                  'progress_percent': progress.round(),
                  'next_step': nextStepController.text.trim().isEmpty
                      ? null
                      : nextStepController.text.trim(),
                };
                if (hasDeadlineChanged) {
                  payload['end_date'] = selectedDeadline == null
                      ? null
                      : _dateOnly(selectedDeadline!);
                  payload['deadline_change_reason'] =
                      reasonController.text.trim();
                }

                await apiClient.put('/tasks/${task.id}', payload);

                final commentText = commentController.text.trim();
                if (commentText.isNotEmpty) {
                  await apiClient.post(
                      '/tasks/${task.id}/comments', {'body': commentText});
                }

                ref.invalidate(tasksProvider(widget.projectId));
                if (mounted) {
                  Navigator.of(context).pop();
                  ScaffoldMessenger.of(this.context).showSnackBar(
                    const SnackBar(content: Text('Задача обновлена')),
                  );
                }
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Ошибка сохранения: $e')),
                  );
                }
              } finally {
                if (mounted) {
                  setSheetState(() => isSaving = false);
                }
              }
            }

            return SafeArea(
              child: Padding(
                padding: EdgeInsets.only(
                  left: 16,
                  right: 16,
                  top: 16,
                  bottom: MediaQuery.of(context).viewInsets.bottom + 16,
                ),
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(task.title,
                          style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        value: selectedStatus,
                        decoration: const InputDecoration(
                          labelText: 'Статус',
                          border: OutlineInputBorder(),
                        ),
                        items: _statusLabels.entries
                            .map((e) => DropdownMenuItem<String>(
                                  value: e.key,
                                  child: Text(e.value),
                                ))
                            .toList(),
                        onChanged: (value) {
                          if (value != null) {
                            setSheetState(() => selectedStatus = value);
                          }
                        },
                      ),
                      const SizedBox(height: 12),
                      Text('Прогресс: ${progress.round()}%'),
                      Slider(
                        value: progress,
                        min: 0,
                        max: 100,
                        divisions: 20,
                        label: '${progress.round()}%',
                        onChanged: (v) => setSheetState(() => progress = v),
                      ),
                      const SizedBox(height: 4),
                      TextField(
                        controller: nextStepController,
                        decoration: const InputDecoration(
                          labelText: 'Следующий шаг',
                          border: OutlineInputBorder(),
                        ),
                        maxLines: 2,
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              selectedDeadline == null
                                  ? 'Дедлайн: не задан'
                                  : 'Дедлайн: ${_dateOnly(selectedDeadline!)}',
                            ),
                          ),
                          TextButton.icon(
                            icon: const Icon(Icons.edit_calendar_outlined),
                            label: const Text('Изменить'),
                            onPressed: () async {
                              final now = DateTime.now();
                              final picked = await showDatePicker(
                                context: context,
                                initialDate: selectedDeadline ?? now,
                                firstDate: DateTime(now.year - 5),
                                lastDate: DateTime(now.year + 10),
                              );
                              if (picked != null) {
                                setSheetState(() => selectedDeadline = picked);
                              }
                            },
                          ),
                          IconButton(
                            tooltip: 'Сбросить дедлайн',
                            onPressed: () =>
                                setSheetState(() => selectedDeadline = null),
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: reasonController,
                        decoration: const InputDecoration(
                          labelText: 'Причина изменения дедлайна',
                          border: OutlineInputBorder(),
                        ),
                        maxLines: 2,
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: commentController,
                        decoration: const InputDecoration(
                          labelText: 'Комментарий к задаче',
                          border: OutlineInputBorder(),
                        ),
                        maxLines: 3,
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: isSaving ? null : saveTask,
                          icon: isSaving
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.save_outlined),
                          label: Text(isSaving
                              ? 'Сохранение...'
                              : 'Сохранить изменения'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );
    nextStepController.dispose();
    commentController.dispose();
    reasonController.dispose();
  }

  bool _dateChanged(DateTime? a, DateTime? b) {
    final aText = a == null ? null : _dateOnly(a);
    final bText = b == null ? null : _dateOnly(b);
    return aText != bText;
  }

  String _dateOnly(DateTime date) {
    final y = date.year.toString().padLeft(4, '0');
    final m = date.month.toString().padLeft(2, '0');
    final d = date.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }
}
