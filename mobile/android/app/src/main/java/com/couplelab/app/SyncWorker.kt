package com.couplelab.app

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Background sync (plan §3.3): every 15 minutes or so, look for the other phone
 * for up to 90 seconds and exchange what is missing. It meets the other phone
 * only if that one is looking at the same moment, which mostly means its app is
 * open; opening the app stays the main way to sync. Arrivals wait in the inbox.
 */
class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        PairLink.init(applicationContext)
        if (PairLink.pair() == null || !PairLink.hasPermissions(applicationContext)) return Result.success()
        val done = CountDownLatch(1)
        if (!PairLink.runInBackground { done.countDown() }) return Result.success()
        done.await(90, TimeUnit.SECONDS)
        PairLink.endBackgroundRun()
        return Result.success()
    }
}

object SyncScheduler {
    private const val NAME = "couplelab-sync"

    fun schedule(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).build()
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(NAME)
    }
}
