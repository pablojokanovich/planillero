const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OPENAI_API_KEY = 'test-key';
const handler = require('../api/ai-plan');

function invoke(body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(value) {
        try { resolve({ status: this.statusCode, body: JSON.parse(value) }); }
        catch (error) { reject(error); }
      }
    };
    Promise.resolve(handler({ method, body }, response)).catch(reject);
  });
}

test('rechaza métodos distintos de POST', async () => {
  const result = await invoke({}, 'GET');
  assert.equal(result.status, 405);
});

test('rechaza URL de archivo insegura', async () => {
  const result = await invoke({ action: 'analyze', fileUrl: 'file:///orden.pdf' });
  assert.equal(result.status, 400);
});

test('envía PDF y devuelve análisis estructurado', async () => {
  const expected = {
    event: { os: '0123', name: 'Evento', venue: 'CEC', setup_date: '01-10-2026', strike_date: '02-10-2026' },
    rooms: ['PLENARIA'], confirmed: [], deduced: [], warnings: [], questions: []
  };
  let sentBody;
  global.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: JSON.stringify(expected) }) };
  };
  const result = await invoke({ action: 'analyze', fileUrl: 'https://example.com/orden.pdf', customRules: ['Regla aprobada'] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.result, expected);
  assert.equal(sentBody.input[0].content[0].type, 'input_file');
  assert.equal(sentBody.input[0].content[0].file_url, 'https://example.com/orden.pdf');
  assert.match(sentBody.instructions, /Regla aprobada/);
  assert.equal(sentBody.text.format.strict, true);
});

test('generate requiere análisis, respuestas e inventario', async () => {
  const result = await invoke({ action: 'generate', fileUrl: 'https://example.com/orden.pdf' });
  assert.equal(result.status, 400);
});
