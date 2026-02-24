import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _baseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:8000/api/v1');
const _storage = FlutterSecureStorage();

class ApiClient {
  final Dio _dio;

  ApiClient() : _dio = Dio(BaseOptions(baseUrl: _baseUrl)) {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _storage.read(key: 'access_token');
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        return handler.next(options);
      },
      onError: (error, handler) async {
        if (error.response?.statusCode == 401) {
          // Try to refresh
          final refreshToken = await _storage.read(key: 'refresh_token');
          if (refreshToken == null) return handler.next(error);

          try {
            final res = await Dio(BaseOptions(baseUrl: _baseUrl)).post(
              '/auth/refresh',
              data: {'refresh_token': refreshToken},
            );
            final newAccess = res.data['access_token'] as String;
            final newRefresh = res.data['refresh_token'] as String;
            await _storage.write(key: 'access_token', value: newAccess);
            await _storage.write(key: 'refresh_token', value: newRefresh);

            // Retry original request
            final opts = error.requestOptions;
            opts.headers['Authorization'] = 'Bearer $newAccess';
            final retryRes = await _dio.fetch(opts);
            return handler.resolve(retryRes);
          } catch (_) {
            await logout();
            return handler.next(error);
          }
        }
        return handler.next(error);
      },
    ));
  }

  Future<void> logout() async {
    await _storage.deleteAll();
  }

  Future<Map<String, dynamic>> get(String path) async {
    final res = await _dio.get(path);
    return res.data as Map<String, dynamic>;
  }

  Future<List<dynamic>> getList(String path) async {
    final res = await _dio.get(path);
    return res.data as List<dynamic>;
  }

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> data) async {
    final res = await _dio.post(path, data: data);
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> put(String path, Map<String, dynamic> data) async {
    final res = await _dio.put(path, data: data);
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> patch(String path, Map<String, dynamic> data) async {
    final res = await _dio.patch(path, data: data);
    return res.data as Map<String, dynamic>;
  }

  Future<void> delete(String path) async {
    await _dio.delete(path);
  }
}

final apiClient = ApiClient();

// Auth helpers
Future<bool> isLoggedIn() async {
  final token = await _storage.read(key: 'access_token');
  return token != null;
}

Future<void> saveTokens(String access, String refresh) async {
  await _storage.write(key: 'access_token', value: access);
  await _storage.write(key: 'refresh_token', value: refresh);
}
