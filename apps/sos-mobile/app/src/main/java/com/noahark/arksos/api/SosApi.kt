package com.noahark.arksos.api

import com.noahark.contracts.SosLocationUpdate
import com.noahark.contracts.SosReport
import com.noahark.contracts.SosRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder

/** The API rejects `null` fields (additionalProperties: false), so they are never written. */
val SosJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = false
}

/** What the backend said to a location update: keep sending, or the SOS is delivered/closed (409). */
sealed interface LocationResult {
    data object Stored : LocationResult
    data object Stop : LocationResult
}

class ApiException(val code: Int, message: String) : Exception(message)

/** The public calls Ark SOS makes (shared/api/openapi.yaml). No login: SOS ids are unguessable ULIDs. */
interface SosApi {
    suspend fun create(report: SosReport): SosRequest
    suspend fun get(id: String): SosRequest

    /** Sends more detail after the one-press SOS; the backend triages and plans the kit again. */
    suspend fun updateReport(id: String, report: SosReport): SosRequest
    suspend fun updateLocation(id: String, update: SosLocationUpdate): LocationResult
}

/** [baseUrl] already ends in `/v1`. */
class HttpSosApi(
    private val baseUrl: String,
    private val client: OkHttpClient = OkHttpClient(),
) : SosApi {

    private class Reply(val code: Int, val body: String)

    private suspend fun send(method: String, path: String, body: String? = null): Reply =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(baseUrl.trimEnd('/') + path)
                .method(method, body?.toRequestBody(JSON_TYPE))
                .build()
            client.newCall(request).execute().use { Reply(it.code, it.body?.string().orEmpty()) }
        }

    private fun failure(reply: Reply): ApiException {
        val code = runCatching {
            SosJson.parseToJsonElement(reply.body).jsonObject["error"]?.jsonPrimitive?.content
        }.getOrNull()
        return ApiException(reply.code, code ?: "http_error")
    }

    private fun parse(reply: Reply, ok: Int): SosRequest {
        if (reply.code != ok) throw failure(reply)
        return SosJson.decodeFromString(SosRequest.serializer(), reply.body)
    }

    private fun path(id: String, suffix: String = "") = "/sos/${URLEncoder.encode(id, "UTF-8")}$suffix"

    override suspend fun create(report: SosReport): SosRequest =
        parse(send("POST", "/sos", SosJson.encodeToString(SosReport.serializer(), report)), 201)

    override suspend fun get(id: String): SosRequest = parse(send("GET", path(id)), 200)

    override suspend fun updateReport(id: String, report: SosReport): SosRequest =
        parse(send("PUT", path(id, "/report"), SosJson.encodeToString(SosReport.serializer(), report)), 200)

    override suspend fun updateLocation(id: String, update: SosLocationUpdate): LocationResult {
        val reply = send("POST", path(id, "/location"), SosJson.encodeToString(serializer<SosLocationUpdate>(), update))
        return when (reply.code) {
            204 -> LocationResult.Stored
            409 -> LocationResult.Stop
            else -> throw failure(reply)
        }
    }

    private companion object {
        val JSON_TYPE = "application/json".toMediaType()
    }
}
