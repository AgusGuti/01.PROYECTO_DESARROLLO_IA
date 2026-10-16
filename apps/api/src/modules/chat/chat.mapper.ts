// Reply text -> response DTO.
import type { ChatDto } from './chat.schemas.js';

export function toChatDto(reply: string): ChatDto {
  return { reply };
}
