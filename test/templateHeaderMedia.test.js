const test = require('node:test');
const assert = require('node:assert/strict');
const templates = require('../src/services/template.service');
const conversations = require('../src/services/conversation.service');
const { createFakePrisma } = require('./helpers/fakePrisma');

function modelo(format, examples = ['https://scontent.whatsapp.net/modelo.jpg']) {
  return templates.normalizeTemplate({ name: 'promocao_syngenta', language: 'pt_BR', status: 'APPROVED',
    components: [{ type: 'HEADER', format, example: { header_handle: examples } }, { type: 'BODY', text: 'Promoção {{1}}' }] });
}

for (const format of ['IMAGE', 'VIDEO', 'DOCUMENT']) {
  test(`envia ${format} do modelo aprovado e persiste a mídia sem mudar o número nem os parâmetros`, async () => {
    const db = createFakePrisma();
    const created = await conversations.createConversation({ name: 'Cliente teste', phone: '5565999999999', channelId: 2 }, db);
    const template = modelo(format);
    const body = [{ type: 'body', parameters: [{ type: 'text', text: 'ICON VET' }] }];
    let enviados;
    const message = await conversations.sendTemplate(created.conversation.id, {
      templateName: template.name, language: template.language, components: body
    }, null, { db, findTemplate: async () => ({ template }),
      sendTemplateMessage: async (_to, _name, _language, components, phoneNumberId) => {
        assert.equal(phoneNumberId, db.state.channels[1].phoneNumberId);
        enviados = components;
        return { messages: [{ id: `wamid.${format}` }] };
      } });
    const type = format.toLowerCase();
    assert.deepEqual(enviados[0], { type: 'header', parameters: [{ type, [type]: { link: 'https://scontent.whatsapp.net/modelo.jpg' } }] });
    assert.equal(enviados[1], body[0]);
    assert.equal(body.length, 1);
    assert.equal(message.templateData.headerMedia.type, type);
    assert.equal(message.templateData.headerMedia.link, template.header.media.link);
    assert.equal(message.renderedText, 'Promoção ICON VET');
  });
}

test('preserva mídia informada e aceita ID de envio sem confundir com handle de aprovação', () => {
  const components = [{ type: 'header', parameters: [{ type: 'video', video: { id: '123456789' } }] }];
  assert.deepEqual(templates.prepareTemplateComponents(modelo('VIDEO'), components), components);
  assert.throws(() => templates.prepareTemplateComponents(modelo('VIDEO'), [{ type: 'header', parameters: [{ type: 'video', video: { id: '4:upload-handle' } }] }]), /ID ou link válido/);
});

test('mídia ausente, formato divergente e links inseguros são bloqueados antes do envio', () => {
  for (const examples of [[], ['4:upload-handle'], ['javascript:alert(1)'], ['https://user:password@example.com/x']]) {
    assert.throws(() => templates.prepareTemplateComponents(modelo('IMAGE', examples)), /mídia da aprovação não está disponível/);
  }
  assert.throws(() => templates.prepareTemplateComponents(modelo('IMAGE'), [{ type: 'header', parameters: [{ type: 'text', text: 'imagem' }] }]), /exige uma mídia/);
  assert.throws(() => templates.prepareTemplateComponents(modelo('IMAGE'), [{ type: 'header', parameters: [{ type: 'image', image: { link: 'file:///secrets' } }] }]), /exige uma mídia/);
});

test('erro de validação de mídia não chama Meta nem grava uma mensagem enviada', async () => {
  const db = createFakePrisma();
  const created = await conversations.createConversation({ name: 'Cliente teste', phone: '5565999999999' }, db);
  await assert.rejects(conversations.sendTemplate(created.conversation.id, { templateName: 'promocao_syngenta', language: 'pt_BR' }, null, {
    db, findTemplate: async () => ({ template: modelo('IMAGE', []) }),
    sendTemplateMessage: () => assert.fail('Não deve enviar template sem mídia')
  }), /mídia da aprovação não está disponível/);
  assert.equal(db.state.messages.length, 0);
});

test('templates de texto e formatos com componentes próprios mantêm o contrato existente', () => {
  const body = [{ type: 'body', parameters: [{ type: 'text', text: 'texto' }] }];
  assert.deepEqual(templates.prepareTemplateComponents(modelo('TEXT'), body), body);
  const location = [{ type: 'header', parameters: [{ type: 'location', location: { latitude: -15, longitude: -55, name: 'Loja', address: 'Endereço' } }] }];
  assert.deepEqual(templates.prepareTemplateComponents(modelo('LOCATION'), location), location);
});

test('bloqueia cabeçalhos duplicados ou mídia com ID e link ao mesmo tempo', () => {
  const header = { type: 'header', parameters: [{ type: 'image', image: { link: 'https://example.com/image.jpg' } }] };
  assert.throws(() => templates.prepareTemplateComponents(modelo('IMAGE'), [header, header]), /exige uma mídia/);
  assert.throws(() => templates.prepareTemplateComponents(modelo('IMAGE'), [{ ...header, parameters: [{ type: 'image', image: { id: '123', link: 'https://example.com/x' } }] }]), /exige uma mídia/);
});
