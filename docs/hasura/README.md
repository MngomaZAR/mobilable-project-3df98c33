# Local Hasura demo (Quick start)

This folder provides a lightweight local Hasura + Postgres setup to prototype a Hasura migration and demo the `SocialFeed` GraphQL integration.

Prereqs
- Docker & docker-compose installed and running.

Start Hasura + Postgres

1. From the repo root run:

   ```bash
   docker-compose -f docker/hasura/docker-compose.yml up -d
   ```

2. Wait a few seconds for Postgres and Hasura to become healthy. Hasura console will be available at http://localhost:8080

Environment / Client config

- For a quick demo, set the following environment variables for Expo (or in `app.config.js` / shell):

  ```bash
  EXPO_PUBLIC_HASURA_URL=http://localhost:8080/v1/graphql
  EXPO_PUBLIC_HASURA_ANON_KEY=hasura_admin_secret
  ```

  Note: For demo purposes we reuse the Hasura admin secret as the client key. For production, set up proper JWT auth and a non-admin anonymous role.

Seeding
- The Docker Compose `postgres` service runs `docker/initdb` SQL on first startup which seeds demo `profiles` and `posts`.

Stop/Remove
- To stop: `docker-compose -f docker/hasura/docker-compose.yml down`

How to test
- Start your Expo dev server and open the app in the browser.
- With the env vars set, `SocialFeed` will prefer Hasura. You should see seeded demo posts from Hasura.

Next steps
- Replace `EXPO_PUBLIC_HASURA_ANON_KEY` with a non-admin JWT or configure Hasura permissions for the `anonymous` role for production-ready setup.
- Apply the repo SQL migrations to your production DB when ready.
