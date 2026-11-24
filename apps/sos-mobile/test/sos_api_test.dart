import 'dart:convert';

import 'package:ark_contracts/ark_contracts.dart';
import 'package:ark_sos/services/fake_sos_api.dart';
import 'package:ark_sos/services/sos_api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const sosId = 'sos_01JD8X5Q2M9VTRC3B7K4N6P0WY';

Map<String, dynamic> stored(Map<String, dynamic> report) => {
  'id': sosId,
  'createdAt': '2026-11-18T09:30:00Z',
  'status': 'new',
  'report': report,
};

void main() {
  test('withoutNulls drops unset fields at every level', () {
    expect(
      withoutNulls({
        'a': 1,
        'b': null,
        'c': {'d': null, 'e': 'x'},
        'f': [
          {'g': null},
        ],
      }),
      {
        'a': 1,
        'c': {'e': 'x'},
        'f': [<String, Object?>{}],
      },
    );
  });

  test('create posts the report without nulls and parses the stored SOS', () async {
    late Map<String, dynamic> body;
    final api = HttpSosApi(
      'https://api.test/v1',
      client: MockClient((req) async {
        expect(req.url.toString(), 'https://api.test/v1/sos');
        body = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response(jsonEncode(stored(body)), 201);
      }),
    );
    final sos = await api.create(
      SosReport(channel: Channel.APP, location: Geo(lat: 5.98, lon: 116.07), peopleCount: 2),
    );
    expect(body, {
      'channel': 'app',
      'location': {'lat': 5.98, 'lon': 116.07},
      'needs': <String>[],
      'medicines': <String>[],
      'peopleCount': 2,
    });
    expect(sos.id, sosId);
    expect(sos.status, SosStatus.NEW);
    expect(sos.triage, isNull);
  });

  test('sendLocation: 204 keeps going, 409 means stop, other errors throw with the API code', () async {
    final statuses = [204, 409, 400];
    final api = HttpSosApi(
      'https://api.test/v1',
      client: MockClient((req) async {
        expect(req.url.path, '/v1/sos/$sosId/location');
        final ts = (jsonDecode(req.body) as Map)['ts'] as String;
        expect(ts, endsWith('Z'));
        final status = statuses.removeAt(0);
        return http.Response(status == 400 ? '{"error":"invalid_body"}' : '', status);
      }),
    );
    SosLocationUpdate update() => SosLocationUpdate(location: Geo(lat: 5.98, lon: 116.07), ts: DateTime.now().toUtc());
    expect(await api.sendLocation(sosId, update()), isTrue);
    expect(await api.sendLocation(sosId, update()), isFalse);
    expect(
      api.sendLocation(sosId, update()),
      throwsA(isA<ApiException>().having((e) => e.code, 'code', 'invalid_body')),
    );
  });

  test('updateReport PUTs the whole report and returns the stored SOS', () async {
    final api = HttpSosApi(
      'https://api.test/v1',
      client: MockClient((req) async {
        expect((req.method, req.url.path), ('PUT', '/v1/sos/$sosId/report'));
        final body = jsonDecode(req.body) as Map<String, dynamic>;
        expect(body['vulnerable'], {'children': 1});
        return http.Response(jsonEncode(stored(body)), 200);
      }),
    );
    final sos = await api.updateReport(
      sosId,
      SosReport(channel: Channel.APP, location: Geo(lat: 5.98, lon: 116.07), vulnerable: SosVulnerable(children: 1)),
    );
    expect(sos.report.vulnerable?.children, 1);
  });

  test('FakeSosApi walks an SOS from new to delivered and then refuses locations', () async {
    var now = DateTime(2026, 11, 18, 9, 30);
    final api = FakeSosApi(step: const Duration(seconds: 5), now: () => now);
    final sos = await api.create(SosReport(channel: Channel.APP, location: Geo(lat: 5.98, lon: 116.07)));
    final seen = <(SosStatus, double?)>[];
    for (var i = 0; i < 8; i++) {
      final s = await api.get(sos.id);
      seen.add((s.status, s.delivery?.etaMinutes));
      now = now.add(const Duration(seconds: 5));
    }
    expect(seen, [
      (SosStatus.NEW, null),
      (SosStatus.TRIAGED, null),
      (SosStatus.ASSIGNED, 5.0),
      (SosStatus.ASSIGNED, 4.0),
      (SosStatus.ASSIGNED, 3.0),
      (SosStatus.ASSIGNED, 2.0),
      (SosStatus.ASSIGNED, 1.0),
      (SosStatus.DELIVERED, 0.0),
    ]);
    final update = SosLocationUpdate(location: Geo(lat: 5.98, lon: 116.07), ts: now.toUtc());
    expect(await api.sendLocation(sos.id, update), isFalse);
  });
}
