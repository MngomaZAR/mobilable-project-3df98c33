import { supabase } from '../config/supabaseClient';

type StartConversationPayload = {
  participantId: string;
  title?: string;
};

type StartConversationResult = {
  id: string;
  title: string;
};

export const startConversationViaEdge = async ({
  participantId,
  title,
}: StartConversationPayload): Promise<StartConversationResult> => {
  const { data, error } = await supabase.functions.invoke('conversation-start', {
    body: {
      participant_id: participantId,
      title,
    },
  });

  if (error) {
    throw new Error(error.message || 'Unable to start a conversation right now.');
  }

  const conversationId = data?.id;
  const conversationTitle = data?.title;
  if (!conversationId || typeof conversationId !== 'string') {
    throw new Error('Chat service did not return a valid conversation ID.');
  }

  return {
    id: conversationId,
    title:
      typeof conversationTitle === 'string' && conversationTitle.length > 0
        ? conversationTitle
        : title || 'Conversation',
  };
};

