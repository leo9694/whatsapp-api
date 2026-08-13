const MEDIA_TYPES = new Set(["image", "document", "audio", "video", "sticker"]);

function toMessageDto(message) {
  if (!message) return message;
  const dto = { ...message };
  if (MEDIA_TYPES.has(message.type) && message.mediaId) {
    dto.media = {
      mediaId: message.mediaId,
      mimeType: message.mimeType || null,
      filename: message.filename || null,
      caption: message.caption || null,
      sha256: message.mediaSha256 || null,
      voice: message.voice ?? null,
      durationSeconds: message.durationSeconds || null,
      url: `/api/media/${encodeURIComponent(message.mediaId)}`,
    };
  }
  delete dto.mediaUrl;
  return dto;
}

module.exports = { toMessageDto };
