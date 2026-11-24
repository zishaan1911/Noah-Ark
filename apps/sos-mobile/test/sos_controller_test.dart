import 'package:ark_contracts/ark_contracts.dart';
import 'package:ark_sos/services/fake_sos_api.dart';
import 'package:ark_sos/services/location.dart';
import 'package:ark_sos/services/sos_controller.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fakes.dart';

void main() {
  final here = Geo(lat: 5.98, lon: 116.07);

  test('an empty form still makes a valid report: location, language, one person', () {
    final report = controller(language: 'ta').report(here);
    expect(report.channel, Channel.APP);
    expect(report.language, 'ta');
    expect(report.peopleCount, 1);
    expect(report.vulnerable, isNull);
    expect(report.medicines, isNull);
  });

  test('details map onto the report: medicines split, vulnerable counts, bad phone left out', () {
    final sos = controller();
    sos.edit(() {
      sos.people = 4;
      sos.vulnerable[Vulnerable.children] = 2;
      sos.vulnerable[Vulnerable.pregnant] = 1;
      sos.needs.add(Need.WATER);
      sos.medicines = 'insulin, paracetamol\n胰岛素、 ';
      sos.phone = '0123';
    });
    final report = sos.report(here);
    expect(report.medicines, ['insulin', 'paracetamol', '胰岛素']);
    expect(report.vulnerable?.toJson(), {'children': 2, 'disabled': 0, 'elderly': 0, 'pregnant': 1});
    expect(report.needs, [Need.WATER]);
    expect(sos.phoneValid, isFalse);
    expect(report.contactPhone, isNull);
  });

  test('fewer people clamps the vulnerable counts', () {
    final sos = controller();
    sos.edit(() {
      sos.people = 3;
      sos.vulnerable[Vulnerable.elderly] = 3;
    });
    sos.edit(() => sos.people = 1);
    expect(sos.vulnerable[Vulnerable.elderly], 1);
  });

  test('the SOS goes out with the details filled in so far, then follows until delivered', () {
    fakeAsync((async) {
      final clock = Clock();
      final api = FakeSosApi(now: () => clock.now);
      final locator = FakeLocator();
      final saved = <String?>[];
      final sos = controller(api: api, locator: locator, saved: saved);
      sos.edit(() {
        sos.people = 2;
        sos.medicines = 'insulin';
      });

      sos.sendSos();
      async.flushMicrotasks();
      expect(sos.sosId, startsWith('sos_'));
      expect(saved, [sos.sosId]);
      expect(sos.detailsDirty, isFalse);
      expect(sos.sharing, isTrue);

      locator.move(Geo(lat: 5.981, lon: 116.071));
      async.flushMicrotasks();
      expect(api.locations.single.ts.isUtc, isTrue);

      clock.advance(const Duration(seconds: 12));
      async.elapse(const Duration(seconds: 1));
      expect(sos.sos?.delivery?.payload?.first.item, 'Drinking water 500 ml');
      expect(sos.sos?.report.medicines, ['insulin']);

      clock.advance(const Duration(seconds: 30));
      async.elapse(const Duration(seconds: 1));
      expect(sos.finished, isTrue);
      expect(sos.sharing, isFalse);
      expect(locator.tracking, isFalse);

      sos.finish();
      expect(saved.last, isNull);
      expect(sos.sosId, isNull);
    });
  });

  test('details after the SOS go as an update', () {
    fakeAsync((async) {
      final api = FakeSosApi();
      final sos = controller(api: api)..sendSos();
      async.flushMicrotasks();
      sos.edit(() => sos.vulnerable[Vulnerable.children] = 1);
      expect(sos.detailsDirty, isTrue);
      sos.sendDetails();
      async.flushMicrotasks();
      expect(sos.detailsDirty, isFalse);
      expect(sos.sos?.report.vulnerable?.children, 1);
      expect(sos.sos?.delivery, isNull); // still new; the kit comes once planned
      sos.dispose();
    });
  });

  test('no location permission: nothing is sent, and the reason is kept', () async {
    final sos = controller(locator: FakeLocator(fail: LocationProblem.denied));
    await sos.sendSos();
    expect(sos.sosId, isNull);
    expect(sos.failure, Failure.locationDenied);
    expect(sos.progress, isNull);
  });
}
