import 'dart:async';

import 'package:ark_contracts/ark_contracts.dart';
import 'package:ark_sos/services/fake_sos_api.dart';
import 'package:ark_sos/services/location.dart';
import 'package:ark_sos/services/sos_controller.dart';

class FakeLocator implements Locator {
  FakeLocator({this.fail});
  final LocationProblem? fail;
  StreamController<Geo>? _positions;
  var tracking = false;

  void move(Geo to) => _positions!.add(to);

  @override
  Future<Geo> current() async => fail == null ? Geo(lat: 5.98, lon: 116.07) : throw LocationUnavailable(fail!);

  @override
  Stream<Geo> track() {
    _positions = StreamController<Geo>(onListen: () => tracking = true, onCancel: () => tracking = false);
    return _positions!.stream;
  }
}

/// A FakeSosApi whose clock the test moves by hand.
class Clock {
  var now = DateTime(2026, 11, 18, 9, 30);
  void advance(Duration d) => now = now.add(d);
}

SosController controller({FakeSosApi? api, Locator? locator, String language = 'en', List<String?>? saved}) =>
    SosController(
      api: api ?? FakeSosApi(),
      locator: locator ?? FakeLocator(),
      language: language,
      pollEvery: const Duration(seconds: 1),
      saveSosId: (id) => saved?.add(id),
    );
