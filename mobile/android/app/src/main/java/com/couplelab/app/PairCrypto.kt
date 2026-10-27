package com.couplelab.app

import com.google.crypto.tink.subtle.X25519
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The pair key (docs/ANDROID_APP_PLAN.md §3.3): X25519 between the two phones,
 * HKDF-SHA256 down to one AES-256 key, and AES-GCM on every message on top of
 * Nearby's own encryption. The short code both screens show is a hash of both
 * public keys, so a third phone that slipped in between would show other digits.
 */
object PairCrypto {
    private val random = SecureRandom()

    /** (private, public), 32 bytes each. */
    fun newKeyPair(): Pair<ByteArray, ByteArray> {
        val priv = X25519.generatePrivateKey()
        return priv to X25519.publicFromPrivate(priv)
    }

    fun deriveKey(priv: ByteArray, peerPub: ByteArray, pairId: ByteArray, hostPub: ByteArray, joinPub: ByteArray): ByteArray {
        val shared = X25519.computeSharedSecret(priv, peerPub)
        // HKDF with a single 32-byte block: extract with the pair id as salt, expand with both keys as info.
        val prk = hmac(pairId, shared)
        return hmac(prk, "couplelab pair v1".toByteArray() + hostPub + joinPub + byteArrayOf(1))
    }

    /** Four digits both phones show; equal only if both hold the same two public keys. */
    fun sas(hostPub: ByteArray, joinPub: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest("couplelab sas v1".toByteArray() + hostPub + joinPub)
        val n = ByteBuffer.wrap(digest).int.toLong() and 0xffffffffL
        return "%04d".format(n % 10000)
    }

    fun hmac(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }

    /** nonce (12) + ciphertext and tag. */
    fun seal(key: ByteArray, plain: ByteArray, aad: ByteArray): ByteArray {
        val iv = ByteArray(12).also(random::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(aad)
        return iv + cipher.doFinal(plain)
    }

    /** Throws if the message was not sealed with this key (another couple, or tampered). */
    fun open(key: ByteArray, blob: ByteArray, aad: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, blob, 0, 12))
        cipher.updateAAD(aad)
        return cipher.doFinal(blob, 12, blob.size - 12)
    }
}
