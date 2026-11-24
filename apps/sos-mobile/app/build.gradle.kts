plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.noahark.arksos"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.noahark.arksos"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        // Empty = the fake backend; e.g. -PapiUrl=http://10.0.2.2:8080/v1 for the local stack from the emulator.
        buildConfigField("String", "API_URL", "\"${project.findProperty("apiUrl") ?: ""}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    // The SOS types are generated from shared/schemas (shared/scripts/codegen.py), never edited here.
    sourceSets["main"].java.srcDir("../../../shared/generated/kotlin")
    testOptions.unitTests.isReturnDefaultValues = true
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.06.01")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
