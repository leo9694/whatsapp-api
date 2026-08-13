const MEDIA_RULES = {
  image: { maxBytes: 5 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png"] },
  audio: { maxBytes: 16 * 1024 * 1024, mimeTypes: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"] },
  video: { maxBytes: 16 * 1024 * 1024, mimeTypes: ["video/mp4", "video/3gpp"] },
  document: {
    maxBytes: 100 * 1024 * 1024,
    mimeTypes: [
      "text/plain", "application/pdf", "application/vnd.ms-powerpoint", "application/msword",
      "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  },
};

module.exports = { MEDIA_RULES };
