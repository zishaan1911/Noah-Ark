package com.noahark.arksos.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

private val Padding = 16.dp

/**
 * A tab's content. Designed to fit a phone screen without scrolling (360 x 640 dp); the scroll only matters
 * when the keyboard is open. The column is at least as tall as the tab, so `Modifier.weight(1f)` spacers
 * push the last item to the bottom, and it scrolls only if the content really does not fit.
 * [content] gets the room left inside the padding.
 */
@Composable
fun TabBody(content: @Composable ColumnScope.(width: Dp, height: Dp) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize().imePadding()) {
        val width = maxWidth - Padding * 2
        val height = maxHeight - Padding * 2
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight)
                .padding(Padding),
        ) {
            content(width, height)
        }
    }
}

/** "Label  [-] n [+]" on one row, with 48 dp buttons. */
@Composable
fun CounterRow(
    label: String,
    value: Int,
    onChange: (Int) -> Unit,
    fewer: String,
    more: String,
    modifier: Modifier = Modifier,
    min: Int = 0,
    max: Int = 99,
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
        OutlinedIconButton(onClick = { onChange(value - 1) }, enabled = value > min) {
            // The minus icon is only in material-icons-extended; a glyph avoids that dependency.
            Text(
                "−",
                Modifier.semantics { contentDescription = "$fewer: $label" },
                style = MaterialTheme.typography.titleLarge,
            )
        }
        Text(
            "$value",
            Modifier.width(40.dp),
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.titleLarge,
        )
        OutlinedIconButton(onClick = { onChange(value + 1) }, enabled = value < max) {
            Icon(Icons.Filled.Add, contentDescription = "$more: $label")
        }
    }
}
