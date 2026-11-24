# Ark SOS (mobile help app)

Native Android app (Kotlin + Jetpack Compose) for people who need help. It replaces the Flutter prototype and keeps
its design. No login, no password. It opens on one big red button: hold it for 2 seconds and the SOS goes out with the
phone's location. The app then follows the SOS and keeps sharing the location until help is delivered.

Types (`SosRequest`, `SosReport`, `Geo`, ...) come from `shared/generated/kotlin` (package `com.noahark.contracts`),
generated from `shared/schemas`. They are on the app's source path and are never edited here.

## Tabs
Every tab fits a 360 x 640 dp phone screen without scrolling.

| Tab | What it does | API (`shared/api/openapi.yaml`) |
|---|---|---|
| **SOS** | The red button (hold 2 s; letting go early cancels; TalkBack users get a custom action). Then: SOS sent → help arranged → drone on the way (ETA) → delivered, and whether the location is shared | `POST /sos`, `GET /sos/{id}` every 10 s, `POST /sos/{id}/location` |
| **People** | How many people, and how many are children, elderly, disabled or pregnant. Optional phone | `PUT /sos/{id}/report` |
| **Needs** | Water, food, medicine, baby supplies, shelter, rescue, other; which medicines; anything else (any language) | `PUT /sos/{id}/report` |
| **Supplies** | The kit mission-planner (Bedrock) packed for this SOS, and its weight against the 2 kg cap | `GET /sos/{id}` (`delivery.payload`) |

- **The details are optional.** Filled in before the button, they go with the SOS. Filled in after, **Send details**
  updates the SOS and the backend triages and plans the kit again. An invalid phone number never blocks the SOS; it is
  left out.
- **No location, no SOS.** The schema requires a location, so if permission is refused or there is no fix, the app says
  why and sends nothing.
- **Reopening the app** returns to the SOS in progress (its id is kept in `SharedPreferences` `ark_sos`).

## Languages
English, Bahasa Melayu, 中文, தமிழ். The phone's language is used if supported, and the 🌐 menu switches it without a
restart. The chosen language goes into the SOS so triage knows what the sender reads. Strings are in
`app/src/main/res/values{,-ms,-zh,-ta}/strings.xml`.

## Background location
After the SOS is sent and location permission is granted, a foreground service (`LocationService`, type `location`)
shows an ongoing notification and posts a `SosLocationUpdate` every 30 s or 20 m. It stops on delivered, closed or a
409 from the API. Because it is a foreground service, the app does not need `ACCESS_BACKGROUND_LOCATION`. Locations
come from the platform `LocationManager` (GPS + network), no Play Services.

## Backend
`BuildConfig.API_URL` empty (the default) = `FakeSosApi`: the SOS walks new → triaged → assigned (drone, ETA, kit) →
delivered on a 5 s timer, so every screen can be seen. A URL = `HttpSosApi` against the real API.

## Run
```bash
cd apps/sos-mobile
./gradlew installDebug                                          # fake backend
./gradlew installDebug -PapiUrl=http://10.0.2.2:8080/v1         # local stack, from the emulator
./gradlew installDebug -PapiUrl=http://<PC LAN IP>:8080/v1      # local stack, from a phone on the same Wi-Fi
```

## Test
```bash
./gradlew testDebugUnitTest lintDebug
```
JVM unit tests only (no emulator):
- `HttpSosApiTest`: no null fields sent, 404 / 500 throw `ApiException`, location 204 → stored, 409 → stop, `PUT` report.
- `SosViewModelTest`: what goes into the report, invalid phone left out, details before vs after sending, polling stops
  on delivered, no location → nothing sent, resume from the saved id.
- `FakeSosApiTest`: the timeline reaches delivered with a kit of at most 2 kg.
