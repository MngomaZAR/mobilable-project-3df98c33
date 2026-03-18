# Xcode Cloud Setup (No EAS)

This project is Expo-managed and currently does not include a committed `ios/` directory from this Windows environment.  
To enable Xcode Cloud, do this once on a Mac with Xcode:

## 1) Generate native iOS project locally (once)

```bash
npm ci
npx expo prebuild --platform ios --clean
```

This creates `ios/` and the Xcode workspace/schemes Xcode Cloud needs.

## 2) Open workspace and create Xcode Cloud workflow

1. Open `ios/*.xcworkspace` in Xcode.
2. In Xcode: `Product` -> `Xcode Cloud` -> `Create Workflow`.
3. Choose repo/branch `main`.
4. Configure build action to archive for App Store distribution.
5. Enable TestFlight distribution in the workflow destination.

## 3) Use included CI script

This repo now includes:

- [ci_post_clone.sh](/C:/Users/27790/Downloads/papzii/ci_scripts/ci_post_clone.sh)

Xcode Cloud will run it automatically. It installs JS deps, regenerates iOS project, and installs CocoaPods before build.

## 4) App Store Connect requirements

Ensure in App Store Connect:

1. App record exists (`com.saicts.papzi`).
2. Certificates/profiles are valid.
3. Build number increments each upload.
4. TestFlight internal/external testers are configured.

## 5) Recommended trigger settings

- Start condition: on every commit to `main` (or manual while stabilizing).
- Parallel testing: keep minimal until stable, then expand device matrix.

