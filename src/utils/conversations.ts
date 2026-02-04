import { AppState } from '../types';

export const PLACEHOLDER_AVATAR = 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=300&q=80';

export function getConversationDisplayInfo(item: { participants?: string[]; title?: string }, appState: AppState) {
  const currentUserId = appState.currentUser?.id;
  let displayTitle = item.title ?? 'Conversation';
  let avatarUrl = PLACEHOLDER_AVATAR;

  if ((!displayTitle || displayTitle === 'Conversation') && item.participants && item.participants.length === 2 && currentUserId) {
    const otherId = item.participants.find((id: string) => id !== currentUserId);
    if (otherId) {
      const found = appState.photographers.find((p) => p.id === otherId);
      if (found) {
        displayTitle = found.name;
        avatarUrl = found.avatar;
      }
    }
  }

  return { displayTitle, avatarUrl };
}
