package com.noahark.arksos

import com.noahark.arksos.api.FakeSosApi
import com.noahark.arksos.api.LocationResult
import com.noahark.arksos.api.SosApi
import com.noahark.arksos.location.LocationSource
import com.noahark.contracts.Channel
import com.noahark.contracts.Geo
import com.noahark.contracts.Need
import com.noahark.contracts.SosLocationUpdate
import com.noahark.contracts.SosReport
import com.noahark.contracts.SosRequest
import com.noahark.contracts.SosVulnerable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private class FakeLocation(var geo: Geo? = Geo(lat = 5.98, lon = 116.07)) : LocationSource {
    override suspend fun current() = geo
    override fun updates(): Flow<Geo> = emptyFlow()
}

private class MemoryPrefs(override var sosId: String? = null, override var language: String? = null) : SosPrefs

/** Records what the app sends and counts polls; can be told to fail the first call. */
private class RecordingApi(private val inner: SosApi, var failCreate: Boolean = false) : SosApi {
    val reports = mutableListOf<SosReport>()
    var gets = 0

    override suspend fun create(report: SosReport): SosRequest {
        if (failCreate) error("offline")
        reports += report
        return inner.create(report)
    }

    override suspend fun get(id: String): SosRequest {
        gets++
        return inner.get(id)
    }

    override suspend fun updateReport(id: String, report: SosReport): SosRequest {
        reports += report
        return inner.updateReport(id, report)
    }

    override suspend fun updateLocation(id: String, update: SosLocationUpdate): LocationResult =
        inner.updateLocation(id, update)
}

@OptIn(ExperimentalCoroutinesApi::class)
class SosViewModelTest {
    private val scheduler = TestCoroutineScheduler()
    private val dispatcher = StandardTestDispatcher(scheduler)
    private val fake = FakeSosApi(stepMs = 5_000, now = { scheduler.currentTime })
    private val api = RecordingApi(fake)
    private val prefs = MemoryPrefs()
    private val here = Geo(lat = 5.98, lon = 116.07)

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun viewModel(
        location: LocationSource = FakeLocation(),
        language: String = "en",
        backend: SosApi = api,
        store: SosPrefs = prefs,
    ) = SosViewModel(backend, location, store, language, pollEveryMs = 1_000)

    @Test
    fun anEmptyFormStillMakesAValidReport() {
        val report = viewModel(language = "ta").report(here)

        assertEquals(Channel.App, report.channel)
        assertEquals("ta", report.language)
        assertEquals(1L, report.peopleCount)
        assertEquals(here, report.location)
        assertNull(report.vulnerable)
        assertNull(report.medicines)
        assertNull(report.needs)
        assertNull(report.contactPhone)
        assertNull(report.rawMessage)
    }

    @Test
    fun detailsMapOntoTheReportAndABadPhoneIsLeftOut() {
        val vm = viewModel()
        vm.setPeople(4)
        vm.setVulnerable(Group.Children, 2)
        vm.setVulnerable(Group.Pregnant, 1)
        vm.setNeed(Need.Water, true)
        vm.setMedicines("insulin, paracetamol\n胰岛素、 ")
        vm.setNotes("  no road, river rising  ")
        vm.setPhone("0123")

        val report = vm.report(here)

        assertEquals(listOf("insulin", "paracetamol", "胰岛素"), report.medicines)
        assertEquals(SosVulnerable(children = 2, elderly = 0, disabled = 0, pregnant = 1), report.vulnerable)
        assertEquals(listOf(Need.Water), report.needs)
        assertEquals("no road, river rising", report.rawMessage)
        assertFalse(vm.state.value.phoneValid)
        assertNull(report.contactPhone)

        vm.setPhone("+60123456789")
        assertTrue(vm.state.value.phoneValid)
        assertEquals("+60123456789", vm.report(here).contactPhone)
    }

    @Test
    fun fewerPeopleClampsTheVulnerableCounts() {
        val vm = viewModel()
        vm.setPeople(3)
        vm.setVulnerable(Group.Elderly, 3)
        vm.setPeople(1)

        assertEquals(1, vm.state.value.details.vulnerable.getValue(Group.Elderly))
    }

