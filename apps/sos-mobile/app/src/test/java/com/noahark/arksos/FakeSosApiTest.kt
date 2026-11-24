package com.noahark.arksos

import com.noahark.arksos.api.ApiException
import com.noahark.arksos.api.FakeSosApi
import com.noahark.arksos.api.LocationResult
import com.noahark.contracts.Channel
import com.noahark.contracts.Geo
import com.noahark.contracts.SosLocationUpdate
import com.noahark.contracts.SosReport
import com.noahark.contracts.SosStatus
import com.noahark.contracts.SosVulnerable
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class FakeSosApiTest {
    private val here = Geo(lat = 5.98, lon = 116.07)
    private var now = 0L
    private val api = FakeSosApi(stepMs = 5_000, now = { now })

    @Test
    fun walksFromNewToDeliveredThenRefusesLocations() = runBlocking {
        val sos = api.create(SosReport(channel = Channel.App, location = here))
        val seen = mutableListOf<Pair<SosStatus, Double?>>()
        repeat(8) {
            val s = api.get(sos.id)
            seen += s.status to s.delivery?.etaMinutes
            now += 5_000
        }
        assertEquals(
            listOf(
                SosStatus.New to null,
                SosStatus.Triaged to null,
                SosStatus.Assigned to 5.0,
                SosStatus.Assigned to 4.0,
                SosStatus.Assigned to 3.0,
                SosStatus.Assigned to 2.0,
                SosStatus.Assigned to 1.0,
                SosStatus.Delivered to 0.0,
            ),
            seen,
        )
        assertEquals(LocationResult.Stop, api.updateLocation(sos.id, SosLocationUpdate(here, "2026-11-18T09:30:00Z")))
    }

    @Test
    fun theKitStaysUnderTwoKilos() = runBlocking {
        val report = SosReport(
            channel = Channel.App,
            location = here,
            medicines = listOf("insulin"),
            vulnerable = SosVulnerable(children = 1),
        )
        val sos = api.create(report)
        now += 15_000
        val delivery = api.get(sos.id).delivery!!

        assertEquals("Drinking water 500 ml", delivery.payload!!.first().item)
        assertTrue(delivery.payload!!.any { it.item.startsWith("Baby formula") })
        assertTrue(delivery.payloadKg!! <= 2.0)
        assertEquals(delivery.payload!!.sumOf { it.weightKg }, delivery.payloadKg!!, 0.001)
    }

    @Test
    fun anUnknownSosIsNotFoundAndAClosedOneRefusesUpdates() = runBlocking {
        try {
            api.get("sos_missing")
            fail("expected ApiException")
        } catch (e: ApiException) {
            assertEquals(404, e.code)
        }
        val sos = api.create(SosReport(channel = Channel.App, location = here))
        assertEquals(LocationResult.Stored, api.updateLocation(sos.id, SosLocationUpdate(here, "2026-11-18T09:30:00Z")))
        now += 40_000
        try {
            api.updateReport(sos.id, SosReport(channel = Channel.App, location = here))
            fail("expected ApiException")
        } catch (e: ApiException) {
            assertEquals(409, e.code)
        }
        assertNull(api.get(sos.id).triage)
    }
}
