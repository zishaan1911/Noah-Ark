package com.noahark.arksos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.noahark.arksos.R
import com.noahark.arksos.SosUiState
import com.noahark.contracts.MissionStatus
import java.util.Locale

// shortcut: Ark-1's 2 kg payload cap (mission.schema.json payloadKg maximum) is repeated here for the gauge only,
// read it from the API if the fleet gets other drone sizes
private const val PAYLOAD_CAP_KG = 2.0

/** 1.04 -> "1.04", 0.30 -> "0.3", 2.00 -> "2.0". */
private fun kg(value: Double) = String.format(Locale.US, "%.2f", value).removeSuffix("0")

/** The kit mission-planner (Bedrock) packed for this SOS, as the operator will send it. */
@Composable
fun SuppliesTab(state: SosUiState) {
    val delivery = state.sos?.delivery
    val kit = delivery?.payload.orEmpty()
    val total = delivery?.payloadKg ?: kit.sumOf { it.weightKg }
    val waiting = delivery?.missionStatus.let { it == MissionStatus.PendingApproval || it == MissionStatus.Approved }
    TabBody { _, _ ->
        Text(stringResource(R.string.supplies_title), style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        if (kit.isEmpty()) Text(stringResource(R.string.supplies_empty), style = MaterialTheme.typography.bodyLarge)
        if (waiting) Text(stringResource(R.string.supplies_pending), style = MaterialTheme.typography.bodyMedium)
        for (line in kit) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 40.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(28.dp).background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("${line.qty}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onPrimaryContainer)
                }
                Text(
                    line.item,
                    Modifier.weight(1f).padding(horizontal = 12.dp),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text("${kg(line.weightKg)} kg")
            }
        }
        Spacer(Modifier.weight(1f))
        if (kit.isNotEmpty()) {
            LinearProgressIndicator(
                progress = { (total / PAYLOAD_CAP_KG).coerceIn(0.0, 1.0).toFloat() },
                modifier = Modifier.fillMaxWidth().height(10.dp),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.supplies_total, kg(total), kg(PAYLOAD_CAP_KG)),
                Modifier.fillMaxWidth(),
                textAlign = TextAlign.End,
            )
        }
    }
}
