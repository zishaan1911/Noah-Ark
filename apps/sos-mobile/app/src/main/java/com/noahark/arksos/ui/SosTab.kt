package com.noahark.arksos.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.noahark.arksos.Failure
import com.noahark.arksos.Progress
import com.noahark.arksos.R
import com.noahark.arksos.SosUiState
import com.noahark.contracts.SosStatus
import kotlin.math.roundToInt

/** The first thing on screen: the big red button. Once sent, the same tab follows the SOS. */
@Composable
fun SosTab(state: SosUiState, onHold: () -> Unit, onDone: () -> Unit) {
    if (state.sosId == null) SosButton(state, onHold) else SosStatusView(state, onDone)
}

@Composable
private fun SosButton(state: SosUiState, onHold: () -> Unit) {
    val message = when {
        state.progress == Progress.Locating -> R.string.finding_location
        state.progress == Progress.Sending -> R.string.sending
        state.failure == Failure.LocationOff -> R.string.location_off
        state.failure == Failure.LocationDenied -> R.string.location_denied
        state.failure == Failure.SendFailed -> R.string.send_failed
        else -> R.string.hold_to_send
    }
    TabBody { width, height ->
        Text(
            stringResource(R.string.sos_hint),
            Modifier.fillMaxWidth(),
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.titleMedium,
        )
        Spacer(Modifier.weight(1f))
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            HoldButton(
                size = minOf(width * 0.8f, height * 0.6f),
                label = stringResource(R.string.sos_label),
                holdingLabel = stringResource(R.string.keep_holding),
                description = stringResource(R.string.hold_to_send),
                enabled = state.progress == null,
                onHeld = onHold,
            )
        }
        Spacer(Modifier.weight(1f))
        Text(
            stringResource(message),
            Modifier.fillMaxWidth(),
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.titleMedium,
            color = if (state.failure != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        )
    }
}

private class Step(val done: Boolean, val title: String, val detail: String)

@Composable
private fun SosStatusView(state: SosUiState, onDone: () -> Unit) {
    val status = state.sos?.status
    val delivery = state.sos?.delivery
    val eta = delivery?.etaMinutes
    val steps = listOf(
        Step(true, stringResource(R.string.step_sent), stringResource(R.string.step_sent_detail)),
        Step(
            status != null && status != SosStatus.New,
            stringResource(R.string.step_arranged),
            stringResource(R.string.step_arranged_detail),
        ),
        Step(
            delivery != null,
            if (delivery == null) stringResource(R.string.step_drone) else stringResource(R.string.step_drone_named, delivery.droneID),
            if (eta == null) stringResource(R.string.step_drone_wait) else stringResource(R.string.step_drone_eta, eta.roundToInt()),
        ),
        Step(state.finished, stringResource(R.string.step_delivered), stringResource(R.string.step_delivered_detail)),
    )
    // Only the latest step reached gets its detail line (e.g. the ETA), which keeps the tab on one screen.
    val current = steps.indexOfLast { it.done }

    TabBody { _, _ ->
        Text(
            stringResource(if (state.finished) R.string.help_arrived else R.string.help_coming),
            style = MaterialTheme.typography.titleLarge,
        )
        Spacer(Modifier.height(8.dp))
        steps.forEachIndexed { i, step ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = 40.dp).padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    if (step.done) Icons.Filled.CheckCircle else Icons.Outlined.CheckCircle,
                    contentDescription = null,
                    tint = if (step.done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                    modifier = Modifier.size(24.dp),
                )
                Column(Modifier.padding(start = 16.dp), verticalArrangement = Arrangement.Center) {
                    Text(step.title, style = MaterialTheme.typography.titleMedium)
                    if (i == current) Text(step.detail, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        Spacer(Modifier.weight(1f))
        if (state.finished) {
            Button(onClick = onDone, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                Text(stringResource(R.string.done))
            }
        } else {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (state.sharing) Icons.Filled.LocationOn else Icons.Outlined.LocationOn,
                    contentDescription = null,
                    modifier = Modifier.size(24.dp),
                )
                // The ongoing Android notification carries the longer explanation.
                Text(
                    stringResource(if (state.sharing) R.string.sharing_on else R.string.sharing_off),
                    Modifier.padding(start = 16.dp),
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.reference, state.sosId.orEmpty()), style = MaterialTheme.typography.bodySmall)
    }
}
