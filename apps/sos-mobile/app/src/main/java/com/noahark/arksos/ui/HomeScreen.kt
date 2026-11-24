package com.noahark.arksos.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.vector.ImageVector
import com.noahark.arksos.R
import com.noahark.arksos.SosUiState
import com.noahark.arksos.SosViewModel

private class TabItem(val icon: ImageVector, val label: Int)

private val Tabs = listOf(
    TabItem(Icons.Filled.Warning, R.string.tab_sos),
    TabItem(Icons.Filled.Person, R.string.tab_people),
    TabItem(Icons.Filled.Favorite, R.string.tab_needs),
    TabItem(Icons.Filled.ShoppingCart, R.string.tab_supplies),
)

/** Four tabs, each one screen: SOS (the button, then status), People, Needs, Supplies. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(state: SosUiState, vm: SosViewModel, onHold: () -> Unit) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.app_name)) },
                actions = { LanguageMenu(onLanguage = vm::setLanguage) },
            )
        },
        bottomBar = {
            NavigationBar {
                Tabs.forEachIndexed { i, item ->
                    NavigationBarItem(
                        selected = tab == i,
                        onClick = { tab = i },
                        icon = { Icon(item.icon, contentDescription = null) },
                        label = { Text(stringResource(item.label)) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding)) {
            when (tab) {
                0 -> SosTab(state, onHold = onHold, onDone = vm::finish)
                1 -> PeopleTab(state, vm)
                2 -> NeedsTab(state, vm)
                else -> SuppliesTab(state)
            }
        }
    }
}

/** The 🌐 menu: each language in its own script. */
@Composable
private fun LanguageMenu(onLanguage: (String) -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    val description = stringResource(R.string.language)
    IconButton(onClick = { open = true }, modifier = Modifier.semantics { contentDescription = description }) {
        Text("🌐")
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        for ((tag, name) in Languages) {
            DropdownMenuItem(
                text = { Text(stringResource(name)) },
                onClick = {
                    open = false
                    onLanguage(tag)
                },
            )
        }
    }
}
