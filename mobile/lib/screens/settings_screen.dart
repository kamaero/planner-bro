import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_provider.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userAsync = ref.watch(authProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Профиль')),
      body: userAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Ошибка: $e')),
        data: (user) => user == null
            ? const SizedBox()
            : ListView(
                children: [
                  const SizedBox(height: 16),
                  ListTile(
                    leading: const Icon(Icons.person),
                    title: const Text('Имя'),
                    subtitle: Text(user.name),
                  ),
                  ListTile(
                    leading: const Icon(Icons.email),
                    title: const Text('Почта'),
                    subtitle: Text(user.email),
                  ),
                  ListTile(
                    leading: const Icon(Icons.badge),
                    title: const Text('Роль'),
                    subtitle: Text(_roleLabel(user.role)),
                  ),
                  const Divider(),
                  ListTile(
                    leading: const Icon(Icons.logout, color: Colors.red),
                    title: const Text('Выйти',
                        style: TextStyle(color: Colors.red)),
                    onTap: () async {
                      final confirm = await showDialog<bool>(
                        context: context,
                        builder: (context) => AlertDialog(
                          title: const Text('Выход'),
                          content:
                              const Text('Выйти из текущей учетной записи?'),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.of(context).pop(false),
                              child: const Text('Отмена'),
                            ),
                            FilledButton(
                              onPressed: () => Navigator.of(context).pop(true),
                              child: const Text('Выйти'),
                            ),
                          ],
                        ),
                      );
                      if (confirm != true) return;
                      await ref.read(authProvider.notifier).logout();
                      if (context.mounted) context.go('/login');
                    },
                  ),
                ],
              ),
      ),
    );
  }

  String _roleLabel(String role) {
    const labels = {
      'admin': 'Администратор',
      'manager': 'Руководитель',
      'member': 'Сотрудник',
      'user': 'Пользователь',
    };
    return labels[role] ?? role;
  }
}
