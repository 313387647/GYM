const { renderPersona } = require('../persona/persona-renderer');

function buildResponse(scene, facts, tone) {
  return renderPersona({ scene, facts, tone });
}

module.exports = { buildResponse };
