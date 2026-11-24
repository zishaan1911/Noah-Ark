package com.noahark.arksos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.noahark.arksos.api.SosBackend
import com.noahark.arksos.location.AndroidLocationSource
import com.noahark.arksos.ui.ArkSosRoot
import com.noahark.arksos.ui.ArkSosTheme
import com.noahark.arksos.ui.startLanguage

class MainActivity : ComponentActivity() {
    private val viewModel: SosViewModel by viewModels {
        object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST") // the only ViewModel this factory is asked for
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                val prefs = SharedSosPrefs(getSharedPreferences("ark_sos", MODE_PRIVATE))
                return SosViewModel(
                    // Empty API_URL = the fake backend, which walks the SOS through every step on a timer.
                    api = SosBackend.api,
                    location = AndroidLocationSource(applicationContext),
                    prefs = prefs,
                    language = startLanguage(prefs.language, resources.configuration.locales[0].language),
                    pollEveryMs = if (BuildConfig.API_URL.isBlank()) 2_000 else 10_000,
                ) as T
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { ArkSosTheme { ArkSosRoot(viewModel) } }
    }
}
