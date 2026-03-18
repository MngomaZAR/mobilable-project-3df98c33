# iOS TestFlight Upload Without EAS

This repo now includes:

- [ios-testflight-no-eas.yml](/C:/Users/27790/Downloads/papzii/.github/workflows/ios-testflight-no-eas.yml)

It builds and uploads iOS to TestFlight directly from GitHub Actions, without EAS.

## Required GitHub Secrets

Set these in `GitHub -> Settings -> Secrets and variables -> Actions`:

1. `APPLE_API_KEY_ID`
2. `APPLE_API_ISSUER_ID`
3. `APPLE_API_KEY_P8_BASE64`
4. `APPLE_TEAM_ID`

## How To Create `APPLE_API_KEY_P8_BASE64`

On your machine:

```bash
base64 -i AuthKey_<KEY_ID>.p8 | tr -d '\n'
```

Use the output as the secret value.

## Run It

1. Open `Actions`.
2. Select `iOS TestFlight (No EAS)`.
3. Click `Run workflow`.

It will:

1. Prebuild iOS from Expo
2. Archive with Xcode
3. Export IPA
4. Upload to TestFlight using App Store Connect API key

## Notes

- This uses Apple signing/provisioning via API key and `-allowProvisioningUpdates`.
- If Apple rejects signing due account/policy restrictions, the workflow log will show the exact signing error for adjustment.
