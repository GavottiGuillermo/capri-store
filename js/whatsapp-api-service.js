const DEFAULT_API_BASE_URL = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com';
const DEFAULT_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v25.0';
const DEFAULT_TIMEOUT_MS = Number(process.env.WHATSAPP_API_TIMEOUT_MS || '15000');
const USE_WHATSAPP_API_RAW = process.env.USE_WHATSAPP_API ?? process.env.WHATSAPP_API_ENABLED ?? 'false';
const WHATSAPP_API_PHONE_NUMBER_ID = process.env.WHATSAPP_API_PHONE_NUMBER_ID;
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const WHATSAPP_API_TEMPLATE_NAME = process.env.WHATSAPP_API_TEMPLATE_NAME;
const WHATSAPP_API_TEMPLATE_LANGUAGE = process.env.WHATSAPP_API_TEMPLATE_LANGUAGE || 'es';

const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch : null;
const AbortControllerCtor = typeof globalThis.AbortController === 'function' ? globalThis.AbortController : null;

function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === undefined || value === null) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

const flagEnabled = parseBoolean(USE_WHATSAPP_API_RAW);

function sanitizeBaseUrl() {
  return DEFAULT_API_BASE_URL.replace(/\/+$/, '');
}

function buildEndpoint() {
  return `${sanitizeBaseUrl()}/${DEFAULT_API_VERSION}/${WHATSAPP_API_PHONE_NUMBER_ID}/messages`;
}

function getMissingConfig() {
  const missing = [];
  if (!WHATSAPP_API_PHONE_NUMBER_ID) {
    missing.push('WHATSAPP_API_PHONE_NUMBER_ID');
  }
  if (!WHATSAPP_API_TOKEN) {
    missing.push('WHATSAPP_API_TOKEN');
  }
  return missing;
}

function isConfigured() {
  return getMissingConfig().length === 0;
}

function shouldUseWhatsAppApi() {
  return flagEnabled && isConfigured();
}

function getWhatsAppApiStatus() {
  const missing = getMissingConfig();
  return {
    flagEnabled,
    configured: missing.length === 0,
    missing,
    baseUrl: sanitizeBaseUrl(),
    version: DEFAULT_API_VERSION,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    templateName: WHATSAPP_API_TEMPLATE_NAME || null,
    templateLanguage: WHATSAPP_API_TEMPLATE_LANGUAGE,
    templateConfigured: Boolean(WHATSAPP_API_TEMPLATE_NAME)
  };
}

function buildTemplatePayload(numero, templateName, languageCode, parameters = []) {
  const sanitizedParams = Array.isArray(parameters)
    ? parameters.map((value) => ({ type: 'text', text: String(value ?? '') }))
    : [];

  return {
    messaging_product: 'whatsapp',
    to: numero.trim(),
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode || WHATSAPP_API_TEMPLATE_LANGUAGE },
      components: [
        {
          type: 'body',
          parameters: sanitizedParams
        }
      ]
    }
  };
}

