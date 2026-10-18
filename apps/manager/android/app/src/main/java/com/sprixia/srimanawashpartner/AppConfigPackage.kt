package com.sprixia.srimanawashpartner

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.uimanager.ViewManager

/** Build settings the JavaScript side needs to know, e.g. whether a Google Maps key was built in. */
class AppConfigModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "AppConfig"

  override fun getConstants(): Map<String, Any> = mapOf("mapsEnabled" to BuildConfig.MAPS_ENABLED)
}

class AppConfigPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(AppConfigModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
