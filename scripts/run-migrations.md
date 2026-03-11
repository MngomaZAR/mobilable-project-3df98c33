# Run Migrations from Terminal

The project is set up to run Supabase migrations from the terminal. You need to **link** the CLI to your remote project once (requires your database password), then you can push migrations anytime.

## One-time setup

### 1. Log in to Supabase CLI
```bash
npm run supabase:login
```
This opens your browser to authenticate with Supabase.

### 2. Link to your project
```bash
npm run supabase:link
```
When prompted for **Database password**, use the password from:
**Supabase Dashboard → Settings → Database → Database password**  
(If you don’t have it, you can reset it there.)

After this, the CLI remembers the project; you don’t need to link again unless you change project or machine.

## Run migrations (including Realtime)

```bash
npm run db:migrate
```
Or:
```bash
npm run supabase:push
```

This applies all pending migrations in order, including:
- `20260106114637_reset_schema.sql` – tables, RLS, `recommend_posts`
- `20260203000000_posts_profiles_fk_and_feed_policies.sql` – posts→profiles FK, profiles public read
- `20260203000001_enable_realtime_posts.sql` – **enables Realtime for the `posts` table**

So **Realtime for `posts` is enabled automatically** when you run `npm run db:migrate`.

## Troubleshooting

- **"Cannot find project ref. Have you run supabase link?"**  
  Run `npm run supabase:link` and enter your database password.

- **"Invalid database password"**  
  Use (or reset) the password from **Settings → Database** in the Supabase Dashboard.

- **Node / npx issues**  
  Supabase CLI needs Node 20+. Use `node -v` to check. If needed, install the CLI globally:  
  `npm install -g supabase`  
  Then use `supabase login`, `supabase link ...`, `supabase db push` instead of the npm scripts.
