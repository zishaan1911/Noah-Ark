package com.noahark.arksos.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** The red of the SOS button; white text on it passes AA contrast. */
val SosRed = Color(0xFFD32F2F)

// A calm light theme built around the red of the Flutter app's seed colour.
private val Colors = lightColorScheme(
    primary = Color(0xFFC62828),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFDAD6),
    onPrimaryContainer = Color(0xFF410002),
    secondaryContainer = Color(0xFFFDE7E4),
    onSecondaryContainer = Color(0xFF3B0A08),
    background = Color(0xFFFFFBFF),
    surface = Color(0xFFFFFBFF),
    surfaceVariant = Color(0xFFF5DDDA),
    error = Color(0xFFB3261E),
)

@Composable
fun ArkSosTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Colors, content = content)
}
