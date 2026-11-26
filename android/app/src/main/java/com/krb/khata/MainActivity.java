package com.krb.khata;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;

/**
 * হিসাব খাতা: the live site in the app's own web view (no browser in between, so it opens on every phone).
 * Login, saved data and the offline helper live in the web view and stay between openings.
 */
public class MainActivity extends Activity {
    static final String HOST = "erp-psi-woad.vercel.app";
    static final String START = "https://" + HOST + "/khata/index.html";
    static final int BLUE = Color.parseColor("#1F4AA8");
    static final int PICK_FILE = 7;
    static final int TAKE_PHOTO = 8;

    private WebView web;
    private View statusBg;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;      // 📷 the photo the camera app is writing
    private File cameraFile;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        statusBg = new View(this);
        statusBg.setBackgroundColor(BLUE);
        root.addView(statusBg, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0));
        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        fitBars(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(100);   // the app's own sizes, even with a big phone font
        s.setUserAgentString(s.getUserAgentString() + " KhataAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.addJavascriptInterface(new Bridge(), "KhataApp");
        cleanCache();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())) return false;
                openOutside(u);   // other sites, phone, WhatsApp … → their own app
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                // first opening ever with no internet (later the offline helper has a copy)
                if (r.isForMainFrame()) v.loadDataWithBaseURL(START, OFFLINE, "text/html", "utf-8", START);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                // 📷 ছবি তুলুন (<input capture>): open the camera itself — the plain file picker has no camera on most phones
                if (p.isCaptureEnabled() && wantsImages(p)) {
                    try {
                        File dir = new File(getCacheDir(), "camera");
                        if (!dir.exists() && !dir.mkdirs()) throw new Exception("no dir");
                        cameraFile = new File(dir, "photo-" + System.currentTimeMillis() + ".jpg");
                        cameraUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", cameraFile);
                        Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, cameraUri)
                                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivityForResult(cam, TAKE_PHOTO);
                        return true;
                    } catch (Exception e) {
                        cameraUri = null; cameraFile = null;   // no camera app → the normal picker below
                    }
                }
                try {
                    Intent pick = p.createIntent();
                    // 🖼 গ্যালারি: several vouchers at once
                    if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(pick, PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(linkOr(getIntent()));
    }

    // Android 15+ draws the app under the status / navigation bars: keep the page clear of them
    private void fitBars(View root) {
        if (Build.VERSION.SDK_INT < 30) {
            getWindow().setStatusBarColor(BLUE);
            return;
        }
        getWindow().setDecorFitsSystemWindows(false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        WindowInsetsController c = getWindow().getInsetsController();
        if (c != null) c.setSystemBarsAppearance(WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        root.setOnApplyWindowInsetsListener((v, in) -> {
            android.graphics.Insets bars = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = in.getInsets(WindowInsets.Type.ime());
            ViewGroup.LayoutParams lp = statusBg.getLayoutParams();
            lp.height = bars.top;
            statusBg.setLayoutParams(lp);
            v.setPadding(bars.left, 0, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsets.CONSUMED;
        });
    }

    private String linkOr(Intent i) {
        Uri u = i == null ? null : i.getData();
        return u != null && HOST.equals(u.getHost()) ? u.toString() : START;
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (i.getData() != null) web.loadUrl(linkOr(i));
    }

    // back: first close an open pop-up in the page, then page history, then leave the app open in the background
    private void back() {
        web.evaluateJavascript("window.__appBack ? String(window.__appBack()) : 'false'", res -> {
            if ("\"true\"".equals(res)) return;
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        back();
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    static boolean wantsImages(WebChromeClient.FileChooserParams p) {
        String[] types = p.getAcceptTypes();
        if (types == null || types.length == 0) return true;
        for (String t : types) if (t == null || t.isEmpty() || t.startsWith("image") || t.equals("*/*")) return true;
        return false;
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (fileCallback == null || (req != PICK_FILE && req != TAKE_PHOTO)) return;
        Uri[] out = null;
        if (req == TAKE_PHOTO) {
            if (res == RESULT_OK && cameraUri != null && cameraFile != null && cameraFile.length() > 0) out = new Uri[]{cameraUri};
            cameraUri = null; cameraFile = null;
        } else if (res == RESULT_OK && data != null) {
            ClipData many = data.getClipData();   // several pictures picked
            if (many != null && many.getItemCount() > 0) {
                out = new Uri[many.getItemCount()];
                for (int k = 0; k < out.length; k++) out[k] = many.getItemAt(k).getUri();
            } else if (data.getData() != null) out = new Uri[]{data.getData()};
        }
        fileCallback.onReceiveValue(out);
        fileCallback = null;
    }

    // old camera photos / shared pictures (older than 2 days) are removed so the app doesn't grow
    void cleanCache() {
        long old = System.currentTimeMillis() - 2L * 24 * 3600 * 1000;
        for (String d : new String[]{"camera", "share", "print"}) {
            File[] fs = new File(getCacheDir(), d).listFiles();
            if (fs != null) for (File f : fs) if (f.lastModified() < old) f.delete();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();   // keep the login
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /** window.KhataApp in the page: PDF (and other files) → the phone's Download folder, then open it. */
    class Bridge {
        @JavascriptInterface
        public boolean saveFile(String base64, String name, String mime) {
            return store(base64, name, mime, true);
        }

        /** the same, without opening each file (many vouchers at once); the page shows one message */
        @JavascriptInterface
        public boolean saveFileQuiet(String base64, String name, String mime) {
            return store(base64, name, mime, false);
        }

        boolean store(String base64, String name, String mime, boolean openIt) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                Uri uri;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/HisabKhata");
                    uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) return false;
                    try (OutputStream o = getContentResolver().openOutputStream(uri)) { o.write(bytes); }
                } else {
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "HisabKhata");
                    if (!dir.exists() && !dir.mkdirs()) return false;
                    File f = new File(dir, safe);
                    try (OutputStream o = new FileOutputStream(f)) { o.write(bytes); }
                    uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                }
                final Uri open = uri;
                if (!openIt) return true;
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, "✓ সেভ হয়েছে: Download/HisabKhata/" + safe, Toast.LENGTH_LONG).show();
                    Intent v = new Intent(Intent.ACTION_VIEW).setDataAndType(open, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try { startActivity(v); } catch (ActivityNotFoundException ignored) { }
                });
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /** window.KhataApp.shareWhatsApp(base64, name, mime, phone): opens that number's WhatsApp chat with the file attached. */
        @JavascriptInterface
        public boolean shareWhatsApp(String base64, String name, String mime, String phone) {
            try {
                ArrayList<Uri> one = new ArrayList<>();
                one.add(shareUri(base64, name));
                openWhatsApp(one, mime, phone);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /** 🖨 window.KhataApp.printPdf(base64, name): the phone's print screen with this PDF (pick the printer, e.g. the shop's HP on the same Wi-Fi). */
        @JavascriptInterface
        public boolean printPdf(String base64, String name) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                File dir = new File(getCacheDir(), "print");
                if (!dir.exists() && !dir.mkdirs()) return false;
                final File f = new File(dir, "print-" + System.currentTimeMillis() + ".pdf");
                try (OutputStream o = new FileOutputStream(f)) { o.write(bytes); }
                final String job = (name == null || name.isEmpty() ? "হিসাব খাতা" : name).replaceAll("\\.pdf$", "");
                runOnUiThread(() -> {
                    PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                    if (pm == null) return;
                    pm.print(job, new PrintDocumentAdapter() {
                        @Override
                        public void onLayout(PrintAttributes oldA, PrintAttributes newA, CancellationSignal cancel, LayoutResultCallback cb, Bundle extras) {
                            if (cancel.isCanceled()) { cb.onLayoutCancelled(); return; }
                            cb.onLayoutFinished(new PrintDocumentInfo.Builder(job + ".pdf").setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true);
                        }
                        @Override
                        public void onWrite(PageRange[] pages, ParcelFileDescriptor dest, CancellationSignal cancel, WriteResultCallback cb) {
                            try (InputStream in = new FileInputStream(f); OutputStream out = new FileOutputStream(dest.getFileDescriptor())) {
                                byte[] buf = new byte[16384]; int n;
                                while ((n = in.read(buf)) > 0) { if (cancel.isCanceled()) { cb.onWriteCancelled(); return; } out.write(buf, 0, n); }
                                cb.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
                            } catch (Exception e) {
                                cb.onWriteFailed(e.getMessage());
                            }
                        }
                    }, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                });
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        // several vouchers in one go: addShareFile(...) for each, then shareWhatsAppFiles(mime, phone) ('' = WhatsApp's own chat list)
        private final ArrayList<Uri> staged = new ArrayList<>();

        @JavascriptInterface
        public void clearShareFiles() {
            synchronized (staged) { staged.clear(); }
        }

        @JavascriptInterface
        public boolean addShareFile(String base64, String name) {
            try {
                Uri u = shareUri(base64, name);
                synchronized (staged) { staged.add(u); }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean shareWhatsAppFiles(String mime, String phone) {
            ArrayList<Uri> list;
            synchronized (staged) { list = new ArrayList<>(staged); staged.clear(); }
            if (list.isEmpty()) return false;
            openWhatsApp(list, mime, phone);
            return true;
        }

        Uri shareUri(String base64, String name) throws Exception {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            File dir = new File(getCacheDir(), "share");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("no dir");
            File f = new File(dir, name.replaceAll("[\\\\/:*?\"<>|]", "_"));
            try (OutputStream o = new FileOutputStream(f)) { o.write(bytes); }
            return FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
        }

        void openWhatsApp(ArrayList<Uri> uris, String mime, String phone) {
            final String digits = phone == null ? "" : phone.replaceAll("[^0-9]", "");
            runOnUiThread(() -> {
                Intent send = uris.size() == 1
                        ? new Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris.get(0))
                        : new Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
                send.setType(mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                if (!digits.isEmpty()) send.putExtra("jid", digits + "@s.whatsapp.net");   // that person's chat; none = WhatsApp's chat list
                for (String pkg : WHATSAPP) {
                    try { startActivity(new Intent(send).setPackage(pkg)); return; } catch (ActivityNotFoundException ignored) { }
                }
                try { startActivity(Intent.createChooser(send, "পাঠান")); } catch (ActivityNotFoundException ignored) { }   // no WhatsApp on this phone
            });
        }
    }

    // (inside Bridge, below) 📲 a voucher picture straight into one WhatsApp chat — the user only taps Send
    static final String[] WHATSAPP = {"com.whatsapp", "com.whatsapp.w4b"};

    static final String OFFLINE = "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<body style='font-family:sans-serif;text-align:center;padding:60px 20px;color:#1B2347'>"
            + "<h2>📴 ইন্টারনেট নেই</h2><p>প্রথমবার খুলতে ইন্টারনেট লাগবে।</p>"
            + "<button onclick=\"location.href='" + START + "'\" style='padding:12px 22px;font-size:16px;border:0;border-radius:10px;background:#1F4AA8;color:#fff'>আবার চেষ্টা করুন</button></body>";
}
