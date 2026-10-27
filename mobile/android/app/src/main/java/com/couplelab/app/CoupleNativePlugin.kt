package com.couplelab.app

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.WindowManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlin.math.roundToInt

/**
 * What the date needs from the phone itself (docs/ANDROID_APP_PLAN.md §3.1, §3.6):
 * waveform vibration for the haptic language, keeping the screen on while the
 * phone lies face down (so the clock and vibrations keep running), optional
 * Do Not Disturb with the previous mode restored afterwards, and the system
 * font size applied to the WebView.
 */
@CapacitorPlugin(name = "CoupleNative")
class CoupleNativePlugin : Plugin() {
    private var filterBeforeDate: Int? = null

    override fun load() = applyFontScale()

    override fun handleOnResume() = applyFontScale()

    /** The WebView ignores Android's font size unless told; rem units then scale the whole UI. */
    private fun applyFontScale() {
        val scale = context.resources.configuration.fontScale
        bridge.webView.post { bridge.webView.settings.textZoom = (scale * 100).roundToInt() }
    }

    private fun vibrator(): Vibrator =
        if (Build.VERSION.SDK_INT >= 31) {
            context.getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }

    @PluginMethod
    fun vibrate(call: PluginCall) {
        val timings = call.getArray("timings")?.toList<Number>()?.map { it.toLong() }?.toLongArray()
        val amplitudes = call.getArray("amplitudes")?.toList<Number>()?.map { it.toInt().coerceIn(0, 255) }?.toIntArray()
        if (timings == null || timings.isEmpty()) {
            call.reject("timings missing")
            return
        }
        val v = vibrator()
        if (!v.hasVibrator()) {
            call.resolve()
            return
        }
        if (Build.VERSION.SDK_INT < 26) {
            @Suppress("DEPRECATION")
            v.vibrate(timings, -1)
            call.resolve()
            return
        }
        val effect = if (amplitudes != null && amplitudes.size == timings.size && v.hasAmplitudeControl()) {
            VibrationEffect.createWaveform(timings, amplitudes, -1)
        } else {
            VibrationEffect.createWaveform(timings, -1)
        }
        // Alarm usage, so the signals of the date still reach the couple with the ringer on silent.
        if (Build.VERSION.SDK_INT >= 33) {
            v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
        } else {
            @Suppress("DEPRECATION")
            v.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
        }
        call.resolve()
    }

    @PluginMethod
    fun cancelVibration(call: PluginCall) {
        vibrator().cancel()
        call.resolve()
    }

    @PluginMethod
    fun keepAwake(call: PluginCall) {
        val on = call.getBoolean("on", false) == true
        activity.runOnUiThread {
            if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            call.resolve()
        }
    }

    private fun notifications(): NotificationManager = context.getSystemService(NotificationManager::class.java)

    @PluginMethod
    fun dndStatus(call: PluginCall) {
        val nm = notifications()
        val result = JSObject()
        result.put("granted", nm.isNotificationPolicyAccessGranted)
        result.put("active", nm.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL)
        call.resolve(result)
    }

    /** Opened on top of this app, not in a new task: on HyperOS a new task joins whatever Settings screen was open, and Back went there. */
    @PluginMethod
    fun openDndSettings(call: PluginCall) {
        activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
        call.resolve()
    }

    /** On: priority only (alarms and starred callers still get through). Off: whatever was there before. */
    @PluginMethod
    fun setDnd(call: PluginCall) {
        val nm = notifications()
        val on = call.getBoolean("on", false) == true
        val result = JSObject()
        if (!nm.isNotificationPolicyAccessGranted) {
            result.put("applied", false)
            call.resolve(result)
            return
        }
        if (on) {
            filterBeforeDate = nm.currentInterruptionFilter
            nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
        } else {
            nm.setInterruptionFilter(filterBeforeDate ?: NotificationManager.INTERRUPTION_FILTER_ALL)
            filterBeforeDate = null
        }
        result.put("applied", true)
        call.resolve(result)
    }
}
