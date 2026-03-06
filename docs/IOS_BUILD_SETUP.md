# iOS Build Setup

## One-time: Set up credentials (REQUIRED)

EAS needs Apple credentials stored before workflow/dashboard builds can run. **You must run this once from your terminal** (not from EAS dashboard):

### Option A: Credentials only (faster, ~2 min)
```bash
cd /workspace   # or your project root
npx eas-cli login
npx eas-cli credentials --platform ios
```
Then select: **Build credentials** → **Set up all the required credentials**

### Option B: Full build (credentials + build, ~15 min)
```bash
cd /workspace
npx eas-cli login
npx eas-cli build --platform ios --profile preview
```

When prompted:
- Choose **Let EAS manage your credentials**
- Sign in with your Apple ID when asked

After this completes once, workflow builds will use the stored credentials.

---

## Then: Use workflow builds

After credentials are set up, you can run iOS builds from:
- **EAS Dashboard** → Workflows → **Build iOS (Preview)**
- Or: `npm run eas:build:ios`

---

## App Store submission (later)

When ready to submit to the App Store:
1. Create the app in App Store Connect
2. Copy the **App ID** (numeric, e.g. 1234567890)
3. Add to `eas.json`:
```json
"submit": {
  "production": {
    "ios": {
      "ascAppId": "YOUR_APP_ID"
    }
  }
}
```
