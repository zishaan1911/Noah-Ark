import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'screens/help_screen.dart';
import 'screens/status_screen.dart';
import 'services/fake_sos_api.dart';
import 'services/location.dart';
import 'services/sos_api.dart';

/// `flutter run --dart-define=API_URL=https://…/v1` for the real API; without it the app runs on FakeSosApi.
const apiUrl = String.fromEnvironment('API_URL');
const _activeSosKey = 'activeSosId';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  runApp(
    ArkSosApp(
      api: apiUrl.isEmpty ? FakeSosApi() : HttpSosApi(apiUrl),
      locator: DeviceLocator(),
      pollEvery: apiUrl.isEmpty ? const Duration(seconds: 2) : const Duration(seconds: 10),
      // Reopening the app after it was closed goes back to the SOS in progress.
      initialSosId: prefs.getString(_activeSosKey),
      saveSosId: (id) => id == null ? prefs.remove(_activeSosKey) : prefs.setString(_activeSosKey, id),
    ),
  );
}

class ArkSosApp extends StatefulWidget {
  const ArkSosApp({
    super.key,
    required this.api,
    required this.locator,
    required this.saveSosId,
    this.initialSosId,
    this.pollEvery = const Duration(seconds: 10),
  });
  final SosApi api;
  final Locator locator;
  final String? initialSosId;
  final void Function(String? sosId) saveSosId;
  final Duration pollEvery;

  @override
  State<ArkSosApp> createState() => _ArkSosAppState();
}

class _ArkSosAppState extends State<ArkSosApp> {
  late String? _sosId = widget.initialSosId;

  void _setSos(String? id) {
    widget.saveSosId(id);
    setState(() => _sosId = id);
  }

  @override
  Widget build(BuildContext context) {
    final sosId = _sosId;
    return MaterialApp(
      title: 'Ark SOS',
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFD32F2F))),
      home: sosId == null
          ? HelpScreen(api: widget.api, locator: widget.locator, onSent: _setSos)
          : StatusScreen(
              key: ValueKey(sosId),
              sosId: sosId,
              api: widget.api,
              locator: widget.locator,
              pollEvery: widget.pollEvery,
              onDone: () => _setSos(null),
            ),
    );
  }
}
