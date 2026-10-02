# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Native modules reached from JavaScript by reflection. Most libraries ship their own rules;
# these cover the ones that don't, so R8 can't strip a class only JS calls into.
-keep class com.horcrux.svg.** { *; }
-keep class com.ReactNativeBlobUtil.** { *; }
-keep class com.imagepicker.** { *; }
-keep class cl.json.** { *; }
-keep class com.BV.LinearGradient.** { *; }
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }
