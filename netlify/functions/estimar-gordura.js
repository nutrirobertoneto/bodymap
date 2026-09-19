// netlify/functions/estimar-gordura.js
// Recebe uma foto (base64) do BodyMap, chama a API da Anthropic com a chave
// protegida (guardada nas Environment Variables do Netlify) e devolve uma
// estimativa aproximada de % de gordura corporal.

exports.handler = async (event) => {
  // Só aceita chamadas vindas do próprio BodyMap (reduz uso indevido da chave de API)
  const PERMITIDAS = ['https://bodymapmetric.netlify.app'];
  const origem = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const headers = {
    'Access-Control-Allow-Origin': PERMITIDAS.includes(origem) ? origem : PERMITIDAS[0],
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
  if (origem && !PERMITIDAS.includes(origem)) {
    return { statusCode: 403, headers, body: JSON.stringify({ erro: 'Origem não autorizada' }) };
  }

  // Pré-checagem do navegador (CORS) - responde OK sem fazer nada
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ erro: 'Método não permitido' }) };
  }

  try {
    const { imagemBase64, mediaType, sexo, idade } = JSON.parse(event.body || '{}');

    if (!imagemBase64) {
      return { statusCode: 400, headers, body: JSON.stringify({ erro: 'Nenhuma imagem enviada' }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ erro: 'Chave de API não configurada no servidor' }) };
    }

    const promptTexto = `Você está ajudando um profissional de nutrição a fazer uma TRIAGEM visual aproximada de percentual de gordura corporal a partir de uma foto${sexo ? `, de uma pessoa do sexo ${sexo === 'F' ? 'feminino' : 'masculino'}` : ''}${idade ? `, ${idade} anos` : ''}.

Isso é apenas uma estimativa de apoio — NÃO substitui plicometria, bioimpedância ou avaliação profissional. Considere postura, definição muscular visível, distribuição de gordura (abdominal, quadril, etc).

Responda ESTRITAMENTE neste formato, sem texto adicional:
PERCENTUAL: [número]
FAIXA: [número mínimo]-[número máximo]
CONFIANCA: [baixa/média/alta]
OBSERVACAO: [uma frase curta sobre o que embasou a estimativa]`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imagemBase64 } },
            { type: 'text', text: promptTexto }
          ]
        }]
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      return { statusCode: resp.status, headers, body: JSON.stringify({ erro: 'Erro na API da Anthropic', detalhe: data }) };
    }

    const textoResposta = (data.content && data.content[0] && data.content[0].text) || '';

    // Parse simples do formato estruturado que pedimos no prompt
    const pctMatch = textoResposta.match(/PERCENTUAL:\s*([\d.,]+)/i);
    const faixaMatch = textoResposta.match(/FAIXA:\s*([\d.,]+)\s*-\s*([\d.,]+)/i);
    const confMatch = textoResposta.match(/CONFIANCA:\s*([^\n]+)/i);
    const obsMatch = textoResposta.match(/OBSERVACAO:\s*(.+)/i);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        percentual: pctMatch ? parseFloat(pctMatch[1].replace(',', '.')) : null,
        faixaMin: faixaMatch ? parseFloat(faixaMatch[1].replace(',', '.')) : null,
        faixaMax: faixaMatch ? parseFloat(faixaMatch[2].replace(',', '.')) : null,
        confianca: confMatch ? confMatch[1].trim() : null,
        observacao: obsMatch ? obsMatch[1].trim() : null,
        textoOriginal: textoResposta
      })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ erro: 'Erro interno', detalhe: err.message }) };
  }
};
