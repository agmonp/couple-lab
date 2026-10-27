package com.couplelab.app

import android.Manifest
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.time.Instant

/**
 * The link between the two phones (docs/ANDROID_APP_PLAN.md §3.3). No server:
 * Nearby Connections over Bluetooth and Wi-Fi Direct, only when the phones are
 * close.
 *
 * Pairing, once: the inviting phone (host) advertises and shows a QR link with
 * its public key; the other phone (join) opens the link, finds the host and
 * sends its own key. Both derive the pair key and show four digits; the pair is
 * saved only when both people confirm the digits match.
 *
 * Syncing, after that: both phones advertise and discover; the one with the
 * smaller device id connects. Messages are sealed with the pair key. Each side
 * says what it has ("hello" with a version vector) and receives only shared
 * events it lacks. Arrivals go to the encrypted inbox, which the app merges with
 * the same rules as `EventLog.merge` (shared only, never "from" this device).
 * Live signals (the break) travel the same way and are never stored.
 *
 * One instance per process, used by the plugin while the app is open and by
 * SyncWorker in the background.
 */
object PairLink {
    interface Listener {
        fun onState(state: JSONObject)
        fun onInbox(count: Int)
        fun onSignal(name: String, data: JSONObject?)
    }

    private const val TAG = "CouplePair"
    private const val SERVICE_PAIR = "com.couplelab.app.pair"
    private const val SERVICE_SYNC = "com.couplelab.app.sync"
    /** Nearby byte payloads stop at 32 KB; events go in batches below that. */
    private const val MAX_BATCH_CHARS = 24_000

    @Volatile
    var listener: Listener? = null
    private lateinit var app: Context
    private val main = Handler(Looper.getMainLooper())
    private val random = SecureRandom()
    private val strategy = Strategy.P2P_POINT_TO_POINT

    private enum class Mode { IDLE, HOST, JOIN, SYNC }

    private var mode = Mode.IDLE
    private var background = false
    private var endpoint: String? = null
    private var phase = "off"
    private var error: String? = null
    private var peerVector = JSONObject()
    private var onExchange: (() -> Unit)? = null

    private class Session(
        val host: Boolean,
        val pairId: ByteArray,
        val priv: ByteArray,
        val pub: ByteArray,
        /** The host's key: its own, or the one from the QR link. */
        val hostPub: ByteArray,
        val me: String,
        val deviceId: String
    ) {
        var peerDevice: String? = null
        var peerMe: String? = null
        var key: ByteArray? = null
        var sas: String? = null
        var confirmedSelf = false
        var confirmedPeer = false
    }

    private var session: Session? = null

    private val client get() = Nearby.getConnectionsClient(app)

    fun init(context: Context) {
        if (!::app.isInitialized) app = context.applicationContext
    }

    // Pair record -------------------------------------------------------------

    fun pair(): JSONObject? = SecureStore.read(app, "pair")?.let { runCatching { JSONObject(it) }.getOrNull() }

    private fun savePair(record: JSONObject) = SecureStore.write(app, "pair", record.toString())

    private fun key(record: JSONObject) = unb64(record.getString("key"))

    private fun aad(record: JSONObject) = record.getString("pairId").toByteArray()

    /** The name both phones advertise under; it says nothing about who they are. */
    private fun tag(record: JSONObject) = "s:" + hex(PairCrypto.hmac(key(record), "couplelab tag".toByteArray())).take(12)

    fun state(): JSONObject {
        val record = pair()
        return JSONObject().apply {
            put("paired", record != null)
            put("phase", phase)
            put("connected", mode == Mode.SYNC && endpoint != null)
            error?.let { put("error", it) }
            session?.let { s ->
                s.sas?.let { put("sas", it) }
                put("waitingForPeer", s.confirmedSelf && !s.confirmedPeer)
            }
            if (record != null) {
                put("me", record.optString("me"))
                put("peerMe", record.optString("peerMe"))
                put("pairedAt", record.optString("pairedAt"))
                if (record.has("lastSyncAt")) put("lastSyncAt", record.getString("lastSyncAt"))
                put("peerVector", record.optJSONObject("peerVector") ?: JSONObject())
            }
        }
    }

