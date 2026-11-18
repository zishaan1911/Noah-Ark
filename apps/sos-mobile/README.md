# Ark SOS (mobile help app)

Flutter app (Android) for people who need help. No login. It sends an SOS with the sender's location, then shows the
request's progress and keeps sharing the location in the background until help is delivered.

| Screen | What it does | API (`shared/api/openapi.yaml`) |
|---|---|---|
| Help | Message (any language), needs, people count, optional phone. Takes one GPS fix and sends it | `POST /sos` |
| Status | SOS sent → help arranged → drone on the way (ETA) → delivered. Polls every 10 s | `GET /sos/{sosId}` (`delivery`) |
| | Shares the location while help is coming; stops on delivered, closed or a 409 | `POST /sos/{sosId}/location` |

- **Background location:** a foreground service with an ongoing notification (geolocator), so the app does not need
  `ACCESS_BACKGROUND_LOCATION`. Updates every 30 s or 20 m.
- **Reopening the app** returns to the SOS in progress (the id is kept in shared preferences).
- **Types** come from the `ark_contracts` path package (`shared/generated/dart`). Request bodies drop `null` fields,
  because the generated `toJson` writes them and the API rejects them.

## Run
From the repo root: `nix develop .#mobile` (Flutter, Android SDK + NDK, JDK 17).
```bash
cd apps/sos-mobile
flutter run                                   # fake backend: the SOS moves through every step on a timer
flutter run --dart-define=API_URL=https://…/v1  # the real API
flutter build apk --debug
```

## Test
```bash
dart format --set-exit-if-changed . && flutter analyze && flutter test
```
Tests cover the API client (no nulls sent, 204 / 409 / errors), the fake backend's progression, the help form
(validation, location refused, what gets sent) and the status screen (location shared, stops once delivered).
