package com.noahark.arksos

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.noahark.arksos.api.SosApi
import com.noahark.arksos.location.LocationSource
import com.noahark.contracts.Channel
import com.noahark.contracts.Geo
import com.noahark.contracts.Need
import com.noahark.contracts.SosReport
import com.noahark.contracts.SosRequest
import com.noahark.contracts.SosStatus
import com.noahark.contracts.SosVulnerable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Same rule as the schema's contactPhone pattern (E.164). */
val E164 = Regex("^\\+[1-9][0-9]{6,14}$")

enum class Progress { Locating, Sending }

enum class Failure { LocationOff, LocationDenied, SendFailed }

enum class Group { Children, Elderly, Disabled, Pregnant }

/** What the sender filled in on the People and Needs tabs. */
data class Details(
    val people: Int = 1,
    val vulnerable: Map<Group, Int> = Group.entries.associateWith { 0 },
    val needs: Set<Need> = emptySet(),
    val medicines: String = "",
    val notes: String = "",
    val phone: String = "",
)

data class SosUiState(
    val language: String,
    val details: Details = Details(),
    val sosId: String? = null,
    val sos: SosRequest? = null,
    val progress: Progress? = null,
    val failure: Failure? = null,
    /** Edited since the last report the server has. */
    val detailsDirty: Boolean = false,
    /** The background location service should be running. */
    val sharing: Boolean = false,
) {
    val phoneValid get() = details.phone.isBlank() || E164.matches(details.phone.trim())
    val finished get() = sos?.status == SosStatus.Delivered || sos?.status == SosStatus.Closed
}

/**
 * Everything the four tabs share: what the sender filled in, the SOS once sent, and whether location is shared.
 * The SOS goes out on the button alone; details filled in before go with it, details after go as an update.
 * The background location posts come from LocationService; this only says whether it should run.
 */
class SosViewModel(
    private val api: SosApi,
    private val location: LocationSource,
    private val prefs: SosPrefs,
    language: String,
    private val pollEveryMs: Long = 10_000,
) : ViewModel() {
    private val _state = MutableStateFlow(SosUiState(language = language))
    val state: StateFlow<SosUiState> = _state.asStateFlow()

    private var lastLocation: Geo? = null
    private var poll: Job? = null

    init {
        // Reopening the app goes back to the SOS in progress.
        prefs.sosId?.let { resume(it) }
    }

    fun setLanguage(tag: String) {
        prefs.language = tag
        _state.update { it.copy(language = tag) }
    }

    // --- the form ---

    fun setPeople(n: Int) = edit { it.copy(people = n.coerceAtLeast(1)) }

    fun setVulnerable(group: Group, n: Int) = edit { it.copy(vulnerable = it.vulnerable + (group to n)) }

    fun setNeed(need: Need, on: Boolean) = edit { it.copy(needs = if (on) it.needs + need else it.needs - need) }

    fun setMedicines(text: String) = edit { it.copy(medicines = text) }

    fun setNotes(text: String) = edit { it.copy(notes = text) }

    fun setPhone(text: String) = edit { it.copy(phone = text) }

    private fun edit(change: (Details) -> Details) = _state.update { s ->
        val d = change(s.details)
        // Nobody can be more vulnerable than the number of people.
        s.copy(details = d.copy(vulnerable = d.vulnerable.mapValues { it.value.coerceIn(0, d.people) }), detailsDirty = true)
    }

    fun report(geo: Geo): SosReport {
        val s = _state.value
        val d = s.details
        val meds = d.medicines.split(MEDICINE_SEPARATORS).map { it.trim().take(100) }.filter { it.isNotEmpty() }.take(20)
        return SosReport(
            channel = Channel.App,
            location = geo,
            language = s.language,
            rawMessage = d.notes.trim().ifEmpty { null },
            peopleCount = d.people.toLong(),
            needs = d.needs.toList().ifEmpty { null },
            medicines = meds.ifEmpty { null },
            // An invalid phone never blocks the SOS itself; it is left out.
            contactPhone = d.phone.trim().takeIf { it.isNotEmpty() && s.phoneValid },
            vulnerable = if (d.vulnerable.values.any { it > 0 }) {
                SosVulnerable(
                    children = d.vulnerable.getValue(Group.Children).toLong(),
                    elderly = d.vulnerable.getValue(Group.Elderly).toLong(),
                    disabled = d.vulnerable.getValue(Group.Disabled).toLong(),
                    pregnant = d.vulnerable.getValue(Group.Pregnant).toLong(),
                )
            } else {
                null
            },
        )
    }

    // --- the SOS ---

    /** The big red button, after the hold. The UI has already asked for location permission. */
    fun sendSos() {
        val s = _state.value
        if (s.progress != null || s.sosId != null) return
        _state.update { it.copy(progress = Progress.Locating, failure = null) }
        viewModelScope.launch {
            val geo = location.current()
            // The schema requires a location, so no fix means nothing is sent.
            if (geo == null) {
                _state.update { it.copy(progress = null, failure = Failure.LocationOff) }
                return@launch
            }
            lastLocation = geo
            _state.update { it.copy(progress = Progress.Sending) }
            try {
                val sent = api.create(report(geo))
                prefs.sosId = sent.id
                _state.update {
                    it.copy(sosId = sent.id, sos = sent, progress = null, detailsDirty = false, sharing = true)
                }
                follow()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // shortcut: no offline queue or SMS fallback yet, add one once the SMS intake number exists
                _state.update { it.copy(progress = null, failure = Failure.SendFailed) }
            }
        }
    }

    fun locationDenied() = _state.update { it.copy(progress = null, failure = Failure.LocationDenied) }

    /** The location service could not start (permission taken away, or the system refused). */
    fun sharingUnavailable() = _state.update { it.copy(sharing = false) }

    fun sendDetails() {
        val s = _state.value
        val id = s.sosId
        val geo = lastLocation ?: s.sos?.report?.location
        if (id == null || geo == null || !s.phoneValid || s.progress != null) return
        _state.update { it.copy(progress = Progress.Sending, failure = null) }
        viewModelScope.launch {
            try {
                val stored = api.updateReport(id, report(geo))
                _state.update { it.copy(sos = stored, progress = null, detailsDirty = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                _state.update { it.copy(progress = null, failure = Failure.SendFailed) }
            }
        }
    }

    /** After "Done": forget this SOS so the next opening shows the button again. */
    fun finish() {
        poll?.cancel()
        prefs.sosId = null
        _state.update { it.copy(sosId = null, sos = null, sharing = false, progress = null, failure = null) }
    }

    private fun resume(id: String) {
        _state.update { it.copy(sosId = id, sharing = true) }
        follow()
    }

    private fun follow() {
        poll?.cancel()
        poll = viewModelScope.launch {
            while (true) {
                refresh()
                if (_state.value.finished) break
                delay(pollEveryMs)
            }
        }
    }

    private suspend fun refresh() {
        val id = _state.value.sosId ?: return
        try {
            val latest = api.get(id)
            val done = latest.status == SosStatus.Delivered || latest.status == SosStatus.Closed
            _state.update { it.copy(sos = latest, sharing = it.sharing && !done) }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // No signal: keep the last status and try again on the next tick.
        }
    }

    private companion object {
        val MEDICINE_SEPARATORS = Regex("[,\\n;，、]")
    }
}
