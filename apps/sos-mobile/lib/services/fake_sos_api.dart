import 'dart:math';

import 'package:ark_contracts/ark_contracts.dart';

import 'sos_api.dart';

/// Stands in for Ark Brain when the app runs without API_URL: the SOS goes new -> triaged -> assigned
/// (drone on the way, ETA counting down) -> delivered, on a clock, so every screen can be seen.
class FakeSosApi implements SosApi {
  FakeSosApi({this.step = const Duration(seconds: 5), DateTime Function()? now}) : _now = now ?? DateTime.now;
  final Duration step;
  final DateTime Function() _now;
  final _sent = <String, (SosRequest, DateTime)>{};
  final locations = <SosLocationUpdate>[];

  static final _random = Random();
  static const _crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  static String _id(String prefix) => '${prefix}_${List.generate(26, (_) => _crockford[_random.nextInt(32)]).join()}';

  @override
  Future<SosRequest> create(SosReport report) async {
    final sos = SosRequest(id: _id('sos'), createdAt: _now().toUtc(), status: SosStatus.NEW, report: report);
    _sent[sos.id] = (sos, _now());
    return sos;
  }

  @override
  Future<SosRequest> get(String sosId) async {
    final (sos, at) = _sent[sosId] ?? (throw ApiException(404, 'not_found'));
    final steps = _now().difference(at).inMilliseconds ~/ step.inMilliseconds;
    // Steps 2..6: a drone is on the way; the ETA drops each step and it lands at step 7.
    const etaSteps = 5;
    return SosRequest(
      id: sos.id,
      createdAt: sos.createdAt,
      report: sos.report,
      status: switch (steps) {
        0 => SosStatus.NEW,
        1 => SosStatus.TRIAGED,
        < 2 + etaSteps => SosStatus.ASSIGNED,
        _ => SosStatus.DELIVERED,
      },
      missionId: steps >= 2 ? 'msn_01JD8X5Q2M9VTRC3B7K4N6P0WY' : null,
      delivery: steps >= 2
          ? SosDelivery(
              droneId: 'ARK-001',
              missionStatus: steps >= 2 + etaSteps ? MissionStatus.DELIVERED : MissionStatus.IN_FLIGHT,
              etaMinutes: max(0, 2 + etaSteps - steps).toDouble(),
            )
          : null,
    );
  }

  @override
  Future<bool> sendLocation(String sosId, SosLocationUpdate update) async {
    final sos = await get(sosId);
    if (sos.status == SosStatus.DELIVERED || sos.status == SosStatus.CLOSED) return false;
    locations.add(update);
    return true;
  }
}
