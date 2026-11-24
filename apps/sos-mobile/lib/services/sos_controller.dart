import 'dart:async';

import 'package:ark_contracts/ark_contracts.dart';
import 'package:flutter/foundation.dart';

import 'location.dart';
import 'sos_api.dart';

/// Same rule as the schema's contactPhone pattern (E.164).
final e164 = RegExp(r'^\+[1-9][0-9]{6,14}$');

enum Progress { locating, sending }

enum Failure { locationOff, locationDenied, sendFailed }

enum Vulnerable { children, elderly, disabled, pregnant }

/// Everything the four tabs share: what the sender filled in, the SOS once sent, and location sharing.
/// The SOS goes out on the button alone; details filled in before go with it, details after go as an update.
class SosController extends ChangeNotifier {
  SosController({
    required this.api,
    required this.locator,
    required this.saveSosId,
    required this.language,
    this.pollEvery = const Duration(seconds: 10),
  });
  final SosApi api;
  final Locator locator;
  final void Function(String? sosId) saveSosId;
  final Duration pollEvery;

  /// BCP 47 tag of the app language; sent so triage knows what the sender reads.
  String language;

  // What the sender filled in.
  int people = 1;
  final vulnerable = {for (final v in Vulnerable.values) v: 0};
  final needs = <Need>{};
  String medicines = '';
  String notes = '';
  String phone = '';

  String? sosId;
  SosRequest? sos;
  Progress? progress;
  Failure? failure;

  /// Edited since the last report the server has.
  bool detailsDirty = false;
  bool sharing = false;
  Geo? _lastLocation;
  Timer? _poll;
  StreamSubscription<Geo>? _track;

  bool get phoneValid => phone.trim().isEmpty || e164.hasMatch(phone.trim());
  bool get finished => sos?.status == SosStatus.DELIVERED || sos?.status == SosStatus.CLOSED;

  void edit(void Function() change) {
    change();
    for (final v in Vulnerable.values) {
      vulnerable[v] = vulnerable[v]!.clamp(0, people);
    }
    detailsDirty = true;
    notifyListeners();
  }

  SosReport report(Geo location) {
    final meds = medicines
        .split(RegExp(r'[,\n;，、]'))
        .map((m) => m.trim())
        .where((m) => m.isNotEmpty)
        .map((m) => m.length > 100 ? m.substring(0, 100) : m)
        .take(20)
        .toList();
    final anyVulnerable = vulnerable.values.any((n) => n > 0);
    return SosReport(
      channel: Channel.APP,
      location: location,
      language: language,
      rawMessage: notes.trim().isEmpty ? null : notes.trim(),
      peopleCount: people,
      needs: needs.isEmpty ? null : needs.toList(),
      medicines: meds.isEmpty ? null : meds,
      // An invalid phone never blocks the SOS itself; it is left out.
      contactPhone: phone.trim().isNotEmpty && phoneValid ? phone.trim() : null,
      vulnerable: anyVulnerable
          ? SosVulnerable(
              children: vulnerable[Vulnerable.children],
              elderly: vulnerable[Vulnerable.elderly],
              disabled: vulnerable[Vulnerable.disabled],
              pregnant: vulnerable[Vulnerable.pregnant],
            )
          : null,
    );
  }

  /// The big red button, after the hold.
  Future<void> sendSos() async {
    if (progress != null || sosId != null) return;
    _set(progress: Progress.locating);
    try {
      final location = await locator.current();
      _lastLocation = location;
      _set(progress: Progress.sending);
      final sent = await api.create(report(location));
      sosId = sent.id;
      sos = sent;
      detailsDirty = false;
      saveSosId(sent.id);
      _set();
      _follow();
    } on LocationUnavailable catch (e) {
      _set(failure: e.problem == LocationProblem.off ? Failure.locationOff : Failure.locationDenied);
    } catch (_) {
      // shortcut: no offline queue or SMS fallback yet, add one once the SMS intake number exists
      _set(failure: Failure.sendFailed);
    }
  }

  /// Back to an SOS sent before the app was closed.
  void resume(String id) {
    sosId = id;
    _follow();
  }

  Future<void> sendDetails() async {
    final id = sosId;
    final location = _lastLocation ?? sos?.report.location;
    if (id == null || location == null || !phoneValid || progress != null) return;
    _set(progress: Progress.sending);
    try {
      sos = await api.updateReport(id, report(location));
      detailsDirty = false;
      _set();
    } catch (_) {
      _set(failure: Failure.sendFailed);
    }
  }

  /// After "Done": forget this SOS so the next opening shows the button again.
  void finish() {
    _stop();
    saveSosId(null);
    sosId = null;
    sos = null;
    notifyListeners();
  }

  void _follow() {
    _refresh();
    _poll = Timer.periodic(pollEvery, (_) => _refresh());
    sharing = true;
    _track = locator.track().listen(
      _sendLocation,
      onError: (Object _) {
        sharing = false;
        notifyListeners();
      },
    );
    notifyListeners();
  }

  Future<void> _refresh() async {
    final id = sosId;
    if (id == null) return;
    try {
      sos = await api.get(id);
      if (finished) _stop();
      notifyListeners();
    } catch (_) {
      // No signal: keep the last status and try again on the next tick.
    }
  }

  Future<void> _sendLocation(Geo location) async {
    _lastLocation = location;
    final id = sosId;
    if (id == null) return;
    try {
      // UTC so the timestamp carries a zone, as the schema's date-time needs.
      if (!await api.sendLocation(id, SosLocationUpdate(location: location, ts: DateTime.now().toUtc()))) _stop();
    } catch (_) {
      // A missed update is fine: the next fix replaces it.
    }
  }

  void _stop() {
    _poll?.cancel();
    _track?.cancel();
    _track = null;
    if (sharing) {
      sharing = false;
      notifyListeners();
    }
  }

  void _set({Progress? progress, Failure? failure}) {
    this.progress = progress;
    this.failure = failure;
    notifyListeners();
  }

  @override
  void dispose() {
    _stop();
    super.dispose();
  }
}
