import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api_client.dart';
import '../core/firebase_service.dart';
import '../models/user.dart';

class AuthNotifier extends AsyncNotifier<User?> {
  Future<void> _syncDeviceTokenSafe() async {
    try {
      await FirebaseService.syncDeviceToken();
    } catch (_) {
      // FCM/Firebase issues must not block authentication.
    }
  }

  @override
  Future<User?> build() async {
    final loggedIn = await isLoggedIn();
    if (!loggedIn) return null;
    try {
      final data = await apiClient.get('/users/me');
      await _syncDeviceTokenSafe();
      return User.fromJson(data);
    } catch (_) {
      return null;
    }
  }

  Future<void> login(String email, String password) async {
    try {
      Map<String, dynamic> tokens;
      try {
        tokens = await apiClient
            .post('/auth/login', {'email': email, 'password': password});
      } on DioException catch (e) {
        final canRetryTrimmed = e.response?.statusCode == 401 &&
            password.trim() != password &&
            password.trim().isNotEmpty;
        if (!canRetryTrimmed) rethrow;
        tokens = await apiClient
            .post('/auth/login', {'email': email, 'password': password.trim()});
      }
      await saveTokens(
          tokens['access_token'] as String, tokens['refresh_token'] as String);
      final userData = await apiClient.get('/users/me');
      await _syncDeviceTokenSafe();
      state = AsyncData(User.fromJson(userData));
    } catch (e) {
      rethrow;
    }
  }

  Future<void> register(String email, String password, String name) async {
    try {
      final tokens = await apiClient.post('/auth/register', {
        'email': email,
        'password': password,
        'name': name,
      });
      await saveTokens(
          tokens['access_token'] as String, tokens['refresh_token'] as String);
      final userData = await apiClient.get('/users/me');
      await _syncDeviceTokenSafe();
      state = AsyncData(User.fromJson(userData));
    } catch (e) {
      rethrow;
    }
  }

  Future<void> logout() async {
    await FirebaseService.unregisterCurrentDevice();
    await apiClient.logout();
    state = const AsyncData(null);
  }
}

final authProvider =
    AsyncNotifierProvider<AuthNotifier, User?>(AuthNotifier.new);
