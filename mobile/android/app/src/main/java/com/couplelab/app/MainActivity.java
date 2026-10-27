package com.couplelab.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CoupleNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Android 15+ forces edge-to-edge; doing it everywhere gives older phones the same layout
        // (the screen's own colour behind the bars, safe-area insets from CSS).
        WindowCompat.enableEdgeToEdge(getWindow());
    }
}
