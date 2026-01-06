# Feed & Chat Review

## FeedScreen / SocialFeed

1. **Pull-to-refresh crashes because the handler calls an undefined function**  
   - Code: `src/components/SocialFeed.tsx:255-263`.  
   - Issue: `onRefresh` invokes `loadFeed()` which is never declared, so the first refresh gesture throws a `ReferenceError` and leaves the `refreshing` flag stuck `true`. Users cannot manually reload the feed.  
   - Recommendation: Extract the hydration logic that currently lives inside the `useEffect` into a reusable `loadFeed` callback (e.g., call `fetchProfiles()` on the first run and `fetchPosts({ reset: true })` thereafter), and wire both the effect and the `RefreshControl` to that function so it actually reloads data.

2. **Pagination state is never wired to the UI, so only the first page of posts ever loads**  
   - Code: `src/components/SocialFeed.tsx:55-139`.  
   - Issue: The component tracks `loadingMore`, `hasMore`, and `paginationOffsetRef`, and `fetchPosts` computes proper ranges, but the rendered `FlatList` never uses `onEndReached`, `ListFooterComponent`, or the `loadingMore/hasMore` booleans. Users see a scrollable feed but pagination never triggers, so Supabase queries beyond the initial `.range(0, INITIAL_LOAD_COUNT - 1)` are impossible and `setHasMore` is effectively dead state.  
   - Recommendation: Add `onEndReached`/`onEndReachedThreshold` handlers that check `hasMore` before calling `fetchPosts({ reset: false })`, flip `loadingMore` appropriately, and render a small footer spinner to signal background fetching. Otherwise remove the unused state to avoid misleading future contributors.

## ChatScreen / AppDataContext

1. **ChatScreen depends on `state.conversations`, but the app state never defines or hydrates that collection**  
   - Code: `src/screens/ChatScreen.tsx:17`.  
   - Issue: `conversationId` falls back to `state.conversations[0]?.id`, yet `AppState` (`src/types/index.ts:76-84`) and `initialState` (`src/data/initialData.ts:3-54`) have no `conversations` array. Invoking `state.conversations[0]` therefore throws when the route omits `conversationId`.  
   - Recommendation: Either make `ChatThread` a strictly param-driven screen (require `route.params.conversationId` and remove the fallback) or extend `AppState`/`initialState` to include a `conversations` slice that mirrors the Supabase `conversations` table.

2. **Message shape mismatch keeps every thread empty**  
   - Code: `src/screens/ChatScreen.tsx:18-20`, `src/data/initialData.ts:23-51`, `src/types/index.ts:43-51`.  
   - Issue: The UI filters messages with `message.conversationId`, but both the TypeScript type and seeded data use the `chatId` field. None of the seeded messages (or anything stored via `addPost`) include `conversationId`, so `FlatList` always receives an empty array.  
   - Recommendation: Settle on a single key (prefer `chatId` to align with the Supabase `messages.chat_id` column) and update ChatScreen, the `Message` type, the seed data, and any selectors/senders accordingly.

3. **`sendMessage` mutates non-existent state and never persists to Supabase**  
   - Code: `src/store/AppDataContext.tsx:323-339`.  
   - Issue: The helper pushes a message with a `conversationId` property into local state and tries to update `prev.conversations.map` even though `prev.conversations` does not exist, which will throw the first time a message is sent. Moreover, no Supabase `messages` insert occurs, so the Supabase-backed `ConversationsListScreen` can never reflect new activity.  
   - Recommendation: Replace the local-only mutation with a proper Supabase write (e.g., `supabase.from('messages').insert({ chat_id: conversationId, body: text, sender_id: currentUser.id })`) and rely on Realtime or a refetch to update the UI. If you still need an optimistic UI, ensure `AppState` actually stores `conversations` before mutating it and normalize on the `chatId` key mentioned above.

4. **Screens pull from completely different data sources**  
   - Code: `src/screens/ConversationsListScreen.tsx:56-132` vs. `src/screens/ChatScreen.tsx:17-65`.  
   - Issue: The list screen fetches Supabase `conversations`, but ChatScreen renders from the local `AppDataContext` store. Opening a conversation that was fetched from the backend yields an empty thread because the store never hydrates those messages, and messages composed in ChatScreen never hit Supabase, so returning to the list doesn’t update `last_message`.  
   - Recommendation: Choose one flow—either hydrate the store from Supabase (`select * from messages where chat_id = :conversationId` + realtime subscription) or keep everything local. Given the presence of migrations/tables, the fix should be to fetch messages from Supabase when ChatScreen mounts, subscribe to `postgres_changes` for live updates, and remove the stale local-only mock data once tests pass.
