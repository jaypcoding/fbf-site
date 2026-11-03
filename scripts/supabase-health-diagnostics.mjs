const MAX_RESPONSE_LENGTH = 2048;
const MAX_MESSAGE_LENGTH = 240;

function redactSensitiveText(message, secrets) {
  let safeMessage = message;

  for (const secret of secrets) {
    if (secret) safeMessage = safeMessage.split(secret).join('[redacted]');
  }

  return safeMessage
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

export async function getSafeResponseMessage(response, secrets = []) {
  let body;
  try {
    body = (await response.text()).slice(0, MAX_RESPONSE_LENGTH);
  } catch {
    return 'Não foi possível ler a mensagem da resposta.';
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 'A resposta não contém uma mensagem JSON segura para exibir.';
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return 'A resposta não contém uma mensagem JSON segura para exibir.';
  }

  const candidate = [parsed.message, parsed.msg, parsed.error_description, parsed.error]
    .find((value) => typeof value === 'string' && value.trim());

  if (!candidate) return 'A resposta não informou uma mensagem de diagnóstico.';

  return redactSensitiveText(candidate, secrets) || 'A resposta não informou uma mensagem segura.';
}
