# হিসাব খাতা — Android app

A small native app (`app/src/main/java/com/krb/khata/MainActivity.java`) that shows
https://erp-psi-woad.vercel.app/khata/index.html in its own web view — no browser needed, so it opens on
every phone. It is the live site, so every website change shows in the app at once — no new APK needed.
PDFs from the site are saved to Download/HisabKhata through `window.KhataApp.saveFile`.

## Build a new APK (only needed if the site address, icon or name changes)
```bash
export ANDROID_HOME=/path/to/android-sdk            # platforms;android-36 + build-tools;36.0.0 (JDK 17+)
export KHATA_KEYSTORE=/path/to/khata-release.jks    # the owner's private key (NOT in git)
export KHATA_KEYSTORE_PASS=…                        # its password (owner has it)
cd android && gradle assembleRelease                # → app/build/outputs/apk/release/app-release.apk
```
Raise `versionCode` in app/build.gradle for every new APK. Always sign with the same key, or phones
can't update over the old app.
