import 'package:ark_contracts/ark_contracts.dart';
import 'package:geolocator/geolocator.dart';

/// Where the sender is: one fix for the SOS, then a stream while help is on the way.
/// The app takes a Locator so tests can pass a fake.
abstract class Locator {
  Future<Geo> current();
  Stream<Geo> track();
}

enum LocationProblem { off, denied }

class LocationUnavailable implements Exception {
  LocationUnavailable(this.problem);
  final LocationProblem problem;

  @override
  String toString() => 'LocationUnavailable(${problem.name})';
}

class DeviceLocator implements Locator {
  Future<void> _ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) throw LocationUnavailable(LocationProblem.off);
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      throw LocationUnavailable(LocationProblem.denied);
    }
  }

  static Geo _geo(Position p) => Geo(lat: p.latitude, lon: p.longitude);

  @override
  Future<Geo> current() async {
    await _ensurePermission();
    return _geo(
      await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high)),
    );
  }

  // A foreground service with a visible notification keeps updates coming while the app is in the background,
  // without the ACCESS_BACKGROUND_LOCATION permission.
  // shortcut: notification text is English only, pass the l10n strings in if users find it confusing
  @override
  Stream<Geo> track() async* {
    await _ensurePermission();
    yield* Geolocator.getPositionStream(
      locationSettings: AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 20,
        intervalDuration: const Duration(seconds: 30),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Ark SOS is sharing your location',
          notificationText: 'So the drone can find you. It stops when help arrives.',
          notificationChannelName: 'Location sharing',
          enableWakeLock: true,
          setOngoing: true,
        ),
      ),
    ).map(_geo);
  }
}
