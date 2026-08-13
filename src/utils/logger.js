function write(level, event, details = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  };

  const output = JSON.stringify(record);
  if (level === "error") {
    console.error(output);
    return;
  }

  if (level === "warn") {
    console.warn(output);
    return;
  }

  console.log(output);
}

module.exports = {
  info: (event, details) => write("info", event, details),
  warn: (event, details) => write("warn", event, details),
  error: (event, details) => write("error", event, details),
};