    @Test
    fun theSosGoesOutWithTheDetailsSoFarThenFollowsUntilDelivered() = runTest(dispatcher) {
        val vm = viewModel()
        vm.setPeople(2)
        vm.setMedicines("insulin")

        vm.sendSos()
        runCurrent()

        val sent = vm.state.value
        assertTrue(sent.sosId!!.startsWith("sos_"))
        assertEquals(sent.sosId, prefs.sosId)
        assertEquals(listOf("insulin"), api.reports.single().medicines)
        assertEquals(2L, api.reports.single().peopleCount)
        assertFalse(sent.detailsDirty)
        assertTrue(sent.sharing)

        advanceTimeBy(12_001)
        assertEquals("Drinking water 500 ml", vm.state.value.sos?.delivery?.payload?.first()?.item)
        assertFalse(vm.state.value.finished)

        advanceTimeBy(30_000)
        assertTrue(vm.state.value.finished)
        assertFalse(vm.state.value.sharing)

        vm.finish()
        assertNull(prefs.sosId)
        assertNull(vm.state.value.sosId)
    }

    @Test
    fun pollingStopsOnceDelivered() = runTest(dispatcher) {
        val vm = viewModel()
        vm.sendSos()
        advanceTimeBy(60_000)
        assertTrue(vm.state.value.finished)

        val polls = api.gets
        advanceTimeBy(60_000)

        assertEquals(polls, api.gets)
    }

    @Test
    fun detailsAfterTheSosGoAsAnUpdate() = runTest(dispatcher) {
        val vm = viewModel()
        vm.sendSos()
        runCurrent()
        vm.setVulnerable(Group.Children, 1)
        assertTrue(vm.state.value.detailsDirty)

        vm.sendDetails()
        runCurrent()

        assertFalse(vm.state.value.detailsDirty)
        assertEquals(2, api.reports.size)
        assertEquals(1L, vm.state.value.sos?.report?.vulnerable?.children)
        assertNull(vm.state.value.sos?.delivery) // still new; the kit comes once planned
        vm.finish()
    }

    @Test
    fun anInvalidPhoneBlocksTheUpdateButNeverTheSos() = runTest(dispatcher) {
        val vm = viewModel()
        vm.setPhone("0123")
        vm.sendSos()
        runCurrent()
        assertNotNull(vm.state.value.sosId)
        assertNull(api.reports.single().contactPhone)

        vm.sendDetails()
        runCurrent()

        assertEquals(1, api.reports.size)
        vm.finish()
    }

    @Test
    fun noLocationMeansNothingIsSent() = runTest(dispatcher) {
        val vm = viewModel(location = FakeLocation(geo = null))

        vm.sendSos()
        runCurrent()

        assertNull(vm.state.value.sosId)
        assertEquals(Failure.LocationOff, vm.state.value.failure)
        assertNull(vm.state.value.progress)
        assertTrue(api.reports.isEmpty())
    }

    @Test
    fun refusedPermissionIsKeptAsTheReason() {
        val vm = viewModel()

        vm.locationDenied()

        assertEquals(Failure.LocationDenied, vm.state.value.failure)
        assertNull(vm.state.value.sosId)
    }

    @Test
    fun aFailedSendCanBeTriedAgain() = runTest(dispatcher) {
        val vm = viewModel()
        api.failCreate = true
        vm.sendSos()
        runCurrent()
        assertEquals(Failure.SendFailed, vm.state.value.failure)
        assertNull(vm.state.value.sosId)

        api.failCreate = false
        vm.sendSos()
        runCurrent()

        assertNotNull(vm.state.value.sosId)
        assertNull(vm.state.value.failure)
        vm.finish()
    }

    @Test
    fun reopeningResumesTheSosInProgress() = runTest(dispatcher) {
        val first = fake.create(SosReport(channel = Channel.App, location = here))
        val vm = viewModel(store = MemoryPrefs(sosId = first.id))
        runCurrent()

        assertEquals(first.id, vm.state.value.sosId)
        assertEquals(first.id, vm.state.value.sos?.id)
        assertTrue(vm.state.value.sharing)
        vm.finish()
    }

    @Test
    fun theLanguageChoiceIsSaved() {
        val vm = viewModel()

        vm.setLanguage("zh")

        assertEquals("zh", prefs.language)
        assertEquals("zh", vm.state.value.language)
    }
}
