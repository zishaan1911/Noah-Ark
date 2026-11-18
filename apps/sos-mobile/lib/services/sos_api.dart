import 'dart:convert';

import 'package:ark_contracts/ark_contracts.dart';
import 'package:http/http.dart' as http;

/// The three public calls Ark SOS makes (shared/api/openapi.yaml). No login: SOS ids are unguessable ULIDs.
abstract class SosApi {
  Future<SosRequest> create(SosReport report);
  Future<SosRequest> get(String sosId);

  /// Returns false once the SOS is delivered or closed (409): stop sending.
  Future<bool> sendLocation(String sosId, SosLocationUpdate update);
}

class ApiException implements Exception {
  ApiException(this.status, this.code);
  final int status;
  final String code;

  @override
  String toString() => 'ApiException($status, $code)';
}

/// The generated toJson writes `null` for unset optional fields; the API rejects those
/// (additionalProperties: false, no null types), so drop them before sending.
Object? withoutNulls(Object? value) => switch (value) {
  Map() => {
    for (final e in value.entries)
      if (e.value != null) e.key: withoutNulls(e.value),
  },
  List() => [for (final v in value) withoutNulls(v)],
  _ => value,
};

class HttpSosApi implements SosApi {
  HttpSosApi(this.baseUrl, {http.Client? client}) : _client = client ?? http.Client();
  final String baseUrl;
  final http.Client _client;

  Future<http.Response> _send(String method, String path, [Object? body]) async {
    final request = http.Request(method, Uri.parse('$baseUrl$path'));
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(withoutNulls(body));
    }
    return http.Response.fromStream(await _client.send(request));
  }

  SosRequest _parse(http.Response res, int ok) {
    if (res.statusCode != ok) throw _error(res);
    return SosRequest.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
  }

  ApiException _error(http.Response res) {
    final code = switch (res.body.isEmpty ? null : jsonDecode(res.body)) {
      {'error': final String code} => code,
      _ => 'http_error',
    };
    return ApiException(res.statusCode, code);
  }

  @override
  Future<SosRequest> create(SosReport report) async => _parse(await _send('POST', '/sos', report.toJson()), 201);

  @override
  Future<SosRequest> get(String sosId) async => _parse(await _send('GET', '/sos/${Uri.encodeComponent(sosId)}'), 200);

  @override
  Future<bool> sendLocation(String sosId, SosLocationUpdate update) async {
    final res = await _send('POST', '/sos/${Uri.encodeComponent(sosId)}/location', update.toJson());
    if (res.statusCode == 409) return false;
    if (res.statusCode != 204) throw _error(res);
    return true;
  }
}
