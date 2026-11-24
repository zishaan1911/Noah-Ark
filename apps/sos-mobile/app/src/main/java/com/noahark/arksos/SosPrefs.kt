package com.noahark.arksos

import android.content.SharedPreferences

/** What survives closing the app: the SOS in progress and the chosen language. */
interface SosPrefs {
    var sosId: String?
    var language: String?
}

class SharedSosPrefs(private val prefs: SharedPreferences) : SosPrefs {
    override var sosId: String?
        get() = prefs.getString(SOS_ID, null)
        set(value) = put(SOS_ID, value)

    override var language: String?
        get() = prefs.getString(LANGUAGE, null)
        set(value) = put(LANGUAGE, value)

    private fun put(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }

    private companion object {
        const val SOS_ID = "activeSosId"
        const val LANGUAGE = "language"
    }
}
