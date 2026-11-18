import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'generated/l10n/app_localizations.dart';
import 'screens/home_screen.dart';
import 'services/fake_sos_api.dart';
import 'services/location.dart';
import 'services/sos_api.dart';
import 'services/sos_controller.dart';

/// `flutter run --dart-define=API_URL=https://…/v1` for the real API; without it the app runs on FakeSosApi.
const apiUrl = String.fromEnvironment('API_URL');
const _activeSosKey = 'activeSosId';
const _languageKey = 'language';

/// The saved choice, else the phone's language if we have it, else English.
String startLanguage(String? saved, Locale device) =>
    saved ?? (languages.containsKey(device.languageCode) ? device.languageCode : 'en');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final sos = SosController(
    api: apiUrl.isEmpty ? FakeSosApi() : HttpSosApi(apiUrl),
    locator: DeviceLocator(),
    pollEvery: apiUrl.isEmpty ? const Duration(seconds: 2) : const Duration(seconds: 10),
    language: startLanguage(prefs.getString(_languageKey), PlatformDispatcher.instance.locale),
    saveSosId: (id) => id == null ? prefs.remove(_activeSosKey) : prefs.setString(_activeSosKey, id),
  );
  // Reopening the app after it was closed goes back to the SOS in progress.
  final active = prefs.getString(_activeSosKey);
  if (active != null) sos.resume(active);
  runApp(ArkSosApp(sos: sos, saveLanguage: (tag) => prefs.setString(_languageKey, tag)));
}

class ArkSosApp extends StatefulWidget {
  const ArkSosApp({super.key, required this.sos, required this.saveLanguage});
  final SosController sos;
  final void Function(String tag) saveLanguage;

  @override
  State<ArkSosApp> createState() => _ArkSosAppState();
}

class _ArkSosAppState extends State<ArkSosApp> {
  void _setLanguage(String tag) {
    widget.saveLanguage(tag);
    setState(() => widget.sos.language = tag);
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
    locale: Locale(widget.sos.language),
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFD32F2F))),
    home: HomeScreen(sos: widget.sos, onLanguage: _setLanguage),
  );
}
