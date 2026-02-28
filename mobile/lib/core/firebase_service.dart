import 'package:firebase_messaging/firebase_messaging.dart';
import 'api_client.dart';

class FirebaseService {
  static final _messaging = FirebaseMessaging.instance;
  static bool _initialized = false;

  static Future<void> init() async {
    if (_initialized) return;
    _initialized = true;
    await _messaging.requestPermission();

    await syncDeviceToken();

    // Handle token refresh
    _messaging.onTokenRefresh.listen(_registerToken);

    // Foreground message handling
    FirebaseMessaging.onMessage.listen((message) {
      // In a real app, show a local notification here
    });
  }

  static Future<void> syncDeviceToken() async {
    final token = await _messaging.getToken();
    if (token != null) {
      await _registerToken(token);
    }
  }

  static Future<void> _registerToken(String token) async {
    try {
      await apiClient
          .post('/devices/register', {'token': token, 'platform': 'android'});
    } catch (_) {
      // Ignore if not logged in yet
    }
  }

  static Future<void> unregisterCurrentDevice() async {
    try {
      final token = await _messaging.getToken();
      if (token == null || token.trim().isEmpty) return;
      await apiClient.delete('/devices/${Uri.encodeComponent(token)}');
    } catch (_) {
      // Ignore network/auth issues on logout path
    }
  }
}

@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  // Background message handler registered in main()
}