    private fun setPhase(next: String, err: String? = null) {
        phase = next
        error = err
        if (err != null) Log.w(TAG, "phase $next: $err")
        val snapshot = state()
        main.post { listener?.onState(snapshot) }
    }

    fun hasPermissions(context: Context): Boolean {
        val needed = when {
            Build.VERSION.SDK_INT >= 33 -> listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.NEARBY_WIFI_DEVICES, Manifest.permission.ACCESS_FINE_LOCATION)
            Build.VERSION.SDK_INT >= 31 -> listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.ACCESS_FINE_LOCATION)
            else -> listOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        return needed.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
    }

    // Pairing -----------------------------------------------------------------

    /** Starts inviting. Returns the link the QR code carries. */
    fun startHost(me: String, deviceId: String): String {
        stopAll()
        val pairId = ByteArray(8).also(random::nextBytes)
        val (priv, pub) = PairCrypto.newKeyPair()
        session = Session(true, pairId, priv, pub, pub, me, deviceId)
        mode = Mode.HOST
        client.startAdvertising("p:" + hex(pairId), SERVICE_PAIR, lifecycle, AdvertisingOptions.Builder().setStrategy(strategy).build())
            .addOnSuccessListener { setPhase("waiting") }
            .addOnFailureListener { setPhase("error", "advertise: ${it.message}") }
        val link = "couplelab://pair?v=1&id=${b64(pairId)}&k=${b64(pub)}&m=$me"
        // Debug builds only, for testing over adb. The link is public (key and id); the digits protect the pairing.
        if (app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) Log.d(TAG, "pair link: $link")
        return link
    }

    /** Joins from a scanned link. False when the link is not a pairing link. */
    fun startJoin(link: String, deviceId: String): Boolean {
        val uri = Uri.parse(link)
        if (uri.scheme != "couplelab" || uri.host != "pair") return false
        val pairId = runCatching { unb64(uri.getQueryParameter("id")!!) }.getOrNull() ?: return false
        val hostPub = runCatching { unb64(uri.getQueryParameter("k")!!) }.getOrNull() ?: return false
        val hostMe = uri.getQueryParameter("m")
        if (pairId.size != 8 || hostPub.size != 32 || (hostMe != "A" && hostMe != "B")) return false
        stopAll()
        val (priv, pub) = PairCrypto.newKeyPair()
        session = Session(false, pairId, priv, pub, hostPub, if (hostMe == "A") "B" else "A", deviceId).also { it.peerMe = hostMe }
        mode = Mode.JOIN
        client.startDiscovery(SERVICE_PAIR, discovery, DiscoveryOptions.Builder().setStrategy(strategy).build())
            .addOnSuccessListener { setPhase("searching") }
            .addOnFailureListener { setPhase("error", "discover: ${it.message}") }
        return true
    }

    fun confirmSas(same: Boolean) {
        val s = session ?: return
        val key = s.key ?: return
        val id = endpoint
        if (!same) {
            if (id != null) client.sendPayload(id, Payload.fromBytes(PairCrypto.seal(key, """{"t":"pair-cancel"}""".toByteArray(), s.pairId)))
            main.postDelayed({ stopAll(); setPhase("error", "sas-mismatch") }, 600)
            return
        }
        s.confirmedSelf = true
        if (id != null) client.sendPayload(id, Payload.fromBytes(PairCrypto.seal(key, """{"t":"pair-confirm"}""".toByteArray(), s.pairId)))
        if (!finishIfBoth()) setPhase("sas")
    }

    fun cancelPairing() {
        if (mode == Mode.HOST || mode == Mode.JOIN) {
            stopAll()
            setPhase("off")
        }
    }

    private fun finishIfBoth(): Boolean {
        val s = session ?: return false
        if (!s.confirmedSelf || !s.confirmedPeer) return false
        val record = JSONObject()
            .put("pairId", hex(s.pairId))
            .put("key", b64(s.key!!))
            .put("myDevice", s.deviceId)
            .put("peerDevice", s.peerDevice)
            .put("me", s.me)
            .put("peerMe", s.peerMe)
            .put("pairedAt", Instant.now().toString())
        savePair(record)
        setPhase("paired")
        // Give the last confirmation time to leave before hanging up; syncing reconnects on its own.
        main.postDelayed({
            stopAll()
            SyncScheduler.schedule(app)
            startSync(false)
        }, 1500)
        return true
    }

    private fun handlePairing(bytes: ByteArray) {
        val s = session ?: return
        val key = s.key
        if (key == null) {
            // Public keys travel in the clear (inside Nearby's own encryption); the digits check them.
            val message = JSONObject(String(bytes, Charsets.UTF_8))
            if (message.optString("t") != "pair-hello") return
            val peerPub = unb64(message.getString("pub"))
            if (!s.host && !peerPub.contentEquals(s.hostPub)) {
                stopAll()
                setPhase("error", "wrong-key")
                return
            }
            s.peerDevice = message.getString("device")
            if (s.host) {
                s.peerMe = message.getString("me")
                if (s.peerMe == s.me) {
                    stopAll()
                    setPhase("error", "same-person")
                    return
                }
            }
            val joinPub = if (s.host) peerPub else s.pub
            s.key = PairCrypto.deriveKey(s.priv, peerPub, s.pairId, s.hostPub, joinPub)
            s.sas = PairCrypto.sas(s.hostPub, joinPub)
            if (s.host) sendPlain(JSONObject().put("t", "pair-hello").put("pub", b64(s.pub)).put("device", s.deviceId).put("me", s.me))
            setPhase("sas")
            return
        }
        val message = JSONObject(String(PairCrypto.open(key, bytes, s.pairId), Charsets.UTF_8))
        when (message.optString("t")) {
            "pair-confirm" -> {
                s.confirmedPeer = true
                if (!finishIfBoth()) setPhase("sas")
            }
            "pair-cancel" -> {
                stopAll()
                setPhase("error", "sas-mismatch")
            }
        }
    }

    private fun sendPlain(message: JSONObject) {
        val id = endpoint ?: return
        client.sendPayload(id, Payload.fromBytes(message.toString().toByteArray(Charsets.UTF_8)))
    }

    // Syncing -----------------------------------------------------------------

    /** Starts looking for the other phone. False when not paired or busy pairing. */
    fun startSync(inBackground: Boolean): Boolean {
        val record = pair() ?: return false
        if (mode == Mode.SYNC) {
            if (!inBackground) background = false
            return true
        }
        if (mode != Mode.IDLE) return false
        mode = Mode.SYNC
        background = inBackground
        peerVector = record.optJSONObject("peerVector") ?: JSONObject()
        advertiseAndDiscover(record)
        return true
    }

    fun stopSync() {
        if (mode == Mode.SYNC) {
            stopAll()
            setPhase("off")
        }
    }

    /** For the background worker: one sync round. `done` fires a few seconds after the exchange. */
    fun runInBackground(done: () -> Unit): Boolean {
        if (mode != Mode.IDLE) return false
        onExchange = { main.postDelayed(done, 5000) }
        return startSync(true)
    }

    fun endBackgroundRun() {
        onExchange = null
        if (mode == Mode.SYNC && background) {
            stopAll()
            phase = "off"
        }
    }

    fun unpair() {
        stopAll()
        SecureStore.write(app, "pair", null)
        SecureStore.write(app, "inbox", null)
        SyncScheduler.cancel(app)
        setPhase("off")
    }

    /** Sends what the other phone lacks, right away, if it is connected. */
    fun pushNow() {
        if (mode == Mode.SYNC && endpoint != null) sendMissing()
    }

    fun sendSignal(name: String, data: JSONObject?): Boolean {
        if (mode != Mode.SYNC || endpoint == null) return false
        return sendSealed(JSONObject().put("kind", "signal").put("name", name).put("data", data ?: JSONObject()))
    }

    private fun advertiseAndDiscover(record: JSONObject) {
        val name = tag(record)
        client.startAdvertising(name, SERVICE_SYNC, lifecycle, AdvertisingOptions.Builder().setStrategy(strategy).build())
            .addOnFailureListener { Log.w(TAG, "sync advertise: ${it.message}") }
        client.startDiscovery(SERVICE_SYNC, discovery, DiscoveryOptions.Builder().setStrategy(strategy).build())
            .addOnFailureListener { Log.w(TAG, "sync discover: ${it.message}") }
        setPhase("searching")
    }

    private fun restartSync() {
        main.postDelayed({
            if (mode == Mode.SYNC && endpoint == null) {
                client.stopAdvertising()
                client.stopDiscovery()
                pair()?.let(::advertiseAndDiscover)
            }
        }, 3000)
    }

    private fun sendSealed(message: JSONObject): Boolean {
        val id = endpoint ?: return false
        val record = pair() ?: return false
        client.sendPayload(id, Payload.fromBytes(PairCrypto.seal(key(record), message.toString().toByteArray(Charsets.UTF_8), aad(record))))
        return true
    }

    /** This phone's log plus what waits in the inbox. */
    private fun allEvents(): List<JSONObject> {
        val list = ArrayList<JSONObject>()
        for (name in listOf("events", "inbox")) {
            val array = SecureStore.read(app, name)?.let { runCatching { JSONArray(it) }.getOrNull() } ?: continue
            for (i in 0 until array.length()) list.add(array.getJSONObject(i))
        }
        return list
    }

    private fun vector(): JSONObject {
        val vector = JSONObject()
        for (event in allEvents()) {
            val device = event.optString("deviceId")
            vector.put(device, maxOf(vector.optInt(device, 0), event.optInt("seq")))
        }
        return vector
    }

    private fun sendHello() {
        val record = pair() ?: return
        sendSealed(JSONObject().put("kind", "hello").put("deviceId", record.getString("myDevice")).put("vector", vector()))
    }

    private fun sendMissing() {
        val missing = allEvents().filter { event ->
            event.optString("layer") == "shared" && event.optInt("seq") > peerVector.optInt(event.optString("deviceId"), 0)
        }
        var batch = JSONArray()
        var size = 0
        for (event in missing) {
            val length = event.toString().length
            if (size + length > MAX_BATCH_CHARS && batch.length() > 0) {
                sendSealed(JSONObject().put("kind", "events").put("events", batch))
                batch = JSONArray()
                size = 0
            }
            batch.put(event)
            size += length
        }
        if (batch.length() > 0) sendSealed(JSONObject().put("kind", "events").put("events", batch))
        // Assume delivery; the next hello corrects us if something was lost.
        for (event in missing) {
            val device = event.optString("deviceId")
            peerVector.put(device, maxOf(peerVector.optInt(device, 0), event.optInt("seq")))
        }
        markSynced()
    }

    private fun markSynced() {
        val record = pair() ?: return
        record.put("lastSyncAt", Instant.now().toString()).put("peerVector", peerVector)
        savePair(record)
        setPhase(phase)
    }

    private fun handleSync(bytes: ByteArray) {
        val record = pair() ?: return
        val message = JSONObject(String(PairCrypto.open(key(record), bytes, aad(record)), Charsets.UTF_8))
        when (message.optString("kind")) {
            "hello" -> {
                peerVector = message.optJSONObject("vector") ?: JSONObject()
                sendMissing()
                onExchange?.invoke()
                onExchange = null
            }
            "events" -> {
                val incoming = message.optJSONArray("events") ?: JSONArray()
                val accepted = JSONArray()
                val myDevice = record.getString("myDevice")
                for (i in 0 until incoming.length()) {
                    val event = incoming.getJSONObject(i)
                    if (event.optString("layer") == "shared" && event.optString("deviceId") != myDevice) accepted.put(event)
                }
                val added = SecureStore.appendInbox(app, accepted)
                markSynced()
                if (added > 0) main.post { listener?.onInbox(added) }
            }
            "signal" -> {
                val name = message.optString("name")
                val data = message.optJSONObject("data")
                main.post { listener?.onSignal(name, data) }
            }
        }
    }

    // Nearby callbacks --------------------------------------------------------

    private val discovery = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(id: String, info: DiscoveredEndpointInfo) {
            when (mode) {
                Mode.JOIN -> {
                    val s = session ?: return
                    if (info.endpointName != "p:" + hex(s.pairId) || endpoint != null) return
                    client.stopDiscovery()
                    setPhase("connecting")
                    client.requestConnection("j:" + hex(s.pairId), id, lifecycle)
                        .addOnFailureListener { setPhase("error", "connect: ${it.message}") }
                }
                Mode.SYNC -> {
                    val record = pair() ?: return
                    if (info.endpointName != tag(record) || endpoint != null) return
                    // Only one side dials, so the two never cross.
                    if (record.getString("myDevice") >= record.getString("peerDevice")) return
                    setPhase("connecting")
                    client.requestConnection(tag(record), id, lifecycle).addOnFailureListener {
                        Log.w(TAG, "sync connect: ${it.message}")
                        restartSync()
                    }
                }
                else -> {}
            }
        }

        override fun onEndpointLost(id: String) {}
    }

    private val lifecycle = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(id: String, info: ConnectionInfo) {
            val accept = when (mode) {
                Mode.HOST -> endpoint == null && session?.let { info.endpointName == "j:" + hex(it.pairId) } == true
                Mode.JOIN -> endpoint == null
                Mode.SYNC -> endpoint == null && pair()?.let { info.endpointName == tag(it) } == true
                Mode.IDLE -> false
            }
            if (accept) client.acceptConnection(id, payloads) else client.rejectConnection(id)
        }

        override fun onConnectionResult(id: String, result: ConnectionResolution) {
            if (!result.status.isSuccess) {
                when (mode) {
                    Mode.SYNC -> restartSync()
                    Mode.JOIN -> setPhase("error", "connect: ${result.status.statusCode}")
                    else -> {}
                }
                return
            }
            endpoint = id
            when (mode) {
                Mode.HOST -> {
                    client.stopAdvertising()
                    setPhase("connected")
                }
                Mode.JOIN -> {
                    val s = session ?: return
                    sendPlain(JSONObject().put("t", "pair-hello").put("pub", b64(s.pub)).put("device", s.deviceId).put("me", s.me))
                    setPhase("connected")
                }
                Mode.SYNC -> {
                    client.stopAdvertising()
                    client.stopDiscovery()
                    setPhase("connected")
                    sendHello()
                }
                Mode.IDLE -> {}
            }
        }

        override fun onDisconnected(id: String) {
            if (id != endpoint) return
            endpoint = null
            when (mode) {
                Mode.SYNC -> {
                    setPhase("searching")
                    if (!background) restartSync()
                }
                Mode.HOST, Mode.JOIN -> if (session?.let { it.confirmedSelf && it.confirmedPeer } != true) {
                    stopAll()
                    setPhase("error", "disconnected")
                }
                Mode.IDLE -> {}
            }
        }
    }

    private val payloads = object : PayloadCallback() {
        override fun onPayloadReceived(id: String, payload: Payload) {
            val bytes = payload.asBytes() ?: return
            try {
                when (mode) {
                    Mode.HOST, Mode.JOIN -> handlePairing(bytes)
                    Mode.SYNC -> handleSync(bytes)
                    Mode.IDLE -> {}
                }
            } catch (e: Exception) {
                // Not sealed with our key, or malformed: not our partner's phone.
                Log.w(TAG, "dropped a message", e)
                if (mode == Mode.SYNC) client.disconnectFromEndpoint(id)
            }
        }

        override fun onPayloadTransferUpdate(id: String, update: PayloadTransferUpdate) {}
    }

    private fun stopAll() {
        if (!::app.isInitialized) return
        runCatching {
            client.stopAdvertising()
            client.stopDiscovery()
            client.stopAllEndpoints()
        }
        endpoint = null
        session = null
        mode = Mode.IDLE
        background = false
    }

    // Encoding ----------------------------------------------------------------

    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    private fun unb64(text: String) = Base64.decode(text, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
}
