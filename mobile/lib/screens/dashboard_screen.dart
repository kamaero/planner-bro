import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
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
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openCreateProjectDialog,
        icon: const Icon(Icons.add),
        label: const Text('Проект'),
      ),
    );
  }
}
