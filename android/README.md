# হিসাব খাতা — Android app

A small Trusted Web Activity: it opens https://erp-psi-woad.vercel.app/khata/index.html full screen
(the live site, so every website change shows in the app at once — no new APK needed).
`public/.well-known/assetlinks.json` holds the signing key's SHA-256 so Android hides the browser bar.
No Chrome on the phone → it falls back to a built-in web view.

## Build a new APK (only needed if the site address, icon or name changes)
```bash
export ANDROID_HOME=/path/to/android-sdk            # platforms;android-36 + build-tools;36.0.0
export KHATA_KEYSTORE=/path/to/khata-release.jks    # the owner's private key (NOT in git)
export KHATA_KEYSTORE_PASS=…                        # its password (owner has it)
cd android && gradle assembleRelease                # → app/build/outputs/apk/release/app-release.apk
```
Raise `versionCode` in app/build.gradle for every new APK. Always sign with the same key, or phones
can't update over the old app (and the browser bar comes back).
