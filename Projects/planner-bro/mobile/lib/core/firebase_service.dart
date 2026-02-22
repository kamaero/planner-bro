import 'package:firebase_messaging/firebase_messaging.dart';
import 'api_client.dart';

class FirebaseService {
  static final _messaging = FirebaseMessaging.instance;

  static Future<void> init() async {
    await _messaging.requestPermission();

    // Get and register FCM token
    final token = await _messaging.getToken();
    if (token != null) {
      await _registerToken(token);
    }

    // Handle token refresh
    _messaging.onTokenRefresh.listen(_registerToken);

    // Foreground message handling
    FirebaseMessaging.onMessage.listen((message) {
      // In a real app, show a local notification here
    });
  }

  static Future<void> _registerToken(String token) async {
    try {
      await apiClient.post('/devices/register', {'token': token, 'platform': 'android'});
    } catch (_) {
      // Ignore if not logged in yet
    }
  }
}

@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  // Background message handler registered in main()
}
