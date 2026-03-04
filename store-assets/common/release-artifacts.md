# Release Artifacts and Integrity

## Upload Files

- Signed APK: `release-apk-files/app-release-signed-v1.0.apk`
- Signed AAB: `release-apk-files/app-release-signed-v1.0.aab`
- Upload certificate: `release-apk-files/upload_certificate.pem`
- SHA-256 file: `release-apk-files/SHA256SUMS.txt`

## Checksum Rule

Regenerate checksums for every release:

```bash
npm run release:checksums
```

Publish `SHA256SUMS.txt` with each release.
