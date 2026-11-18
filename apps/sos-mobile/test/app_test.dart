import 'package:ark_sos/main.dart';
import 'package:ark_sos/screens/home_screen.dart';
import 'package:ark_sos/services/fake_sos_api.dart';
import 'package:ark_sos/services/sos_controller.dart';
import 'package:ark_sos/widgets/hold_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fakes.dart';

/// A small Android phone in logical pixels; every tab must fit it without scrolling.
const phone = Size(360, 640);

Future<void> pumpApp(WidgetTester tester, SosController sos) async {
  tester.view.physicalSize = phone;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ArkSosApp(sos: sos, saveLanguage: (_) {}));
  await tester.pump();
}

/// Unmount first so the controller has no listeners, then stop its timers.
Future<void> closeApp(WidgetTester tester, SosController sos) async {
  await tester.pumpWidget(const SizedBox());
  sos.dispose();
}

/// Opens each tab and checks the visible one fits without scrolling (an overflow fails the test on its own).
Future<void> expectNoTabScrolls(WidgetTester tester, String why) async {
  for (var tab = 0; tab < 4; tab++) {
    await tester.tap(find.byType(NavigationDestination).at(tab));
    await tester.pump();
    // Vertical only: each text field has its own horizontal Scrollable.
    final scrollable = find.descendant(
      of: find.byType(IndexedStack),
      matching: find.byWidgetPredicate((w) => w is Scrollable && axisDirectionToAxis(w.axisDirection) == Axis.vertical),
    );
    expect(scrollable, findsOneWidget, reason: '$why, tab $tab');
    expect(tester.state<ScrollableState>(scrollable).position.maxScrollExtent, 0, reason: '$why, tab $tab');
  }
  await tester.tap(find.byType(NavigationDestination).first);
  await tester.pump();
}

void main() {
  testWidgets('opens on the big red button; a short press does nothing, a 2 s hold sends', (tester) async {
    final sos = controller();
    await pumpApp(tester, sos);
    expect(find.text('SOS'), findsWidgets);
    expect(find.text('Hold for 2 seconds to call for help'), findsOneWidget);

    final button = find.byType(HoldButton);
    var press = await tester.startGesture(tester.getCenter(button));
    await tester.pump(); // the ring's clock starts on this frame
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Keep holding…'), findsOneWidget);
    await press.up();
    await tester.pump(const Duration(seconds: 2));
    expect(sos.sosId, isNull);

    press = await tester.startGesture(tester.getCenter(button));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 2100));
    await press.up();
    await tester.pump();
    await tester.pump();
    expect(sos.sosId, startsWith('sos_'));
    expect(find.text('Help is coming'), findsOneWidget);
    expect(find.text('Sharing your location'), findsOneWidget);
    await closeApp(tester, sos);
  });

  testWidgets('the language menu switches every label', (tester) async {
    final sos = controller();
    await pumpApp(tester, sos);
    await tester.tap(find.byTooltip('Language'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Bahasa Melayu'));
    await tester.pumpAndSettle();
    expect(find.text('Keperluan'), findsOneWidget);
    expect(sos.language, 'ms');
    expect(sos.report(await FakeLocator().current()).language, 'ms');
    await closeApp(tester, sos);
  });

  testWidgets('details filled in the People tab go with the SOS', (tester) async {
    final api = FakeSosApi();
    final sos = controller(api: api);
    await pumpApp(tester, sos);
    await tester.tap(find.text('People').last);
    await tester.pump();
    await tester.tap(find.byTooltip('More: People (including you)'));
    await tester.tap(find.byTooltip('More: Children'));
    await tester.pump();
    expect(find.text('Sent with your SOS'), findsOneWidget);

    await sos.sendSos();
    expect((await api.get(sos.sosId!)).report.vulnerable?.children, 1);
    await closeApp(tester, sos);
  });

  for (final language in languages.keys) {
    testWidgets('$language: every tab fits a 360 x 640 phone, before and after sending', (tester) async {
      final clock = Clock();
      final sos = controller(
        api: FakeSosApi(now: () => clock.now),
        language: language,
      );
      sos.edit(() {
        sos.people = 6;
        for (final v in Vulnerable.values) {
          sos.vulnerable[v] = 1;
        }
        sos.medicines = 'insulin';
        sos.notes = 'roof';
      });
      await pumpApp(tester, sos);
      await expectNoTabScrolls(tester, '$language before sending');

      await sos.sendSos();
      clock.advance(const Duration(seconds: 12)); // drone on the way, with the kit
      await tester.pump(const Duration(seconds: 1));
      await tester.pump();
      expect(sos.sos?.delivery?.payload, isNotEmpty);
      expect(find.textContaining(language == 'en' ? 'About 5 min' : '5'), findsWidgets);
      await expectNoTabScrolls(tester, '$language after sending');
      await closeApp(tester, sos);
    });
  }
}
