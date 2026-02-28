import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:dio/dio.dart';
import '../providers/auth_provider.dart';
import '../core/api_client.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _showPassword = false;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final email = _emailController.text.trim().toLowerCase();
      final password = _passwordController.text;
      await ref.read(authProvider.notifier).login(
            email,
            password,
          );
      if (mounted) context.go('/');
    } catch (e) {
      final message = _mapAuthError(e);
      setState(() => _error = message);
      if (mounted) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
          );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _forgotPassword() async {
    final email = _emailController.text.trim().toLowerCase();
    if (email.isEmpty) {
      setState(() => _error = 'Введите email для восстановления пароля.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await apiClient.post('/auth/forgot-password', {'email': email});
      final msg = (res['message'] ?? 'Если аккаунт найден, письмо отправлено.').toString();
      if (mounted) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating),
          );
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Не удалось отправить запрос восстановления. Попробуйте позже.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _mapAuthError(Object error) {
    if (error is DioException) {
      final status = error.response?.statusCode;
      final path = error.requestOptions.path;
      final detail = error.response?.data is Map<String, dynamic>
          ? (error.response?.data['detail']?.toString() ?? '')
          : '';
      if (status == 401) {
        if (path.contains('/auth/login')) {
          return 'Неверный email или пароль.';
        }
        if (path.contains('/users/me')) {
          return 'Вход выполнен, но не удалось проверить профиль. Повторите попытку.';
        }
        if (detail.isNotEmpty) {
          return 'Ошибка авторизации (401).';
        }
        return 'Ошибка авторизации (401).';
      }
      if (status == 403) {
        return 'Доступ запрещен: аккаунт отключен или вход недоступен.';
      }
      if (status == 422) {
        return 'Проверьте корректность email и пароля.';
      }
      if (error.type == DioExceptionType.connectionError ||
          error.type == DioExceptionType.connectionTimeout ||
          error.type == DioExceptionType.receiveTimeout ||
          error.type == DioExceptionType.sendTimeout) {
        return 'Нет соединения с сервером. Проверьте интернет.';
      }
      if (detail.isNotEmpty) {
        return detail;
      }
      return 'Ошибка запроса к серверу.';
    }
    return 'Ошибка авторизации. Проверьте логин и пароль.';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              Text(
                'PlannerBro',
                style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                'Войдите в учетную запись',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(
                        context,
                      ).colorScheme.onSurface.withValues(alpha: 0.6),
                    ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 32),
              TextField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                textCapitalization: TextCapitalization.none,
                autocorrect: false,
                enableSuggestions: false,
                decoration: const InputDecoration(
                  labelText: 'Почта',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _passwordController,
                obscureText: !_showPassword,
                autocorrect: false,
                enableSuggestions: false,
                decoration: InputDecoration(
                  labelText: 'Пароль',
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    onPressed: () =>
                        setState(() => _showPassword = !_showPassword),
                    icon: Icon(
                      _showPassword ? Icons.visibility_off : Icons.visibility,
                    ),
                  ),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(
                  _error!,
                  style: TextStyle(
                      color: Theme.of(context).colorScheme.error, fontSize: 13),
                ),
              ],
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _loading ? null : _submit,
                child: _loading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Войти'),
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: _loading ? null : _forgotPassword,
                child: const Text('Забыли пароль?'),
              ),
              const Spacer(),
            ],
          ),
        ),
      ),
    );
  }
}
