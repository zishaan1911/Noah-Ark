package com.noahark.arksos.ui

import android.content.Context
import android.content.res.Configuration
import androidx.annotation.StringRes
import com.noahark.arksos.R
import java.util.Locale

/** Languages offered, each named in its own script. */
val Languages: List<Pair<String, Int>> = listOf(
    "en" to R.string.language_en,
    "ms" to R.string.language_ms,
    "zh" to R.string.language_zh,
    "ta" to R.string.language_ta,
)

/** The saved choice, else the phone's language if we have it, else English. */
fun startLanguage(saved: String?, device: String): String =
    saved?.takeIf { s -> Languages.any { it.first == s } } ?: device.takeIf { d -> Languages.any { it.first == d } } ?: "en"

/** [base] with its resources switched to [tag], so stringResource follows the in-app menu. */
fun localizedContext(base: Context, tag: String?): Context {
    if (tag == null) return base
    val config = Configuration(base.resources.configuration).apply { setLocale(Locale.forLanguageTag(tag)) }
    return base.createConfigurationContext(config)
}

@StringRes
fun languageName(tag: String): Int = Languages.first { it.first == tag }.second
