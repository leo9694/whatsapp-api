function parseFrontendUrls(raw = process.env.FRONTEND_URLS) {
  if (!raw?.trim()) return [];

  const value = raw.trim();
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
    } catch {
      return value.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean);
    }
  }

  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function createCorsOptions() {
  const allowedOrigins = parseFrontendUrls();
  return {
    credentials: false,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      const error = new Error("Origem não permitida.");
      error.status = 403;
      return callback(error);
    },
  };
}

module.exports = { parseFrontendUrls, createCorsOptions };
