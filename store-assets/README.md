# Store Publishing Pack

This folder contains ready-to-use metadata and assets for:

- GitHub Releases (direct)
- Amazon Appstore
- Samsung Galaxy Store
- Huawei AppGallery
- Aptoide

## Fixed App Identity

- Package ID: `com.rohith.nithya`
- Version: `1.0` (code `1`)
- Target age: `13+`
- Signing: use the same keystore for every update

## Privacy Policy URL

Use:

- `https://nithya.fit/privacy-policy.html`

## Release Artifacts to Upload

- APK: `release-apk-files/app-release-signed-v1.0.apk`
- AAB: `release-apk-files/app-release-signed-v1.0.aab` (for stores that accept/require AAB)
- Checksums: `release-apk-files/SHA256SUMS.txt`

## Listing Content

- Shared listing copy: `common/listing-text.md`
- Age/content rating guidance: `common/content-rating-13plus.md`
- Store-specific checklists: `stores/*.md`

## Screenshots

- Final screenshot folder: `screenshots/android-phone`
- Standard names:
  - `01_navigation-menu.jpg`
  - `02_landing-screen.jpg`
  - `03_profile-stats.jpg`

Use the helper script to rename uploaded screenshots automatically:

```powershell
powershell -ExecutionPolicy Bypass -File tools/rename-store-screenshots.ps1
```
