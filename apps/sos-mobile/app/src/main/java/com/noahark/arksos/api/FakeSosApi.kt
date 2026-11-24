package com.noahark.arksos.api

import com.noahark.contracts.MissionStatus
import com.noahark.contracts.PayloadItem
import com.noahark.contracts.SosDelivery
import com.noahark.contracts.SosLocationUpdate
import com.noahark.contracts.SosReport
import com.noahark.contracts.SosRequest
import com.noahark.contracts.SosStatus
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.max
import kotlin.math.roundToLong
import kotlin.random.Random

/**
 * Stands in for Ark Brain when the app runs without API_URL: the SOS goes new -> triaged -> assigned
 * (drone on the way with a kit, ETA counting down) -> delivered, on a clock, so every screen can be seen.
 * [now] is epoch milliseconds, injectable so tests can move time by hand.
 */
class FakeSosApi(
    private val stepMs: Long = 5_000,
    private val now: () -> Long = System::currentTimeMillis,
) : SosApi {
    private val sent = ConcurrentHashMap<String, Pair<SosRequest, Long>>()
    val locations = CopyOnWriteArrayList<SosLocationUpdate>()

    override suspend fun create(report: SosReport): SosRequest {
        val sos = SosRequest(id = newId("sos"), createdAt = Instant.ofEpochMilli(now()).toString(), status = SosStatus.New, report = report)
        sent[sos.id] = sos to now()
        return sos
    }

    override suspend fun get(id: String): SosRequest {
        val (sos, at) = sent[id] ?: throw ApiException(404, "not_found")
        val steps = (now() - at) / stepMs
        val kit = kitFor(sos.report)
        val flying = steps >= 2
        val delivered = steps >= 2 + ETA_STEPS
        return sos.copy(
            status = when {
                steps < 1 -> SosStatus.New
                steps == 1L -> SosStatus.Triaged
                !delivered -> SosStatus.Assigned
                else -> SosStatus.Delivered
            },
            missionID = if (flying) "msn_01JD8X5Q2M9VTRC3B7K4N6P0WY" else null,
            delivery = if (flying) {
                SosDelivery(
                    droneID = "ARK-001",
                    missionStatus = if (delivered) MissionStatus.Delivered else MissionStatus.InFlight,
                    etaMinutes = max(0L, 2 + ETA_STEPS - steps).toDouble(),
                    payload = kit,
                    payloadKg = kit.sumOf { (it.weightKg * 1000).roundToLong() } / 1000.0,
                )
            } else {
                null
            },
        )
    }

    override suspend fun updateReport(id: String, report: SosReport): SosRequest {
        if (get(id).status.isFinished()) throw ApiException(409, "closed")
        val (sos, at) = sent.getValue(id)
        sent[id] = sos.copy(report = report) to at
        return get(id)
    }

    override suspend fun updateLocation(id: String, update: SosLocationUpdate): LocationResult {
        if (get(id).status.isFinished()) return LocationResult.Stop
        locations.add(update)
        return LocationResult.Stored
    }

    companion object {
        // Steps 2..6: a drone is on the way; the ETA drops each step and it lands at step 7.
        private const val ETA_STEPS = 5L
        private const val CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

        private fun SosStatus.isFinished() = this == SosStatus.Delivered || this == SosStatus.Closed

        private fun newId(prefix: String) = "${prefix}_" + String(CharArray(26) { CROCKFORD[Random.nextInt(32)] })

        /** A stand-in for mission-planner's Bedrock kit: water first, then what the report asks for, under 2 kg. */
        fun kitFor(report: SosReport): List<PayloadItem> = buildList {
            add(PayloadItem(item = "Drinking water 500 ml", qty = 2, weightKg = 1.04))
            report.medicines?.takeIf { it.isNotEmpty() }?.let {
                add(PayloadItem(item = "Requested medicines: ${it.joinToString(", ")}", qty = 1, weightKg = 0.3))
            }
            if ((report.vulnerable?.children ?: 0L) > 0L) {
                add(PayloadItem(item = "Baby formula 200 g", qty = 1, weightKg = 0.22))
            }
            add(PayloadItem(item = "Oral rehydration salts sachet", qty = 4, weightKg = 0.12))
            add(PayloadItem(item = "Energy biscuits 100 g", qty = 2, weightKg = 0.22))
        }
    }
}
