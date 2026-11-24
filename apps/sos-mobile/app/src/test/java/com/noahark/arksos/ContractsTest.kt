package com.noahark.arksos

import com.noahark.contracts.SosStatus
import com.noahark.contracts.SosRequest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class ContractsTest {
    @Test
    fun parsesAnSos() {
        val json = """{"id":"sos_01JDZ7Q4X9K2M5N8P3R6T0V1WY","createdAt":"2026-11-24T06:30:00Z","status":"triaged",
            "report":{"channel":"app","location":{"lat":6.42,"lon":116.34}}}"""
        val sos = Json { ignoreUnknownKeys = true }.decodeFromString(SosRequest.serializer(), json)
        assertEquals(SosStatus.Triaged, sos.status)
    }
}
