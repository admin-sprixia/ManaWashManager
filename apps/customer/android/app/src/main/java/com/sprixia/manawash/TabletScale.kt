package com.sprixia.manawash

import android.content.res.Resources
import kotlin.math.min

/**
 * Enlarges the whole UI on big tablets by raising the app's density, so a 900dp-wide tablet lays
 * out like a 720dp one. Phones and small tablets are untouched.
 *
 * The framework resets the density on every configuration change, so this runs again from each
 * onConfigurationChanged. react-native-svg is patched to read this density too (see /patches).
 */
object TabletScale {
  private const val TARGET_SMALLEST_DP = 720f
  private const val MAX_SCALE = 1.3f

  fun apply(resources: Resources) {
    val config = resources.configuration
    val smallest = config.smallestScreenWidthDp
    if (smallest <= TARGET_SMALLEST_DP) return
    val scale = min(smallest / TARGET_SMALLEST_DP, MAX_SCALE)
    val density = Resources.getSystem().displayMetrics.density * scale
    resources.displayMetrics.apply {
      this.density = density
      densityDpi = (density * 160).toInt()
      @Suppress("DEPRECATION")
      scaledDensity = density * config.fontScale
    }
  }
}
