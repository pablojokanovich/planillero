const { CCTV_RULES } = require('./_cctv-rules');

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['event', 'rooms', 'confirmed', 'deduced', 'warnings', 'questions'],
  properties: {
    event: {
      type: 'object', additionalProperties: false,
      required: ['os', 'name', 'venue', 'setup_date', 'strike_date'],
      properties: {
        os: { type: 'string' }, name: { type: 'string' }, venue: { type: 'string' },
        setup_date: { type: 'string' }, strike_date: { type: 'string' }
      }
    },
    rooms: { type: 'array', items: { type: 'string' } },
    confirmed: { type: 'array', items: { type: 'string' } },
    deduced: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    questions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'room', 'question', 'reason', 'required'],
        properties: {
          id: { type: 'string' }, room: { type: 'string' }, question: { type: 'string' },
          reason: { type: 'string' }, required: { type: 'boolean' }
        }
      }
    }
  }
};

const planSchema = {
  type: 'object', additionalProperties: false,
  required: ['event', 'status', 'rooms', 'confirmed', 'deduced', 'preventive', 'pending', 'notes'],
  properties: {
    event: {
      type: 'object', additionalProperties: false,
      required: ['os', 'name', 'venue', 'setup_date', 'strike_date'],
      properties: {
        os: { type: 'string' }, name: { type: 'string' }, venue: { type: 'string' },
        setup_date: { type: 'string' }, strike_date: { type: 'string' }
      }
    },
    status: { type: 'string', enum: ['draft'] },
    rooms: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'items', 'personnel', 'notes'],
        properties: {
          name: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              required: ['category', 'item', 'quantity', 'observation', 'basis'],
              properties: {
                category: { type: 'string' }, item: { type: 'string' }, quantity: { type: 'integer', minimum: 1 },
                observation: { type: 'string' }, basis: { type: 'string', enum: ['confirmed', 'deduced', 'preventive'] }
              }
            }
          },
          personnel: { type: 'array', items: { type: 'string' } },
          notes: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    confirmed: { type: 'array', items: { type: 'string' } },
    deduced: { type: 'array', items: { type: 'string' } },
    preventive: { type: 'array', items: { type: 'string' } },
    pending: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } }
  }
};

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function outputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  throw new Error('OpenAI no devolvió contenido de texto.');
}

async function callOpenAI({ fileUrl, action, analysis, answers, inventory, customRules }) {
  const isAnalyze = action === 'analyze';
  const schema = isAnalyze ? analysisSchema : planSchema;
  const schemaName = isAnalyze ? 'cctv_order_analysis' : 'cctv_draft_plan';
  const task = isAnalyze
    ? `Analizá esta orden de servicio. Detectá salas, requisitos de CCTV, contradicciones y toda pregunta necesaria antes de generar la planilla. No hagas preguntas ya resueltas explícitamente en la orden. Si falta una decisión que según las reglas debe consultar Pablo, incluila.`
    : `Generá el borrador editable final por sala usando el análisis y las respuestas. Solo podés usar nombres exactos presentes en INVENTARIO CCTV. No incluyas KIT VMIX como renglón; expandilo en sus componentes. No dejes preguntas ya respondidas. Si todavía queda una decisión crítica sin responder, registrala en pending y no inventes el equipo afectado.

ANÁLISIS PREVIO:\n${JSON.stringify(analysis || {})}

RESPUESTAS DEL USUARIO:\n${JSON.stringify(answers || {})}

INVENTARIO CCTV AUTORIZADO:\n${JSON.stringify(inventory || [])}`;

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      instructions: `${CCTV_RULES}\n\nREGLAS CONFIRMADAS POSTERIORMENTE POR EL EQUIPO:\n${(customRules || []).map((rule, index) => `${index + 1}. ${rule}`).join('\n') || 'Ninguna.'}`,
      input: [{
        role: 'user',
        content: [
          { type: 'input_file', file_url: fileUrl, detail: 'high' },
          { type: 'input_text', text: task }
        ]
      }],
      text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } }
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI respondió ${response.status}.`);
  return JSON.parse(outputText(data));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido.' });
  if (!process.env.OPENAI_API_KEY) return sendJson(res, 500, { error: 'Falta configurar OPENAI_API_KEY en Vercel.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { action, fileUrl, analysis, answers, inventory } = body;
    const customRules = Array.isArray(body.customRules)
      ? body.customRules.slice(0, 100).map(value => String(value).trim().slice(0, 1000)).filter(Boolean)
      : [];
    if (!['analyze', 'generate'].includes(action)) return sendJson(res, 400, { error: 'Acción inválida.' });
    if (!validHttpUrl(fileUrl)) return sendJson(res, 400, { error: 'La URL del PDF no es válida.' });
    if (action === 'generate' && (!analysis || !answers || !Array.isArray(inventory))) {
      return sendJson(res, 400, { error: 'Faltan el análisis, las respuestas o el inventario.' });
    }
    const result = await callOpenAI({ fileUrl, action, analysis, answers, inventory, customRules });
    return sendJson(res, 200, { result, model: MODEL });
  } catch (error) {
    console.error('ai-plan error', error);
    return sendJson(res, 500, { error: error.message || 'No se pudo procesar la orden.' });
  }
};
