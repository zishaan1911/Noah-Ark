# Ark SOS (mobile help app)

Flutter app (Android) for people who need help. No login, no password. It opens on one big red button: hold it for
2 seconds and the SOS goes out with the phone's location. The app then follows the SOS and keeps sharing the location
until help is delivered.

## Tabs
Every tab fits a phone screen without scrolling (tested at 360 x 640 in all four languages).

| Tab | What it does | API (`shared/api/openapi.yaml`) |
|---|---|---|
| **SOS** | The red button (hold 2 s; letting go early cancels). Then: SOS sent → help arranged → drone on the way (ETA) → delivered, and whether the location is being shared | `POST /sos`, `GET /sos/{sosId}` every 10 s, `POST /sos/{sosId}/location` |
| **People** | How many people, and how many are children, elderly, disabled or pregnant. Optional phone | `PUT /sos/{sosId}/report` |
| **Needs** | Water, food, medicine, baby supplies, shelter, rescue, other; which medicines; anything else (any language) | `PUT /sos/{sosId}/report` |
| **Supplies** | The kit mission-planner (Bedrock) packed for this SOS, and its weight against the 2 kg cap | `GET /sos/{sosId}` (`delivery.payload`) |

- **The details are optional.** Filled in before the button, they go with the SOS. Filled in after, **Send details**
  updates the SOS and the backend triages and plans the kit again. An invalid phone number never blocks the SOS; it is
  left out.
- **Languages:** English, Bahasa Melayu, 中文, தமிழ். The phone's language is used if supported, and the 🌐 menu
  switches it. The chosen language goes into the SOS so triage knows what the sender reads. Strings are in
  `lib/l10n/app_<lang>.arb`.
- **Background location:** a foreground service with an ongoing notification (geolocator), so the app does not need
  `ACCESS_BACKGROUND_LOCATION`. Updates every 30 s or 20 m; stops on delivered, closed or a 409.
- **Reopening the app** returns to the SOS in progress.
- **Types** come from the `ark_contracts` path package (`shared/generated/dart`). Request bodies drop `null` fields,
  because the generated `toJson` writes them and the API rejects them.

## Run
From the repo root: `nix develop .#mobile` (Flutter, Android SDK + NDK, JDK 17).
```bash
cd apps/sos-mobile
flutter run                                     # fake backend: the SOS walks every step on a timer, with a kit
flutter run --dart-define=API_URL=https://…/v1  # the real API
flutter build apk --debug
```

## Test
```bash
dart format --set-exit-if-changed . && flutter analyze && flutter test
```
- `app_test.dart`: a short press does not send, a 2 s hold does; the language menu; details go with the SOS; every tab
  fits 360 x 640 in every language, before and after sending.
- `sos_controller_test.dart`: what goes into the report, details before and after sending, location sharing stops on
  delivery, location refused.
- `sos_api_test.dart`: no nulls sent, `PUT` report, 204 / 409 / errors, the fake backend's timeline.
