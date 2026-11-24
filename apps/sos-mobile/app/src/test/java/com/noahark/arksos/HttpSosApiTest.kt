package com.noahark.arksos

import com.noahark.arksos.api.ApiException
import com.noahark.arksos.api.HttpSosApi
import com.noahark.arksos.api.LocationResult
import com.noahark.arksos.api.SosJson
import com.noahark.contracts.Channel
import com.noahark.contracts.Geo
import com.noahark.contracts.SosLocationUpdate
import com.noahark.contracts.SosReport
import com.noahark.contracts.SosStatus
import com.noahark.contracts.SosVulnerable
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class HttpSosApiTest {
    private val sosId = "sos_01JD8X5Q2M9VTRC3B7K4N6P0WY"
    private val here = Geo(lat = 5.98, lon = 116.07)
    private lateinit var server: MockWebServer
    private lateinit var api: HttpSosApi

    @Before
    fun start() {
        server = MockWebServer().apply { start() }
        api = HttpSosApi(server.url("/v1").toString().trimEnd('/'))
    }

    @After
    fun stop() = server.shutdown()

    private fun stored(report: String) =
        """{"id":"$sosId","createdAt":"2026-11-18T09:30:00Z","status":"new","report":$report}"""

    @Test
    fun createPostsTheReportWithoutNullFields() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(201).setBody(stored("""{"channel":"app","location":{"lat":5.98,"lon":116.07}}""")))

        val sos = api.create(SosReport(channel = Channel.App, location = here, peopleCount = 2))

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/v1/sos", request.path)
        val body = SosJson.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals(setOf("channel", "location", "peopleCount"), body.keys)
        assertEquals("app", body["channel"]?.jsonPrimitive?.content)
        assertEquals(sosId, sos.id)
        assertEquals(SosStatus.New, sos.status)
        assertNull(sos.triage)
    }

    @Test
    fun nestedNullsAreDroppedToo() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(201).setBody(stored("""{"channel":"app","location":{"lat":1.0,"lon":2.0}}""")))

        api.create(SosReport(channel = Channel.App, location = here, vulnerable = SosVulnerable(children = 1)))

        val body = SosJson.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals(setOf("children"), (body["vulnerable"] as JsonObject).keys)
        assertEquals(setOf("lat", "lon"), (body["location"] as JsonObject).keys)
    }

    @Test
    fun missingAndBrokenAnswersThrowWithTheApiCode() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"not_found"}"""))
        server.enqueue(MockResponse().setResponseCode(500))

        val notFound = runCatching { api.get(sosId) }.exceptionOrNull() as ApiException
        assertEquals(404, notFound.code)
        assertEquals("not_found", notFound.message)

        val broken = runCatching { api.get(sosId) }.exceptionOrNull() as ApiException
        assertEquals(500, broken.code)
        assertEquals("http_error", broken.message)
    }

    @Test
    fun getReadsTheStoredSos() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody(stored("""{"channel":"app","location":{"lat":5.98,"lon":116.07}}""")))

        val sos = api.get(sosId)

        assertEquals("GET", server.takeRequest().method)
        assertEquals(sosId, sos.id)
    }

    @Test
    fun updateReportPutsTheWholeReport() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody(stored("""{"channel":"app","location":{"lat":5.98,"lon":116.07},"vulnerable":{"children":1}}""")))

        val sos = api.updateReport(sosId, SosReport(channel = Channel.App, location = here, vulnerable = SosVulnerable(children = 1)))

        val request = server.takeRequest()
        assertEquals("PUT", request.method)
        assertEquals("/v1/sos/$sosId/report", request.path)
        assertEquals(1L, sos.report.vulnerable?.children)
    }

    @Test
    fun locationAnswers204Stored409StopAndOthersThrow() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(204))
        server.enqueue(MockResponse().setResponseCode(409))
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"invalid_body"}"""))
        val update = SosLocationUpdate(location = here, ts = "2026-11-18T09:31:00Z")

        assertEquals(LocationResult.Stored, api.updateLocation(sosId, update))
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/v1/sos/$sosId/location", request.path)
        assertTrue(request.body.readUtf8().contains("\"ts\":\"2026-11-18T09:31:00Z\""))

        assertEquals(LocationResult.Stop, api.updateLocation(sosId, update))
        try {
            api.updateLocation(sosId, update)
            fail("expected ApiException")
        } catch (e: ApiException) {
            assertEquals("invalid_body", e.message)
        }
        Unit
    }
}
