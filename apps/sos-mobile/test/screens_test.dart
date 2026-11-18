import 'dart:async';

import 'package:ark_contracts/ark_contracts.dart';
import 'package:ark_sos/screens/help_screen.dart';
import 'package:ark_sos/screens/status_screen.dart';
import 'package:ark_sos/services/fake_sos_api.dart';
import 'package:ark_sos/services/location.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class FakeLocator implements Locator {
  FakeLocator({this.fail});
  final String? fail;
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

Widget app(Widget home) => MaterialApp(home: home);

/// The form is longer than the test screen: scroll to a widget before touching it.
Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
}

void main() {
  testWidgets('sending an SOS reports the location, needs and people, then hands over the id', (tester) async {
    final api = FakeSosApi();
    String? sent;
    await tester.pumpWidget(app(HelpScreen(api: api, locator: FakeLocator(), onSent: (id) => sent = id)));

    await tester.enterText(find.byType(TextFormField).first, 'Flood, on the roof');
    await tester.tap(find.text('Water'));
    await tapVisible(tester, find.byTooltip('More people'));
    await tapVisible(tester, find.text('Send SOS'));
    // The spinner keeps running (the app swaps screens on onSent), so pump frames instead of settling.
    for (var i = 0; i < 3; i++) {
      await tester.pump();
    }

    expect(sent, matches(RegExp(r'^sos_[0-9A-HJKMNP-TV-Z]{26}$')));
    final report = (await api.get(sent!)).report;
    expect(report.rawMessage, 'Flood, on the roof');
    expect(report.needs, [Need.WATER]);
    expect(report.peopleCount, 2);
    expect(report.location.lat, 5.98);
  });

  testWidgets('a bad phone number is caught before sending', (tester) async {
    String? sent;
    await tester.pumpWidget(app(HelpScreen(api: FakeSosApi(), locator: FakeLocator(), onSent: (id) => sent = id)));
    await tester.enterText(find.widgetWithText(TextFormField, 'Phone (optional)'), '0123456789');
    await tapVisible(tester, find.text('Send SOS'));
    await tester.pumpAndSettle();
    expect(find.textContaining('international format'), findsOneWidget);
    expect(sent, isNull);
  });

  testWidgets('no location permission shows why, and nothing is sent', (tester) async {
    String? sent;
    await tester.pumpWidget(
      app(
        HelpScreen(
          api: FakeSosApi(),
          locator: FakeLocator(fail: 'Allow location'),
          onSent: (id) => sent = id,
        ),
      ),
    );
    await tapVisible(tester, find.text('Send SOS'));
    await tester.pumpAndSettle();
    expect(find.text('Allow location'), findsOneWidget);
    expect(sent, isNull);
  });

  testWidgets('status shares location while help is coming and stops once delivered', (tester) async {
    var now = DateTime(2026, 11, 18, 9, 30);
    final api = FakeSosApi(step: const Duration(seconds: 5), now: () => now);
    final sos = await api.create(SosReport(channel: Channel.APP, location: Geo(lat: 5.98, lon: 116.07)));
    final locator = FakeLocator();
    var done = false;

    now = now.add(const Duration(seconds: 12)); // assigned, ETA 5 min
    await tester.pumpWidget(
      app(
        StatusScreen(
          sosId: sos.id,
          api: api,
          locator: locator,
          pollEvery: const Duration(seconds: 1),
          onDone: () => done = true,
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Drone ARK-001 on the way'), findsOneWidget);
    expect(find.textContaining('About 5 min'), findsOneWidget);
    expect(locator.tracking, isTrue);

    locator.move(Geo(lat: 5.981, lon: 116.071));
    await tester.pump();
    expect(api.locations.single.location.lat, 5.981);
    expect(api.locations.single.ts.isUtc, isTrue);

    now = now.add(const Duration(seconds: 30)); // delivered
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.text('Help has arrived'), findsOneWidget);
    expect(locator.tracking, isFalse);

    await tester.tap(find.text('Done'));
    expect(done, isTrue);
  });
}
