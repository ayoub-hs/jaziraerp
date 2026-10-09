package com.jazira.erp;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.jazira.erp.printer.ErpSppPrinterPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ErpSppPrinterPlugin.class);
        registerPlugin(KeepScreenPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
