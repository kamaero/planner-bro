import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/task.dart';
import '../providers/auth_provider.dart';
import '../providers/projects_provider.dart';
import '../widgets/task_card_widget.dart';
import '../widgets/gantt_widget.dart';
import '../core/api_client.dart';

class ProjectScreen extends ConsumerStatefulWidget {
  final String projectId;
  final String? initialTaskId;

  const ProjectScreen({super.key, required this.projectId, this.initialTaskId});

  @override
  ConsumerState<ProjectScreen> createState() => _ProjectScreenState();
}

class _ProjectScreenState extends ConsumerState<ProjectScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  int _activeTab = 0;
  bool _handledInitialTaskOpen = false;
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
    _tabController.addListener(() {
      if (_tabController.indexIsChanging) return;
      if (_activeTab != _tabController.index) {
        setState(() => _activeTab = _tabController.index);
      }
    });
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
      error: (e, _) => Scaffold(body: Center(child: Text('Ошибка: $e'))),
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
              Tab(icon: Icon(Icons.list), text: 'Задачи'),
              Tab(icon: Icon(Icons.bar_chart), text: 'Гант'),
            ],
          ),
        ),
        body: tasksAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(child: Text('Ошибка: $e')),
          data: (tasks) {
            _maybeOpenInitialTask(tasks);
            return TabBarView(
              controller: _tabController,
              children: [
                // Task list
                RefreshIndicator(
                  onRefresh: () =>
                      ref.refresh(tasksProvider(widget.projectId).future),
                  child: tasks.isEmpty
                      ? const Center(child: Text('Задач пока нет'))
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
            );
          },
        ),
        floatingActionButton: _activeTab == 0
            ? FloatingActionButton.extended(
                onPressed: _openCreateTaskDialog,
                icon: const Icon(Icons.add_task),
                label: const Text('Задача'),
              )
            : null,
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
    final membersFuture = _loadProjectMembers();
    final commentsFuture = _loadTaskComments(task.id);
    final initialAssigneeId = task.assignee?.id;
    String? selectedAssigneeId = initialAssigneeId;
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
                if (selectedAssigneeId != initialAssigneeId) {
                  payload['assigned_to_id'] = selectedAssigneeId;
                }
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
                if (!mounted) return;
                Navigator.of(this.context).pop();
                ScaffoldMessenger.of(this.context).showSnackBar(
                  const SnackBar(content: Text('Задача обновлена')),
                );
              } catch (e) {
                if (!mounted) return;
                ScaffoldMessenger.of(this.context).showSnackBar(
                  SnackBar(content: Text('Ошибка сохранения: $e')),
                );
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
                        initialValue: selectedStatus,
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
                      FutureBuilder<List<_AssigneeOption>>(
                        future: membersFuture,
                        builder: (context, snapshot) {
                          if (snapshot.connectionState ==
                              ConnectionState.waiting) {
                            return const Padding(
                              padding: EdgeInsets.symmetric(vertical: 8),
                              child: LinearProgressIndicator(minHeight: 2),
                            );
                          }
                          final members =
                              snapshot.data ?? const <_AssigneeOption>[];
                          final hasSelected = members.any(
                            (member) => member.id == selectedAssigneeId,
                          );
                          if (!hasSelected) {
                            selectedAssigneeId = null;
                          }
                          return DropdownButtonFormField<String?>(
                            initialValue: selectedAssigneeId,
                            decoration: const InputDecoration(
                              labelText: 'Ответственный',
                              border: OutlineInputBorder(),
                            ),
                            items: [
                              const DropdownMenuItem<String?>(
                                value: null,
                                child: Text('Не назначен'),
                              ),
                              ...members.map(
                                (member) => DropdownMenuItem<String?>(
                                  value: member.id,
                                  child: Text(member.label),
                                ),
                              ),
                            ],
                            onChanged: (value) {
                              setSheetState(() => selectedAssigneeId = value);
                            },
                          );
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
                      Text(
                        'Последние комментарии',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 8),
                      FutureBuilder<List<_TaskCommentPreview>>(
                        future: commentsFuture,
                        builder: (context, snapshot) {
                          if (snapshot.connectionState ==
                              ConnectionState.waiting) {
                            return const Padding(
                              padding: EdgeInsets.symmetric(vertical: 8),
                              child: LinearProgressIndicator(minHeight: 2),
                            );
                          }
                          final comments =
                              snapshot.data ?? const <_TaskCommentPreview>[];
                          if (comments.isEmpty) {
                            return Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                border: Border.all(
                                  color: Theme.of(context).dividerColor,
                                ),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Text('Комментариев пока нет'),
                            );
                          }
                          return Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              border: Border.all(
                                color: Theme.of(context).dividerColor,
                              ),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Column(
                              children: comments
                                  .take(5)
                                  .map(
                                    (comment) => Padding(
                                      padding: const EdgeInsets.symmetric(
                                        vertical: 6,
                                        horizontal: 4,
                                      ),
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            comment.authorLabel,
                                            style: Theme.of(context)
                                                .textTheme
                                                .bodySmall
                                                ?.copyWith(
                                                  fontWeight: FontWeight.w600,
                                                ),
                                          ),
                                          const SizedBox(height: 2),
                                          Text(comment.body),
                                          const SizedBox(height: 2),
                                          Text(
                                            _formatDateTime(comment.createdAt),
                                            style: Theme.of(context)
                                                .textTheme
                                                .bodySmall,
                                          ),
                                        ],
                                      ),
                                    ),
                                  )
                                  .toList(),
                            ),
                          );
                        },
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

  Future<void> _openCreateTaskDialog() async {
    final titleController = TextEditingController();
    final descriptionController = TextEditingController();
    final nextStepController = TextEditingController();
    final me = ref.read(authProvider).valueOrNull;
    final membersFuture = _loadProjectMembers();
    var selectedStatus = 'todo';
    var selectedPriority = 'medium';
    var progress = 0.0;
    DateTime? selectedDeadline;
    String? selectedAssigneeId = me?.id;
    var isSaving = false;

    await showDialog<void>(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            Future<void> saveTask() async {
              if (isSaving) return;
              if (titleController.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Введите название задачи')),
                );
                return;
              }
              setDialogState(() => isSaving = true);
              try {
                await apiClient.post('/projects/${widget.projectId}/tasks', {
                  'title': titleController.text.trim(),
                  'description': descriptionController.text.trim().isEmpty
                      ? null
                      : descriptionController.text.trim(),
                  'status': selectedStatus,
                  'priority': selectedPriority,
                  'progress_percent': progress.round(),
                  'next_step': nextStepController.text.trim().isEmpty
                      ? null
                      : nextStepController.text.trim(),
                  'end_date': selectedDeadline == null
                      ? null
                      : _dateOnly(selectedDeadline!),
                  if (selectedAssigneeId != null)
                    'assigned_to_id': selectedAssigneeId,
                });
                ref.invalidate(tasksProvider(widget.projectId));
                if (!mounted) return;
                Navigator.of(this.context).pop();
                ScaffoldMessenger.of(this.context).showSnackBar(
                  const SnackBar(content: Text('Задача создана')),
                );
              } catch (e) {
                if (!mounted) return;
                ScaffoldMessenger.of(this.context).showSnackBar(
                  SnackBar(content: Text('Ошибка создания задачи: $e')),
                );
              } finally {
                if (mounted) setDialogState(() => isSaving = false);
              }
            }

            return AlertDialog(
              title: const Text('Новая задача'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: titleController,
                      decoration: const InputDecoration(labelText: 'Название'),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: descriptionController,
                      decoration: const InputDecoration(labelText: 'Описание'),
                      maxLines: 2,
                    ),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<String>(
                      initialValue: selectedStatus,
                      decoration: const InputDecoration(labelText: 'Статус'),
                      items: _statusLabels.entries
                          .map((e) => DropdownMenuItem<String>(
                                value: e.key,
                                child: Text(e.value),
                              ))
                          .toList(),
                      onChanged: (v) {
                        if (v != null) setDialogState(() => selectedStatus = v);
                      },
                    ),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<String>(
                      initialValue: selectedPriority,
                      decoration: const InputDecoration(labelText: 'Приоритет'),
                      items: const [
                        DropdownMenuItem(value: 'low', child: Text('Low')),
                        DropdownMenuItem(
                            value: 'medium', child: Text('Medium')),
                        DropdownMenuItem(value: 'high', child: Text('High')),
                        DropdownMenuItem(
                            value: 'critical', child: Text('Critical')),
                      ],
                      onChanged: (v) {
                        if (v != null) {
                          setDialogState(() => selectedPriority = v);
                        }
                      },
                    ),
                    const SizedBox(height: 8),
                    Text('Прогресс: ${progress.round()}%'),
                    Slider(
                      value: progress,
                      min: 0,
                      max: 100,
                      divisions: 20,
                      label: '${progress.round()}%',
                      onChanged: (v) => setDialogState(() => progress = v),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: nextStepController,
                      decoration:
                          const InputDecoration(labelText: 'Следующий шаг'),
                      maxLines: 2,
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            selectedDeadline == null
                                ? 'Дедлайн не задан'
                                : 'Дедлайн: ${_dateOnly(selectedDeadline!)}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                        TextButton(
                          onPressed: () async {
                            final now = DateTime.now();
                            final picked = await showDatePicker(
                              context: context,
                              initialDate: selectedDeadline ?? now,
                              firstDate: DateTime(now.year - 2),
                              lastDate: DateTime(now.year + 5),
                            );
                            if (picked != null) {
                              setDialogState(() => selectedDeadline = picked);
                            }
                          },
                          child: const Text('Выбрать'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    FutureBuilder<List<_AssigneeOption>>(
                      future: membersFuture,
                      builder: (context, snapshot) {
                        if (snapshot.connectionState ==
                            ConnectionState.waiting) {
                          return const Padding(
                            padding: EdgeInsets.symmetric(vertical: 8),
                            child: LinearProgressIndicator(minHeight: 2),
                          );
                        }
                        final members =
                            snapshot.data ?? const <_AssigneeOption>[];
                        final hasSelected = members.any(
                          (member) => member.id == selectedAssigneeId,
                        );
                        if (!hasSelected) {
                          selectedAssigneeId = null;
                        }
                        return DropdownButtonFormField<String?>(
                          initialValue: selectedAssigneeId,
                          decoration:
                              const InputDecoration(labelText: 'Ответственный'),
                          items: [
                            const DropdownMenuItem<String?>(
                              value: null,
                              child: Text('Не назначен'),
                            ),
                            ...members.map(
                              (member) => DropdownMenuItem<String?>(
                                value: member.id,
                                child: Text(member.label),
                              ),
                            ),
                          ],
                          onChanged: (value) {
                            setDialogState(() => selectedAssigneeId = value);
                          },
                        );
                      },
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed:
                      isSaving ? null : () => Navigator.of(context).pop(),
                  child: const Text('Отмена'),
                ),
                FilledButton(
                  onPressed: isSaving ? null : saveTask,
                  child: Text(isSaving ? 'Сохранение...' : 'Создать'),
                ),
              ],
            );
          },
        );
      },
    );

    titleController.dispose();
    descriptionController.dispose();
    nextStepController.dispose();
  }

  Future<List<_AssigneeOption>> _loadProjectMembers() async {
    final rows =
        await apiClient.getList('/projects/${widget.projectId}/members');
    final members = <_AssigneeOption>[];
    for (final row in rows) {
      if (row is! Map<String, dynamic>) continue;
      final user = row['user'];
      if (user is! Map<String, dynamic>) continue;
      final id = (user['id'] ?? '').toString().trim();
      final name = (user['name'] ?? '').toString().trim();
      final email = (user['email'] ?? '').toString().trim();
      if (id.isEmpty) continue;
      members.add(
        _AssigneeOption(
          id: id,
          label: name.isNotEmpty ? name : (email.isNotEmpty ? email : id),
        ),
      );
    }
    members
        .sort((a, b) => a.label.toLowerCase().compareTo(b.label.toLowerCase()));
    return members;
  }

  Future<List<_TaskCommentPreview>> _loadTaskComments(String taskId) async {
    final rows = await apiClient.getList('/tasks/$taskId/comments');
    final comments = <_TaskCommentPreview>[];
    for (final row in rows) {
      if (row is! Map<String, dynamic>) continue;
      final body = (row['body'] ?? '').toString().trim();
      if (body.isEmpty) continue;
      final createdAtRaw = row['created_at']?.toString();
      final createdAt = createdAtRaw == null
          ? DateTime.now()
          : DateTime.tryParse(createdAtRaw) ?? DateTime.now();
      final author = row['author'];
      String authorLabel = 'Сотрудник';
      if (author is Map<String, dynamic>) {
        final name = (author['name'] ?? '').toString().trim();
        final email = (author['email'] ?? '').toString().trim();
        if (name.isNotEmpty) {
          authorLabel = name;
        } else if (email.isNotEmpty) {
          authorLabel = email;
        }
      }
      comments.add(
        _TaskCommentPreview(
          body: body,
          authorLabel: authorLabel,
          createdAt: createdAt,
        ),
      );
    }
    comments.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return comments;
  }

  String _formatDateTime(DateTime dateTime) {
    final local = dateTime.toLocal();
    final d = local.day.toString().padLeft(2, '0');
    final m = local.month.toString().padLeft(2, '0');
    final y = local.year.toString();
    final hh = local.hour.toString().padLeft(2, '0');
    final mm = local.minute.toString().padLeft(2, '0');
    return '$d.$m.$y $hh:$mm';
  }

  void _maybeOpenInitialTask(List<Task> tasks) {
    if (_handledInitialTaskOpen) return;
    final initialTaskId = widget.initialTaskId?.trim();
    if (initialTaskId == null || initialTaskId.isEmpty) return;
    Task? target;
    for (final task in tasks) {
      if (task.id == initialTaskId) {
        target = task;
        break;
      }
    }
    _handledInitialTaskOpen = true;
    if (target == null) return;
    if (_activeTab != 0) {
      _tabController.animateTo(0);
      setState(() => _activeTab = 0);
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _openTaskEditor(target!);
    });
  }
}

class _AssigneeOption {
  final String id;
  final String label;

  const _AssigneeOption({required this.id, required this.label});
}

class _TaskCommentPreview {
  final String body;
  final String authorLabel;
  final DateTime createdAt;

  const _TaskCommentPreview({
    required this.body,
    required this.authorLabel,
    required this.createdAt,
  });
}
