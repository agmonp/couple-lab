package com.couplelab.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import org.json.JSONArray
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Small encrypted files in the app's private folder (plan §3.4): the event log,
 * the pair record with its key, and the inbox of events that arrived from the
 * other phone while the app was closed. The AES key lives in Android Keystore
 * and never leaves it.
 */
object SecureStore {
    private const val TAG = "CoupleStore"
    private const val ALIAS = "couplelab.store.v1"

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private fun file(context: Context, name: String) = File(File(context.filesDir, "secure").apply { mkdirs() }, "$name.bin")

    @Synchronized
    fun write(context: Context, name: String, text: String?) {
        val target = file(context, name)
        if (text == null) {
            target.delete()
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val body = cipher.iv + cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        // Write then rename, so a crash mid-write never leaves half a log.
        val tmp = File(target.parentFile, "${target.name}.tmp")
        tmp.writeBytes(body)
        if (!tmp.renameTo(target)) {
            target.delete()
            tmp.renameTo(target)
        }
    }

    @Synchronized
    fun read(context: Context, name: String): String? {
        val source = file(context, name)
        if (!source.exists()) return null
        return try {
            val bytes = source.readBytes()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12))
            String(cipher.doFinal(bytes, 12, bytes.size - 12), Charsets.UTF_8)
        } catch (e: Exception) {
            Log.w(TAG, "could not read $name", e)
            null
        }
    }

    /** Adds events to the inbox, skipping ids already waiting there. Returns how many were new. */
    @Synchronized
    fun appendInbox(context: Context, events: JSONArray): Int {
        val inbox = read(context, "inbox")?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()
        val ids = HashSet<String>()
        for (i in 0 until inbox.length()) ids.add(inbox.getJSONObject(i).optString("id"))
        var added = 0
        for (i in 0 until events.length()) {
            val event = events.getJSONObject(i)
            if (ids.add(event.optString("id"))) {
                inbox.put(event)
                added++
            }
        }
        if (added > 0) write(context, "inbox", inbox.toString())
        return added
    }

    /** The inbox as JSON, emptied in the same step. */
    @Synchronized
    fun drainInbox(context: Context): String {
        val text = read(context, "inbox") ?: "[]"
        write(context, "inbox", null)
        return text
    }
}
