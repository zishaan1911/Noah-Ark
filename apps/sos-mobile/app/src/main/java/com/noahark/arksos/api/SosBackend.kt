package com.noahark.arksos.api

import com.noahark.arksos.BuildConfig

/**
 * One backend per process, shared by the screen and the location service so the fake backend
 * sees both. Empty API_URL = the fake one.
 */
object SosBackend {
    val api: SosApi by lazy { BuildConfig.API_URL.ifBlank { null }?.let { HttpSosApi(it) } ?: FakeSosApi() }
}
