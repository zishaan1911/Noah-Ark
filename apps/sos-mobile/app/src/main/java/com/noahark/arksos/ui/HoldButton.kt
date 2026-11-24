package com.noahark.arksos.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * A big round button that fires only after being held for [holdMs], so a pocket press does not send an SOS.
 * Letting go early runs the ring back. Screen readers get a custom action instead of the hold.
 */
@Composable
fun HoldButton(
    size: Dp,
    label: String,
    holdingLabel: String,
    description: String,
    enabled: Boolean,
    onHeld: () -> Unit,
    modifier: Modifier = Modifier,
    holdMs: Int = 2_000,
) {
    val progress = remember { Animatable(0f) }
    val haptic = LocalHapticFeedback.current
    val currentOnHeld by rememberUpdatedState(onHeld)
    val red = if (enabled) SosRed else Color.Gray

    Box(
        modifier = modifier
            .size(size)
            .clearAndSetSemantics {
                role = Role.Button
                contentDescription = description
                if (enabled) {
                    customActions = listOf(CustomAccessibilityAction(description) { currentOnHeld(); true })
                } else {
                    disabled()
                }
            }
            .pointerInput(enabled, holdMs) {
                if (!enabled) return@pointerInput
                coroutineScope {
                    awaitEachGesture {
                        awaitFirstDown()
                        val hold = launch {
                            progress.animateTo(1f, tween(holdMs, easing = LinearEasing))
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            currentOnHeld()
                            progress.snapTo(0f)
                        }
                        waitForUpOrCancellation()
                        if (hold.isActive) {
                            hold.cancel()
                            launch { progress.animateTo(0f, tween(250)) }
                        }
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(size)) {
            val stroke = 12.dp.toPx()
            val inset = stroke / 2
            val arc = Size(this.size.width - stroke, this.size.height - stroke)
            drawArc(red.copy(alpha = 0.12f), 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(stroke))
            drawArc(
                red.copy(alpha = 0.5f), -90f, 360f * progress.value, false, Offset(inset, inset), arc,
                style = Stroke(stroke, cap = StrokeCap.Butt),
            )
        }
        Column(
            modifier = Modifier
                .size(size)
                .padding(18.dp)
                .shadow(8.dp, CircleShape)
                .background(red, CircleShape),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(label, color = Color.White, fontSize = (size.value * 0.22f).sp, fontWeight = FontWeight.Black)
            if (progress.value > 0f) {
                Text(
                    holdingLabel,
                    color = Color.White,
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 24.dp),
                )
            }
        }
    }
}
