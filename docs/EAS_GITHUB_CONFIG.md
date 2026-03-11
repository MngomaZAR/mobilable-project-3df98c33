# EAS + GitHub Configuration Check

If iOS builds keep failing with "Credentials are not set up", check these:

## 1. Which EXPO_TOKEN are you using?

- Use a token from **your user account** (mavzar): https://expo.dev/settings/access-tokens
- Do NOT use the "GitHub App" / "PAPP" robot token for GitHub Actions
- The user token has full access to your project and its credentials

## 2. EAS Project Settings → GitHub

Go to: **expo.dev** → Your project → **Project settings** → **GitHub**

- If "Build from GitHub" is connected, pushes may trigger **EAS Workflows** (run on Expo servers)
- Those builds might use a different auth context than your GitHub Actions
- **Option A:** Disconnect GitHub here and use only the GitHub Actions workflow (`.github/workflows/eas-build-ios.yml`) — this uses your EXPO_TOKEN explicitly
- **Option B:** Keep connected but ensure the linked account is **mavzar** (the account where you ran `eas credentials`)

## 3. Production vs Preview credentials

- **Production** = App Store. Needs App Store Connect setup.
- **Preview** = Internal/TestFlight. Uses ad hoc distribution.

When you ran `eas credentials --platform ios`, which profile did you configure? Credentials are **per profile**. If you set up "preview" but the build uses "production", it will fail.

The new GitHub Actions workflow (`.github/workflows/eas-build-ios.yml`) uses **preview** profile.

## 4. Run the GitHub Actions workflow

1. Go to: https://github.com/MngomaZAR/mobilable-project-3df98c33/actions
2. Select **EAS Build iOS**
3. Click **Run workflow** → **Run workflow**

This uses your EXPO_TOKEN from secrets and runs `eas build --platform ios --profile preview`.
