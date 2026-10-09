package com.jazira.erp;

import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native keep-screen-on plugin via WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON.
 * Avoids power manager WAKE_LOCK permission.
 */
@CapacitorPlugin(name = "KeepScreen")
public class KeepScreenPlugin extends Plugin {

    @PluginMethod
    public void keepOn(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                call.resolve();
            } catch (Exception e) {
                call.reject("Failed to set FLAG_KEEP_SCREEN_ON", e);
            }
        });
    }

    @PluginMethod
    public void allowSleep(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                call.resolve();
            } catch (Exception e) {
                call.reject("Failed to clear FLAG_KEEP_SCREEN_ON", e);
            }
        });
    }
}
