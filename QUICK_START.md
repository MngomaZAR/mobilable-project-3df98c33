# Quick Start

## 1) Install

```bash
npm install
```

## 2) Configure env

Copy `.env.example` to `.env` and set:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## 3) Start app

```bash
npm run start
```

Then open:

- Web: press `w`
- Android: press `a`
- iOS: press `i`

## 4) Launch verification

```bash
npm run check:launch
```

## 5) Manual smoke (must pass)

1. Auth: sign in
2. Home: filters + discovery cards render
3. Map: search + live online pill + markers render
4. Bookings: empty state auto-seeds sample rows for client
5. Chat: open conversation + send message
6. Profile: follow/tip/report actions open correctly

## 6) Export web build

```bash
npm run build:web
npm run preview:web
```
