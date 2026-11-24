package com.noahark.arksos.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.noahark.arksos.Failure
import com.noahark.arksos.Group
import com.noahark.arksos.R
import com.noahark.arksos.SosUiState
import com.noahark.arksos.SosViewModel
import com.noahark.contracts.Need

private const val NOTES_MAX = 4000

/** People and Needs: the optional form. Filled before the SOS, it goes with it; after, "Send details" updates it. */
@Composable
fun PeopleTab(state: SosUiState, vm: SosViewModel) {
    var phone by rememberSaveable { mutableStateOf(state.details.phone) }
    val labels = listOf(
        Group.Children to R.string.children,
        Group.Elderly to R.string.elderly,
        Group.Disabled to R.string.disabled,
        Group.Pregnant to R.string.pregnant,
    )
    val fewer = stringResource(R.string.fewer)
    val more = stringResource(R.string.more)
    TabBody { _, _ ->
        Text(stringResource(R.string.people_title), style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        CounterRow(
            label = stringResource(R.string.people_total),
            value = state.details.people,
            min = 1,
            fewer = fewer,
            more = more,
            onChange = vm::setPeople,
        )
        HorizontalDivider()
        for ((group, label) in labels) {
            CounterRow(
                label = stringResource(label),
                value = state.details.vulnerable.getValue(group),
                max = state.details.people,
                fewer = fewer,
                more = more,
                onChange = { vm.setVulnerable(group, it) },
            )
        }
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = phone,
            onValueChange = {
                phone = it
                vm.setPhone(it)
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            label = { Text(stringResource(R.string.phone_label)) },
            placeholder = { Text(stringResource(R.string.phone_hint)) },
            isError = !state.phoneValid,
            supportingText = if (state.phoneValid) null else ({ Text(stringResource(R.string.phone_invalid)) }),
        )
        Spacer(Modifier.weight(1f))
        DetailsButton(state, vm)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NeedsTab(state: SosUiState, vm: SosViewModel) {
    var medicines by rememberSaveable { mutableStateOf(state.details.medicines) }
    var notes by rememberSaveable { mutableStateOf(state.details.notes) }
    val labels = listOf(
        Need.Water to R.string.need_water,
        Need.Food to R.string.need_food,
        Need.Medicine to R.string.need_medicine,
        Need.BabySupplies to R.string.need_baby_supplies,
        Need.Shelter to R.string.need_shelter,
        Need.Rescue to R.string.need_rescue,
        Need.Other to R.string.need_other,
    )
    TabBody { _, _ ->
        Text(stringResource(R.string.needs_title), style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((need, label) in labels) {
                val selected = need in state.details.needs
                FilterChip(
                    selected = selected,
                    onClick = { vm.setNeed(need, !selected) },
                    label = { Text(stringResource(label)) },
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = medicines,
            onValueChange = {
                medicines = it
                vm.setMedicines(it)
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text(stringResource(R.string.medicines_label)) },
            placeholder = { Text(stringResource(R.string.medicines_hint)) },
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = notes,
            onValueChange = {
                if (it.length <= NOTES_MAX) {
                    notes = it
                    vm.setNotes(it)
                }
            },
            modifier = Modifier.fillMaxWidth(),
            maxLines = 3,
            label = { Text(stringResource(R.string.notes_label)) },
            placeholder = { Text(stringResource(R.string.notes_hint)) },
        )
        Spacer(Modifier.weight(1f))
        DetailsButton(state, vm)
    }
}

/** Before the SOS: says the details will go with it. After: sends them, or shows they are sent. */
@Composable
private fun DetailsButton(state: SosUiState, vm: SosViewModel) {
    if (state.sosId == null) {
        Text(
            stringResource(R.string.details_with_sos),
            Modifier.fillMaxWidth().padding(top = 8.dp),
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.bodyMedium,
        )
        return
    }
    val canSend = state.detailsDirty && state.phoneValid && state.progress == null && !state.finished
    if (state.failure == Failure.SendFailed) {
        Text(
            stringResource(R.string.send_failed),
            Modifier.padding(bottom = 8.dp),
            color = MaterialTheme.colorScheme.error,
        )
    }
    Button(onClick = vm::sendDetails, enabled = canSend, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Icon(
            if (state.detailsDirty) Icons.AutoMirrored.Filled.Send else Icons.Filled.Check,
            contentDescription = null,
        )
        Text(
            stringResource(if (state.detailsDirty) R.string.send_details else R.string.details_sent),
            Modifier.padding(start = 8.dp),
        )
    }
}
