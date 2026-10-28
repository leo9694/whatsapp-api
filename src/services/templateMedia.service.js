const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const AppError = require('../utils/AppError');
const mediaService = require('./media.service');
const { MEDIA_RULES } = require('../config/media');

const uploaded = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function metaMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && (url.hostname === 'scontent.whatsapp.net' || url.hostname.endsWith('.fbcdn.net') || url.hostname === 'lookaside.fbsbx.com');
  } catch { return false; }
}

async function uploadFromMeta(link, type, phoneNumberId, dependencies) {
  const fetchMedia = dependencies.fetch || global.fetch;
  const upload = dependencies.upload || mediaService.upload;
  let directory;
  let file;
  let handle;
  let response;
  try {
    let url = link;
    const signal = AbortSignal.timeout(30000);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (!metaMediaUrl(url)) throw new AppError('A mídia do modelo redirecionou para um endereço não permitido.', 400);
      response = await fetchMedia(url, { redirect: 'manual', signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new AppError('Redirecionamento inválido na mídia do modelo.', 400);
      url = new URL(location, url).href;
    }
    if (!response.ok || !response.body) throw new AppError('Não foi possível obter a mídia cadastrada no modelo. Atualize o template ou informe outro link acessível.', 400);
    const mime = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    const rule = MEDIA_RULES[type];
    if (!rule?.mimeTypes.includes(mime) || (type === 'document' && mime !== 'application/pdf')) {
      throw new AppError('A mídia cadastrada não corresponde ao formato do template.', 415);
    }
    if (Number(response.headers.get('content-length') || 0) > rule.maxBytes) throw new AppError('Mídia do template excede o limite permitido.', 413);
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ns-template-'));
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf' }[mime];
    file = { path: path.join(directory, `template.${extension}`), originalname: `template.${extension}`, mimetype: mime, size: 0 };
    handle = await fs.open(file.path, 'wx', 0o600);
    for await (const chunk of response.body) {
      file.size += chunk.length;
      if (file.size > rule.maxBytes) throw new AppError('Mídia do template excede o limite permitido.', 413);
      for (let offset = 0; offset < chunk.length;) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
        if (!bytesWritten) throw new Error('Falha ao gravar a mídia temporária');
        offset += bytesWritten;
      }
    }
    await handle.close();
    handle = null;
    const result = await upload(file, type, { phoneNumberId });
    if (!result?.mediaId) throw new AppError('A Meta não retornou o ID da mídia do template.', 502);
    return result.mediaId;
  } catch (error) {
    if (error instanceof AppError || error.name === 'MetaApiError') throw error;
    throw new AppError('Não foi possível preparar a mídia do template. Verifique o arquivo e tente novamente.', 502);
  } finally {
    await handle?.close().catch(() => {});
    await response?.body?.cancel().catch(() => {});
    await mediaService.cleanupUpload(file);
    if (directory) await fs.rmdir(directory).catch(() => {});
  }
}

async function prepareTemplateMedia(components, phoneNumberId, dependencies = {}) {
  const cache = dependencies.cache || uploaded;
  return Promise.all(components.map(async (component) => {
    if (String(component.type).toLowerCase() !== 'header') return component;
    const parameter = component.parameters?.[0];
    const type = parameter?.type;
    const media = parameter?.[type];
    if (!['image', 'video', 'document'].includes(type) || !media?.link || !metaMediaUrl(media.link)) return component;
    const key = JSON.stringify([phoneNumberId, type, media.link]);
    let entry = cache.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      entry = { expiresAt: Date.now() + CACHE_TTL, promise: uploadFromMeta(media.link, type, phoneNumberId, dependencies) };
      cache.set(key, entry);
      while (cache.size > 100) cache.delete(cache.keys().next().value);
    }
    let id;
    try { id = await entry.promise; }
    catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
    return { ...component, parameters: [{ ...parameter, [type]: { id, ...(media.filename ? { filename: media.filename } : {}) } }] };
  }));
}

module.exports = { prepareTemplateMedia };
