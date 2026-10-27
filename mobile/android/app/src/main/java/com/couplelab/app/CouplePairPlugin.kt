package com.couplelab.app

import android.Manifest
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * The two-phone link for the web layer: pairing (QR and four digits), sync,
 * live signals, and the encrypted store the event log lives in. The work is in
 * PairLink and SecureStore; this class only translates.
 */
@CapacitorPlugin(
    name = "CouplePair",
    permissions = [
        // Nearby discovery also wants precise location on Android 13+ (seen on the Redmi: errors 8034, 8036).
        Permission(alias = "nearby33", strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.NEARBY_WIFI_DEVICES, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION]),
        Permission(alias = "nearby31", strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION]),
        Permission(alias = "nearbyOld", strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION])
    ]
)
class CouplePairPlugin : Plugin(), PairLink.Listener {
    /** Only the app's own files; the pair record and the inbox stay native. */
    private val webKeys = setOf("events")

    override fun load() {
        PairLink.init(context)
        PairLink.listener = this
    }

    override fun handleOnResume() {
        if (PairLink.hasPermissions(context)) PairLink.startSync(false)
    }

    override fun handleOnDestroy() {
        if (PairLink.listener === this) PairLink.listener = null
    }

    override fun onState(state: JSONObject) = notifyListeners("state", JSObject.fromJSONObject(state))

    override fun onInbox(count: Int) = notifyListeners("inbox", JSObject().put("count", count))

    override fun onSignal(name: String, data: JSONObject?) =
        notifyListeners("signal", JSObject().put("name", name).put("data", data?.let { JSObject.fromJSONObject(it) } ?: JSObject()))

    private fun nearbyAlias() = when {
        Build.VERSION.SDK_INT >= 33 -> "nearby33"
        Build.VERSION.SDK_INT >= 31 -> "nearby31"
        else -> "nearbyOld"
    }

    @PluginMethod
    fun nearbyAllowed(call: PluginCall) {
        call.resolve(JSObject().put("granted", getPermissionState(nearbyAlias()) == PermissionState.GRANTED))
    }

    @PluginMethod
    fun askNearby(call: PluginCall) {
        if (getPermissionState(nearbyAlias()) == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        requestPermissionForAlias(nearbyAlias(), call, "nearbyResult")
    }

    @PermissionCallback
    private fun nearbyResult(call: PluginCall) {
        call.resolve(JSObject().put("granted", getPermissionState(nearbyAlias()) == PermissionState.GRANTED))
    }

    @PluginMethod
    fun status(call: PluginCall) = call.resolve(JSObject.fromJSONObject(PairLink.state()))

    @PluginMethod
    fun startHost(call: PluginCall) {
        val me = call.getString("me")
        val deviceId = call.getString("deviceId")
        if ((me != "A" && me != "B") || deviceId.isNullOrEmpty()) {
            call.reject("me and deviceId needed")
            return
        }
        val link = PairLink.startHost(me, deviceId)
        call.resolve(JSObject().put("link", link).put("qr", qrDataUrl(link)))
    }

    @PluginMethod
    fun startJoin(call: PluginCall) {
        val link = call.getString("link") ?: ""
        val deviceId = call.getString("deviceId")
        if (deviceId.isNullOrEmpty()) {
            call.reject("deviceId needed")
            return
        }
        call.resolve(JSObject().put("ok", PairLink.startJoin(link, deviceId)))
    }

    @PluginMethod
    fun confirmSas(call: PluginCall) {
        PairLink.confirmSas(call.getBoolean("same", false) == true)
        call.resolve()
    }

    @PluginMethod
    fun cancelPairing(call: PluginCall) {
        PairLink.cancelPairing()
        call.resolve()
    }

    @PluginMethod
    fun unpair(call: PluginCall) {
        PairLink.unpair()
        call.resolve()
    }

    @PluginMethod
    fun startSync(call: PluginCall) = call.resolve(JSObject().put("started", PairLink.startSync(false)))

    @PluginMethod
    fun stopSync(call: PluginCall) {
        PairLink.stopSync()
        call.resolve()
    }

    @PluginMethod
    fun pushNow(call: PluginCall) {
        PairLink.pushNow()
        call.resolve()
    }

    @PluginMethod
    fun sendSignal(call: PluginCall) {
        val name = call.getString("name") ?: return call.reject("name needed")
        call.resolve(JSObject().put("sent", PairLink.sendSignal(name, call.getObject("data"))))
    }

    @PluginMethod
    fun storeRead(call: PluginCall) {
        val key = call.getString("key")
        if (key !in webKeys) return call.reject("unknown key")
        val result = JSObject()
        result.put("text", SecureStore.read(context, key!!) ?: JSONObject.NULL)
        call.resolve(result)
    }

    @PluginMethod
    fun storeWrite(call: PluginCall) {
        val key = call.getString("key")
        if (key !in webKeys) return call.reject("unknown key")
        SecureStore.write(context, key!!, call.getString("text"))
        call.resolve()
    }

    @PluginMethod
    fun drainInbox(call: PluginCall) = call.resolve(JSObject().put("events", SecureStore.drainInbox(context)))

    @PluginMethod
    fun scanQr(call: PluginCall) {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(activity, options).startScan()
            .addOnSuccessListener { code -> call.resolve(JSObject().put("text", code.rawValue ?: "")) }
            .addOnCanceledListener { call.resolve(JSObject().put("text", "")) }
            .addOnFailureListener { call.reject(it.message ?: "scan failed") }
    }

    /** ColorOS and HyperOS stop apps in the background unless battery use is "unrestricted". */
    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
        call.resolve()
    }

    private fun qrDataUrl(text: String): String {
        val size = 640
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 2))
        val pixels = IntArray(size * size) { i -> if (matrix.get(i % size, i / size)) Color.BLACK else Color.WHITE }
        val bitmap = Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
}
