package com.noahark.arksos.location

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.noahark.arksos.R
import com.noahark.arksos.api.LocationResult
import com.noahark.arksos.api.SosBackend
import com.noahark.arksos.ui.localizedContext
import com.noahark.contracts.Geo
import com.noahark.contracts.SosLocationUpdate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Instant
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Keeps the sender's position flowing to the backend while the app is in the background. A foreground
 * service with an ongoing notification, so the app does not need ACCESS_BACKGROUND_LOCATION.
 * Posts every 30 s or 20 m, and stops itself when the backend says the SOS is delivered or closed (409).
 */
class LocationService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var job: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val sosId = intent?.getStringExtra(EXTRA_SOS_ID)
        if (sosId == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        val text = localizedContext(this, intent?.getStringExtra(EXTRA_LANGUAGE))
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(text), foregroundType())
        job?.cancel()
        job = scope.launch { share(sosId) }
        return START_REDELIVER_INTENT
    }

    private suspend fun share(sosId: String) {
        val throttle = LocationThrottle()
        AndroidLocationSource(this).updates().collect { geo ->
            val nowMs = System.currentTimeMillis()
            if (!throttle.shouldSend(geo, nowMs)) return@collect
            try {
                // UTC, so the timestamp carries a zone as the schema's date-time needs.
                val update = SosLocationUpdate(location = geo, ts = Instant.ofEpochMilli(nowMs).toString())
                throttle.sent(geo, nowMs)
                if (SosBackend.api.updateLocation(sosId, update) == LocationResult.Stop) {
                    stopSelf()
                    throw CancellationException("SOS finished")
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // A missed update is fine: the next fix replaces it.
            }
        }
    }

    private fun foregroundType() =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0

    private fun notification(text: Context): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, text.getString(R.string.sharing_channel), NotificationManager.IMPORTANCE_LOW),
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(text.getString(R.string.sharing_notification_title))
            .setContentText(text.getString(R.string.sharing_notification_text))
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_SOS_ID = "sosId"
        private const val EXTRA_LANGUAGE = "language"
        private const val CHANNEL_ID = "location_sharing"
        private const val NOTIFICATION_ID = 1

        fun intent(context: Context, sosId: String, language: String) =
            Intent(context, LocationService::class.java)
                .putExtra(EXTRA_SOS_ID, sosId)
                .putExtra(EXTRA_LANGUAGE, language)
    }
}

/** Send a fix when 30 s have passed since the last one, or the sender moved 20 m. */
class LocationThrottle(private val everyMs: Long = 30_000, private val meters: Double = 20.0) {
    private var lastAt: Long? = null
    private var lastGeo: Geo? = null

    fun shouldSend(geo: Geo, nowMs: Long): Boolean {
        val at = lastAt
        val from = lastGeo
        if (at == null || from == null) return true
        return nowMs - at >= everyMs || distanceM(from, geo) >= meters
    }

    fun sent(geo: Geo, nowMs: Long) {
        lastAt = nowMs
        lastGeo = geo
    }
}

/** Haversine distance in metres; plenty accurate at 20 m. */
fun distanceM(a: Geo, b: Geo): Double {
    val earth = 6_371_000.0
    val dLat = Math.toRadians(b.lat - a.lat)
    val dLon = Math.toRadians(b.lon - a.lon)
    val h = sin(dLat / 2).pow(2) + cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLon / 2).pow(2)
    return 2 * earth * asin(sqrt(h))
}
