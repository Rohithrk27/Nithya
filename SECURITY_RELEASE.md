# Nithya Secure Release and Distribution

## Official Distribution Policy

Official release channels for this project:

- GitHub Releases (direct distribution)
- Amazon Appstore
- Samsung Galaxy Store
- Huawei AppGallery
- Aptoide

Do not trust builds shared from chat apps, mirrors, or unknown drives.

## Build Policy

- Ship signed `release` artifacts only.
- Never distribute `debug` APKs.
- Keep package name constant across updates: `com.rohith.nithya`.
- Keep the same signing key for all updates across all stores.
- Keep signing key files private:
  - `android/app/*.jks`
  - `android/keystore.properties`

## Content Rating Policy

- Target age rating: `13+`.

## Permissions Policy

Nithya requests only the minimum required Android permissions:

- `android.permission.INTERNET`
- `android.permission.POST_NOTIFICATIONS`
- `android.permission.SCHEDULE_EXACT_ALARM` (optional strict reminder timing)

## HTTPS Policy

- Production endpoints must use HTTPS.
- Localhost HTTP is allowed only for local development.
- Client env validation script: `npm run security:env`

## Checksum Policy

- For each release artifact, publish SHA-256 values in:
  - `release-apk-files/SHA256SUMS.txt`
- Re-generate checksums with:
  - `npm run release:checksums`

## User Verification Steps

1. Download APK from the official GitHub Release only.
2. Compare file hash against `SHA256SUMS.txt`.
3. Install only if hashes match exactly.
