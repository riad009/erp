package com.krb.khata;

import android.content.pm.ActivityInfo;
import android.os.Bundle;

/** Opens the app (same as Google's Bubblewrap template). */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The see-through start screen must not lock the orientation: that crashes Android 8.0 and older.
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }
}