async function sendWhatsAppApiMessage(numero, mensaje, meta = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [WhatsAppAPI] Preparando envío`);
  console.log(`[${timestamp}] [WhatsAppAPI] Flag habilitado: ${flagEnabled}`);

  if (!shouldUseWhatsAppApi()) {
    return { success: false, skipped: true, reason: 'api_disabled_or_unconfigured' };
  }

  if (!fetchFn) {
    return { success: false, error: 'Fetch API no disponible en este entorno' };
  }

  if (!numero || typeof numero !== 'string' || numero.trim().length < 5) {
    return { success: false, error: 'Número de destino inválido para WhatsApp API' };
  }

  if (!mensaje || typeof mensaje !== 'string') {
    return { success: false, error: 'Mensaje inválido para WhatsApp API' };
  }

  const endpoint = buildEndpoint();
  const payload = {
    messaging_product: 'whatsapp',
    to: numero.trim(),
    type: 'text',
    text: {
      preview_url: Boolean(meta.previewUrl),
      body: mensaje
    }
  };

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${WHATSAPP_API_TOKEN}`
  };

  const controller = AbortControllerCtor ? new AbortControllerCtor() : null;
  let timeoutId = null;

  if (controller) {
    timeoutId = setTimeout(() => {
      controller.abort();
    }, DEFAULT_TIMEOUT_MS);
  }

  try {
    console.log(`[${timestamp}] [WhatsAppAPI] POST ${endpoint}`);
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    });

    let responseBody = {};
    try {
      responseBody = await response.json();
    } catch (parseError) {
      console.warn(`[${timestamp}] [WhatsAppAPI] No se pudo parsear la respuesta JSON: ${parseError.message}`);
    }

    if (!response.ok) {
      console.error(`[${timestamp}] [WhatsAppAPI] Error HTTP ${response.status}`);
      const errorMessage = responseBody?.error?.message || `HTTP ${response.status}`;
      return {
        success: false,
        error: errorMessage,
        status: response.status,
        details: responseBody,
        transport: 'whatsapp_api'
      };
    }

    const messageId = responseBody?.messages?.[0]?.id;
    console.log(`[${timestamp}] [WhatsAppAPI] Mensaje enviado correctamente (ID: ${messageId || 'desconocido'})`);
    return {
      success: true,
      messageId,
      raw: responseBody,
      transport: 'whatsapp_api'
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`[${timestamp}] [WhatsAppAPI] Timeout tras ${DEFAULT_TIMEOUT_MS}ms`);
      return { success: false, error: 'Timeout enviando mensaje por WhatsApp API', transport: 'whatsapp_api' };
    }
    console.error(`[${timestamp}] [WhatsAppAPI] Error general: ${error.message}`);
    return { success: false, error: error.message, transport: 'whatsapp_api' };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function sendWhatsAppApiTemplateMessage(numero, templateName, languageCode, parameters = [], meta = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [WhatsAppAPI] Preparando envío con plantilla`);
  console.log(`[${timestamp}] [WhatsAppAPI] Flag habilitado: ${flagEnabled}`);

  if (!shouldUseWhatsAppApi()) {
    return { success: false, skipped: true, reason: 'api_disabled_or_unconfigured' };
  }

  if (!fetchFn) {
    return { success: false, error: 'Fetch API no disponible en este entorno' };
  }

  if (!numero || typeof numero !== 'string' || numero.trim().length < 5) {
    return { success: false, error: 'Número de destino inválido para WhatsApp API' };
  }

  if (!templateName || typeof templateName !== 'string') {
    return { success: false, error: 'Template inválido para WhatsApp API' };
  }

  const endpoint = buildEndpoint();
  const payload = buildTemplatePayload(numero, templateName, languageCode, parameters);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${WHATSAPP_API_TOKEN}`
  };

  const controller = AbortControllerCtor ? new AbortControllerCtor() : null;
  let timeoutId = null;

  if (controller) {
    timeoutId = setTimeout(() => {
      controller.abort();
    }, DEFAULT_TIMEOUT_MS);
  }

  try {
    console.log(`[${timestamp}] [WhatsAppAPI] POST ${endpoint}`);
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    });

    let responseBody = {};
    try {
      responseBody = await response.json();
    } catch (parseError) {
      console.warn(`[${timestamp}] [WhatsAppAPI] No se pudo parsear la respuesta JSON: ${parseError.message}`);
    }

    if (!response.ok) {
      console.error(`[${timestamp}] [WhatsAppAPI] Error HTTP ${response.status}`);
      const errorMessage = responseBody?.error?.message || `HTTP ${response.status}`;
      return {
        success: false,
        error: errorMessage,
        status: response.status,
        details: responseBody,
        transport: 'whatsapp_api'
      };
    }

    const messageId = responseBody?.messages?.[0]?.id;
    console.log(`[${timestamp}] [WhatsAppAPI] Plantilla enviada correctamente (ID: ${messageId || 'desconocido'})`);
    return {
      success: true,
      messageId,
      raw: responseBody,
      transport: 'whatsapp_api'
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`[${timestamp}] [WhatsAppAPI] Timeout tras ${DEFAULT_TIMEOUT_MS}ms`);
      return { success: false, error: 'Timeout enviando plantilla por WhatsApp API', transport: 'whatsapp_api' };
    }
    console.error(`[${timestamp}] [WhatsAppAPI] Error general: ${error.message}`);
    return { success: false, error: error.message, transport: 'whatsapp_api' };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

module.exports = {
  shouldUseWhatsAppApi,
  getWhatsAppApiStatus,
  sendWhatsAppApiMessage,
  sendWhatsAppApiTemplateMessage
};
