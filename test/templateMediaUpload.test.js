const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { prepareTemplateMedia } = require('../src/services/templateMedia.service');
const mediaService = require('../src/services/media.service');

function components(type = 'image', link = 'https://scontent.whatsapp.net/exemplo') {
  return [{ type: 'header', parameters: [{ type, [type]: { link } }] }, { type: 'body', parameters: [{ type: 'text', text: 'Promoção' }] }];
}

const fixtures = {
  image: { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  video: { mime: 'video/mp4', bytes: [0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0] },
  document: { mime: 'application/pdf', bytes: [...Buffer.from('%PDF-1.7\n')] }
};

for (const [type, fixture] of Object.entries(fixtures)) {
  test(`baixa ${type} do CDN, valida arquivo e envia por ID em vez do link de aprovação`, async () => {
    const original = components(type);
    let filePath;
    const result = await prepareTemplateMedia(original, 'phone-1', { cache: new Map(),
      fetch: async (_url, options) => {
        assert.equal(options.redirect, 'manual');
        return new Response(new Uint8Array(fixture.bytes), { headers: { 'content-type': fixture.mime } });
      },
      upload: async (file, kind, options) => {
        filePath = file.path;
        assert.equal(options.phoneNumberId, 'phone-1');
        return mediaService.upload(file, kind, { uploadMedia: async () => ({ id: '123456789' }) });
      } });
    assert.equal(result[0].parameters[0][type].id, '123456789');
    assert.equal(result[0].parameters[0][type].link, undefined);
    assert.ok(original[0].parameters[0][type].link);
    assert.equal(result[1], original[1]);
    await assert.rejects(fs.access(filePath));
  });
}

test('reutiliza upload concorrente no mesmo número e isola IDs entre números diferentes', async () => {
  let uploads = 0;
  const dependencies = { cache: new Map(),
    fetch: async () => new Response(new Uint8Array(fixtures.image.bytes), { headers: { 'content-type': 'image/png' } }),
    upload: async () => ({ mediaId: String(++uploads) }) };
  const [a, b] = await Promise.all([prepareTemplateMedia(components(), 'phone-a', dependencies), prepareTemplateMedia(components(), 'phone-a', dependencies)]);
  assert.equal(uploads, 1);
  assert.equal(a[0].parameters[0].image.id, b[0].parameters[0].image.id);
  const c = await prepareTemplateMedia(components(), 'phone-b', dependencies);
  assert.equal(uploads, 2);
  assert.notEqual(a[0].parameters[0].image.id, c[0].parameters[0].image.id);
});

test('falha 403 não mantém cache e não tenta upload nem envio de mensagem', async () => {
  const dependencies = { cache: new Map(), fetch: async () => new Response('Forbidden', { status: 403 }),
    upload: () => assert.fail('Não deve subir arquivo inacessível') };
  await assert.rejects(prepareTemplateMedia(components(), 'phone', dependencies), /Não foi possível obter a mídia/);
  assert.equal(dependencies.cache.size, 0);
});

test('não baixa URLs arbitrárias e bloqueia redirecionamento do CDN para rede interna', async () => {
  const external = components('image', 'https://example.com/foto.png');
  const untouched = await prepareTemplateMedia(external, 'phone', { fetch: () => assert.fail('Não deve baixar URL arbitrária') });
  assert.equal(untouched[0], external[0]);
  let calls = 0;
  await assert.rejects(prepareTemplateMedia(components(), 'phone', { cache: new Map(), fetch: async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
  } }), /endereço não permitido/);
  assert.equal(calls, 1);
});

test('rejeita MIME incorreto e limita tamanho declarado ou recebido durante o download', async () => {
  for (const response of [
    new Response('html', { headers: { 'content-type': 'text/html' } }),
    new Response(null, { headers: { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) } }),
    new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } })
  ]) {
    await assert.rejects(prepareTemplateMedia(components(), 'phone', { cache: new Map(), fetch: async () => response,
      upload: () => assert.fail('Não deve subir arquivo inválido') }), /formato do template|limite permitido|Não foi possível obter/);
  }
});

test('falha no upload remove arquivo temporário e permite nova tentativa sem cache envenenado', async () => {
  let filePath;
  const dependencies = { cache: new Map(),
    fetch: async () => new Response(new Uint8Array(fixtures.image.bytes), { headers: { 'content-type': 'image/png' } }),
    upload: async (file) => { filePath = file.path; throw new Error('falha simulada'); } };
  await assert.rejects(prepareTemplateMedia(components(), 'phone', dependencies), /Não foi possível preparar/);
  await assert.rejects(fs.access(filePath));
  assert.equal(dependencies.cache.size, 0);
});
