// ============================================================
// FILE: src/utils/conversations.ts  
// COMPLETE REPLACEMENT
// BUG FIX: Was only checking photographers[] for display name.
// Now checks profiles[], photographers[], and models[].
// ============================================================

import { AppState } from '../types';

export const PLACEHOLDER_AVATAR =
  'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=300&q=80';

export function getConversationDisplayInfo(
  item: { participants?: string[]; title?: string; participant?: { id: string; name: string; avatar_url: string } },
  appState: AppState
) {
  const currentUserId = appState.currentUser?.id;

  // If the conversation already has a resolved participant object, use it directly
  if (item.participant?.name) {
    return {
      displayTitle: item.participant.name,
      avatarUrl: item.participant.avatar_url || PLACEHOLDER_AVATAR,
    };
  }

  let displayTitle = item.title ?? 'Conversation';
  let avatarUrl = PLACEHOLDER_AVATAR;

  // Try to resolve from participants array
  if (item.participants && item.participants.length >= 2 && currentUserId) {
    const otherId = item.participants.find((id: string) => id !== currentUserId);

    if (otherId) {
      // BUG FIX: Check all three sources, not just photographers
      
      // 1. Check photographers
      const photographer = appState.photographers.find((p) => p.id === otherId);
      if (photographer) {
        return {
          displayTitle: photographer.name || displayTitle,
          avatarUrl: photographer.avatar_url || PLACEHOLDER_AVATAR,
        };
      }

      // 2. Check models
      const model = appState.models?.find((m) => m.id === otherId);
      if (model) {
        return {
          displayTitle: model.name || displayTitle,
          avatarUrl: model.avatar_url || PLACEHOLDER_AVATAR,
        };
      }

      // 3. Check profiles (all users)
      const profile = appState.profiles?.find((p) => p.id === otherId);
      if (profile) {
        return {
          displayTitle: profile.full_name || displayTitle,
          avatarUrl: profile.avatar_url || PLACEHOLDER_AVATAR,
        };
      }
    }
  }

  return { displayTitle, avatarUrl };
}
