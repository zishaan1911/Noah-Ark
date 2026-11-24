package com.noahark.arksos.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.noahark.arksos.SosViewModel
import com.noahark.arksos.location.LocationService
import com.noahark.arksos.location.hasLocationPermission

/**
 * Permissions and the location service live out here, on the real activity context. Only the screen below
 * gets the context switched to the chosen language (so the permission launcher still finds the activity).
 */
@Composable
fun ArkSosRoot(vm: SosViewModel) {
    val context = LocalContext.current
    val state by vm.state.collectAsStateWithLifecycle()

    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val granted = result[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            result[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (granted) vm.sendSos() else vm.locationDenied()
    }
    val onHold = {
        if (hasLocationPermission(context)) vm.sendSos() else permissions.launch(requestedPermissions())
    }

    // Start the background location service once the SOS is sent and permission is there; stop it when sharing ends.
    LaunchedEffect(state.sosId, state.sharing, state.language) {
        val id = state.sosId
        if (id != null && state.sharing) {
            if (hasLocationPermission(context)) {
                try {
                    ContextCompat.startForegroundService(context, LocationService.intent(context, id, state.language))
                } catch (_: RuntimeException) {
                    // The system refused a foreground start (e.g. the app is not visible): show it as not shared.
                    vm.sharingUnavailable()
                }
            } else {
                vm.sharingUnavailable()
            }
        } else {
            context.stopService(LocationService.intent(context, "", state.language))
        }
    }

    val localized = remember(state.language) { localizedContext(context, state.language) }
    CompositionLocalProvider(
        LocalContext provides localized,
        LocalConfiguration provides localized.resources.configuration,
    ) {
        ArkSosTheme { HomeScreen(state, vm, onHold) }
    }
}

private fun requestedPermissions(): Array<String> = buildList {
    add(Manifest.permission.ACCESS_FINE_LOCATION)
    add(Manifest.permission.ACCESS_COARSE_LOCATION)
    // Shown on Android 13+; refusing it does not block the SOS.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
}.toTypedArray()
