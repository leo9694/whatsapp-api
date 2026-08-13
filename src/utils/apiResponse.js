function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function error(res, code, message, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } });
}

module.exports = { success, error };
