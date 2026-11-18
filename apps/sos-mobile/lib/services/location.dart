import 'package:ark_contracts/ark_contracts.dart';
import 'package:geolocator/geolocator.dart';

/// Where the sender is: one fix for the SOS, then a stream while help is on the way.
/// Screens take these as parameters so tests can pass fakes.
abstract class Locator {
  Future<Geo> current();
  Stream<Geo> track();
}

class LocationUnavailable implements Exception {
  LocationUnavailable(this.reason);
  final String reason;

  @override
  String toString() => reason;
}

class DeviceLocator implements Locator {
  Future<void> _ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) throw LocationUnavailable('Turn on location (GPS).');
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      throw LocationUnavailable('Allow location so the drone can find you.');
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
