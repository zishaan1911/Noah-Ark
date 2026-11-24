package com.noahark.arksos.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import androidx.core.content.ContextCompat
import com.noahark.contracts.Geo
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.withTimeoutOrNull

/** Where the sender is: one fix for the SOS, then a stream while help is on the way. */
interface LocationSource {
    /** A fix now, or null when there is none (no permission, GPS off, no last known position). */
    suspend fun current(): Geo?
    fun updates(): Flow<Geo>
}

fun hasLocationPermission(context: Context): Boolean =
    listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION).any {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }

/** Plain [LocationManager] (GPS + network providers), no Play Services. */
class AndroidLocationSource(private val context: Context) : LocationSource {
    private val manager get() = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    override suspend fun current(): Geo? {
        if (!hasLocationPermission(context)) return null
        // A fresh fix if one arrives in time, else whatever the phone last knew.
        return withTimeoutOrNull(FIX_TIMEOUT_MS) { stream(minTimeMs = 0).firstOrNull() } ?: lastKnown()
    }

    // shortcut: a fix every 5 s while sharing; the service throttles to 30 s / 20 m. Slow it down if battery matters.
    override fun updates(): Flow<Geo> = stream(minTimeMs = 5_000)

    // The permission is checked by hasLocationPermission() before every call into here.
    @SuppressLint("MissingPermission")
    private fun lastKnown(): Geo? {
        if (!hasLocationPermission(context)) return null
        return PROVIDERS.mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.time }
            ?.toGeo()
    }

    @SuppressLint("MissingPermission")
    private fun stream(minTimeMs: Long): Flow<Geo> = callbackFlow {
        if (!hasLocationPermission(context)) {
            close()
            return@callbackFlow
        }
        val listener = LocationListener { trySend(it.toGeo()) }
        val enabled = PROVIDERS.filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }
        enabled.forEach { manager.requestLocationUpdates(it, minTimeMs, 0f, listener, Looper.getMainLooper()) }
        awaitClose { manager.removeUpdates(listener) }
    }

    private fun Location.toGeo() = Geo(lat = latitude, lon = longitude)

    private companion object {
        val PROVIDERS = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        const val FIX_TIMEOUT_MS = 15_000L
    }
}
