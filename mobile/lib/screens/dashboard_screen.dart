import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../models/task.dart';
import '../providers/auth_provider.dart';
import '../providers/projects_provider.dart';
import '../core/api_client.dart';
import '../widgets/project_card_widget.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  bool _showMyTasks = false;
  String _myTasksFilter = 'all';

  Future<void> _openCreateProjectDialog() async {
    final nameController = TextEditingController();
    final descriptionController = TextEditingController();
    var selectedStatus = 'active';
    var selectedPriority = 'medium';
    var controlSki = false;
    DateTime? deadline;
    var isSaving = false;

    await showDialog<void>(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            Future<void> saveProject() async {
              if (isSaving) return;
              if (nameController.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Введите название проекта')),
                );
                return;
              }
              setDialogState(() => isSaving = true);
              try {
                await apiClient.post('/projects/', {
                  'name': nameController.text.trim(),
                  'description': descriptionController.text.trim().isEmpty
                      ? null
                      : descriptionController.text.trim(),
                  'status': selectedStatus,
                  'priority': controlSki ? 'critical' : selectedPriority,
                  'control_ski': controlSki,
                  'end_date': deadline == null ? null : _dateOnly(deadline!),
                });
                ref.invalidate(projectsProvider);
                if (!mounted) return;
                Navigator.of(this.context).pop();
                ScaffoldMessenger.of(this.context).showSnackBar(
                  const SnackBar(content: Text('Проект создан')),
                );
              } catch (e) {
                if (!mounted) return;
                ScaffoldMessenger.of(this.context).showSnackBar(
                  SnackBar(content: Text('Ошибка создания проекта: $e')),
                );
              } finally {
                if (mounted) {
                  setDialogState(() => isSaving = false);
                }
              }
            }

            return AlertDialog(
              title: const Text('Новый проект'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: nameController,
                      decoration: const InputDecoration(
                        labelText: 'Название',
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: descriptionController,
                      decoration: const InputDecoration(
                        labelText: 'Описание',
                      ),
                      maxLines: 2,
                    ),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<String>(
                      initialValue: selectedStatus,
                      decoration: const InputDecoration(labelText: 'Статус'),
                      items: const [
                        DropdownMenuItem(
                            value: 'planning', child: Text('Планирование')),
                        DropdownMenuItem(value: 'tz', child: Text('ТЗ')),
                        DropdownMenuItem(
                            value: 'active', child: Text('В работе')),
                        DropdownMenuItem(
                            value: 'testing', child: Text('Тестирование')),
                        DropdownMenuItem(
                            value: 'on_hold', child: Text('На паузе')),
                      ],
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
                      onChanged: controlSki
                          ? null
                          : (v) {
                              if (v != null) {
                                setDialogState(() => selectedPriority = v);
                              }
                            },
                    ),
                    const SizedBox(height: 8),
                    SwitchListTile(
                      value: controlSki,
                      onChanged: (v) => setDialogState(() => controlSki = v),
                      title: const Text('Контроль СКИ'),
                      contentPadding: EdgeInsets.zero,
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            deadline == null
                                ? 'Дедлайн не задан'
                                : 'Дедлайн: ${_dateOnly(deadline!)}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                        TextButton(
                          onPressed: () async {
                            final now = DateTime.now();
                            final picked = await showDatePicker(
                              context: context,
                              initialDate: deadline ?? now,
                              firstDate: DateTime(now.year - 2),
                              lastDate: DateTime(now.year + 5),
                            );
                            if (picked != null) {
                              setDialogState(() => deadline = picked);
                            }
                          },
                          child: const Text('Выбрать'),
                        ),
                      ],
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
                  onPressed: isSaving ? null : saveProject,
                  child: Text(isSaving ? 'Сохранение...' : 'Создать'),
                ),
              ],
            );
          },
        );
      },
    );
    nameController.dispose();
    descriptionController.dispose();
  }

  String _dateOnly(DateTime date) {
    final y = date.year.toString().padLeft(4, '0');
    final m = date.month.toString().padLeft(2, '0');
    final d = date.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  @override
  Widget build(BuildContext context) {
    final projectsAsync = ref.watch(projectsProvider);
    final myTasksAsync = ref.watch(myTasksProvider);
    ref.watch(authProvider);

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
          return Column(
            children: [
              const SizedBox(height: 10),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: SegmentedButton<bool>(
                  segments: const [
                    ButtonSegment<bool>(
                      value: false,
                      icon: Icon(Icons.folder_outlined),
                      label: Text('Проекты'),
                    ),
                    ButtonSegment<bool>(
                      value: true,
                      icon: Icon(Icons.task_alt),
                      label: Text('Мои задачи'),
                    ),
                  ],
                  selected: {_showMyTasks},
                  onSelectionChanged: (selection) {
                    setState(() => _showMyTasks = selection.first);
                  },
                ),
              ),
              const SizedBox(height: 10),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () async {
                    ref.invalidate(projectsProvider);
                    ref.invalidate(myTasksProvider);
                  },
                  child: _showMyTasks
                      ? myTasksAsync.when(
                          loading: () =>
                              const Center(child: CircularProgressIndicator()),
                          error: (e, _) =>
                              Center(child: Text('Ошибка задач: $e')),
                          data: (entries) {
                            final filteredEntries = _filterMyTasks(entries);
                            final allCount = entries.length;
                            final urgentCount =
                                _filterMyTasks(entries, mode: 'urgent').length;
                            final overdueCount =
                                _filterMyTasks(entries, mode: 'overdue').length;
                            return ListView.builder(
                              padding: const EdgeInsets.all(16),
                              itemCount: (filteredEntries.isEmpty
                                  ? 1
                                  : filteredEntries.length + 1),
                              itemBuilder: (ctx, i) {
                                if (i == 0) {
                                  return Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Wrap(
                                        spacing: 8,
                                        children: [
                                          ChoiceChip(
                                            label: Text('Все ($allCount)'),
                                            selected: _myTasksFilter == 'all',
                                            onSelected: (_) => setState(
                                              () => _myTasksFilter = 'all',
                                            ),
                                          ),
                                          ChoiceChip(
                                            label: Text(
                                              'Срочные ($urgentCount)',
                                            ),
                                            selected:
                                                _myTasksFilter == 'urgent',
                                            onSelected: (_) => setState(
                                              () => _myTasksFilter = 'urgent',
                                            ),
                                          ),
                                          ChoiceChip(
                                            label: Text(
                                              'Просроченные ($overdueCount)',
                                            ),
                                            selected:
                                                _myTasksFilter == 'overdue',
                                            onSelected: (_) => setState(
                                              () => _myTasksFilter = 'overdue',
                                            ),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 12),
                                      if (filteredEntries.isEmpty)
                                        Center(
                                          child: Padding(
                                            padding: const EdgeInsets.only(
                                              top: 48,
                                            ),
                                            child: Text(
                                              _myTasksFilter == 'overdue'
                                                  ? 'Просроченных задач нет'
                                                  : _myTasksFilter == 'urgent'
                                                      ? 'Срочных задач нет'
                                                      : 'На вас нет активных задач',
                                            ),
                                          ),
                                        ),
                                    ],
                                  );
                                }
                                final entry = filteredEntries[i - 1];
                                final task = entry.task;
                                final urgencyColor = _urgencyColor(task);
                                return Card(
                                  margin: const EdgeInsets.only(bottom: 10),
                                  child: InkWell(
                                    borderRadius: BorderRadius.circular(12),
                                    onTap: () => context.push(
                                      '/projects/${entry.project.id}?task=${task.id}',
                                    ),
                                    child: Container(
                                      decoration: BoxDecoration(
                                        borderRadius: BorderRadius.circular(12),
                                        border: Border.all(
                                          color: urgencyColor,
                                          width: 1.2,
                                        ),
                                      ),
                                      padding: const EdgeInsets.all(12),
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              Expanded(
                                                child: Text(
                                                  task.title,
                                                  style: Theme.of(context)
                                                      .textTheme
                                                      .titleSmall
                                                      ?.copyWith(
                                                        fontWeight:
                                                            FontWeight.w600,
                                                      ),
                                                ),
                                              ),
                                              if (task.status != 'done')
                                                IconButton(
                                                  tooltip: 'Выполнено',
                                                  icon: const Icon(
                                                    Icons.check_circle_outline,
                                                    size: 20,
                                                  ),
                                                  onPressed: () =>
                                                      _markTaskDone(
                                                    taskId: task.id,
                                                  ),
                                                ),
                                            ],
                                          ),
                                          const SizedBox(height: 6),
                                          Text(
                                            entry.project.name,
                                            style: Theme.of(context)
                                                .textTheme
                                                .bodySmall,
                                          ),
                                          const SizedBox(height: 4),
                                          Text(
                                            'Статус: ${_statusLabel(task.status)}',
                                            style: Theme.of(context)
                                                .textTheme
                                                .bodySmall,
                                          ),
                                          const SizedBox(height: 6),
                                          Text(
                                            _deadlineLabel(task.endDate),
                                            style: TextStyle(
                                              color: urgencyColor,
                                              fontWeight: FontWeight.w600,
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
                        )
                      : projects.isEmpty
                          ? ListView(
                              children: [
                                SizedBox(height: 160),
                                Center(
                                  child: Text(
                                    'Нет проектов.\nПопросите менеджера добавить вас.',
                                    textAlign: TextAlign.center,
                                  ),
                                ),
                              ],
                            )
                          : ListView.builder(
                              padding: const EdgeInsets.all(16),
                              itemCount: projects.length,
                              itemBuilder: (ctx, i) =>
                                  ProjectCardWidget(project: projects[i]),
                            ),
                ),
              ),
            ],
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openCreateProjectDialog,
        icon: const Icon(Icons.add),
        label: const Text('Проект'),
      ),
    );
  }

  String _deadlineLabel(DateTime? endDate) {
    if (endDate == null) return 'Дедлайн: не задан';
    final now = DateTime.now();
    final dayNow = DateTime(now.year, now.month, now.day);
    final dayEnd = DateTime(endDate.year, endDate.month, endDate.day);
    final diff = dayEnd.difference(dayNow).inDays;
    final dateText =
        '${endDate.day.toString().padLeft(2, '0')}.${endDate.month.toString().padLeft(2, '0')}.${endDate.year}';
    if (diff < 0) return 'Просрочено · $dateText';
    if (diff == 0) return 'Срок сегодня · $dateText';
    if (diff == 1) return 'Срок завтра · $dateText';
    if (diff <= 7) return 'Срок через $diff дн. · $dateText';
    return 'Срок: $dateText';
  }

  Color _urgencyColor(Task task) {
    if (task.endDate == null) return Colors.blueGrey;
    final now = DateTime.now();
    final dayNow = DateTime(now.year, now.month, now.day);
    final dayEnd = DateTime(
      task.endDate!.year,
      task.endDate!.month,
      task.endDate!.day,
    );
    final diff = dayEnd.difference(dayNow).inDays;
    if (diff < 0) return Colors.red.shade700;
    if (diff <= 1) return Colors.orange.shade700;
    if (diff <= 3) return Colors.amber.shade800;
    return Colors.green.shade700;
  }

  Future<void> _markTaskDone({required String taskId}) async {
    try {
      await apiClient.patch('/tasks/$taskId/status', {'status': 'done'});
      ref.invalidate(myTasksProvider);
      ref.invalidate(projectsProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Задача переведена в Выполнено')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Ошибка обновления задачи: $e')),
      );
    }
  }

  String _statusLabel(String status) {
    const labels = {
      'planning': 'Планирование',
      'tz': 'ТЗ',
      'todo': 'К выполнению',
      'in_progress': 'В работе',
      'testing': 'Тестирование',
      'review': 'На проверке',
      'done': 'Выполнено',
    };
    return labels[status] ?? status;
  }

  List<UserTaskEntry> _filterMyTasks(
    List<UserTaskEntry> entries, {
    String? mode,
  }) {
    final activeMode = mode ?? _myTasksFilter;
    if (activeMode == 'all') return entries;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    if (activeMode == 'overdue') {
      return entries.where((entry) {
        final end = entry.task.endDate;
        if (end == null || entry.task.status == 'done') return false;
        final dayEnd = DateTime(end.year, end.month, end.day);
        return dayEnd.isBefore(today);
      }).toList();
    }
    if (activeMode == 'urgent') {
      return entries.where((entry) {
        final end = entry.task.endDate;
        if (end == null || entry.task.status == 'done') return false;
        final dayEnd = DateTime(end.year, end.month, end.day);
        final diff = dayEnd.difference(today).inDays;
        return diff <= 2;
      }).toList();
    }
    return entries;
  }
}
